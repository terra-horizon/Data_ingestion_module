"""HTTP adapter that delegates ECMWF/IFS acquisition to Hydro Modeling."""

import logging
import os
from dataclasses import dataclass
from time import perf_counter
from typing import Any, TypeVar
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ValidationError

from app.schemas.hydro_modeling import (
    AvailabilityResult,
    IfsRequest,
    IfsResult,
    LocalForecastRequest,
    LocalForecastResult,
    ReanalysisRequest,
    ReanalysisResult,
)


logger = logging.getLogger(__name__)
ResultT = TypeVar("ResultT", bound=BaseModel)
DEFAULT_BASE_URL = "https://server.iprism.eu/terra/use-case-1/hydro-modeling-service"


def _redact(value: Any, secret: str) -> Any:
    if isinstance(value, str):
        return value.replace(secret, "[redacted]")
    if isinstance(value, list):
        return [_redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {key: _redact(item, secret) for key, item in value.items()}
    return value


class HydroAdapterError(Exception):
    def __init__(self, status_code: int, code: str, message: str, *, errors: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.errors = errors


@dataclass(frozen=True)
class HydroModelingSettings:
    base_url: str
    api_key: str
    connect_timeout_seconds: float
    read_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "HydroModelingSettings":
        base_url = os.getenv("HYDRO_MODELING_BASE_URL", DEFAULT_BASE_URL).strip().rstrip("/")
        try:
            parsed = urlsplit(base_url)
            parsed.port  # Reject malformed numeric ports before making a request.
            valid_url = (
                parsed.scheme in {"http", "https"} and parsed.hostname
                and not parsed.query and not parsed.fragment and not parsed.username
                and not any(character.isspace() for character in base_url)
            )
        except ValueError:
            valid_url = False
        if not valid_url:
            raise HydroAdapterError(503, "hydro_configuration_error", "Hydro Modeling base URL is invalid.")
        api_key = os.getenv("HYDRO_MODELING_API_KEY", "").strip()
        if not api_key or "\r" in api_key or "\n" in api_key:
            raise HydroAdapterError(503, "hydro_configuration_error", "Hydro Modeling API key is not configured.")
        try:
            read_timeout = float(os.getenv("HYDRO_MODELING_TIMEOUT_SECONDS", "120"))
            connect_timeout = float(os.getenv("HYDRO_MODELING_CONNECT_TIMEOUT_SECONDS", "10"))
            if not 0 < read_timeout <= 3600 or not 0 < connect_timeout <= 300:
                raise ValueError("timeout out of range")
        except ValueError as exc:
            raise HydroAdapterError(503, "hydro_configuration_error", "Hydro Modeling timeouts are invalid.") from exc
        return cls(base_url, api_key, connect_timeout, read_timeout)


class HydroModelingAdapter:
    def __init__(self, settings: HydroModelingSettings) -> None:
        self.settings = settings

    def _request(
        self, method: str, path: str, result_type: type[ResultT], *, request_id: str,
        area_id: str, params: dict[str, Any] | None = None, payload: dict[str, Any] | None = None,
    ) -> tuple[ResultT, int]:
        started = perf_counter()
        downstream_status: int | None = None
        outcome = "failed"
        try:
            timeout = httpx.Timeout(
                connect=self.settings.connect_timeout_seconds,
                read=self.settings.read_timeout_seconds,
                write=self.settings.read_timeout_seconds,
                pool=self.settings.connect_timeout_seconds,
            )
            with httpx.Client(timeout=timeout, verify=True) as client:
                response = client.request(
                    method, self.settings.base_url + path,
                    params=params, json=payload,
                    headers={"X-API-Key": self.settings.api_key, "Accept": "application/json"},
                )
            downstream_status = response.status_code
            if response.status_code in {401, 403}:
                raise HydroAdapterError(502, "hydro_downstream_auth_failed", "Hydro Modeling rejected the configured credential.")
            if response.status_code == 422:
                try:
                    detail = _redact(response.json().get("detail"), self.settings.api_key)
                except (ValueError, AttributeError):
                    detail = None
                raise HydroAdapterError(422, "hydro_downstream_validation_error", "Hydro Modeling rejected the request.", errors=detail)
            if response.status_code in {429, 502, 503, 504}:
                raise HydroAdapterError(503, "hydro_downstream_unavailable", "Hydro Modeling is temporarily unavailable.")
            if response.status_code >= 400:
                raise HydroAdapterError(502, "hydro_downstream_error", "Hydro Modeling returned an error.")
            try:
                body = response.json()
            except ValueError as exc:
                raise HydroAdapterError(502, "hydro_invalid_response", "Hydro Modeling returned invalid JSON.") from exc
            if not isinstance(body, dict):
                raise HydroAdapterError(502, "hydro_invalid_response", "Hydro Modeling returned an invalid response.")
            try:
                result = result_type.model_validate(body)
            except ValidationError as exc:
                raise HydroAdapterError(502, "hydro_invalid_response", "Hydro Modeling returned an invalid response.") from exc
            returned_area = getattr(result, "analysis_area_id", getattr(result, "marine_analysis_area_id", None))
            if returned_area != area_id:
                raise HydroAdapterError(502, "hydro_invalid_response", "Hydro Modeling returned a different analysis area.")
            outcome = "success"
            return result, response.status_code
        except httpx.TimeoutException as exc:
            raise HydroAdapterError(504, "hydro_downstream_timeout", "Hydro Modeling did not respond in time.") from exc
        except httpx.TransportError as exc:
            raise HydroAdapterError(503, "hydro_downstream_unavailable", "Hydro Modeling could not be reached.") from exc
        finally:
            logger.info(
                "hydro-modeling operation=%s request_id=%s downstream_status=%s duration_ms=%s outcome=%s",
                path.rsplit("/", 1)[-1], request_id, downstream_status,
                round((perf_counter() - started) * 1000), outcome,
            )

    def get_reanalysis_availability(self, analysis_area_id: str, *, request_id: str) -> tuple[AvailabilityResult, int]:
        return self._request(
            "GET", "/data-ingestion/ecmwf/reanalysis-availability", AvailabilityResult,
            request_id=request_id, area_id=analysis_area_id, params={"analysis_area_id": analysis_area_id},
        )

    def ingest_reanalysis(self, request: ReanalysisRequest, *, request_id: str) -> tuple[ReanalysisResult, int]:
        return self._request(
            "POST", "/data-ingestion/ecmwf/reanalysis", ReanalysisResult,
            request_id=request_id, area_id=request.analysis_area_id, payload=request.model_dump(mode="json"),
        )

    def ingest_local_forecast(self, request: LocalForecastRequest, *, request_id: str) -> tuple[LocalForecastResult, int]:
        return self._request(
            "POST", "/data-ingestion/ecmwf/local-forecast", LocalForecastResult,
            request_id=request_id, area_id=request.analysis_area_id, payload=request.model_dump(mode="json"),
        )

    def ingest_ifs(self, request: IfsRequest, *, request_id: str) -> tuple[IfsResult, int]:
        return self._request(
            "POST", "/data-ingestion/ifs", IfsResult,
            request_id=request_id, area_id=request.marine_analysis_area_id, payload=request.model_dump(mode="json"),
        )
