from unittest.mock import Mock

import httpx
import pytest
from data_collection.remote_storage import StorageConfigurationError

from app.main import app
from app.schemas.health import ReadinessChecks, ReadinessResponse
from app.services.health import check_readiness


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as value:
        yield value


@pytest.mark.asyncio
async def test_liveness_returns_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_readiness_returns_ok_when_dependencies_are_available(
    monkeypatch,
    client: httpx.AsyncClient,
) -> None:
    check = Mock(
        return_value=ReadinessResponse(
            status="ready",
            checks=ReadinessChecks(configuration="ok", mongodb="ok", minio="ok"),
        )
    )
    monkeypatch.setattr("app.api.routes.health.check_readiness", check)

    response = await client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"configuration": "ok", "mongodb": "ok", "minio": "ok"},
    }
    check.assert_called_once_with()


@pytest.mark.asyncio
async def test_readiness_returns_503_without_exposing_dependency_errors(
    monkeypatch,
    client: httpx.AsyncClient,
) -> None:
    check = Mock(
        return_value=ReadinessResponse(
            status="not_ready",
            checks=ReadinessChecks(
                configuration="ok",
                mongodb="unavailable",
                minio="ok",
            ),
        )
    )
    monkeypatch.setattr("app.api.routes.health.check_readiness", check)

    response = await client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {
            "configuration": "ok",
            "mongodb": "unavailable",
            "minio": "ok",
        },
    }
    assert "password" not in response.text.lower()


def test_readiness_check_pings_dependencies_without_writing(monkeypatch) -> None:
    settings = Mock(minio_bucket="test-bucket")
    store = Mock()
    monkeypatch.setattr("app.services.health.load_local_env_if_present", Mock())
    monkeypatch.setattr(
        "app.services.health.CollectorStorageSettings.from_env",
        Mock(return_value=settings),
    )
    monkeypatch.setattr("app.services.health.get_credential_sets", Mock(return_value=[{}]))
    monkeypatch.setattr("app.services.health.CollectorStore", Mock(return_value=store))

    result = check_readiness()

    assert result.status == "ready"
    assert result.checks == ReadinessChecks(configuration="ok", mongodb="ok", minio="ok")
    store.database.command.assert_called_once_with("ping")
    store.s3.head_bucket.assert_called_once_with(Bucket="test-bucket")
    store.close.assert_called_once_with()


def test_readiness_check_reports_invalid_configuration(monkeypatch) -> None:
    monkeypatch.setattr("app.services.health.load_local_env_if_present", Mock())
    monkeypatch.setattr(
        "app.services.health.CollectorStorageSettings.from_env",
        Mock(side_effect=StorageConfigurationError("private configuration detail")),
    )

    result = check_readiness()

    assert result == ReadinessResponse(
        status="not_ready",
        checks=ReadinessChecks(
            configuration="unavailable",
            mongodb="skipped",
            minio="skipped",
        ),
    )
