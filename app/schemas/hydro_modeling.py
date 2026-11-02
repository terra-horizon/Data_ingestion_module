"""Requests and downstream results for delegated Hydro Modeling ingestion."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HydroRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("analysis_area_id", "marine_analysis_area_id", check_fields=False)
    @classmethod
    def nonblank_area(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("area id must not be blank")
        return value


class ReanalysisRequest(HydroRequest):
    analysis_area_id: str = Field(min_length=1)
    action_date: date

    @field_validator("action_date", mode="before")
    @classmethod
    def iso_date(cls, value: Any) -> str:
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("action_date must be YYYY-MM-DD")
        return value


class LocalForecastRequest(HydroRequest):
    analysis_area_id: str = Field(min_length=1)
    horizon_days: int = Field(default=15, ge=1, strict=True)


class IfsRequest(HydroRequest):
    marine_analysis_area_id: str = Field(min_length=1)
    action_date: date
    horizon_days: int = Field(default=6, ge=1, strict=True)
    source: str = Field(default="ecmwf", min_length=1)

    @field_validator("action_date", mode="before")
    @classmethod
    def iso_date(cls, value: Any) -> str:
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("action_date must be YYYY-MM-DD")
        return value


class HydroResult(BaseModel):
    # Preserve provider additions instead of dropping unrecognized metadata.
    model_config = ConfigDict(extra="allow")


class AvailabilityResult(HydroResult):
    analysis_area_id: str
    dataset: str
    processing_version: str | None = None
    latest_mongo_reanalysis_date: date | None = None
    latest_ecmwf_available_date: date | None = None
    next_missing_date: date | None = None
    lag_days: int | None = None


class IngestionResult(HydroResult):
    status: str = Field(min_length=1)
    dataset: str
    inserted: int | None = Field(default=None, ge=0)
    existing: int | None = Field(default=None, ge=0)
    updated: int | None = Field(default=None, ge=0)
    skipped: int | None = Field(default=None, ge=0)


class ReanalysisResult(IngestionResult):
    analysis_area_id: str
    action_date: date | None = None
    selected_records: int | None = Field(default=None, ge=0)
    reanalysis_dates: list[date] | None = None
    forecast_dates: list[date] | None = None
    coexistence_dates: list[date] | None = None


class LocalForecastResult(IngestionResult):
    analysis_area_id: str
    forecast_base_date: date | None = None
    forecast_start_date: date | None = None
    forecast_end_date: date | None = None
    horizon_days: int | None = Field(default=None, ge=1)
    forecast_dates: list[date] | None = None
    records_prepared: int | None = Field(default=None, ge=0)


class IfsResult(IngestionResult):
    marine_analysis_area_id: str
    processing_version: str | None = None
    forecast_run_time: datetime | None = None
    requested_date: date | None = None
    horizon_days: int | None = Field(default=None, ge=1)
    forecast_dates: list[date] | None = None
    records_prepared: int | None = Field(default=None, ge=0)
    source_files: list[Any] | None = None


class HydroResponse(BaseModel):
    provider: str = "hydro-modeling"
    profile: str
    status: str
    request_id: str
    downstream_status: int
    duration_ms: int
    result: dict[str, Any]


class AvailabilityResponse(HydroResponse):
    result: AvailabilityResult


class ReanalysisResponse(HydroResponse):
    result: ReanalysisResult


class LocalForecastResponse(HydroResponse):
    result: LocalForecastResult


class IfsResponse(HydroResponse):
    result: IfsResult
