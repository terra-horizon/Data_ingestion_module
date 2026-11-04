"""Upstream response validation for UC1 Hydro Modeling profiles."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HydroResult(BaseModel):
    # Preserve provider additions instead of dropping unrecognized metadata.
    model_config = ConfigDict(extra="allow")


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

