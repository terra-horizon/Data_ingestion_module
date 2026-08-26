from unittest.mock import Mock

import httpx
import pytest

from app.main import app


VALID_REQUEST = {
    "run_job_id": "job-sperchios-001",
    "triggered_at": "2026-08-11T10:00:00+03:00",
    "provider": "sentinel-2",
    "profile": "forecaster-collector",
    "aoi_id": "sperchios",
    "bbox": [22.433493, 38.837552, 22.569555, 38.894223],
    "run_name": "sperchios",
    "history_start": "2016-01-01",
    "mode": "auto",
    "max_days_per_run": 1,
    "max_tiles_per_run": 1,
}


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as value:
        yield value


@pytest.mark.asyncio
async def test_run_ingestion_returns_success(monkeypatch, client: httpx.AsyncClient) -> None:
    result = {
        "status": "success",
        "new_record_count": 2,
        "collected_dates": ["2026-08-10"],
        "failed_units": [],
        "latest_available_observation": "2026-08-10",
        "run_summary": "Collected two records.",
    }
    collector_result = Mock()
    collector_result.to_dict.return_value = result
    collector = Mock(return_value=collector_result)
    monkeypatch.setattr("app.adapters.collector.collect", collector)

    request_body = {**VALID_REQUEST, "history_start": "2026-07-01"}
    response = await client.post("/api/ingestion/run", json=request_body)

    assert response.status_code == 200
    body = response.json()
    assert body["run_job_id"] == "job-sperchios-001"
    assert body["provider"] == "sentinel-2"
    assert body["profile"] == "forecaster-collector"
    assert body["aoi_id"] == "sperchios"
    assert body["triggered_at"] == "2026-08-11T10:00:00+03:00"
    assert body["status"] == "success"
    assert body["duration_ms"] >= 0
    assert body["started_at"]
    assert body["completed_at"]
    assert body["collector_result"] == result
    collector.assert_called_once()
    collection_request = collector.call_args.args[0]
    assert collection_request.aoi_id == "sperchios"
    assert collection_request.aoi_bbox == VALID_REQUEST["bbox"]
    assert collection_request.history_start == "2026-07-01"
    assert collection_request.publish is True


@pytest.mark.asyncio
async def test_run_ingestion_preserves_partial_result(monkeypatch, client: httpx.AsyncClient) -> None:
    failed_units = [{"tile_id": "tile-1", "retryable": True}]
    result = {
        "status": "partial",
        "new_record_count": 1,
        "collected_dates": ["2026-08-10"],
        "failed_units": failed_units,
        "run_summary": "One unit remains retryable.",
    }
    collector_result = Mock()
    collector_result.to_dict.return_value = result
    monkeypatch.setattr("app.adapters.collector.collect", Mock(return_value=collector_result))

    response = await client.post("/api/ingestion/run", json=VALID_REQUEST)

    assert response.status_code == 200
    assert response.json()["status"] == "partial"
    assert response.json()["collector_result"]["failed_units"] == failed_units


@pytest.mark.asyncio
async def test_run_ingestion_returns_controlled_collector_error(
    monkeypatch,
    client: httpx.AsyncClient,
) -> None:
    collector = Mock(side_effect=RuntimeError("private storage details"))
    monkeypatch.setattr("app.adapters.collector.collect", collector)

    response = await client.post("/api/ingestion/run", json=VALID_REQUEST)

    assert response.status_code == 500
    assert response.json() == {
        "detail": {
            "code": "collector_execution_error",
            "message": "Collector execution failed.",
            "run_job_id": "job-sperchios-001",
        }
    }
    assert "Traceback" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_request",
    [
        {key: value for key, value in VALID_REQUEST.items() if key != "aoi_id"},
        {key: value for key, value in VALID_REQUEST.items() if key != "profile"},
        {**VALID_REQUEST, "profile": "unknown-process"},
        {**VALID_REQUEST, "bbox": [22.4, 38.8, 22.5]},
        {**VALID_REQUEST, "bbox": [22.5, 38.8, 22.4, 38.9]},
        {**VALID_REQUEST, "triggered_at": "2026-08-11T10:00:00"},
    ],
)
async def test_run_ingestion_validates_aoi_and_bbox(
    client: httpx.AsyncClient,
    invalid_request: dict,
) -> None:
    response = await client.post("/api/ingestion/run", json=invalid_request)

    assert response.status_code == 422
