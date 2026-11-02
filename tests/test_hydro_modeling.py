"""Hydro delegation contract; all downstream traffic uses MockTransport."""

import json

import httpx
import pytest

from app.main import app


BASE_URL = "https://hydro.example/terra/use-case-1/hydro-modeling-service"
AREA = "sperchios"


@pytest.fixture
def downstream(monkeypatch):
    seen = []
    response = {"value": httpx.Response(200, json={"analysis_area_id": AREA, "dataset": "ERA5-Land"})}
    original_client = httpx.Client

    def handle(request):
        seen.append(request)
        value = response["value"]
        return value(request) if callable(value) else value

    def make_client(**kwargs):
        assert kwargs["verify"] is True
        return original_client(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setenv("HYDRO_MODELING_BASE_URL", BASE_URL + "/")
    monkeypatch.setenv("HYDRO_MODELING_API_KEY", "test-secret")
    monkeypatch.setattr("app.adapters.hydro_modeling.httpx.Client", make_client)
    return seen, response


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as value:
        yield value


@pytest.mark.parametrize("method,path,payload,downstream_path,body", [
    ("GET", "/api/hydro-modeling/ecmwf/reanalysis-availability?analysis_area_id=sperchios", None,
     "/data-ingestion/ecmwf/reanalysis-availability",
     {"analysis_area_id": AREA, "dataset": "ERA5-Land", "processing_version": "v1",
      "latest_mongo_reanalysis_date": None, "next_missing_date": "2026-10-30", "lag_days": 1, "future_field": "kept"}),
    ("POST", "/api/hydro-modeling/ecmwf/reanalysis", {"analysis_area_id": AREA, "action_date": "2026-10-30"},
     "/data-ingestion/ecmwf/reanalysis",
     {"status": "completed", "analysis_area_id": AREA, "dataset": "ERA5-Land", "action_date": "2026-10-30",
      "selected_records": 2, "reanalysis_dates": ["2026-10-30"], "inserted": 1, "existing": 1, "updated": 0, "skipped": 0}),
    ("POST", "/api/hydro-modeling/ecmwf/local-forecast", {"analysis_area_id": AREA},
     "/data-ingestion/ecmwf/local-forecast",
     {"status": "completed", "analysis_area_id": AREA, "dataset": "ERA5-Land", "horizon_days": 15,
      "forecast_base_date": "2026-10-30", "forecast_dates": ["2026-10-31"], "records_prepared": 1,
      "inserted": 1, "existing": 0, "updated": 0, "skipped": 0}),
    ("POST", "/api/hydro-modeling/ifs", {"marine_analysis_area_id": "maliakos", "action_date": "2026-10-30"},
     "/data-ingestion/ifs",
     {"status": "completed", "marine_analysis_area_id": "maliakos", "dataset": "IFS", "requested_date": "2026-10-30",
      "horizon_days": 6, "source_files": [{"name": "ifs.grib"}], "inserted": 1, "existing": 0, "updated": 0}),
])
async def test_four_operations_delegate_and_preserve_metadata(client, downstream, method, path, payload, downstream_path, body):
    seen, response = downstream
    response["value"] = httpx.Response(200, json=body)
    result = await client.request(method, path, json=payload)
    assert result.status_code == 200
    envelope = result.json()
    assert envelope["provider"] == "hydro-modeling"
    assert envelope["downstream_status"] == 200
    assert envelope["result"] == body
    assert envelope["request_id"]
    assert seen[0].url.path == "/terra/use-case-1/hydro-modeling-service" + downstream_path
    assert seen[0].headers["X-API-Key"] == "test-secret"
    if method == "GET":
        assert seen[0].url.params["analysis_area_id"] == AREA
    else:
        sent = json.loads(seen[0].content)
        assert sent == {**payload, **({"horizon_days": 15} if downstream_path.endswith("local-forecast") else {}),
                        **({"horizon_days": 6, "source": "ecmwf"} if downstream_path.endswith("/ifs") else {})}


@pytest.mark.parametrize("path,payload", [
    ("/api/hydro-modeling/ecmwf/reanalysis-availability", None),
    ("/api/hydro-modeling/ecmwf/reanalysis", {"analysis_area_id": AREA, "action_date": "30-10-2026"}),
    ("/api/hydro-modeling/ecmwf/local-forecast", {"analysis_area_id": AREA, "horizon_days": 0}),
    ("/api/hydro-modeling/ifs", {"marine_analysis_area_id": " ", "action_date": "2026-10-30"}),
])
async def test_invalid_input_never_reaches_hydro(client, downstream, path, payload):
    seen, _ = downstream
    response = await client.request("GET" if payload is None else "POST", path, json=payload)
    assert response.status_code == 422
    assert not seen


async def test_missing_key_is_configuration_failure(client, downstream, monkeypatch):
    seen, _ = downstream
    monkeypatch.delenv("HYDRO_MODELING_API_KEY")
    response = await client.get("/api/hydro-modeling/ecmwf/reanalysis-availability?analysis_area_id=sperchios")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "hydro_configuration_error"
    assert not seen


def test_timeout_configuration_is_independent(monkeypatch):
    from app.adapters.hydro_modeling import HydroModelingSettings

    monkeypatch.setenv("HYDRO_MODELING_BASE_URL", BASE_URL)
    monkeypatch.setenv("HYDRO_MODELING_API_KEY", "test-secret")
    monkeypatch.setenv("HYDRO_MODELING_TIMEOUT_SECONDS", "30")
    monkeypatch.setenv("HYDRO_MODELING_CONNECT_TIMEOUT_SECONDS", "3")
    settings = HydroModelingSettings.from_env()
    assert settings.read_timeout_seconds == 30
    assert settings.connect_timeout_seconds == 3


@pytest.mark.parametrize("status,expected,code", [
    (401, 502, "hydro_downstream_auth_failed"),
    (403, 502, "hydro_downstream_auth_failed"),
    (422, 422, "hydro_downstream_validation_error"),
    (500, 502, "hydro_downstream_error"),
    (503, 503, "hydro_downstream_unavailable"),
])
async def test_downstream_http_errors(client, downstream, status, expected, code):
    _, result = downstream
    result["value"] = httpx.Response(status, json={"detail": [{"loc": ["body", "action_date"], "msg": "invalid"}]})
    response = await client.post("/api/hydro-modeling/ecmwf/reanalysis", json={"analysis_area_id": AREA, "action_date": "2026-10-30"})
    assert response.status_code == expected
    assert response.json()["detail"]["code"] == code
    assert "test-secret" not in response.text
    if status == 422:
        assert response.json()["detail"]["errors"][0]["loc"] == ["body", "action_date"]


@pytest.mark.parametrize("failure,expected", [
    (httpx.ConnectTimeout("timeout"), 504),
    (httpx.ConnectError("unreachable"), 503),
    (httpx.Response(200, content=b"not-json"), 502),
    (httpx.Response(200, json={"status": "completed", "analysis_area_id": AREA}), 502),
])
async def test_transport_and_response_failures(client, downstream, failure, expected):
    seen, result = downstream
    result["value"] = (lambda request: (_ for _ in ()).throw(failure)) if isinstance(failure, Exception) else failure
    response = await client.post("/api/hydro-modeling/ecmwf/reanalysis", json={"analysis_area_id": AREA, "action_date": "2026-10-30"})
    assert response.status_code == expected
    assert response.json()["detail"]["code"].startswith("hydro_")
    assert len(seen) == 1  # Never retry a POST whose write outcome is unknown.


async def test_mismatched_area_is_rejected(client, downstream):
    _, result = downstream
    result["value"] = httpx.Response(200, json={"status": "completed", "dataset": "IFS", "marine_analysis_area_id": "other"})
    response = await client.post("/api/hydro-modeling/ifs", json={"marine_analysis_area_id": "maliakos", "action_date": "2026-10-30"})
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "hydro_invalid_response"


async def test_downstream_validation_detail_redacts_key(client, downstream):
    _, result = downstream
    result["value"] = httpx.Response(422, json={"detail": [{"msg": "rejected test-secret"}]})
    response = await client.post("/api/hydro-modeling/ecmwf/reanalysis", json={"analysis_area_id": AREA, "action_date": "2026-10-30"})
    assert response.status_code == 422
    assert "test-secret" not in response.text
    assert "[redacted]" in response.text


async def test_openapi_contains_only_requested_hydro_operations(client):
    paths = (await client.get("/openapi.json")).json()["paths"]
    assert {path for path in paths if path.startswith("/api/hydro-modeling/")} == {
        "/api/hydro-modeling/ecmwf/reanalysis-availability",
        "/api/hydro-modeling/ecmwf/reanalysis",
        "/api/hydro-modeling/ecmwf/local-forecast",
        "/api/hydro-modeling/ifs",
    }
    assert "/api/ingestion/run" in paths
