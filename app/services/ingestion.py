from collections.abc import Callable, Mapping
from typing import Any

from starlette.concurrency import run_in_threadpool

from app.adapters.collector import run_sentinel_ingestion
from app.schemas.ingestion import IngestionProfile, IngestionRunRequest


ProfileRunner = Callable[[Mapping[str, Any]], dict[str, Any]]

PROFILE_RUNNERS: dict[IngestionProfile, ProfileRunner] = {
    "forecaster-collector": run_sentinel_ingestion,
}


async def execute_ingestion_profile(request: IngestionRunRequest) -> dict[str, Any]:
    """Execute the adapter registered for the request's server-approved profile."""
    runner = PROFILE_RUNNERS[request.profile]
    config = request.model_dump(mode="json", exclude_none=True)
    return await run_in_threadpool(runner, config)
