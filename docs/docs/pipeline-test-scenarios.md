# Pipeline Test Scenarios

These scenarios exercise the implemented FastAPI-to-collector flow. Use a test
AOI and local MongoDB/MinIO data that can be reset safely.

## Scenario 1: Request validation

Remove `profile`, provide an unknown profile, remove the timezone from
`triggered_at`, or reverse bbox coordinates.

Expected result: HTTP `422`; the collector is not called.

## Scenario 2: First bounded backfill

Use a new `aoi_id` and `run_name` with:

```json
{
  "mode": "auto",
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

Expected result:

- CDSE discovery windows are requested and written under
  `outputs/<run>/cdse_stac_cache`;
- river tiles are generated;
- at most one date and one tile are processed;
- MongoDB and MinIO receive collector-owned data;
- HTTP status is `200` with collector status `success` or `partial`.

## Scenario 3: Incremental rerun

Repeat the same AOI after a successful run.

Expected result:

- remote state and observations are restored if local staging is absent;
- completed tile/date units are not duplicated;
- only newly available or incomplete work is selected.

## Scenario 4: Local output deletion

Delete only the test run's local `outputs/<run>` directory and rerun the same
AOI.

Expected result: MongoDB/MinIO state is hydrated. Historical CDSE requests are
not repeated when restored state already covers the target date. The local STAC
cache may remain absent when discovery window count is zero.

## Scenario 5: Partial run

Cause one collector unit to fail transiently while another succeeds.

Expected result: HTTP `200`, response status `partial`, successful data remains
published, and retryable units appear in `failed_units`.

## Scenario 6: MongoDB connectivity and authentication

Test an unreachable hostname, then a URI without credentials against an
authenticated MongoDB.

Expected result: unreachable storage maps to HTTP `503`. An authorization error
during later MongoDB setup may surface as the collector's generic HTTP `500`;
inspect container logs and `pipeline_runs` during diagnosis.

## Scenario 7: MinIO connectivity

Set `MINIO_ENDPOINT` to `localhost` inside the API container.

Expected result: HTTP `503`. Restore `http://terra-minio:9000`, recreate the API
container, and confirm the bucket and credentials match the node stack.

## Scenario 8: Same-AOI concurrency

Send two overlapping requests for the same AOI to one API process.

Expected result: one request runs and the other returns HTTP `409`.

## Scenario 9: Independent AOIs

Send requests for two different AOI IDs.

Expected result: the process-local guard allows both. Resource capacity and
external API limits still apply.

## Scenario 10: Container replacement

Run successfully, recreate the API container, and run the same AOI again.

Expected result: local staging starts empty, durable collector state is
restored, and only required incremental work runs.
