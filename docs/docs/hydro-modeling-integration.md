# Hydro Modeling delegated ingestion

The Data Ingestion Module forwards four ECMWF/IFS ingestion operations to the UC1 Hydro Modeling Service. Hydro performs acquisition, processing, and MongoDB persistence. This module validates inputs, sends the configured downstream API key, validates the returned JSON, and gives the orchestrator a response envelope. The Sentinel UC1 and UC3 profiles continue to use `POST /api/ingestion/run`.

| Module operation | Hydro Modeling endpoint |
|---|---|
| `GET /api/hydro-modeling/ecmwf/reanalysis-availability` | `GET /data-ingestion/ecmwf/reanalysis-availability` |
| `POST /api/hydro-modeling/ecmwf/reanalysis` | `POST /data-ingestion/ecmwf/reanalysis` |
| `POST /api/hydro-modeling/ecmwf/local-forecast` | `POST /data-ingestion/ecmwf/local-forecast` |
| `POST /api/hydro-modeling/ifs` | `POST /data-ingestion/ifs` |

The downstream base URL defaults to `https://server.iprism.eu/terra/use-case-1/hydro-modeling-service`. Set these in the private `.env` or container environment:

```dotenv
HYDRO_MODELING_BASE_URL=https://server.iprism.eu/terra/use-case-1/hydro-modeling-service
HYDRO_MODELING_API_KEY=YOUR_DOWNSTREAM_KEY
HYDRO_MODELING_TIMEOUT_SECONDS=120
HYDRO_MODELING_CONNECT_TIMEOUT_SECONDS=10
```

The key is required and sent only as `X-API-Key` to Hydro. TLS certificate verification stays enabled. The timeout values bound connection setup and individual socket reads/writes; they are **not** a hard limit for the entire downstream operation. The adapter does not retry POST requests because a timed-out Hydro request may already have written data. Keep this downstream key separate from controls protecting the module's own API. Docker Compose passes `.env` into the application container, so environment changes require a container recreation.

## Requests

Use the module's local base URL `http://127.0.0.1:18000` with Docker Compose, or `http://127.0.0.1:8000` with local Uvicorn. The four bodies are independent of the Sentinel profile request schema.

```http
GET /api/hydro-modeling/ecmwf/reanalysis-availability?analysis_area_id=sperchios
```

```http
POST /api/hydro-modeling/ecmwf/reanalysis
Content-Type: application/json

{"analysis_area_id":"sperchios","action_date":"2026-10-30"}
```

```http
POST /api/hydro-modeling/ecmwf/local-forecast
Content-Type: application/json

{"analysis_area_id":"sperchios","horizon_days":15}
```

```http
POST /api/hydro-modeling/ifs
Content-Type: application/json

{"marine_analysis_area_id":"maliakos","action_date":"2026-10-30","horizon_days":6,"source":"ecmwf"}
```

`horizon_days` defaults to 15 for local forecast and 6 for IFS; `source` defaults to `ecmwf`. Action dates must be `YYYY-MM-DD`. Optional defaults are included in forwarded POST bodies so both services use the same values. No Hydro operation writes to MongoDB from the module.

## Response and errors

Successful calls return the module envelope below. `result` contains the validated Hydro payload, including any additional metadata Hydro supplies. Nullable dates stay null. A successful availability check has top-level `status: "success"`; POST status follows Hydro's `result.status`.

```json
{
  "provider": "hydro-modeling",
  "profile": "ecmwf-reanalysis",
  "status": "completed",
  "request_id": "generated-module-id",
  "downstream_status": 200,
  "duration_ms": 247,
  "result": {
    "status": "completed",
    "analysis_area_id": "sperchios",
    "dataset": "ERA5-Land",
    "action_date": "2026-10-30",
    "inserted": 1,
    "existing": 0
  }
}
```

Local input validation returns 422 before contacting Hydro. Missing key or invalid adapter settings return 503. Downstream 401/403 map to 502 without disclosing the key; downstream 422 maps to 422 and includes its validation detail. Downstream 500 and malformed JSON/payload map to 502; downstream 502/503/504 or 429 map to 503; transport timeouts map to 504. Errors use `detail.code`, `detail.message`, and `detail.request_id`. The adapter logs operation, request ID, HTTP status, duration, and outcome without logging request headers or credentials.

The response field list follows the supplied Hydro contract; the live Hydro OpenAPI schema was not queried as part of this integration. If that schema differs, update these result models and the mocked contract tests before production use.

## Local and live validation

Run the mocked suite without contacting Hydro:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_hydro_modeling.py -q
.venv\Scripts\python.exe -m pytest -q
```

For a live test, configure the key privately, start the module, and begin with the read-only availability GET. Inspect the response before sending any POST: those requests can cause real Hydro acquisition and database writes. Verify the target analysis area, date, and operator authorization with the Hydro team. Do not use the module's MongoDB credentials to substitute for the Hydro service key.
