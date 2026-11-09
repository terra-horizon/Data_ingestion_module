# Manual integration requests

The `.http` examples use `@baseUrl`. Set it to `http://127.0.0.1:8000` for local Uvicorn, or `http://127.0.0.1:18000` when connected to the production server over SSH. The main Compose configuration also maps port 18000. Read-only GET requests do not start ingestion. Every POST starts real work and may write to production when pointed at a production-configured service, including a locally running service.

Configure the application using `.env.example`: the satellite service needs `UC1_COLLECTOR_BASE_URL` and `UC1_COLLECTOR_API_KEY`; Hydro needs its URL, API key and configured static IDs; UC3 needs its independently installed wheel and `UC3_INGEST_*` settings. The application sends UC1 keys in `X-API-Key`; do not put them in request files. On `terra-network`, use `http://uc1-water-pollutants-collector:8000` and `http://hydro-modeling-service:8000`.

Use [healthChecks.http](healthChecks.http) for read-only liveness and independent satellite and UC3 readiness. HTTP 503 indicates unavailable configuration or a dependency. Health does not prove downstream write permissions.

[ingestion.http](ingestion.http) submits `uc1-water-pollutants-collector`. Set a new run ID and timestamp and appropriate collection dates. The module submits once, then polls. HTTP 200 alone is not success: inspect `status` and `collector_result`. Terminal statuses are `success`, `partial`, and `failed`; `pending` means polling ended while the collector may continue. Save `collector_result.satellite_submission.job_id` and use the read-only status request in that file. The service does not store job IDs; if a client or proxy disconnects before receiving the response, recover the ID from the collector before retrying. Reusing a run ID and trigger date yields the same derived collector run ID, but upstream idempotency is not guaranteed.

[uc1_sperchios.http](uc1_sperchios.http) includes `uc1-sperchios-river` and `uc1-sperchios-sea`. River performs static lookup, ECMWF reanalysis and a 15-day local forecast; sea validates a marine analysis and runs six-day IFS. A later failed step returns `partial` with completed responses and an error.

[uc3.http](uc3.http) exercises `coastal-uc3-sentinel2` with the existing example AOI. Confirm that the AOI and bbox are authorised in the target registry and update the acquisition window. UC3 may query CDSE and publish to MongoDB and MinIO. Inspect its `completed`, `no_data`, or `failed` outcome and result details.

HTTP 422 means invalid request, 400 generally indicates invalid configuration, 404 means a collector job was not found, 409 means an AOI is already guarded in this process, and 503 indicates an unavailable dependency. See the [API reference](../docs/docs/api-reference.md) for details. Run offline regression tests with `python -m pytest -q`; upstream calls are mocked.
