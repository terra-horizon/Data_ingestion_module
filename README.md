# TERRA Data Ingestion Module

Python 3.12+ FastAPI service that exposes the TERRA UC1 and UC3 Sentinel-2 collectors
through a profile-based ingestion endpoint. The service validates orchestration
requests, selects a registered process profile, runs the collector outside the
async event loop, and returns run metadata with the collector result.

For the `coastal-uc3-sentinel2` package, local wheel installation and independent runtime
settings, see [UC3 integration](docs/docs/uc3-integration.md). Supply its wheel in `vendor/`
before installing the application or building its Docker image.


## UC1 data flow

```text
TERRA Orchestrator -> Data Ingestion Module -> Satellite Water Pollutants Collector API
                                                 -> independent collection worker -> MongoDB / MinIO
```

The four profiles are `uc1-water-pollutants-collector`, `uc1-sperchios-river`, `uc1-sperchios-sea`, and `coastal-uc3-sentinel2`. The satellite profile submits and monitors remote collector jobs; river and sea independently call Hydro Modeling. UC3 remains an independently installed package.

## Local setup

Create and activate a virtual environment:

```bash
python -m venv .venv
```

Linux or macOS:

```bash
source .venv/bin/activate
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Install the application and test dependencies:

```bash
python -m pip install vendor/terra_wp2_uc3_ingestion-0.5.2-py3-none-any.whl -e ".[test]"
```

Copy `.env.example` to `.env`, supply the required remote service settings and UC3 configuration, then start the API:

```bash
uvicorn app.main:app --reload --env-file .env
```

Swagger UI is available at <http://127.0.0.1:8000/docs>.

## Run ingestion

Send `POST /api/ingestion/run`:

```json
{
  "run_job_id": "job-sperchios-20260814-001",
  "triggered_at": "2026-08-14T07:30:00+03:00",
  "provider": "sentinel-2",
  "profile": "uc1-water-pollutants-collector",
  "aoi_id": "sperchios",
  "bbox": [22.433493, 38.837552, 22.569555, 38.894223],
  "history_start": "2016-01-01",
  "mode": "auto",
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

Use `tests_external/ingestion.http` to send the same request from an HTTP client
that supports `.http` files.

The response retains the request metadata and timings. For satellite collection, `collector_result.satellite_submission` contains the submission and `satellite_collection` contains the latest job response. Upstream `succeeded`, `partial`, and `failed` map to `success`, `partial`, and `failed`; a wait timeout or polling error returns `pending` and preserves the job ID.

Save `collector_result.satellite_submission.job_id` and retrieve the latest upstream status with `GET /api/ingestion/satellite/jobs/{job_id}`. The request may outlast a client or proxy timeout; this service does not persist job IDs, so if the response is lost, obtain the ID from the collector before retrying. Upstream jobs are not cancelled when polling stops.

## Docker

Compose injects `.env` into the API container on the external `terra-network`. For the internal services set `UC1_COLLECTOR_BASE_URL=http://uc1-water-pollutants-collector:8000` and `UC1_HYDRO_BASE_URL=http://hydro-modeling-service:8000`. UC3 storage remains separately configured. Start with `docker compose up --build -d`; the main Compose file exposes port 18000 locally.

## Tests

```bash
python -m pytest
```

The tests use an in-process ASGI client and mock collector execution. They do
not contact CDSE, MongoDB, or MinIO.

## Documentation

Detailed architecture, API, configuration, deployment, workflow, and QA guides are available:

- **Local:** `docs/docs/` - Build with MkDocs when documentation tooling is installed
- **Online:** [Data_ingestion_module/latest](https://terra-horizon.github.io/Data_ingestion_module/latest/)

### UC1 Sperchios delegated profiles

`uc1-water-pollutants-collector`, `uc1-sperchios-river` and `uc1-sperchios-sea` run through the same `POST /api/ingestion/run` endpoint. Supply the common request fields. For example, change `profile` among the three names:

```json
{"run_job_id":"uc1-river-001","triggered_at":"2026-11-03T07:00:00Z","provider":"sentinel-2","profile":"uc1-sperchios-river","aoi_id":"sperchios","bbox":[22.433493,38.837552,22.569555,38.894223]}
```

Set the `UC1_*` environment variables in `.env.example` in the application process. Use external proxy prefixes for external URLs and no prefix for internal Docker URLs; configure the static river and marine IDs from the respective service. The satellite profile submits a collection job. Independently, the river profile retrieves the configured river analysis, then runs reanalysis and a 15-day local forecast. The sea profile finds the configured marine analysis for the river, then runs a six-day ECMWF IFS ingestion. Steps run sequentially; Hydro Modeling owns persistence.

The satellite submission (`202`) is followed by polling until a terminal result or the configured wait limit. Successful upstream bodies are retained under `collector_result`. A later Hydro Modeling failure stops its sequence and returns HTTP 200 with `status: partial`, completed responses and an `error` with the failed step and category. Initial configuration, availability and execution failures use the existing 400, 503 and 500 error responses. Secrets echoed by upstream services are redacted. Run offline tests with `.venv\Scripts\python.exe -m pytest tests/test_uc1_profile.py` (or `python -m pytest` for the full suite).
