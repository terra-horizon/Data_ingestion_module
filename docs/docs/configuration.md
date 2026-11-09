# Configuration

For the `coastal-uc3-sentinel2` package, local wheel installation and independent runtime
settings, see [UC3 integration](uc3-integration.md). Supply its wheel in `vendor/`
before installing the application or building its Docker image.

Copy `.env.example` to a private `.env` or inject settings into the service process. The remote collector owns its storage and Copernicus credentials. UC3 retains its separate `UC3_INGEST_*` configuration; see [UC3 integration](uc3-integration.md).

## Applying changes

Compose injects `.env` when it creates a container. After environment-only
changes, recreate without rebuilding:

```bash
docker compose up -d --force-recreate
```

Use `--build` only after Dockerfile, dependency, or application-source changes.

## UC1 Sperchios delegated profiles

Inject these environment variables into the application process (see `.env.example`):

- `UC1_COLLECTOR_BASE_URL`, `UC1_COLLECTOR_API_KEY`: satellite service URL including its `/terra/use-case-1/water-pollutants-collector` prefix and API key.
- `UC1_HYDRO_BASE_URL`, `UC1_HYDRO_API_KEY`: Hydro Modeling URL including its `/terra/use-case-1/hydro-modeling-service` prefix and API key. Both services receive `X-API-Key`.
- `UC1_SPERCHIOS_ANALYSIS_AREA_ID`: static river ID, required by both Hydro Modeling profiles.
- `UC1_SPERCHIOS_MARINE_ANALYSIS_AREA_ID`: static marine ID, required by the sea profile.
- `UC1_RIVER_FORECAST_HORIZON_DAYS=15` and `UC1_IFS_FORECAST_HORIZON_DAYS=6`: fixed values; other values are rejected.
- `UC1_HTTP_CONNECT_TIMEOUT_SECONDS=10` and `UC1_HTTP_READ_TIMEOUT_SECONDS=120`: positive HTTP timeouts.

Only the selected profile?s service configuration is required. Configuration is validated before requests. The service uses the configured river ID to find the static analysis and checks the configured marine ID against the filtered list; it never creates analyses. Run `python -m pytest tests/test_uc1_profile.py` for mocked local integration tests.

`UC1_COLLECTOR_POLL_INTERVAL_SECONDS` defaults to 10 and `UC1_COLLECTOR_MAX_WAIT_SECONDS` defaults to 1800; both must be finite and positive. The wait starts after successful submission. Client or proxy timeouts may end the request earlier; use a suitably bounded wait and retain the returned job ID for the status endpoint. This process does not durably store submitted IDs.

On the shared production Docker network use `http://uc1-water-pollutants-collector:8000` and `http://hydro-modeling-service:8000` as the respective base URLs. External URLs may require their proxy prefixes.
