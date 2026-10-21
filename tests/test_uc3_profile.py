"""coastal-uc3-sentinel2 registration: schema, dispatch, envelope and error mapping.

The UC3 package is exercised for real up to request translation; acquisition and
publication are replaced by a recorded result fixture (no CDSE, no storage).
"""

import json
import os
from importlib import resources
from threading import Event, Thread
from unittest.mock import Mock

import httpx
import pytest

from app.main import app
from wp2_uc3_ingestion.errors import ConfigurationError
from wp2_uc3_ingestion.profile import build_acquisition_request


@pytest.fixture(autouse=True)
def isolated_uc3_environment(monkeypatch):
    for name in os.environ:
        if name.startswith("UC3_INGEST_"):
            monkeypatch.delenv(name)


UC3_REQUEST = {
    "run_job_id": "airflow-run-aoi_01-1",
    "triggered_at": "2026-10-08T00:05:00Z",
    "provider": "sentinel-2",
    "profile": "coastal-uc3-sentinel2",
    "aoi_id": "aoi_01",
    "bbox": [-2.88294, 56.33412, -2.80112, 56.3715],
    "uc3": {
        "contract_version": 2,
        "mode": "latest",
        "time_from": "2026-09-08T00:00:00Z",
        "time_to": "2026-10-08T00:00:00Z",
        "selection_policy": "uc3_parity_pilot",
    },
}
UC1_REQUEST = {
    "run_job_id": "job-sperchios-001",
    "triggered_at": "2026-08-11T10:00:00+03:00",
    "provider": "sentinel-2",
    "profile": "forecaster-collector",
    "aoi_id": "sperchios",
    "bbox": [22.433493, 38.837552, 22.569555, 38.894223],
    "run_name": "sperchios",
}


def fixture(name: str) -> dict:
    return json.loads(resources.files("wp2_uc3_ingestion").joinpath("examples", name).read_text())


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as value:
        yield value


@pytest.fixture
def recorded(monkeypatch):
    """Translate with the real package, then return a recorded completed result."""
    seen = {}

    def fake_run_profile(config):
        seen["config"] = dict(config)
        seen["request"] = build_acquisition_request(config, default_project_id="terra-pilot")
        return fixture("wp2_run_response_completed.fixture.json")["collector_result"]

    monkeypatch.setattr("app.adapters.uc3.run_profile", fake_run_profile)
    return seen


async def test_uc3_run_returns_the_wp2_envelope(client, recorded):
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["profile"] == "coastal-uc3-sentinel2"
    assert body["status"] == body["collector_result"]["status"] == "completed"
    assert body["collector_result"]["scene_asset_ids"]
    # UC1 defaults do not reach the UC3 package.
    assert "run_name" not in recorded["config"] and "history_start" not in recorded["config"]
    assert recorded["config"]["profile"] == "coastal-uc3-sentinel2"
    request = recorded["request"]
    assert request["data_specification"]["provider"] == "CDSE"
    assert request["time_range"] == {"from": "2026-09-08T00:00:00Z", "to": "2026-10-08T00:00:00Z"}
    assert request["correlation_id"] == "airflow-run-aoi_01-1"


@pytest.mark.parametrize(
    "invalid",
    [
        {key: value for key, value in UC3_REQUEST.items() if key != "uc3"},
        {**UC3_REQUEST, "uc3": {**UC3_REQUEST["uc3"], "mongodb_uri": "mongodb://elsewhere/terra_uc3"}},
        {**UC3_REQUEST, "uc3": {**UC3_REQUEST["uc3"], "time_from": "2026-09-08T00:00:00"}},
        {**UC3_REQUEST, "uc3": {**UC3_REQUEST["uc3"], "time_to": "2026-09-01T00:00:00Z"}},
        {**UC3_REQUEST, "uc3": {**UC3_REQUEST["uc3"], "selection_policy": "custom"}},
        {**UC3_REQUEST, "provider": "CDSE"},
        {**UC1_REQUEST, "uc3": UC3_REQUEST["uc3"]},
        {key: value for key, value in UC1_REQUEST.items() if key != "run_name"},
    ],
    ids=["no_uc3", "storage_field", "naive_time", "empty_window", "free_policy", "outer_provider", "uc3_on_uc1", "uc1_without_run_name"],
)
async def test_profile_specific_validation(client, invalid):
    response = await client.post("/api/ingestion/run", json=invalid)
    assert response.status_code == 422


