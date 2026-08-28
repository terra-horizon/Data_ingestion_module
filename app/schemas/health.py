from typing import Literal

from pydantic import BaseModel


HealthCheckStatus = Literal["ok", "unavailable", "skipped"]


class LivenessResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessChecks(BaseModel):
    configuration: HealthCheckStatus
    mongodb: HealthCheckStatus
    minio: HealthCheckStatus


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks
