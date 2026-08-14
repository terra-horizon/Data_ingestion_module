from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterator, Mapping

from data_collection import CollectionRequest, collect
from data_collection.remote_storage import (
    StorageConfigurationError,
    StorageConnectionError,
)


class CollectorAdapterError(Exception):
    """Base error raised by the collector adapter."""


class CollectorConfigurationError(CollectorAdapterError):
    """The collector runtime configuration is invalid or incomplete."""


class CollectorUnavailableError(CollectorAdapterError):
    """The collector's persistence services are unavailable."""


class CollectorExecutionError(CollectorAdapterError):
    """The collector failed during execution."""


class CollectorAlreadyRunningError(CollectorAdapterError):
    """This process is already collecting the requested AOI."""


_active_aoi_ids: set[str] = set()
_active_aoi_ids_lock = Lock()

@contextmanager
def _guard_aoi(aoi_id: str) -> Iterator[None]:
    with _active_aoi_ids_lock:
        if aoi_id in _active_aoi_ids:
            raise CollectorAlreadyRunningError(
                f"Collection is already running for AOI '{aoi_id}'."
            )
        _active_aoi_ids.add(aoi_id)

    try:
        yield
    finally:
        with _active_aoi_ids_lock:
            _active_aoi_ids.discard(aoi_id)


def run_sentinel_ingestion(config: Mapping[str, Any]) -> dict[str, Any]:
    aoi_id = str(config["aoi_id"])
    target_date = config.get("target_date") or datetime.now(timezone.utc).date().isoformat()
    try:
        request = CollectionRequest(
            aoi_id=aoi_id,
            aoi_bbox=list(config["bbox"]),
            run_name=str(config["run_name"]),
            output_root=Path("outputs"),
            history_start=str(config.get("history_start", "2016-01-01")),
            target_date=str(target_date),
            mode=str(config.get("mode", "auto")),
            max_days_per_run=config.get("max_days_per_run"),
            max_tiles_per_run=config.get("max_tiles_per_run"),
            publish=True,
        )
        with _guard_aoi(aoi_id):
            result = collect(request)
        return result.to_dict()
    except CollectorAlreadyRunningError:
        raise
    except StorageConfigurationError as exc:
        raise CollectorConfigurationError(str(exc)) from exc
    except StorageConnectionError as exc:
        raise CollectorUnavailableError(str(exc)) from exc
    except ValueError as exc:
        raise CollectorConfigurationError(str(exc)) from exc
    except RuntimeError as exc:
        message = str(exc)
        if message.startswith("Collection is already running for"):
            raise CollectorAlreadyRunningError(message) from exc
        if message.startswith("Environment variable '") and "required but not set" in message:
            raise CollectorConfigurationError(message) from exc
        raise CollectorExecutionError("Collector execution failed.") from exc
    except Exception as exc:
        raise CollectorExecutionError("Collector execution failed.") from exc
