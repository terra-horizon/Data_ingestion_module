# API Reference

Local base URL:

```text
http://127.0.0.1:8000
```

Interactive OpenAPI documentation is available at `/docs`.

## GET /health/live

Returns HTTP `200` when the FastAPI process is running:

```json
{
  "status": "ok"
}
```

This endpoint does not contact external dependencies.

## GET /health/ready

Checks required storage configuration, MongoDB connectivity, and access to the
configured MinIO bucket. It performs no writes. A ready service returns HTTP
`200`:

```json
{
  "status": "ready",
  "checks": {
    "configuration": "ok",
    "mongodb": "ok",
    "minio": "ok"
  }
}
```

An unavailable dependency returns HTTP `503`. The response identifies only the
failed dependency and does not expose connection strings, credentials, or
internal exception details.

## POST /api/ingestion/run

Runs the process selected by `profile`. The current implementation supports
only `forecaster-collector` with provider `sentinel-2`.

### Request

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
  "target_date": "2026-08-14",
  "mode": "auto",
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

| Field | Required | Description |
| --- | --- | --- |
| `run_job_id` | Yes | Caller-owned orchestration identifier echoed in responses and handled errors. |
| `triggered_at` | Yes | ISO 8601 timestamp including a timezone offset. |
| `provider` | Yes | Currently `sentinel-2`. |
| `profile` | Yes | Currently `forecaster-collector`. |
| `aoi_id` | Yes | Stable remote-storage identity for the physical AOI. |
| `bbox` | Yes | `[min_lon, min_lat, max_lon, max_lat]` in WGS84. |
| `run_name` | Yes | Name used for the normalized local output directory. |
| `history_start` | No | Historical discovery start date; default `2016-01-01`. |
| `target_date` | No | Inclusive end date; defaults to the current UTC date in the adapter. |
| `mode` | No | `auto`, `backfill`, or `incremental`; default `auto`. |
| `max_days_per_run` | No | Positive limit for missing dates processed in this invocation. |
| `max_tiles_per_run` | No | Positive limit for tiles processed in this invocation. |

### Successful response

Both complete and partial collector outcomes return HTTP `200`.

```json
{
  "run_job_id": "job-sperchios-20260814-001",
  "provider": "sentinel-2",
  "profile": "forecaster-collector",
  "aoi_id": "sperchios",
  "triggered_at": "2026-08-14T07:30:00+03:00",
  "started_at": "2026-08-14T04:30:01Z",
  "completed_at": "2026-08-14T04:30:04Z",
  "duration_ms": 3000,
  "status": "success",
  "collector_result": {
    "status": "success",
    "run_dir": "outputs/sperchios",
    "run_summary": "No new satellite data required collection.",
    "mode": "auto",
    "available_dates": [],
    "missing_dates": [],
    "collected_dates": [],
    "new_record_count": 0,
    "failed_units": [],
    "latest_available_observation": null,
    "history_json_path": "outputs/sperchios/history/global_history.json",
    "history_csv_path": "outputs/sperchios/history/global_history.csv",
    "tile_records_path": "outputs/sperchios/tiles/tile_records.json",
    "tiles_geojson_path": "outputs/sperchios/tiles/river_tiles.geojson",
    "state_path": "outputs/sperchios/collection/state.json",
    "discovery_windows": [],
    "warnings": []
  }
}
```

The exact `collector_result` follows the bundled collector's
`CollectionResult.to_dict()` contract. Local paths are execution details, not
portable MongoDB or MinIO references.

### Handled errors

```json
{
  "detail": {
    "code": "collector_unavailable",
    "message": "MinIO preflight failed ...",
    "run_job_id": "job-sperchios-20260814-001"
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `collector_configuration_error` | Collector input or runtime configuration is invalid. |
| `409` | `collector_already_running` | The same API process is already collecting this AOI. |
| `503` | `collector_unavailable` | MongoDB or MinIO preflight failed. |
| `500` | `collector_execution_error` | An unexpected collector failure was hidden behind a stable public message. |
| `422` | FastAPI validation detail | Request fields failed schema validation. |

The service currently exposes no `/api/sources` endpoint.
