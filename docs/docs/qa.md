# Quality Assurance

## Automated API tests

Run from the repository root:

```bash
python -m pytest
```

The FastAPI tests use `httpx.ASGITransport` and mock the collector boundary.
They verify:

- liveness and readiness response contracts;
- sanitized HTTP `503` readiness responses;
- HTTP `200` success responses;
- `partial` collector results;
- orchestration metadata and selected profile;
- construction of the collector request;
- timezone, AOI, bounding-box, and profile validation;
- stable, sanitized HTTP `500` behavior for unexpected collector errors.

These tests do not contact CDSE, MongoDB, or MinIO.

## Remote collector tests

The collector service owns its collection and persistence tests. This module mocks its HTTP API and verifies submission, polling, readiness, and error handling. UC3 integration tests use the installed wheel.

## Manual API test

Start Uvicorn or the Compose service and execute
`tests_external/ingestion.http`. For a commissioning run, retain small limits:

```json
{
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

Confirm the top-level status and inspect `collector_result.satellite_submission` and `satellite_collection`. `pending` retains the remote job ID when the wait expires or polling fails. The remote worker owns MongoDB and MinIO persistence.

## Failure-path checks

| Test | Expected result |
| --- | --- |
| Missing or unknown profile | HTTP `422`. |
| Timestamp without timezone | HTTP `422`. |
| Reversed or incomplete bbox | HTTP `422`. |
| Missing collector environment variable | HTTP `400`. |
| Remote collector unreachable before submission | HTTP `503`. |
| Concurrent UC3 request for same AOI in one API process | HTTP `409`. |
| Unexpected collector exception | HTTP `500` without a traceback in the response. |

Use the remote collector's diagnostics for collection failures. Public errors intentionally avoid returning tracebacks.
