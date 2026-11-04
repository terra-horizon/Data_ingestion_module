# Configuration

For the `coastal-uc3-sentinel2` package, local wheel installation and independent runtime
settings, see [UC3 integration](uc3-integration.md). Supply its wheel in `vendor/`
before installing the application or building its Docker image.

The FastAPI layer does not maintain the collector package needed for the forecaster. It passes the
request to the installed collector package, which reads storage and CDSE
configuration from the process environment. Copy `.env.example` to `.env` and
never commit the populated file.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATA_COLLECTION_ENV_FILE` | No | Optional explicit collector environment-file path. |
| `MONGO_URI` | Yes | Full MongoDB URI including database and, when required, `authSource`. |
| `MINIO_ENDPOINT` | Yes | MinIO S3 API URL. Use port `9000`, not the console port `9001`. |
| `MINIO_ACCESS_KEY` | Yes | MinIO application/root user for the current local stack. |
| `MINIO_SECRET_KEY` | Yes | Matching MinIO secret. |
| `MINIO_BUCKET_NAME` | Yes | Existing bucket used by the collector. |
| `MINIO_VERIFY_TLS` | No | Enables TLS certificate verification; defaults to `true`. |
| `MINIO_CA_BUNDLE` | No | Optional CA bundle path for private certificate authorities. |
| `CDSE_CLIENT_ID` | Yes | Primary CDSE OAuth client ID. |
| `CDSE_CLIENT_SECRET` | Yes | Primary CDSE OAuth client secret. |
| `CDSE_BACKUP_CLIENT_ID`, `CDSE_BACKUP_CLIENT_SECRET` | No | First backup credential pair. |
| `CDSE_BACKUP_2_*` through `CDSE_BACKUP_9_*` | No | Additional ordered backup pairs. |

The database name is taken from `MONGO_URI`; a separate `MONGO_DATABASE` value
is not used by the collector.

## Local host execution

When Uvicorn runs directly on Windows and MongoDB/MinIO publish their standard
ports to the host, endpoints may use loopback:

```env
MONGO_URI=mongodb://<user>:<url-encoded-password>@127.0.0.1:27017/terra_db?authSource=admin
MINIO_ENDPOINT=http://127.0.0.1:9000
```

## Docker execution

Inside a container, `localhost`, `127.0.0.1`, and `::1` identify the API
container itself. The application Compose file attaches to the external
`terra-network`, so use Docker DNS names and internal ports:

```env
MONGO_URI=mongodb://<user>:<url-encoded-password>@terra-mongodb:27017/terra_db?authSource=admin
MINIO_ENDPOINT=http://terra-minio:9000
```

For the provided local stack, source MongoDB and MinIO credentials from: [terra-node-stack](https://github.com/terra-horizon/terra-node-stack/blob/master/docker-files/.env_example)

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

`UC1_HTTP_CA_BUNDLE` optionally points to a readable PEM trust bundle for the UC1 HTTP client. It supplies that client's trusted roots and leaves certificate and hostname verification enabled. If omitted, HTTPX uses its default trust configuration. When running in a container, use a path inside the container. See the [manual testing guide](../../tests_external/README.md).