async def test_uc1_requests_are_unchanged(monkeypatch, client):
    result = Mock()
    result.to_dict.return_value = {"status": "success"}
    monkeypatch.setattr("app.adapters.collector.collect", Mock(return_value=result))
    response = await client.post("/api/ingestion/run", json=UC1_REQUEST)
    assert response.status_code == 200 and response.json()["status"] == "success"


async def test_uc3_configuration_errors_are_400_without_secrets(monkeypatch, client):
    def missing_settings(config):
        raise ConfigurationError("Publication requires UC3_INGEST_MONGODB_URI")

    monkeypatch.setattr("app.adapters.uc3.run_profile", missing_settings)
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "collector_configuration_error"


async def test_uc3_unexpected_errors_are_masked(monkeypatch, client):
    monkeypatch.setattr("app.adapters.uc3.run_profile", Mock(side_effect=RuntimeError("mongodb://u:" + "pw@host")))
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 500 and "pw@host" not in response.text


async def test_failed_outcome_keeps_its_result_body(monkeypatch, client):
    failed = fixture("wp2_run_response_failed.fixture.json")["collector_result"]
    monkeypatch.setattr("app.adapters.uc3.run_profile", Mock(return_value=failed))
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["collector_result"]["error"]["error_code"] == "PROVIDER_UNAVAILABLE"


async def test_concurrent_run_for_the_same_aoi_is_409(monkeypatch, client):
    started, release = Event(), Event()

    def slow(config):
        started.set()
        release.wait(5)
        return fixture("wp2_run_response_no_data.fixture.json")["collector_result"]

    monkeypatch.setattr("app.adapters.uc3.run_profile", slow)
    from app.adapters.uc3 import run_uc3_adapter

    worker = Thread(target=run_uc3_adapter, args=(UC3_REQUEST,))
    worker.start()
    started.wait(5)
    try:
        response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
        assert response.status_code == 409
    finally:
        release.set()
        worker.join()


@pytest.mark.parametrize("outcome", ["completed", "no_data", "failed"])
async def test_all_outcomes_preserve_full_result(monkeypatch, client, outcome):
    result = fixture(f"wp2_run_response_{outcome}.fixture.json")["collector_result"]
    execute = Mock(return_value=result)
    monkeypatch.setattr("app.adapters.uc3.run_profile", execute)
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 200
    assert response.json()["status"] == outcome
    assert response.json()["collector_result"] == result
    assert response.json()["profile"] == "coastal-uc3-sentinel2"
    execute.assert_called_once()


@pytest.mark.parametrize("change", [{"aoi_id": "unapproved"}, {"bbox": [22, 38, 23, 39]}])
async def test_unauthorised_aoi_never_reaches_acquisition(monkeypatch, client, change):
    execute = Mock()
    monkeypatch.setattr("app.adapters.uc3.run_profile", execute)
    response = await client.post("/api/ingestion/run", json={**UC3_REQUEST, **change})
    assert response.status_code == 400
    execute.assert_not_called()


@pytest.mark.parametrize("options", [
    {"max_scenes": 0}, {"max_scenes": 25}, {"max_scenes": True}, {"max_scenes": 1.5},
    {"mode": "auto"}, {"contract_version": 1}, {"time_to": UC3_REQUEST["uc3"]["time_from"]},
])
async def test_invalid_uc3_options(client, options):
    response = await client.post("/api/ingestion/run", json={
        **UC3_REQUEST, "uc3": {**UC3_REQUEST["uc3"], **options},
    })
    assert response.status_code == 422


def test_package_resources_and_supported_entry_point(monkeypatch):
    from wp2_uc3_ingestion.contract import load_schema
    from wp2_uc3_ingestion.requests_builder import load_authorised_aois
    from app.adapters.uc3 import run_profile

    assert load_schema("acquisition_request")["type"] == "object"
    assert load_authorised_aois()["aois"]
    execute = Mock(return_value={"status": "no_data"})
    monkeypatch.setattr("wp2_uc3_ingestion.profile.run_profile", execute)
    config = {"profile": "coastal-uc3-sentinel2"}
    assert run_profile(config) == {"status": "no_data"}
    execute.assert_called_once_with(config)


