# Ingestion Workflow

## 1. Request validation

The caller sends `POST /api/ingestion/run`. Pydantic verifies:

- a non-empty `run_job_id`, `aoi_id`, and `run_name`;
- a timezone-aware `triggered_at`;
- `provider: sentinel-2`;
- a registered `profile`;
- a four-number WGS84 bounding box with ordered coordinates;
- valid dates, mode, and positive optional run limits.

Invalid input returns HTTP `422` before an adapter runs.

## 2. Profile selection

`app/services/ingestion.py` selects the registered profile runner. The current
mapping is:

```text
forecaster-collector -> run_sentinel_ingestion
```

Because collection is synchronous and blocking, the profile runner executes in
a Starlette worker thread.

## 3. Adapter translation

The collector adapter converts the validated request into `CollectionRequest`.
It sets `output_root` to `outputs`, passes the AOI, dates, mode and limits, and
enables publication. A process-local guard prevents two requests for the same
AOI from collecting concurrently.

## 4. Storage preflight and hydration

For a published run, the collector:

1. Loads runtime environment variables.
2. Connects to MongoDB and MinIO and checks required storage resources.
3. Verifies the stable AOI definition.
4. Restores observations from MongoDB when local history is absent.
5. Restores collection state and tile artifacts from MinIO when local files are
   absent.
6. Creates a `pipeline_runs` record with collector status `running`.

## 5. Discovery and collection

The collector calculates discovery windows from `mode`, `history_start`,
`target_date`, and restored state.

- Existing `cdse_stac_cache` entries are reused when a matching local cache is
  present.
- Missing windows are requested from CDSE and cached locally.
- If state already covers the target date, no discovery request is made.
- River tiles are restored or generated as needed.
- Missing tile/date units are collected through the Sentinel Hub Statistical
  API.
- Run limits can restrict dates and tiles for commissioning tests.

## 6. Publication

The collector updates local history and state, then publishes:

- observation documents and tile documents to MongoDB;
- incremental collection state to MongoDB;
- stable AOI, tile, observation, result, input-manifest, and log artifacts to
  MinIO;
- the terminal `success`, `partial`, or `failed` pipeline run status.

Partial runs keep successfully collected data and report retryable failures in
`failed_units`.

## 7. API response

FastAPI returns an envelope containing the request job ID, provider, profile,
AOI, trigger/start/completion timestamps, duration, status, and serialized
collector result. Collector-local paths in that result refer to the current
host or container only.

Known errors map to:

| Condition | HTTP status |
| --- | --- |
| Invalid request | `422` |
| Invalid collector configuration | `400` |
| Same AOI already running in this process | `409` |
| MongoDB or MinIO unavailable | `503` |
| Unexpected collector failure | `500` |
