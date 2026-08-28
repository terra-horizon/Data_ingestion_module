from fastapi import APIRouter, Response, status
from starlette.concurrency import run_in_threadpool

from app.schemas.health import LivenessResponse, ReadinessResponse
from app.services.health import check_readiness


router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", response_model=LivenessResponse)
async def live() -> LivenessResponse:
    return LivenessResponse()


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ReadinessResponse}},
)
async def ready(response: Response) -> ReadinessResponse:
    result = await run_in_threadpool(check_readiness)
    if result.status == "not_ready":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
