"""Read-only readiness of the delegated satellite collector."""
from app.adapters.common import CollectorAdapterError
from app.adapters.uc1_client import Settings, UC1Client
from app.schemas.health import ReadinessChecks, ReadinessResponse


def check_readiness() -> ReadinessResponse:
    try:
        settings = Settings.from_env("satellite")
    except CollectorAdapterError:
        return ReadinessResponse(status="not_ready", checks=ReadinessChecks(configuration="unavailable", collector="skipped"))
    try:
        with UC1Client(settings, timeout_cap=5) as client:
            body = client.request("Satellite collector", "GET", "/health/ready")
        checks = body.get("checks") if isinstance(body, dict) else None
        ready = (isinstance(checks, dict) and body.get("status") == "ready"
                 and all(checks.get(name) == "ok" for name in ("configuration", "mongodb", "minio", "worker")))
    except CollectorAdapterError:
        ready = False
    return ReadinessResponse(status="ready" if ready else "not_ready", checks=ReadinessChecks(
        configuration="ok", collector="ok" if ready else "unavailable"))
