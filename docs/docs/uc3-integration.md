# UC3 package integration

`POST /api/ingestion/run` accepts `profile: "coastal-uc3-sentinel2"`. The dispatcher calls `app/adapters/uc3.py` in the existing thread pool. The adapter passes the canonical profile through unchanged and invokes `wp2_uc3_ingestion.profile.run_profile`. It strips UC1-only options and preserves the package result. There is no additional service or job queue.

## Build and install

Use Python 3.12 and the application virtual environment. From the application root, build the wheel from the supplied UC3 **project root**, not its Python package subdirectory (set `<UC3_SOURCE_ROOT>` to the authorised local source location):

```powershell
.venv\Scripts\python.exe -m pip wheel --no-deps --wheel-dir vendor "<UC3_SOURCE_ROOT>"
.venv\Scripts\python.exe -m pip install vendor/terra_wp2_uc3_ingestion-0.5.1-py3-none-any.whl -e ".[test]"
.venv\Scripts\python.exe -m pip check
.venv\Scripts\python.exe -c "from wp2_uc3_ingestion.profile import run_profile; from wp2_uc3_ingestion.contract import load_schema; from wp2_uc3_ingestion.requests_builder import load_authorised_aois; print(load_schema('acquisition_request')['title']); print(len(load_authorised_aois()['aois']))"
```

For future upgrades, obtain the team's official wheel or its complete source distribution metadata with the source handoff; do not assume the current local packaging scaffold represents future package metadata. The wheel includes schemas, examples and the AOI registry. No private GitHub access is needed at build time when the authorised wheel is supplied. The existing UC1 dependency still uses its own Git URL.

If the pip build frontend stalls, the installed setuptools backend can build the copied source without downloading build tools. From `build/uc3-source/`:

```powershell
..\..\.venv\Scripts\python.exe -c "import setuptools.build_meta; print(setuptools.build_meta.build_wheel('../../vendor'))"
```

The application pins `terra-wp2-uc3-ingestion==0.5.1`. This release changes the CDSE catalogue request's `Accept` header to `application/geo+json`, which the catalogue endpoint requires. The catalogue URL remains the package's official default. UC3's dependency ranges allow UC1's pinned pymongo, requests and python-dotenv versions. Do not apply the team's standalone `constraints-py312.txt` wholesale: its pins differ from UC1's. Resolve the wheel and application together and run `pip check`.

## Docker and upgrades

Place the wheel in `vendor/` before `docker build -t data-ingestion-module:uc3 .`. The Dockerfile installs `libexpat1` for rasterio and resolves the application and the explicitly named local wheel together. It does not embed desktop paths. CI must obtain the wheel through private build-artifact delivery; a Git checkout alone does not contain it. Wheels and the copied source under `build/` are ignored.

For a new handover, rebuild from its project root, check the wheel's version and resources, update the application dependency pin and Dockerfile wheel filename, and supply that artifact to CI. Repeat import/resource checks, dependency checks, the complete test suite and a Docker build before deployment. Keep the prior wheel in private artifact storage for rollback.

## Runtime configuration

Use the `UC3_INGEST_*` placeholders in the root `.env.example`. UC3 never falls back to UC1's `MONGO_URI`, `MINIO_*` or `CDSE_*` values. Supply variables to the process, Docker `--env-file`, Compose `env_file`, or Uvicorn `--env-file .env`. The Python entry point itself does not load `.env`; do not depend on UC1 loading it.

