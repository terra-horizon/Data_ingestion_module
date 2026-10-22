import builtins
from unittest.mock import MagicMock, Mock

import httpx
import pytest

from app.main import app
from app.services.uc3_health import check_uc3_readiness


@pytest.fixture
def dependencies(monkeypatch):
    settings = Mock(mongodb_uri="mongodb://test", mongodb_database="test")
    mongo = MagicMock()
    minio = Mock()
    listing = Mock()
    monkeypatch.setattr("wp2_uc3_ingestion.settings.IngestionSettings.from_env", Mock(return_value=settings))
    monkeypatch.setattr("pymongo.MongoClient", Mock(return_value=mongo))
    monkeypatch.setattr("wp2_uc3_ingestion.storage.quick_minio_client", Mock(return_value=minio))
    monkeypatch.setattr("wp2_uc3_ingestion.storage.scene_prefix_listable", listing)
    return settings, mongo, minio, listing


def test_readiness_only_pings_and_lists(dependencies):
    settings, mongo, minio, listing = dependencies
    result = check_uc3_readiness()
    assert result.status == "ready"
    assert result.checks.package == "ok"
    mongo.__getitem__.assert_called_once_with("test")
    mongo.__getitem__.return_value.command.assert_called_once_with("ping")
    listing.assert_called_once_with(settings, minio)
    mongo.close.assert_called_once_with()


def test_missing_configuration_skips_external_checks(dependencies):
    settings, mongo, _, listing = dependencies
    settings.require_storage.side_effect = ValueError("secret")
    result = check_uc3_readiness()
    assert result.status == "not_ready"
    assert result.checks.configuration == "unavailable"
    assert result.checks.mongodb == result.checks.minio == "skipped"
    assert "secret" not in result.model_dump_json()
    mongo.assert_not_called()
    listing.assert_not_called()


@pytest.mark.parametrize("dependency", ["mongodb", "minio"])
def test_dependency_failure_is_masked(dependencies, dependency):
    _, mongo, _, listing = dependencies
    if dependency == "mongodb":
        mongo.__getitem__.return_value.command.side_effect = RuntimeError("secret")
    else:
        listing.side_effect = RuntimeError("secret")
    result = check_uc3_readiness()
    assert result.status == "not_ready"
    assert getattr(result.checks, dependency) == "unavailable"
    assert "secret" not in result.model_dump_json()
    mongo.close.assert_called_once_with()


def test_missing_package_is_distinguished(monkeypatch):
    original = builtins.__import__

    def unavailable(name, *args, **kwargs):
        if name.startswith("wp2_uc3_ingestion"):
            raise ImportError("private detail")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", unavailable)
    result = check_uc3_readiness()
    assert result.checks.package == "unavailable"
    assert result.checks.configuration == "skipped"
    assert result.status == "not_ready"


@pytest.mark.parametrize("ready", [True, False])
async def test_profile_readiness_route(dependencies, ready):
    settings, _, _, _ = dependencies
    if not ready:
        settings.require_provider.side_effect = ValueError("missing")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/ready/coastal-uc3-sentinel2")
        assert response.status_code == (200 if ready else 503)
        assert response.json()["checks"]["package"] == "ok"
        assert (await client.get("/health/live")).json() == {"status": "ok"}