@pytest.mark.parametrize("result", [{"status": "success"}, {"status": "completed", "outcome": "failed"}, None])
async def test_invalid_package_outcomes_are_not_success(monkeypatch, client, result):
    monkeypatch.setattr("app.adapters.uc3.run_profile", Mock(return_value=result))
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 500


async def test_missing_package_returns_503_without_disabling_uc1(monkeypatch, client):
    import builtins

    original = builtins.__import__

    def unavailable(name, *args, **kwargs):
        if name.startswith("wp2_uc3_ingestion"):
            raise ImportError("private installation detail")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", unavailable)
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 503
    assert "private installation detail" not in response.text
    result = Mock()
    result.to_dict.return_value = {"status": "success"}
    monkeypatch.setattr("app.adapters.collector.collect", Mock(return_value=result))
    assert (await client.post("/api/ingestion/run", json=UC1_REQUEST)).status_code == 200


async def test_dispatch_runs_outside_event_loop(monkeypatch, client):
    from threading import get_ident

    caller_thread = get_ident()
    threads = []

    def execute(config):
        threads.append(get_ident())
        return {"status": "no_data"}

    monkeypatch.setattr("app.adapters.uc3.run_profile", execute)
    assert (await client.post("/api/ingestion/run", json=UC3_REQUEST)).status_code == 200
    assert threads and threads[0] != caller_thread


async def test_operator_registry_override_is_respected(monkeypatch, client, tmp_path):
    registry = tmp_path / "aois.json"
    registry.write_text(json.dumps({"schema": "uc3_authorised_aois_v1", "aois": []}))
    monkeypatch.setenv("UC3_INGEST_AOI_REGISTRY_FILE", str(registry))
    execute = Mock()
    monkeypatch.setattr("app.adapters.uc3.run_profile", execute)
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 400
    execute.assert_not_called()


@pytest.mark.parametrize("missing", ["time_from", "time_to"])
async def test_missing_window_bounds_are_rejected(client, missing):
    options = {key: value for key, value in UC3_REQUEST["uc3"].items() if key != missing}
    response = await client.post("/api/ingestion/run", json={**UC3_REQUEST, "uc3": options})
    assert response.status_code == 422


async def test_offset_window_normalises_to_utc(client, recorded):
    options = {**UC3_REQUEST["uc3"], "time_from": "2026-09-08T03:00:00+03:00"}
    response = await client.post("/api/ingestion/run", json={**UC3_REQUEST, "uc3": options})
    assert response.status_code == 200
    assert recorded["request"]["time_range"]["from"] == "2026-09-08T00:00:00Z"


@pytest.fixture
def package_execution(monkeypatch):
    """Run the real UC3 entry point; replace only its external acquisition pipeline."""
    from wp2_uc3_ingestion.settings import IngestionSettings

    settings = IngestionSettings(
        project_id="terra-pilot", cdse_client_id="fixture", cdse_client_secret="fixture",
        mongodb_uri="mongodb://fixture.invalid/test", mongodb_database="test",
        minio_endpoint="fixture.invalid:9000", minio_access_key="fixture",
        minio_secret_key="fixture", minio_bucket="test", minio_prefix="test",
    )
    monkeypatch.setattr("wp2_uc3_ingestion.settings.IngestionSettings.from_env", lambda: settings)
    pipeline = Mock()
    pipeline.run.return_value = fixture("wp2_run_response_no_data.fixture.json")["collector_result"]
    factory = Mock(return_value=pipeline)
    monkeypatch.setattr("wp2_uc3_ingestion.profile.IngestionPipeline", factory)
    return settings, pipeline, factory


@pytest.mark.parametrize("outcome", ["completed", "no_data", "failed"])
async def test_real_entry_point_preserves_outcomes_and_cleans_up(client, package_execution, outcome):
    from pathlib import Path

    _, pipeline, factory = package_execution
    raw = fixture(f"wp2_run_response_{outcome}.fixture.json")["collector_result"]
    raw = {key: value for key, value in raw.items() if key not in {"status", "scene_asset_ids"}}
    pipeline.run.return_value = raw
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 200
    result = response.json()["collector_result"]
    assert result == {**raw, "status": outcome, "scene_asset_ids": [s["scene_asset_id"] for s in raw["scene_packages"]]}
    factory.assert_called_once()
    pipeline.close.assert_called_once_with()
    assert pipeline.run.call_args.kwargs["publish"] is True
    assert not Path(pipeline.run.call_args.kwargs["output_dir"]).exists()