Required settings are `PROJECT_ID`, `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` (or supported credential files/backup pairs), `MONGODB_URI`, `MONGODB_DATABASE`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` and `MINIO_PREFIX`, all prefixed with `UC3_INGEST_`. Additional settings include `MONGODB_COLLECTION_PREFIX`, `MINIO_REGION`, `MINIO_SECURE`, `MINIO_CERT_CHECK`, `ALLOW_SERVING_NAMESPACE`, `AOI_REGISTRY_FILE`, `WORK_DIR`, and CDSE URL overrides. Omit `WORK_DIR` to use temporary working files cleaned up by the package.

The intended shared deployment uses database `terra-db`, collection prefix `uc3_`, bucket `terra-bucket`, and object prefix `terra-uc3`. The package requires `UC3_INGEST_ALLOW_SERVING_NAMESPACE=true` to publish into this serving namespace; the example deliberately uses test storage with this flag disabled. Credentials must grant access to the configured namespace. `PROJECT_ID` is required in the environment even when a request includes `uc3.project_id`.

## Request and outcomes

```json
{
  "run_job_id": "uc3-aoi02-20261019-001",
  "triggered_at": "2026-10-19T09:00:00Z",
  "provider": "sentinel-2",
  "profile": "coastal-uc3-sentinel2",
  "aoi_id": "aoi_02",
  "bbox": [-2.84437, 56.39264, -2.78475, 56.43782],
  "uc3": {
    "contract_version": 2,
    "mode": "latest",
    "time_from": "2026-09-19T00:00:00Z",
    "time_to": "2026-10-19T00:00:00Z",
    "selection_policy": "uc3_parity_pilot",
    "max_scenes": 1
  }
}
```

The UC3 object requires version 2, `mode` (`latest` or `window`), and an explicit, timezone-aware increasing time window. Offsets are normalised to UTC by the package. `selection_policy` defaults to `uc3_parity_pilot`; the other supported policy is `uc3_monthly_backfill`. `max_scenes` is an integer from 1 to 24; omitted, the current policies use 3. Optional package metadata fields are `project_id`, `request_id`, `registry_version`, and `window_id`. Unknown nested fields are rejected. AOI ID and bbox must match the operator-selected or packaged authorised registry (package tolerance: 0.000001 degrees). They are checked before acquisition. UC3 requires no `run_name`, `history_start`, or `target_date`; those UC1 fields are not forwarded. UC1 still requires `run_name` and retains its existing defaults.

| Result | HTTP | Meaning |
| --- | --- | --- |
| `completed` | 200 | Acquisition completed; inspect scene IDs and output references. |
| `no_data` | 200 | No suitable data; a normal acquisition outcome. |
| `failed` | 200 | Structured failure; inspect package error/retry metadata. |
| Invalid request schema | 422 | Missing/invalid UC3 options or outer fields. |
| Unauthorised AOI or invalid package configuration | 400 | Acquisition cannot begin. |
| Same UC3 AOI already running in this process | 409 | Retry after the current invocation completes. |
| UC3 package/runtime unavailable | 503 | Repair package installation. |
| Unexpected exception or invalid package outcome | 500 | Masked execution error. |

Both top-level `status` and `collector_result.status` retain the UC3 outcome. Scene IDs, timestamps, references, and structured failures remain in `collector_result`. HTTP 200 alone does not establish acquisition success. The request, response and internal package metadata all use `coastal-uc3-sentinel2`. The former `uc3profile` name is no longer accepted. Update callers and use `/health/ready/coastal-uc3-sentinel2` for UC3 readiness.

Execution is synchronous to the HTTP caller; configure proxy/client timeouts for acquisition duration. The AOI concurrency guard is process-local, not a distributed lock. There is no durable job submission or polling contract in this integration.

## Readiness and offline tests

`GET /health/ready` retains the UC1 contract. `GET /health/ready/coastal-uc3-sentinel2` independently returns 200 or 503 with `package`, `configuration`, `mongodb`, and `minio` checks (`ok`, `unavailable`, or `skipped`). It imports the package, reads its schema and registry, checks required settings, pings MongoDB, and lists at most one object under the UC3 scene prefix. It performs no writes or CDSE calls. Credential presence does not prove CDSE authentication, and storage reads do not prove write permissions. UC3 readiness failure does not change UC1 readiness.

```powershell
.venv\Scripts\python.exe -m pytest tests/test_uc3_profile.py tests/test_uc3_health.py -q
.venv\Scripts\python.exe -m pytest -q
```

Tests use the real package for contract translation and resource checks, with acquisition and external services mocked. Live CDSE authentication, download, publication permissions and downstream assimilation require separate validation.

## Manual test from Windows

The current `0.5.1` wheel must be installed and checked before use; package-level catalogue behavior can be regression-checked offline without making a CDSE request. No live acquisition or production storage access is part of that check.

If Docker cannot read a wheel built by a sandboxed Windows process, reset only that artifact's permissions to inherit from its parent directory, then rebuild:

```powershell
icacls vendor\terra_wp2_uc3_ingestion-0.5.1-py3-none-any.whl /reset
```

Add the UC3 settings from `.env.example` to your existing private `.env`; retain the UC1 values. For a host Python process, use storage addresses reachable from Windows, not container-only DNS names. Start the application from the project root:

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

In a second terminal:

```powershell
curl.exe -i http://127.0.0.1:8000/health/live
curl.exe -i http://127.0.0.1:8000/health/ready/coastal-uc3-sentinel2
```

Liveness should return 200. UC3 readiness should return 200 with all four checks `ok`; 503 identifies missing configuration or unavailable dependencies. Readiness does not verify CDSE credentials against the provider or prove storage writes.

Open `http://127.0.0.1:8000/docs` and use `POST /api/ingestion/run` with the request above, or use `tests_external/uc3.http` in an HTTP client. Update the run ID, trigger timestamp and acquisition window; retain the authorised bbox. Use `max_scenes: 1` for the first acquisition. This POST performs a real download and publishes into the configured UC3 namespace. Inspect `status` and `collector_result`, including scene IDs, references and error details; HTTP 200 can also represent `no_data` or `failed`.

