from typing import Literal

from pydantic import BaseModel


HealthCheckStatus = Literal["ok", "unavailable", "skipped"]


class LivenessResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessChecks(BaseModel):
    configuration: HealthCheckStatus
    collector: HealthCheckStatus


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks


class Uc3ReadinessChecks(BaseModel):
    package: HealthCheckStatus
    configuration: HealthCheckStatus
    mongodb: HealthCheckStatus
    minio: HealthCheckStatus


class Uc3ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: Uc3ReadinessChecks
