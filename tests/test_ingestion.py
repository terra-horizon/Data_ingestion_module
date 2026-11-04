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
async def test_legacy_ingestion_uses_remote_adapter(monkeypatch, client):
    calls = []
    for key, value in {"UC1_COLLECTOR_BASE_URL": "https://collector.test", "UC1_COLLECTOR_API_KEY": "test-key"}.items():
        monkeypatch.setenv(key, value)
    def upstream(self, method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "POST":
            return httpx.Response(202, json={"job_id": "job", "status": "queued"})
        return httpx.Response(200, json={"job_id": "job", "status": "succeeded", "result": {"data": 2}})
    monkeypatch.setattr(httpx.Client, "request", upstream)
    response = await client.post("/api/ingestion/run", json=VALID_REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["profile"] == "forecaster-collector" and body["status"] == "success"
    assert body["collector_result"]["satellite_collection"]["result"] == {"data": 2}
    assert [call[0] for call in calls] == ["POST", "GET"]
    assert "run_name" not in calls[0][2]["json"]
    assert calls[0][2]["headers"]["X-API-Key"] == "test-key"
    assert body["started_at"] and body["completed_at"] and body["duration_ms"] >= 0


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
