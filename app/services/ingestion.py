from collections.abc import Callable, Mapping
from typing import Any

from starlette.concurrency import run_in_threadpool

from app.adapters.uc3 import run_uc3_adapter
from app.adapters.uc1 import run_uc1_river_adapter, run_uc1_sea_adapter, run_uc1_water_pollutants_adapter
from app.schemas.ingestion import IngestionProfile, IngestionRunRequest


ProfileRunner = Callable[[Mapping[str, Any]], dict[str, Any]]

PROFILE_RUNNERS: dict[IngestionProfile, ProfileRunner] = {
    "coastal-uc3-sentinel2": run_uc3_adapter,
    "uc1-water-pollutants-collector": run_uc1_water_pollutants_adapter,
    "uc1-sperchios-river": run_uc1_river_adapter,
    "uc1-sperchios-sea": run_uc1_sea_adapter,
}


async def execute_ingestion_profile(request: IngestionRunRequest) -> dict[str, Any]:
    """Execute the adapter registered for the request's server-approved profile."""
    runner = PROFILE_RUNNERS[request.profile]
    config = request.model_dump(mode="json", exclude_none=True)
    if request.profile == "uc1-water-pollutants-collector":
        for name in ("history_start", "mode"):
            if name not in request.model_fields_set:
                config.pop(name, None)
    return await run_in_threadpool(runner, config)
