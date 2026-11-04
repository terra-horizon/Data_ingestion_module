"""Configuration and HTTP transport for the delegated UC1 workflows."""
import math
import os
import ssl
from dataclasses import dataclass
from urllib.parse import urlsplit
import httpx
from app.adapters.collector import CollectorConfigurationError, CollectorExecutionError, CollectorUnavailableError

@dataclass(frozen=True)
class Settings:
    collector_url: str
    collector_key: str
    hydro_url: str
    hydro_key: str
    river_id: str
    marine_id: str
    connect_timeout: float
    read_timeout: float
    ca_bundle: str | None = None

    @classmethod
    def from_env(cls, profile: str) -> "Settings":
        def required(name):
            value = os.getenv(name, "").strip()
            if not value or any(c in value for c in "\r\n"):
                raise CollectorConfigurationError(f"{name} is missing or invalid.")
            return value
        satellite = profile == "satellite"
        collector_url = required("UC1_COLLECTOR_BASE_URL").rstrip("/") if satellite else ""
        hydro_url = "" if satellite else required("UC1_HYDRO_BASE_URL").rstrip("/")
        for url in (collector_url, hydro_url):
            if not url:
                continue
            try:
                parsed = urlsplit(url)
                parsed.port
                valid = (parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username
                         and not parsed.password and not parsed.query and not parsed.fragment
                         and not any(c.isspace() for c in url))
            except ValueError:
                valid = False
            if not valid:
                raise CollectorConfigurationError("UC1 service base URL is invalid.")
        river_id = "" if satellite else required("UC1_SPERCHIOS_ANALYSIS_AREA_ID")
        marine_id = required("UC1_SPERCHIOS_MARINE_ANALYSIS_AREA_ID") if profile == "sea" else ""
        try:
            connect = float(os.getenv("UC1_HTTP_CONNECT_TIMEOUT_SECONDS", "10"))
            read = float(os.getenv("UC1_HTTP_READ_TIMEOUT_SECONDS", "120"))
            if not all(math.isfinite(x) and x > 0 for x in (connect, read)):
                raise ValueError
            if (profile == "river" and int(os.getenv("UC1_RIVER_FORECAST_HORIZON_DAYS", "15")) != 15) or (profile == "sea" and int(os.getenv("UC1_IFS_FORECAST_HORIZON_DAYS", "6")) != 6):
                raise ValueError
        except ValueError as exc:
            raise CollectorConfigurationError("UC1 timeout or fixed forecast horizon configuration is invalid.") from exc
        return cls(collector_url, required("UC1_COLLECTOR_API_KEY") if satellite else "", hydro_url,
                   "" if satellite else required("UC1_HYDRO_API_KEY"), river_id, marine_id, connect, read,
                   os.getenv("UC1_HTTP_CA_BUNDLE", "").strip() or None)

class UC1Client:
    def __init__(self, settings):
        self.settings = settings
        verify = True
        if settings.ca_bundle:
            try:
                verify = ssl.create_default_context(cafile=settings.ca_bundle)
            except (OSError, ValueError) as exc:
                raise CollectorConfigurationError("UC1 CA bundle could not be loaded.") from exc
        self.client = httpx.Client(verify=verify, timeout=httpx.Timeout(connect=settings.connect_timeout, read=settings.read_timeout,
                                                          write=settings.read_timeout, pool=settings.connect_timeout))
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.client.close()
    def request(self, service, method, path, *, payload=None, params=None, expected=None):
        base = self.settings.collector_url if service == "Satellite collector" else self.settings.hydro_url
        key = self.settings.collector_key if service == "Satellite collector" else self.settings.hydro_key
        try:
            response = self.client.request(method, base + path, json=payload, params=params,
                                           headers={"X-API-Key": key, "Accept": "application/json"})
        except httpx.TimeoutException as exc:
            raise CollectorUnavailableError(f"{service} request timed out.") from exc
        except httpx.TransportError as exc:
            raise CollectorUnavailableError(f"{service} is unavailable.") from exc
        if response.status_code in (401, 403):
            raise CollectorConfigurationError(f"{service} rejected its configured credential.")
        if response.status_code == 404 and method == "GET":
            raise CollectorConfigurationError(f"{service} static analysis was not found.")
        if response.status_code in (429, 502, 503, 504):
            raise CollectorUnavailableError(f"{service} is unavailable (HTTP {response.status_code}).")
        if not 200 <= response.status_code < 300 or (expected and response.status_code != expected):
            raise CollectorExecutionError(f"{service} returned an unexpected HTTP status ({response.status_code}).")
        try:
            body = response.json()
            # Do not expose configured credentials even if an upstream echoes them.
            def redact(value):
                if isinstance(value, str):
                    for secret in (self.settings.collector_key, self.settings.hydro_key):
                        if secret:
                            value = value.replace(secret, "[redacted]")
                    return value
                if isinstance(value, list):
                    return [redact(item) for item in value]
                if isinstance(value, dict):
                    return {redact(key): redact(item) for key, item in value.items()}
                return value
            return redact(body)
        except ValueError as exc:
            raise CollectorExecutionError(f"{service} returned invalid JSON.") from exc
