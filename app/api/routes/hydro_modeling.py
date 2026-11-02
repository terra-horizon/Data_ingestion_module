"""Delegated Hydro Modeling ingestion operations."""

from collections.abc import Callable
from time import perf_counter
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.adapters.hydro_modeling import HydroAdapterError, HydroModelingAdapter, HydroModelingSettings
from app.schemas.hydro_modeling import (
    AvailabilityResponse, HydroResponse, IfsRequest, IfsResponse,
    LocalForecastRequest, LocalForecastResponse, ReanalysisRequest, ReanalysisResponse,
)


router = APIRouter(prefix="/hydro-modeling", tags=["hydro-modeling"])
HydroCall = Callable[[HydroModelingAdapter, str], tuple[BaseModel, int]]


async def _execute(profile: str, call: HydroCall) -> HydroResponse:
    request_id = uuid4().hex
    started = perf_counter()
    try:
        adapter = HydroModelingAdapter(HydroModelingSettings.from_env())
        result, downstream_status = await run_in_threadpool(call, adapter, request_id)
    except HydroAdapterError as exc:
        detail: dict[str, Any] = {"code": exc.code, "message": str(exc), "request_id": request_id}
        if exc.errors is not None:
            detail["errors"] = exc.errors
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc
    return HydroResponse(
        profile=profile,
        status=str(getattr(result, "status", "success")),
        request_id=request_id,
        downstream_status=downstream_status,
        duration_ms=round((perf_counter() - started) * 1000),
        result=result.model_dump(mode="json", exclude_unset=True),
    )


@router.get("/ecmwf/reanalysis-availability", response_model=AvailabilityResponse, response_model_exclude_unset=True)
async def reanalysis_availability(
    analysis_area_id: Annotated[str, Query(min_length=1, pattern=r".*\S.*")],
) -> HydroResponse:
    return await _execute(
        "ecmwf-reanalysis-availability",
        lambda adapter, request_id: adapter.get_reanalysis_availability(analysis_area_id, request_id=request_id),
    )


@router.post("/ecmwf/reanalysis", response_model=ReanalysisResponse, response_model_exclude_unset=True)
async def ingest_reanalysis(request: ReanalysisRequest) -> HydroResponse:
    return await _execute(
        "ecmwf-reanalysis",
        lambda adapter, request_id: adapter.ingest_reanalysis(request, request_id=request_id),
    )


@router.post("/ecmwf/local-forecast", response_model=LocalForecastResponse, response_model_exclude_unset=True)
async def ingest_local_forecast(request: LocalForecastRequest) -> HydroResponse:
    return await _execute(
        "ecmwf-local-forecast",
        lambda adapter, request_id: adapter.ingest_local_forecast(request, request_id=request_id),
    )


@router.post("/ifs", response_model=IfsResponse, response_model_exclude_unset=True)
async def ingest_ifs(request: IfsRequest) -> HydroResponse:
    return await _execute(
        "ifs-wind-forecast",
        lambda adapter, request_id: adapter.ingest_ifs(request, request_id=request_id),
    )
