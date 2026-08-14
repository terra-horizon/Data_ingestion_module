# TERRA Data Ingestion Module

Python 3.12+ FastAPI service that exposes the TERRA UC1 Sentinel-2 collector
through a profile-based ingestion endpoint. The service validates orchestration
requests, selects a registered process profile, runs the collector outside the
async event loop, and returns run metadata with the collector result.

The collector is temporarily bundled at `app/packages/collector`. It remains a
separate installable Python package and owns CDSE discovery, river tiling,
collection state, MongoDB persistence, and MinIO publication. Replace the
bundled copy with the organization-managed package when it becomes available.

## Data flow

```text
Caller
  -> POST /api/ingestion/run
  -> Pydantic request validation
  -> profile dispatcher
  -> forecaster-collector adapter
  -> bundled data_collection package
     -> restore observations/state/tiles from MongoDB and MinIO
     -> discover new Sentinel-2 dates through CDSE when required
     -> collect tile/date statistics
     -> update local staging files
     -> publish documents to MongoDB and artifacts to MinIO
  -> structured HTTP response
```

The current profile is `forecaster-collector`. Profiles are server-registered;
callers cannot provide arbitrary Python process names.

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

Install the bundled collector, followed by the API and test dependencies:

```bash
python -m pip install -e app/packages/collector
python -m pip install -e ".[test]"
```

Copy `.env.example` to `.env`, supply the required credentials and storage
endpoints, then start the API:

```bash
uvicorn app.main:app --reload
```

Swagger UI is available at <http://127.0.0.1:8000/docs>.

## Run ingestion

Send `POST /api/ingestion/run`:

```json
{
  "run_job_id": "job-sperchios-20260814-001",
  "triggered_at": "2026-08-14T07:30:00+03:00",
  "provider": "sentinel-2",
  "profile": "forecaster-collector",
  "aoi_id": "sperchios",
  "bbox": [22.433493, 38.837552, 22.569555, 38.894223],
  "run_name": "sperchios",
  "history_start": "2016-01-01",
  "mode": "auto",
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

Use `tests_external/ingestion.http` to send the same request from an HTTP client
that supports `.http` files.

The response contains the caller's `run_job_id`, selected provider/profile,
timings, overall status, and the serialized collector result. Paths inside
`collector_result` refer to local staging paths in the API process or container;
durable data is stored by the collector in MongoDB and MinIO.

## Docker

The application Compose file expects the existing `terra-network`,
`terra-mongodb`, and `terra-minio` resources supplied by the local TERRA stack.
Use container DNS names and internal ports in `.env`:

```env
MONGO_URI=mongodb://<user>:<url-encoded-password>@terra-mongodb:27017/terra_db?authSource=admin
MINIO_ENDPOINT=http://terra-minio:9000
```

Start or rebuild the API container:

```bash
docker compose up --build -d
```

The API is exposed at <http://127.0.0.1:8000>. MinIO port `9000` is the S3 API;
port `9001` is the browser console.

## Tests

```bash
python -m pytest
```

The tests use an in-process ASGI client and mock collector execution. They do
not contact CDSE, MongoDB, or MinIO.

## Documentation

Detailed architecture, API, configuration, deployment, workflow, and QA guides
are under `docs/docs`. Build them from `docs/` with MkDocs when the documentation
tooling is installed.
