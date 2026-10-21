# API Reference

## Overview

The module exposes a synchronous REST API for two Sentinel-2 workflows. Both use `provider: "sentinel-2"`; `profile` selects the adapter and determines which request fields and persistence operations apply.

| Profile | Workflow |
|---|---|
| `forecaster-collector` | UC1 statistical collection and processing |
| `coastal-uc3-sentinel2` | UC3 Sentinel-2 L2A scene selection, quality checks, raster delivery, and publication |

### Base URLs

Local development: `http://127.0.0.1:8000`

Production: `https://server.iprism.eu/data-ingestion`

Append endpoint paths to the base URL. In production the reverse proxy serves the application under `/data-ingestion`. Interactive OpenAPI documentation is at `/docs` (under the production prefix, `/data-ingestion/docs`).

---

## Health endpoints

### `GET /health/live`

Reports that the API process is running. It does not contact external dependencies.

```json
{"status":"ok"}
```

HTTP status: `200`.

### `GET /health/ready`

UC1 readiness check. It loads UC1 storage/provider configuration, pings the configured MongoDB database, and calls MinIO `head_bucket` for the UC1 bucket. It does not write data or contact the satellite provider. A configuration failure marks MongoDB and MinIO `skipped`; failed connectivity marks the affected dependency `unavailable`.

```json
{
  "status": "ready",
  "checks": {"configuration":"ok", "mongodb":"ok", "minio":"ok"}
}
```

HTTP status is `200` when ready and `503` otherwise. The body has the same shape when not ready, with `status: "not_ready"` and per-check states.

### `GET /health/ready/coastal-uc3-sentinel2`

UC3 readiness is checked independently. It imports the installed UC3 package and loads its acquisition schema, validates UC3 storage/provider settings and the authorised AOI registry, pings MongoDB, then lists at most one object under the configured UC3 scene-input prefix. If package/configuration checks fail, later dependency checks are `skipped`.

```json
{
  "status": "ready",
  "checks": {"package":"ok", "configuration":"ok", "mongodb":"ok", "minio":"ok"}
}
```

HTTP status is `200` when every check is `ok`, otherwise `503`. This does not test CDSE authentication, execute a catalogue/process request, or prove MinIO write permission. UC3 readiness does not change UC1 readiness.

---

## `POST /api/ingestion/run`

Runs the selected profile in a worker thread and keeps the HTTP request open until it finishes. A normal collector outcome (including UC3 `no_data` or `failed`) is returned with HTTP `200`; HTTP errors are reserved for validation, configuration, availability, concurrency, and unexpected execution errors described below. There is no job queue, `202 Accepted`, or polling endpoint.

### Common request fields

| Field | Required | Contract |
|---|---|---|
| `run_job_id` | Yes | Non-empty orchestration/correlation identifier. UC3 also uses it as the package correlation ID. |
| `triggered_at` | Yes | ISO 8601 datetime with a timezone offset. |
| `provider` | Yes | Literal `sentinel-2`. |
| `profile` | Yes | `forecaster-collector` or `coastal-uc3-sentinel2`. |
| `aoi_id` | Yes | Non-empty AOI identifier. UC3 additionally checks it against the configured authorised AOI registry. |
| `bbox` | Yes | Four WGS84 numbers `[min_lon, min_lat, max_lon, max_lat]`; must be ordered and within longitude/latitude ranges. UC3 also checks it matches the registered AOI. |

The outer request model permits extra fields by Pydantic's default behavior. The nested `uc3` object explicitly rejects unknown fields. UC1-only fields are not forwarded to the UC3 package.

### UC1: `forecaster-collector`

`run_name` is required for UC1. Other optional UC1 fields are:

| Field | Default / constraints |
|---|---|
| `history_start` | `2016-01-01` |
| `target_date` | Current UTC date when omitted |
| `mode` | `auto`; allowed: `auto`, `backfill`, `incremental` |
| `max_days_per_run` | Optional positive integer |
| `max_tiles_per_run` | Optional positive integer |

Example:

