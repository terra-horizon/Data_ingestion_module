from botocore.exceptions import BotoCoreError, ClientError, EndpointConnectionError
from data_collection.credentials import get_credential_sets, load_local_env_if_present
from data_collection.remote_storage import (
    CollectorStorageSettings,
    CollectorStore,
    StorageConfigurationError,
)
from pymongo.errors import PyMongoError

from app.schemas.health import ReadinessChecks, ReadinessResponse


def check_readiness() -> ReadinessResponse:
    """Check required storage configuration and connectivity without writing data."""
    try:
        load_local_env_if_present()
        settings = CollectorStorageSettings.from_env(aoi_id="health-check")
        get_credential_sets()
    except (StorageConfigurationError, RuntimeError):
        return ReadinessResponse(
            status="not_ready",
            checks=ReadinessChecks(
                configuration="unavailable",
                mongodb="skipped",
                minio="skipped",
            ),
        )

    store = CollectorStore(settings)
    mongo_status = "ok"
    minio_status = "ok"
    try:
        try:
            store.database.command("ping")
        except (PyMongoError, ValueError, OSError):
            mongo_status = "unavailable"

        try:
            store.s3.head_bucket(Bucket=settings.minio_bucket)
        except (BotoCoreError, ClientError, EndpointConnectionError, ValueError, OSError):
            minio_status = "unavailable"
    finally:
        store.close()

    ready = mongo_status == "ok" and minio_status == "ok"
    return ReadinessResponse(
        status="ready" if ready else "not_ready",
        checks=ReadinessChecks(
            configuration="ok",
            mongodb=mongo_status,
            minio=minio_status,
        ),
    )
