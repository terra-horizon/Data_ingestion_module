# Quality Assurance

## Automated API tests

Run from the repository root:

```bash
python -m pytest
```

The FastAPI tests use `httpx.ASGITransport` and mock the collector boundary.
They verify:

- HTTP `200` success responses;
- `partial` collector results;
- orchestration metadata and selected profile;
- construction of the collector request;
- timezone, AOI, bounding-box, and profile validation;
- stable, sanitized HTTP `500` behavior for unexpected collector errors.

These tests do not contact CDSE, MongoDB, or MinIO.

## Bundled collector tests

The collector has its own test suite and optional test dependencies:

```bash
python -m pip install -e "app/packages/collector[test]"
python -m pytest app/packages/collector/tests
```

Collector tests cover incremental state, discovery caching, retries, storage
contracts, publication, and schema validation without live CDSE calls.

## Manual API test

Start Uvicorn or the Compose service and execute
`tests_external/ingestion.http`. For a commissioning run, retain small limits:

```json
{
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

Confirm:

1. HTTP status is `200` for `success` or `partial`.
2. The response echoes `run_job_id`, provider, profile, and AOI.
3. MongoDB `pipeline_runs` contains the collector run.
4. Observation/tile/state documents are present under the expected AOI.
5. MinIO contains stable AOI artifacts and a run-scoped prefix.

## Failure-path checks

| Test | Expected result |
| --- | --- |
| Missing or unknown profile | HTTP `422`. |
| Timestamp without timezone | HTTP `422`. |
| Reversed or incomplete bbox | HTTP `422`. |
| Missing collector environment variable | HTTP `400`. |
| MongoDB/MinIO unreachable | HTTP `503`. |
| Concurrent request for same AOI in one API process | HTTP `409`. |
| Unexpected collector exception | HTTP `500` without a traceback in the response. |

Use container logs and the collector's `pipeline_runs` records for internal
diagnostics. Public errors intentionally avoid returning tracebacks.