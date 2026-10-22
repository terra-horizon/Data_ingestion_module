"""Read-only, profile-specific readiness; no acquisitions or storage writes."""

from app.schemas.health import Uc3ReadinessResponse


def check_uc3_readiness() -> Uc3ReadinessResponse:
    checks = dict(package="unavailable", configuration="skipped", mongodb="skipped", minio="skipped")

    def report() -> Uc3ReadinessResponse:
        return Uc3ReadinessResponse(
            status="ready" if all(value == "ok" for value in checks.values()) else "not_ready",
            checks=checks,
        )

    try:
        from wp2_uc3_ingestion.profile import run_profile  # noqa: F401
        from wp2_uc3_ingestion.contract import load_schema
        from wp2_uc3_ingestion.settings import IngestionSettings
        from wp2_uc3_ingestion.storage import quick_minio_client, scene_prefix_listable
        from pymongo import MongoClient

        load_schema("acquisition_request")
        checks["package"] = "ok"
    except Exception:
        return report()

    try:
        settings = IngestionSettings.from_env()
        settings.require_storage()
        settings.require_provider()
        settings.authorised_aois()
        checks["configuration"] = "ok"
    except Exception:
        checks["configuration"] = "unavailable"
        return report()

    client = None
    try:
        client = MongoClient(
            settings.mongodb_uri, serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000, socketTimeoutMS=5000,
        )
        client[str(settings.mongodb_database)].command("ping")
        checks["mongodb"] = "ok"
    except Exception:
        checks["mongodb"] = "unavailable"
    finally:
        if client is not None:
            client.close()

    try:
        scene_prefix_listable(settings, quick_minio_client(settings))
        checks["minio"] = "ok"
    except Exception:
        checks["minio"] = "unavailable"
    return report()
