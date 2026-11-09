from datetime import date, datetime
import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


IngestionProfile = Literal["coastal-uc3-sentinel2", "uc1-sperchios-river", "uc1-sperchios-sea", "uc1-water-pollutants-collector"]


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
    history_start: date = date(2016, 1, 1)
    target_date: date | None = None
    mode: Literal["auto", "backfill", "incremental"] = "auto"
    max_days_per_run: Annotated[int, Field(gt=0)] | None = None
    max_tiles_per_run: Annotated[int, Field(gt=0)] | None = None

    sensor: Literal["sentinel2", "sentinel3"] | None = None
    discovery_chunk_days: Annotated[int, Field(gt=0)] | None = None
    max_cloud_coverage: Annotated[int, Field(ge=0, le=100)] | None = None

    uc3: Uc3AcquisitionOptions | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_unknown_satellite_options(cls, value: Any) -> Any:
        if isinstance(value, dict) and value.get("profile") == "uc1-water-pollutants-collector":
            unknown = set(value) - set(cls.model_fields)
            if unknown:
                raise ValueError("Unsupported satellite request fields: " + ", ".join(sorted(unknown)))
            for name in ("max_days_per_run", "max_tiles_per_run", "discovery_chunk_days", "max_cloud_coverage"):
                option = value.get(name)
                if option is not None and type(option) is not int:
                    raise ValueError(f"{name} must be an integer")
            bbox = value.get("bbox")
            if isinstance(bbox, list) and any(type(item) not in (int, float) for item in bbox):
                raise ValueError("bbox values must be numbers")
        return value

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
        if self.profile == "coastal-uc3-sentinel2" and self.uc3 is None:
            # history_start defaults to 2016-01-01, so UC3 requires an explicit window.
            raise ValueError("coastal-uc3-sentinel2 requires uc3 options with time_from and time_to")
        if self.profile.startswith("uc1-") and self.uc3 is not None:
            raise ValueError("uc3 options apply only to the coastal-uc3-sentinel2 profile")
        if self.profile == "uc1-water-pollutants-collector":
            if len(self.run_job_id) > 200:
                raise ValueError("run_job_id must have at most 200 characters")
            if len(self.aoi_id) > 120 or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", self.aoi_id):
                raise ValueError("aoi_id must be 1-120 lowercase letters, digits, underscores or hyphens and start with a letter or digit")
            if self.discovery_chunk_days is not None and self.discovery_chunk_days > 366:
                raise ValueError("discovery_chunk_days must be at most 366")
        if self.profile != "uc1-water-pollutants-collector" and (self.sensor is not None or self.discovery_chunk_days is not None or self.max_cloud_coverage is not None):
            raise ValueError("satellite collector options apply only to the uc1-water-pollutants-collector profile")
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
