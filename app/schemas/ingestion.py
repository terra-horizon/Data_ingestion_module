from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


IngestionProfile = Literal["forecaster-collector", "coastal-uc3-sentinel2"]


class Uc3AcquisitionOptions(BaseModel):
    """UC3 profile options. Explicit UTC window; no storage, credential or runner fields.

    Storage and credentials come from the worker's UC3_INGEST_* environment, never from
    the request. extra="forbid" makes any such field a 422 instead of silently ignored.
    """

    model_config = ConfigDict(extra="forbid")

    contract_version: Literal[2]
    mode: Literal["latest", "window"]
    time_from: datetime
    time_to: datetime
    selection_policy: Literal["uc3_parity_pilot", "uc3_monthly_backfill"] = "uc3_parity_pilot"
    max_scenes: Annotated[int, Field(ge=1, le=24, strict=True)] | None = None
    project_id: Annotated[str, Field(min_length=1)] | None = None
    request_id: Annotated[str, Field(min_length=1)] | None = None
    registry_version: str | None = None
    window_id: str | None = None

    @model_validator(mode="after")
    def validate_window(self) -> "Uc3AcquisitionOptions":
        for value in (self.time_from, self.time_to):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("uc3.time_from and uc3.time_to must include a timezone offset")
        if self.time_to <= self.time_from:
            raise ValueError("uc3.time_to must be after uc3.time_from")
        return self


class IngestionRunRequest(BaseModel):
    run_job_id: Annotated[str, Field(min_length=1)]
    triggered_at: datetime
    provider: Literal["sentinel-2"]
    profile: IngestionProfile
    aoi_id: Annotated[str, Field(min_length=1)]
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)]
    run_name: Annotated[str, Field(min_length=1)] | None = None
    history_start: date = date(2016, 1, 1)
    target_date: date | None = None
    mode: Literal["auto", "backfill", "incremental"] = "auto"
    max_days_per_run: Annotated[int, Field(gt=0)] | None = None
    max_tiles_per_run: Annotated[int, Field(gt=0)] | None = None

    uc3: Uc3AcquisitionOptions | None = None

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

    @model_validator(mode="after")
    def validate_profile_fields(self) -> "IngestionRunRequest":
        if self.profile == "forecaster-collector":
            if self.run_name is None:
                raise ValueError("run_name is required for the forecaster-collector profile")
            if self.uc3 is not None:
                raise ValueError("uc3 options apply only to the coastal-uc3-sentinel2 profile")
        elif self.profile == "coastal-uc3-sentinel2" and self.uc3 is None:
            # history_start defaults to 2016-01-01, so UC3 requires an explicit window.
            raise ValueError("coastal-uc3-sentinel2 requires uc3 options with time_from and time_to")
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