@pytest.mark.parametrize("mode", ["latest", "window"])
@pytest.mark.parametrize("policy", ["uc3_parity_pilot", "uc3_monthly_backfill"])
@pytest.mark.parametrize("limit", [None, 1, 24])
async def test_modes_policies_limits_and_metadata(client, package_execution, mode, policy, limit):
    _, pipeline, _ = package_execution
    options = {**UC3_REQUEST["uc3"], "mode": mode, "selection_policy": policy,
               "project_id": "terra-pilot", "request_id": "explicit-request-1",
               "registry_version": "fixture-v1", "window_id": "2026-09"}
    if limit is not None:
        options["max_scenes"] = limit
    response = await client.post("/api/ingestion/run", json={**UC3_REQUEST, "uc3": options})
    assert response.status_code == 200
    request = pipeline.run.call_args.args[0]
    assert request["mode"] == mode
    assert request["selection"]["policy_name"] == policy
    assert request["selection"]["max_scenes"] == (3 if limit is None else limit)
    assert request["request_id"] == "explicit-request-1"
    assert request["aoi"]["registry_version"] == "fixture-v1"
    assert request["window_id"] == "2026-09"
    assert request["project_id"] == "terra-pilot"


async def test_retry_identity_and_environment_project(client, package_execution):
    _, pipeline, _ = package_execution
    first = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    a = pipeline.run.call_args.args[0]
    second = await client.post("/api/ingestion/run", json={**UC3_REQUEST, "run_job_id": "retry-2", "triggered_at": "2026-10-09T00:00:00Z"})
    b = pipeline.run.call_args.args[0]
    assert first.status_code == second.status_code == 200
    assert a["request_id"] == b["request_id"]
    assert a["correlation_id"] != b["correlation_id"]
    assert a["project_id"] == b["project_id"] == "terra-pilot"


async def test_work_directory_and_exception_cleanup(client, package_execution, monkeypatch, tmp_path):
    _, pipeline, _ = package_execution
    monkeypatch.setenv("UC3_INGEST_WORK_DIR", str(tmp_path))
    pipeline.run.side_effect = RuntimeError("private credential detail")
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 500
    assert "private credential detail" not in response.text
    assert pipeline.run.call_args.kwargs["output_dir"] == str(tmp_path)
    pipeline.close.assert_called_once_with()
    # An exception must release the AOI guard so the next attempt can run.
    pipeline.run.side_effect = None
    assert (await client.post("/api/ingestion/run", json=UC3_REQUEST)).status_code == 200


@pytest.mark.parametrize("missing", ["project_id", "mongodb_uri", "minio_bucket", "cdse_client_id", "cdse_client_secret"])
async def test_real_settings_reject_missing_configuration(client, package_execution, monkeypatch, missing):
    from dataclasses import replace
    settings, _, factory = package_execution
    monkeypatch.setattr("wp2_uc3_ingestion.settings.IngestionSettings.from_env", lambda: replace(settings, **{missing: None}))
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.status_code == 400
    factory.assert_not_called()


async def test_serving_namespace_requires_opt_in(client, package_execution, monkeypatch):
    from dataclasses import replace
    settings, _, factory = package_execution
    shared = replace(settings, mongodb_database="terra-db", mongodb_collection_prefix="uc3_",
                     minio_bucket="terra-bucket", minio_prefix="terra-uc3")
    monkeypatch.setattr("wp2_uc3_ingestion.settings.IngestionSettings.from_env", lambda: shared)
    assert (await client.post("/api/ingestion/run", json=UC3_REQUEST)).status_code == 400
    factory.assert_not_called()
    shared = replace(shared, allow_serving_namespace=True)
    assert (await client.post("/api/ingestion/run", json=UC3_REQUEST)).status_code == 200


