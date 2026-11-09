from datetime import datetime, timezone
from time import perf_counter

from fastapi import APIRouter, HTTPException, status
from starlette.concurrency import run_in_threadpool
from app.adapters.uc1 import get_satellite_job

from app.adapters.common import (
    CollectorAlreadyRunningError,
    CollectorConfigurationError,
    CollectorExecutionError,
    CollectorJobNotFoundError,
    CollectorUnavailableError,
)
from app.schemas.ingestion import IngestionRunRequest, IngestionRunResponse
from app.services.ingestion import execute_ingestion_profile


router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.get("/satellite/jobs/{job_id}")
async def satellite_job_status(job_id: str) -> dict:
    """Retrieve a previously submitted collector job without submitting another."""
    try:
        return await run_in_threadpool(get_satellite_job, job_id)
    except CollectorJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": "collector_job_not_found", "message": str(exc)}) from exc
    except CollectorConfigurationError as exc:
        raise HTTPException(status_code=400, detail={"code": "collector_configuration_error", "message": str(exc)}) from exc
    except CollectorUnavailableError as exc:
        raise HTTPException(status_code=503, detail={"code": "collector_unavailable", "message": str(exc)}) from exc
    except CollectorExecutionError as exc:
        raise HTTPException(status_code=502, detail={"code": "collector_execution_error", "message": str(exc)}) from exc


@router.post("/run", response_model=IngestionRunResponse)
async def run_ingestion(request: IngestionRunRequest) -> IngestionRunResponse:
    started_at = datetime.now(timezone.utc)
    started_timer = perf_counter()
    try:
        collector_result = await execute_ingestion_profile(request)
    except CollectorAlreadyRunningError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "collector_already_running", "message": str(exc), "run_job_id": request.run_job_id},
        ) from exc
    except CollectorConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "collector_configuration_error", "message": str(exc), "run_job_id": request.run_job_id},
        ) from exc
    except CollectorUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "collector_unavailable", "message": str(exc), "run_job_id": request.run_job_id},
        ) from exc
    except CollectorExecutionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "collector_execution_error", "message": str(exc), "run_job_id": request.run_job_id},
        ) from exc

    completed_at = datetime.now(timezone.utc)
    return IngestionRunResponse(
        run_job_id=request.run_job_id,
        provider=request.provider,
        profile=request.profile,
        aoi_id=request.aoi_id,
        triggered_at=request.triggered_at,
        started_at=started_at,
        completed_at=completed_at,
        duration_ms=round((perf_counter() - started_timer) * 1000),
        status=str(collector_result.get("status", "unknown")),
        collector_result=collector_result,
    )