```json
{
  "run_job_id": "job-sperchios-001",
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

Execution calls the installed `data_collection` collector with publication enabled. It discovers and collects the missing Sentinel-2 tile/date observations, processes them, and maintains local run/history/state outputs. For persistence it reads existing AOI observations and checkpoints from MongoDB, uploads/updates artifacts and metadata in MinIO/MongoDB, and writes its pipeline-run state. Exact provider calls and number of DB/object operations depend on the requested date range, missing observations, and persisted state; this is not a single fixed database query.

UC1 result fields are those returned by the installed collector's `CollectionResult.to_dict()`. Common outcomes are `success`, `partial`, and `failed`.

### UC3: `coastal-uc3-sentinel2`

UC3 requires the nested `uc3` options. Storage credentials, provider credentials, database names, bucket, and prefixes come from worker environment configuration (`UC3_INGEST_*`); they are not accepted as request options.

| `uc3` field | Required | Contract |
|---|---|---|
| `contract_version` | Yes | Literal integer `2`. |
| `mode` | Yes | `latest` or `window`. |
| `time_from`, `time_to` | Yes | Timezone-aware datetimes; `time_to` must be later. |
| `selection_policy` | No | `uc3_parity_pilot` by default; alternatively `uc3_monthly_backfill`. |
| `max_scenes` | No | Strict integer 1–24; omitted value/policy defaults are resolved by the package. |
| `project_id` | No | Optional request value; the package scopes execution to its configured project. |
| `request_id` | No | Optional package request identifier. |
| `registry_version` | No | Optional AOI registry version. |
| `window_id` | No | Optional acquisition window identifier. |

Example:

```json
{
  "run_job_id": "uc3-aoi01-20261008-001",
  "triggered_at": "2026-10-08T00:05:00Z",
  "provider": "sentinel-2",
  "profile": "coastal-uc3-sentinel2",
  "aoi_id": "aoi_01",
  "bbox": [-2.88294, 56.33412, -2.80112, 56.3715],
  "uc3": {
    "contract_version": 2,
    "mode": "latest",
    "time_from": "2026-09-08T00:00:00Z",
    "time_to": "2026-10-08T00:00:00Z",
    "selection_policy": "uc3_parity_pilot",
    "max_scenes": 1
  }
}
```

The adapter passes `run_job_id`, trigger time, provider/profile, AOI, bbox, and `uc3` options to the package after checking the AOI registry. The package then builds and validates its acquisition request, searches the CDSE catalogue for Sentinel-2 L2A candidates, applies its tile/AOI quality selection, and requests five-band reflectance rasters from the CDSE Process API for selected scenes. The package publishes accepted rasters to the configured MinIO namespace and commits scene, scene-asset, and artifact metadata in MongoDB. It checks committed artifacts to support reuse/idempotency. If no candidates pass selection, it returns `no_data` and does not publish a scene package. The exact catalogue pages, process calls, and MongoDB/MinIO operations depend on matches, quality results, and existing committed assets.

---

## Response structure

The API wraps each adapter result in this application-owned envelope. `status` is copied from `collector_result.status` (or `unknown` if a collector omits it); timestamps and duration are measured by the API. UC1 and UC3 collector payloads have different contracts.

```json
{
  "run_job_id": "job-id",
  "provider": "sentinel-2",
  "profile": "forecaster-collector",
  "aoi_id": "sperchios",
  "triggered_at": "2026-08-14T07:30:00+03:00",
  "started_at": "2026-08-14T04:30:01Z",
  "completed_at": "2026-08-14T04:30:04Z",
  "duration_ms": 3000,
  "status": "success",
  "collector_result": {"status":"success"}
}
```

`collector_result` is abbreviated above. The real payload is the selected collector's dictionary and is not normalized into a shared inner schema.

### UC1 response

The UC1 payload is `CollectionResult.to_dict()`. For example, a no-new-data run may return `status: "success"`, empty date lists, zero new records, and paths to its persisted history/state outputs. A run can also return `partial` or `failed`. Paths such as `outputs/sperchios/...` are worker-local paths, not necessarily downloadable API URLs.

### UC3 response

The UC3 payload is the package's `wp2_run_response` result. The following is a consistent excerpt from the installed package's no-data fixture; all three status/outcome fields agree and there are no scene assets because no scene was delivered:

```json
{
  "run_job_id": "example-airflow-run",
  "provider": "sentinel-2",
  "profile": "coastal-uc3-sentinel2",
  "aoi_id": "aoi_01",
  "triggered_at": "2026-10-08T00:05:00Z",
  "started_at": "2026-10-08T00:05:00Z",
  "completed_at": "2026-10-08T00:05:00Z",
  "duration_ms": 0,
  "status": "no_data",
  "collector_result": {
    "schema_version": 2,
    "result_type": "uc3_ingestion_result",
    "package_version": "0.5.1",
    "profile": "coastal-uc3-sentinel2",
    "request_id": "uc3req_0f610d29f7c25189afd117bb7fc9652e",
    "correlation_id": "example-airflow-run",
    "aoi_id": "aoi_01",
    "mode": "latest",
    "publish": true,
    "outcome": "no_data",
    "reason": "no_scene_passed_aoi_quality",
    "error": null,
    "started_at": "2026-10-08T00:05:00Z",
    "completed_at": "2026-10-08T00:05:00Z",
    "output_grid": {"crs":"EPSG:4326", "width":505, "height":414, "approx_pixel_size_m":[9.993,9.981]},
    "selection": {"catalogue_entries":1, "acquisitions":1, "passed_tile_prefilter":1, "considered":1, "aoi_quality_policy":"uc3_aoi_scl_unusable_v1", "max_scenes":3, "delivered":0},
    "candidates": [
      {
        "provider":"CDSE",
        "provider_scene_id":"S2B_MSIL2A_20260824T113319_N0512_R080_T30VWH_FIXTURE.SAFE",
        "acquisition_key":"S2B_20260824T113319",
        "duplicate_tile_scene_ids":[],
        "collection":"sentinel-2-l2a",
        "processing_level":"L2A",
        "acquired_at":"2026-08-24T11:35:31.331Z",
        "cloud_cover_pct":12.0,
        "platform":"sentinel-2b",
        "constellation":"sentinel-2",
        "decision":"rejected_aoi_quality",
        "aoi_quality":{"policy_id":"uc3_aoi_scl_unusable_v1", "max_aoi_unusable_pct":10.0, "probe_resolution_m":60.0, "aoi_unusable_pct":62.0, "aoi_cloud_pct":62.0, "aoi_cloud_shadow_pct":0.0, "aoi_nodata_pct":0.0, "aoi_other_unusable_pct":0.0, "status":"rejected"}
      }
    ],
    "scene_packages": [],
    "status": "no_data",
    "scene_asset_ids": []
  }
}
```

For `completed`, accepted candidates have corresponding entries in `scene_packages`; `scene_asset_ids` is derived from those packages. Each scene package contains identifiers, scene/quality/raster/processing metadata, a committed artifact delivery reference (bucket/object key/hash), and provenance. For `failed`, the package returns `outcome/status: "failed"` and may include a structured `error` object. The API copies the package result and mirrors its `status` in the outer response. UC3 outcomes `completed`, `no_data`, and `failed` all normally use HTTP `200`.

Clients should inspect the outer `status` and, for UC3, `collector_result.outcome`, `collector_result.reason`, and `collector_result.error`; do not treat HTTP `200` alone as a successful acquisition.

---

## Error responses

### Request validation (`422`)

FastAPI/Pydantic rejects malformed request bodies before the adapter runs. This includes unknown profile/provider, invalid bbox order/range, missing profile-required fields, invalid UC3 times/options, and extra keys inside `uc3`. FastAPI uses its standard validation body, for example:

```json
{"detail":[{"loc":["body","uc3","mode"],"msg":"Input should be 'latest' or 'window'","type":"literal_error"}]}
```

### Handled adapter errors

The application returns `{"detail":{"code":"...","message":"...","run_job_id":"..."}}` for mapped execution errors.

| HTTP | Code | Typical cause |
|---|---|---|
| `400` | `collector_configuration_error` | Invalid/missing adapter configuration, or UC3 AOI/bbox not authorised. |
| `409` | `collector_already_running` | Another request for the same guarded AOI is running in this process. |
| `503` | `collector_unavailable` | UC3 package/runtime cannot be imported or another explicitly unavailable dependency is detected. |
| `500` | `collector_execution_error` | Unexpected collector error or invalid/inconsistent UC3 result. |

UC1 storage preflight errors are mapped to `400` (configuration) or `503` (connection). UC3 configuration errors raised by the package are mapped to `400`; provider or storage failures represented as a valid UC3 result may instead produce HTTP `200` with `status: "failed"`. Unhandled failures outside the adapter's mapped exceptions use FastAPI's normal server-error handling.

Messages are sanitized for adapter execution failures. Validation messages may contain the invalid field/value supplied by the caller; never put credentials in request fields.

---

## Execution and deployment notes

- Calls are synchronous and can take as long as catalogue discovery, raster processing, and publication. Set client and reverse-proxy timeouts accordingly.
- The AOI concurrency guard is process-local; it does not coordinate multiple API replicas.
- Readiness reports connectivity/configuration checks and does not guarantee CDSE authentication, a matching scene, or successful writes.
- UC3 API responses include storage object keys and artifact metadata, not raster bytes or a download endpoint.
- The UC3 package must be installed in the runtime image and its server-side `UC3_INGEST_*` settings must be configured.

See [UC3 Integration Documentation](uc3-integration.md) for package installation, environment setup, and manual execution guidance.