For a manual Docker run, the configured storage must be reachable from the container. When using the existing TERRA node stack and its external network:

```powershell
docker run --rm --name uc3-manual --network terra-network --env-file .env -p 127.0.0.1:18001:8000 data-ingestion-module:uc3-test
```

Use port `18001` for the URLs above. This runs separately from the Compose service on port `18000`. Stop the foreground test container with Ctrl+C.

## Deploying the Git checkout on the server

Commit the application, tests, configuration template and documentation. Deliver `vendor/terra_wp2_uc3_ingestion-0.5.1-py3-none-any.whl` separately to the server's checkout via private file transfer or artifact storage: it is Git-ignored, so `git pull` alone cannot supply it. Alternatively deliver a built application image through a private image registry. Do not commit the wheel, source handover, or `.env`.

Merge the UC3 variables into the server's existing private `.env`. The intended shared deployment settings are:

```dotenv
UC3_INGEST_PROJECT_ID=YOUR_UC3_PROJECT_ID
UC3_INGEST_MONGODB_URI=mongodb://APP_USERNAME:URL_ENCODED_PASSWORD\@terra-mongodb:27017/terra-db?authSource=AUTH_DATABASE
UC3_INGEST_MONGODB_DATABASE=terra-db
UC3_INGEST_MONGODB_COLLECTION_PREFIX=uc3_
UC3_INGEST_MINIO_ENDPOINT=http://terra-minio:9000
UC3_INGEST_MINIO_SECURE=false
UC3_INGEST_MINIO_BUCKET=terra-bucket
UC3_INGEST_MINIO_PREFIX=terra-uc3
UC3_INGEST_MINIO_REGION=us-east-1
UC3_INGEST_ALLOW_SERVING_NAMESPACE=true
```

Also supply `UC3_INGEST_CDSE_CLIENT_ID`, `UC3_INGEST_CDSE_CLIENT_SECRET`, `UC3_INGEST_MINIO_ACCESS_KEY`, and `UC3_INGEST_MINIO_SECRET_KEY`. The serving namespace flag enables writes into UC3's serving data; use it for the intended production deployment, not an isolated test. Confirm the actual node names, Mongo authentication database, project ID, storage permissions and outbound CDSE connectivity with the server configuration. Keep UC1 settings unchanged.

Once the wheel, environment and existing `terra-network` are present, from the server checkout:

```bash
docker compose build data-ingestion-module
docker compose up -d --no-deps data-ingestion-module
docker compose logs --tail=100 data-ingestion-module
curl -i http://127.0.0.1:18000/health/live
curl -i http://127.0.0.1:18000/health/ready
curl -i http://127.0.0.1:18000/health/ready/coastal-uc3-sentinel2
```

The current Compose file binds port 18000 only to server loopback. Retain the existing reverse-proxy mapping for `/data-ingestion/`; the public UC3 readiness URL is `https://server.iprism.eu/data-ingestion/health/ready/coastal-uc3-sentinel2` and the POST URL remains `https://server.iprism.eu/data-ingestion/api/ingestion/run`. Ensure the proxy's access controls cover ingestion and its timeouts accommodate synchronous acquisition; the application adds no UC3 API-key mechanism. Keep the previous image for rollback. No additional UC3 service, job-store provisioning, or storage migration is required by this package integration.

## Private package and distribution disclaimer

The `terra-wp2-uc3-ingestion` package is developed and maintained by the UC3 team in a private repository. Its source code and wheel are not included in this repository and must be obtained through an authorised handover or approved private artifact distribution channel. A Git checkout alone is insufficient to build or deploy the integration without the required wheel.

This repository documents and maintains the integration with that external dependency; it does not claim ownership of the UC3 package or grant rights to use, modify, publish, or redistribute it beyond those authorised by its maintainers and applicable licensing terms. Package updates, upstream defects, and distribution permissions should be coordinated with the UC3 team.
