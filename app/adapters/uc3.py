"""Invoke the independently installed UC3 package using its canonical profile."""

from typing import Any, Mapping

from app.adapters.collector import (
    CollectorAlreadyRunningError,
    CollectorConfigurationError,
    CollectorExecutionError,
    CollectorUnavailableError,
    _guard_aoi,
)


def run_profile(config: Mapping[str, Any]) -> dict[str, Any]:
    # Lazy loading keeps UC1 available if the UC3 distribution cannot be imported.
    from wp2_uc3_ingestion.profile import run_profile as execute

    return execute(config)


def run_uc3_adapter(config: Mapping[str, Any]) -> dict[str, Any]:
    try:
        from wp2_uc3_ingestion.errors import ConfigurationError, InvalidRequestError
        from wp2_uc3_ingestion.requests_builder import check_authorised_aoi
        from wp2_uc3_ingestion.settings import IngestionSettings
    except (ImportError, OSError) as exc:
        raise CollectorUnavailableError("UC3 package is unavailable.") from exc

    package_config = {
        key: config[key]
        for key in ("run_job_id", "triggered_at", "provider", "profile", "aoi_id", "bbox", "uc3")
        if key in config
    }
    try:
        with _guard_aoi(f"coastal-uc3-sentinel2:{config['aoi_id']}"):
            # Validate against the operator-selected registry before acquisition,
            # including when the execution boundary is replaced in offline tests.
            settings = IngestionSettings.from_env()
            check_authorised_aoi(settings.authorised_aois(), str(config["aoi_id"]), list(config["bbox"]))
            result = run_profile(package_config)
        if not isinstance(result, dict) or result.get("status") not in {"completed", "no_data", "failed"}:
            raise CollectorExecutionError("UC3 returned an invalid outcome.")
        if result.get("outcome", result["status"]) != result["status"]:
            raise CollectorExecutionError("UC3 returned inconsistent outcomes.")
        return result
    except (CollectorAlreadyRunningError, CollectorExecutionError):
        raise
    except InvalidRequestError as exc:
        raise CollectorConfigurationError(str(exc)) from exc
    except ConfigurationError as exc:
        raise CollectorConfigurationError("UC3 configuration is invalid; check UC3_INGEST_* settings and the AOI registry.") from exc
    except (ImportError, OSError) as exc:
        raise CollectorUnavailableError("UC3 runtime dependency is unavailable.") from exc
    except Exception as exc:
        raise CollectorExecutionError("UC3 profile execution failed.") from exc
