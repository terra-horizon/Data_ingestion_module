from contextlib import contextmanager
from threading import Lock
from typing import Iterator


class CollectorAdapterError(Exception):
    """Base error raised by the collector adapter."""


class CollectorConfigurationError(CollectorAdapterError):
    """The collector runtime configuration is invalid or incomplete."""


class CollectorUnavailableError(CollectorAdapterError):
    """The collector's persistence services are unavailable."""


class CollectorJobNotFoundError(CollectorConfigurationError):
    """The remote satellite job does not exist."""


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

