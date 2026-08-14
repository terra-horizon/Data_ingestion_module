from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


IngestionProfile = Literal["forecaster-collector"]


class IngestionRunRequest(BaseModel):
    run_job_id: Annotated[str, Field(min_length=1)]
    triggered_at: datetime
    provider: Literal["sentinel-2"]
    profile: IngestionProfile
    aoi_id: Annotated[str, Field(min_length=1)]
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)]
    run_name: Annotated[str, Field(min_length=1)]
    history_start: date = date(2016, 1, 1)
    target_date: date | None = None
    mode: Literal["auto", "backfill", "incremental"] = "auto"
    max_days_per_run: Annotated[int, Field(gt=0)] | None = None
    max_tiles_per_run: Annotated[int, Field(gt=0)] | None = None

    @field_validator("triggered_at")
    @classmethod
    def validate_triggered_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("triggered_at must include a timezone offset")
        return value

    @model_validator(mode="after")
    def validate_bbox(self) -> "IngestionRunRequest":
        min_lon, min_lat, max_lon, max_lat = self.bbox
        if not (-180 <= min_lon < max_lon <= 180):
            raise ValueError("bbox longitude values must satisfy -180 <= min_lon < max_lon <= 180")
        if not (-90 <= min_lat < max_lat <= 90):
            raise ValueError("bbox latitude values must satisfy -90 <= min_lat < max_lat <= 90")
        return self


class IngestionRunResponse(BaseModel):
    run_job_id: str
    provider: str
    profile: IngestionProfile
    aoi_id: str
    triggered_at: datetime
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    status: str
    collector_result: dict[str, Any]