@pytest.mark.parametrize("reason", ["no_catalogue_scene_in_interval", "no_scene_passed_tile_prefilter", "no_scene_passed_aoi_quality", "no_scene_passed_preflight"])
async def test_no_data_reasons_are_preserved(client, package_execution, reason):
    _, pipeline, _ = package_execution
    pipeline.run.return_value = {**pipeline.run.return_value, "reason": reason}
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.json()["status"] == "no_data"
    assert response.json()["collector_result"]["reason"] == reason


async def test_completed_with_partial_errors_and_reused_assets(client, package_execution):
    _, pipeline, _ = package_execution
    result = fixture("wp2_run_response_completed.fixture.json")["collector_result"]
    result["candidates"] = [
        {"decision": "error", "error": {"error_code": "RASTER_DOWNLOAD_FAILED", "retryable": True}},
        {"decision": "reused", "scene_asset_id": result["scene_packages"][0]["scene_asset_id"]},
        {"decision": "not_attempted"},
    ]
    pipeline.run.return_value = result
    response = await client.post("/api/ingestion/run", json=UC3_REQUEST)
    assert response.json()["status"] == "completed"
    assert response.json()["collector_result"]["candidates"] == result["candidates"]


def registry_cases():
    from wp2_uc3_ingestion.requests_builder import load_authorised_aois
    registry = load_authorised_aois()
    return [(entry, 200) for entry in registry["aois"]] + [(entry, 400) for entry in registry["excluded"]]


@pytest.mark.parametrize("entry,expected", registry_cases(), ids=lambda value: value.get("aoi_id") if isinstance(value, dict) else str(value))
async def test_all_registry_entries(client, package_execution, entry, expected):
    response = await client.post("/api/ingestion/run", json={**UC3_REQUEST, "aoi_id": entry["aoi_id"], "bbox": entry["bbox"]})
    assert response.status_code == expected


@pytest.mark.parametrize("outcome,action", [("completed", "assimilate"), ("no_data", "skip"), ("failed", None)])
async def test_upstream_helpers_work_without_profile_translation(client, package_execution, outcome, action):
    from wp2_uc3_ingestion.orchestration import GateError, gate_ingestion, wp2_run_payload
    from wp2_uc3_ingestion.contract import schema_errors

    _, pipeline, _ = package_execution
    pipeline.run.return_value = fixture(f"wp2_run_response_{outcome}.fixture.json")["collector_result"]
    request = wp2_run_payload(
        aoi_id=UC3_REQUEST["aoi_id"], bbox=UC3_REQUEST["bbox"],
        time_from=UC3_REQUEST["uc3"]["time_from"], time_to=UC3_REQUEST["uc3"]["time_to"],
        run_job_id=UC3_REQUEST["run_job_id"], triggered_at=UC3_REQUEST["triggered_at"],
    )
    assert schema_errors("wp2_run_request", request) == []
    http_response = await client.post("/api/ingestion/run", json=request)
    assert http_response.status_code == 200
    response = http_response.json()
    assert schema_errors("wp2_run_response", response) == []
    if action is None:
        with pytest.raises(GateError, match="Ingestion failed"):
            gate_ingestion(response, aoi_id=UC3_REQUEST["aoi_id"])
    else:
        assert gate_ingestion(response, aoi_id=UC3_REQUEST["aoi_id"])["action"] == action


async def test_old_profile_is_rejected(client):
    response = await client.post("/api/ingestion/run", json={**UC3_REQUEST, "profile": "uc3profile"})
    assert response.status_code == 422


def test_uc3_catalogue_search_accepts_the_official_geojson_media_type():
    from types import SimpleNamespace

    from wp2_uc3_ingestion.cdse import CDSEClient

    response = Mock(status_code=200)
    response.json.return_value = {"features": []}
    client = CDSEClient(SimpleNamespace(cdse_catalog_url="https://catalogue.example/search"))
    client._post = Mock(return_value=response)

    result = client.search({
        "aoi": {"bbox_wgs84": [0.0, 0.0, 1.0, 1.0]},
        "time_range": {"from": "2026-10-01T00:00:00Z", "to": "2026-10-02T00:00:00Z"},
        "selection": {"max_catalogue_cloud_cover_pct": 80.0},
        "data_specification": {"collection": "sentinel-2-l2a"},
    })

    assert result["catalogue_entries"] == 0
    assert client._post.call_args.kwargs["accept"] == "application/geo+json"
