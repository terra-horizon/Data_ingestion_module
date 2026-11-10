# API Reference

## Overview

The module exposes a synchronous REST API for registered ingestion workflows. Both use `provider: "sentinel-2"`; `profile` selects the adapter and determines which request fields and persistence operations apply.

| Profile | Workflow |
|---|---|
| `uc1-water-pollutants-collector` | Remote satellite collector job |
| `uc1-sperchios-river` | Hydro Modeling river ingestion |
| `uc1-sperchios-sea` | Hydro Modeling marine ingestion |
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

UC1 readiness validates local collector configuration and queries the collector's `/health/ready` endpoint with a short timeout. It does not write data. The response uses `checks.configuration` and `checks.collector`, each `ok`, `unavailable`, or `skipped`; HTTP status is 200 when ready, 503 otherwise.

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

Runs the selected profile in a worker thread and keeps the HTTP request open until it finishes. A normal collector outcome (including UC3 `no_data` or `failed`) is returned with HTTP `200`; HTTP errors are reserved for validation, configuration, availability, concurrency, and unexpected execution errors described below. The satellite profiles submit and poll a remote job. Retrieve a known job later with `GET /api/ingestion/satellite/jobs/{job_id}`; this returns the validated upstream job body and does not submit a job.

### Common request fields

| Field | Required | Contract |
|---|---|---|
| `run_job_id` | Yes | Non-empty orchestration/correlation identifier. UC3 also uses it as the package correlation ID. |
| `triggered_at` | Yes | ISO 8601 datetime with a timezone offset. |
| `provider` | Yes | Literal `sentinel-2`. |
| `profile` | Yes | `uc1-water-pollutants-collector`, `uc1-sperchios-river`, `uc1-sperchios-sea`, or `coastal-uc3-sentinel2`. |
| `aoi_id` | Yes | Non-empty AOI identifier. UC3 additionally checks it against the configured authorised AOI registry. |
| `bbox` | Yes | Four WGS84 numbers `[min_lon, min_lat, max_lon, max_lat]`; must be ordered and within longitude/latitude ranges. UC3 also checks it matches the registered AOI. |

The outer request model permits extra fields by Pydantic's default behavior. The nested `uc3` object explicitly rejects unknown fields. UC1-only fields are not forwarded to the UC3 package.

### UC1 Satellite Water Pollutants Collection

Profile:

`uc1-water-pollutants-collector`

The Data Ingestion Module delegates satellite water pollutants collection to the external TERRA UC1 Satellite Water Pollutants Collector microservice.

Unlike the Hydro Modeling workflows, satellite collection is executed asynchronously by the external service.

The Data Ingestion Module is responsible for:

1. Validating the incoming ingestion request.
2. Constructing the Collector API request.
3. Submitting the collection job.
4. Monitoring the remote job until completion or timeout.
5. Returning the final or latest available job result.

The Data Ingestion Module does not execute the embedded UC1 Collector Python package.

The legacy `forecaster-collector` profile has been removed.

---

#### 1. Service Configuration

The integration requires:

| Environment Variable | Description |
|---|---|
| `UC1_COLLECTOR_BASE_URL` | Satellite Collector service URL |
| `UC1_COLLECTOR_API_KEY` | Authentication key for the Collector API |
| `UC1_COLLECTOR_POLL_INTERVAL_SECONDS` | Interval between job-status requests |
| `UC1_COLLECTOR_MAX_WAIT_SECONDS` | Maximum duration for waiting on job completion |

The actual supported polling configuration names and defaults should be confirmed against the deployed application settings.

---

#### 3. Satellite Collection Request

POST /api/ingestion/run

Example:

```json
{
  "run_job_id": "uc1-satellite-example-20261109-001",
  "triggered_at": "2026-11-09T09:00:00Z",
  "provider": "sentinel-2",
  "profile": "uc1-water-pollutants-collector",
  "aoi_id": "sperchios",
  "bbox": [
    22.433493,
    38.837552,
    22.569555,
    38.894223
  ]
}
```

The `profile` determines the collection workflow.

The common `provider` remains `sentinel-2`.

The upstream Collector supports both Sentinel-2 and Sentinel-3, selected using the optional `sensor` field.

---

#### 4. Supported Collection Options

The following optional parameters are supported:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sensor` | string | `sentinel2` | Satellite sensor: `sentinel2` or `sentinel3` |
| `mode` | string | `auto` | Collection mode |
| `history_start` | date | `2016-01-01` | Beginning of historical collection |
| `target_date` | date/null | UTC today | Inclusive collection cutoff |
| `max_days_per_run` | integer/null | null | Maximum days processed per run |
| `max_tiles_per_run` | integer/null | null | Maximum tiles processed per run |
| `discovery_chunk_days` | integer | 31 | Size of discovery windows |
| `max_cloud_coverage` | integer | 30 | Maximum cloud coverage percentage |

Supported collection modes:

- `auto`
- `backfill`
- `incremental`

Validation constraints:

- AOI identifiers must match `^[a-z0-9][a-z0-9_-]*$`.
- AOI identifiers must contain at most 120 characters.
- Collector run identifiers must contain at most 200 characters.
- Bounding boxes must contain four ordered WGS84 coordinates.
- `max_days_per_run` and `max_tiles_per_run` must be positive when supplied.
- `discovery_chunk_days` must be between 1 and 366.
- `max_cloud_coverage` must be between 0 and 100.

Unsupported satellite request fields are rejected with HTTP 422.

Example with optional parameters:

```json
{
  "run_job_id": "uc1-satellite-custom-20261109-001",
  "triggered_at": "2026-11-09T09:00:00Z",
  "provider": "sentinel-2",
  "profile": "uc1-water-pollutants-collector",
  "aoi_id": "sperchios",
  "bbox": [
    22.433493,
    38.837552,
    22.569555,
    38.894223
  ],
  "sensor": "sentinel2",
  "mode": "incremental",
  "history_start": "2016-01-01",
  "target_date": "2026-11-09",
  "max_days_per_run": 30,
  "max_tiles_per_run": 100,
  "discovery_chunk_days": 31,
  "max_cloud_coverage": 30
}
```

These optional limits can change how much data is processed.

---

#### 6. Successful Production Response

The following response summarizes an actual successful live
integration test performed on November 9, 2026.

HTTP 200 OK

```json
{
  "run_job_id": "uc1-satellite-example-20261109-001",
  "provider": "sentinel-2",
  "profile": "uc1-water-pollutants-collector",
  "aoi_id": "sperchios",
  "triggered_at": "2026-11-09T09:00:00Z",
  "started_at": "2026-11-09T08:39:51.779202Z",
  "completed_at": "2026-11-09T08:42:51.924752Z",
  "duration_ms": 180146,
  "status": "success",
  "collector_result": {
    "status": "success",
    "satellite_submission": {
      "job_id": "3c16420e507f448ea01a13f71267db3e",
      "run_job_id": "uc1.collection.water-pollutants_2026-11-09_2a6433e4da888ee42c64efcf",
      "aoi_id": "sperchios",
      "sensor": "sentinel2",
      "target_date": "2026-11-09",
      "status": "queued",
      "submitted_at": "2026-11-09T08:39:51Z"
    },
    "satellite_collection": {
      "job_id": "3c16420e507f448ea01a13f71267db3e",
      "run_job_id": "uc1.collection.water-pollutants_2026-11-09_2a6433e4da888ee42c64efcf",
      "aoi_id": "sperchios",
      "sensor": "sentinel2",
      "target_date": "2026-11-09",
      "status": "succeeded",
      "submitted_at": "2026-11-09T08:39:51Z",
      "started_at": "2026-11-09T08:39:52Z",
      "completed_at": "2026-11-09T08:42:49Z",
      "result": {
        "status": "success",
        "run_dir": "/app/outputs/sperchios",
        "run_summary": "No new satellite data required collection; latest available observation is 2026-10-21.",
        "mode": "auto",
        "available_dates": [],
        "missing_dates": [],
        "collected_dates": [],
        "new_record_count": 0,
        "failed_units": [],
        "latest_available_observation": "2026-10-21",
        "history_json_path": "/path/.../global_history.json",
        "history_csv_path": "/path/.../global_history.csv",
        "tile_records_path": "/path/.../tile_records.json",
        "tiles_geojson_path": "/path/.../river_tiles.geojson",
        "state_path": "/path/.../state.json",
        "discovery_windows": [
          {
            "start_date": "2026-11-05",
            "end_date": "2026-11-09"
          }
        ],
        "warnings": []
      },
      "error": null
    }
  }
}
```

This example is abbreviated. The actual response preserves the complete submission and collection result structures.

---

#### 7. Understanding the Successful Response

The response contains two important objects.

##### satellite_submission

Represents the initial response returned by the external Collector when the job was accepted.

It includes:

- job_id
- run_job_id
- aoi_id
- sensor
- target_date
- submitted_at
- initial status

The initial status is commonly `queued`.

This object records the submission state and is not subsequently overwritten by the final result.

##### satellite_collection

Represents the latest or final job state retrieved during polling.

It includes:

- job_id
- run_job_id
- current status
- timestamps
- result
- error

For a successful job, `result` contains collection details.

Important result fields:

| Field | Description |
|---|---|
| `run_summary` | Human-readable summary of the collection |
| `mode` | Collection mode used |
| `available_dates` | Dates identified during discovery |
| `missing_dates` | Dates requiring collection |
| `collected_dates` | Dates collected during the run |
| `new_record_count` | Number of newly collected tile-date records |
| `failed_units` | Units that failed during processing |
| `latest_available_observation` | Latest available observation reported by the Collector |
| `discovery_windows` | Date windows searched |
| `warnings` | Nonfatal warnings |

The result may also contain paths to output files maintained inside the Collector service.

These paths refer to the Collector's filesystem, not the Data Ingestion Module's filesystem.

They should not be interpreted as public download URLs.

---

#### 8. Retrieve an Existing Satellite Job

The Data Ingestion Module provides a read-only endpoint for retrieving an existing job.

GET /api/ingestion/satellite/jobs/{job_id}

Example:

GET /api/ingestion/satellite/jobs/3c16420e507f448ea01a13f71267db3e

The module forwards this request to:

GET /api/collection/jobs/{job_id} on the external Satellite Collector service.

It authenticates using the configured API key and returns the validated upstream job response.

The status endpoint does not:

- Create a new job.
- Restart an existing job.
- Cancel an existing job.
- Modify collected satellite data.

For a completed job, the returned status is:

`succeeded`

The complete Collector result remains available in the response as long as the upstream service retains the job.

---

#### 9. Pending Collection Jobs

Satellite collection can require several minutes.

If the Data Ingestion Module reaches its polling deadline, it returns: `pending`

This does not mean the Collector failed. The remote job continues independently. A pending response retains the upstream job identifier and the latest known job state.

Clients should save: `collector_result.satellite_submission.job_id`

They can subsequently retrieve the job using: `GET /api/ingestion/satellite/jobs/{job_id}`

Do not submit the same collection request again merely because the ingestion response is pending.

---

#### 10. Error Handling

The satellite integration distinguishes job execution failures from HTTP-level communication and configuration errors.

##### Failed collection

If the Collector returns: `failed` the Data Ingestion Module maps the terminal result to: `status: failed`

The upstream error information is preserved.

##### Partial collection

If the Collector returns: `partial` the Data Ingestion Module returns: `status: partial`

The available upstream result and error information remain accessible.

##### Collector unavailable

Communication failures, invalid authentication, and malformed upstream responses are handled by the adapter's error mapping.

Transient polling failures receive bounded retries. Submission is not automatically retried.

##### Invalid requests

Unsupported or invalid satellite options produce HTTP 422.

Examples include:

- Invalid sensor.
- Unsupported mode.
- Invalid AOI ID.
- Invalid bounding box.
- Invalid collection dates.
- Nonpositive run limits.
- Cloud coverage outside 0–100.

---


## UC1 Sperchios — Hydro Modeling Integration

The Data Ingestion Module provides two independent Hydro Modeling profiles for the Sperchios river and Maliakos Gulf:

- `uc1-sperchios-river`
- `uc1-sperchios-sea`

Both profiles are available through:

POST /api/ingestion/run

The ingestion module communicates with the Hydro Modeling microservice, executes the required upstream operations, validates their responses, and returns the results in a common ingestion response envelope.

The two workflows operate independently. Running one does not automatically execute the other.

### Configuration

The following environment variables configure the integration:

| Variable | Description |
|---|---|
| `UC1_HYDRO_BASE_URL` | Hydro Modeling service base URL |
| `UC1_HYDRO_API_KEY` | Hydro Modeling API key |
| `UC1_SPERCHIOS_ANALYSIS_AREA_ID` | Static river analysis area ID |
| `UC1_SPERCHIOS_MARINE_ANALYSIS_AREA_ID` | Static marine analysis area ID |

Configured analysis IDs:

River: df1e179a-99d6-4eef-8a28-08a01fed8a99

Marine: 04d4d57b-ae59-4c32-8004-c0e201f48be5

### 1. Sperchios River Ingestion

Profile:

`uc1-sperchios-river`

#### Workflow

The river workflow executes three sequential operations:

1. Retrieve the configured static river analysis.
2. Execute ECMWF ERA5-Land reanalysis ingestion.
3. Execute the 15-day local forecast.

The local forecast depends on the preceding operations completing successfully.

#### Request

POST /api/ingestion/run

```json
{
  "run_job_id": "uc1-sperchios-river-example-001",
  "triggered_at": "2026-11-09T09:00:00Z",
  "provider": "sentinel-2",
  "profile": "uc1-sperchios-river",
  "aoi_id": "sperchios",
  "bbox": [
    22.433493,
    38.837552,
    22.569555,
    38.894223
  ]
}
```

#### Successful response

HTTP 200 OK

The following example summarizes the actual successful integration response observed on November 9, 2026.

```json
{
  "run_job_id": "uc1-sperchios-river-test-001",
  "provider": "sentinel-2",
  "profile": "uc1-sperchios-river",
  "aoi_id": "sperchios",
  "triggered_at": "2026-11-04T09:00:00Z",
  "started_at": "2026-11-09T09:02:08.592079Z",
  "completed_at": "2026-11-09T09:02:11.593973Z",
  "duration_ms": 3002,
  "status": "success",
  "collector_result": {
    "status": "success",
    "static_river_analysis": {
      "analysis_area_id": "df1e179a-99d6-4eef-8a28-08a01fed8a99",
      "river_id": "d0e1672e-b7da-47fc-9e2c-4223ead0e4f4",
      "river_name": "Σπερχειός",
      "status": "READY",
      "static_version": "v1",
      "hydraulic_model_version": "hydraulics_v1"
    },
    "ecmwf_reanalysis": {
      "status": "reanalysis_ready",
      "analysis_area_id": "df1e179a-99d6-4eef-8a28-08a01fed8a99",
      "dataset": "era5land",
      "action_date": "2026-11-09",
      "selected_records": 55,
      "reanalysis_dates": [],
      "inserted": 0,
      "existing": 0,
      "updated": 0,
      "skipped": 0
    },
    "ecmwf_local_forecast": {
      "status": "forecast_ready",
      "analysis_area_id": "df1e179a-99d6-4eef-8a28-08a01fed8a99",
      "dataset": "local_model_forecast",
      "forecast_base_date": "2026-11-03",
      "forecast_start_date": "2026-11-04",
      "forecast_end_date": "2026-11-18",
      "horizon_days": 15,
      "records_prepared": 825,
      "inserted": 275,
      "existing": 550,
      "updated": 550,
      "skipped": 0
    }
  }
}
```

This example is abbreviated for readability. The actual API preserves the complete upstream response bodies, including analysis geometry, forecast dates, metadata, and processing information.

#### Response interpretation

| Field | Description |
|---|---|
| `static_river_analysis` | Static hydraulic analysis metadata |
| `ecmwf_reanalysis` | ERA5-Land ingestion result |
| `ecmwf_local_forecast` | Local forecast ingestion result |
| `horizon_days` | Forecast horizon, fixed at 15 days |
| `records_prepared` | Forecast records prepared for persistence |
| `inserted` | Newly inserted records |
| `existing` | Records already present |
| `updated` | Existing records updated |

The number of inserted records depends on the state of Hydro Modeling's database and may vary between executions.

A successful ingestion does not necessarily imply that new records were inserted.

---

### 2. Sperchios Sea Ingestion

Profile:

`uc1-sperchios-sea`

#### Workflow

The sea workflow performs two sequential operations:

1. Retrieve and validate the configured marine analysis for the Sperchios river.
2. Execute ECMWF IFS forecast ingestion for the selected marine area.

The static marine analysis must exist uniquely and be associated with the configured Sperchios river analysis.

The forecast horizon is fixed at six days.

#### Request

POST /api/ingestion/run

```json
{
  "run_job_id": "uc1-sperchios-sea-example-001",
  "triggered_at": "2026-11-09T09:00:00Z",
  "provider": "sentinel-2",
  "profile": "uc1-sperchios-sea",
  "aoi_id": "sperchios",
  "bbox": [
    22.433493,
    38.837552,
    22.569555,
    38.894223
  ]
}
```

#### Successful response

HTTP 200 OK

The following example summarizes the successful production response observed on November 9, 2026.

```json
{
  "run_job_id": "uc1-sperchios-sea-test-001",
  "provider": "sentinel-2",
  "profile": "uc1-sperchios-sea",
  "aoi_id": "sperchios",
  "triggered_at": "2026-11-04T09:00:00Z",
  "started_at": "2026-11-09T08:52:37.516021Z",
  "completed_at": "2026-11-09T08:53:06.174777Z",
  "duration_ms": 28659,
  "status": "success",
  "collector_result": {
    "status": "success",
    "static_marine_analysis": {
      "count": 1,
      "analyses": [
        {
          "marine_analysis_area_id": "04d4d57b-ae59-4c32-8004-c0e201f48be5",
          "name": "Maliakos Gulf",
          "status": "READY",
          "river_analysis_area_id": "df1e179a-99d6-4eef-8a28-08a01fed8a99",
          "mesh_status": "READY",
          "mesh_resolution_m": 500.0,
          "mesh_triangle_count": 6232,
          "bathymetry_dataset": "EMODnet DTM"
        }
      ]
    },
    "ifs_ingestion": {
      "status": "COMPLETED",
      "marine_analysis_area_id": "04d4d57b-ae59-4c32-8004-c0e201f48be5",
      "dataset": "ifs_forecast",
      "processing_version": "v1",
      "forecast_run_time": "2026-11-09T00:00:00Z",
      "requested_date": "2026-11-09",
      "horizon_days": 6,
      "forecast_dates": [
        "2026-11-09",
        "2026-11-10",
        "2026-11-11",
        "2026-11-12",
        "2026-11-13",
        "2026-11-14",
        "2026-11-15"
      ],
      "records_prepared": 294,
      "inserted": 294,
      "existing": 0,
      "updated": 0,
      "source_files": [
        "ifs_10u.grib2",
        "ifs_10v.grib2"
      ]
    }
  }
}
```

This example is abbreviated. The real response includes the complete static marine analysis metadata and IFS ingestion results.

#### Response interpretation

| Field | Description |
|---|---|
| `static_marine_analysis.count` | Number of returned marine analyses |
| `static_marine_analysis.analyses` | Available marine analysis metadata |
| `ifs_ingestion` | IFS forecast ingestion result |
| `forecast_run_time` | ECMWF forecast initialization time |
| `requested_date` | Date requested for ingestion |
| `horizon_days` | Configured six-day forecast horizon |
| `forecast_dates` | Dates represented in the returned forecast |
| `source_files` | Source GRIB files reported by Hydro Modeling |
| `records_prepared` | Records prepared for persistence |
| `inserted` | Newly inserted records |

Although `horizon_days` is six, the returned forecast_dates list may contain seven dates because it includes the initialization date and subsequent forecast dates.

---

### 3. Status and Error Handling

The Data Ingestion Module preserves successful upstream results and identifies the failing workflow step.

Both Sperchios profiles have been successfully tested against the live Hydro Modeling service.

However, an upstream request may fail due to network availability, timeouts, configuration problems, or invalid upstream responses.

#### Successful execution

HTTP 200

```json
{
  "status": "success",
  "collector_result": {
    "status": "success"
  }
}
```

The actual response also includes the common ingestion metadata and the individual upstream response bodies.

#### Partial execution

If an earlier operation succeeds but a later step fails, the ingestion module may return:

HTTP 200

```json
{
  "status": "partial",
  "collector_result": {
    "status": "partial",
    "static_river_analysis": {
      "analysis_area_id": "df1e179a-99d6-4eef-8a28-08a01fed8a99",
      "status": "READY"
    },
    "error": {
      "step": "ecmwf_reanalysis",
      "category": "CollectorUnavailableError",
      "message": "Hydro Modeling request timed out."
    }
  }
}
```

This is an abbreviated example based on an observed timeout during live testing. The same river workflow subsequently completed successfully.

The error object contains:

| Field | Description |
|---|---|
| `step` | Workflow operation that failed |
| `category` | Error classification |
| `message` | Description of the failure |

Previously completed upstream responses remain available.

Subsequent dependent steps are not executed after a failure.

#### Other HTTP errors

| HTTP | Description |
|---|---|
| 400 | Invalid or missing configuration |
| 422 | Invalid ingestion request |
| 503 | Upstream dependency unavailable |
| 500 | Unexpected execution failure |

HTTP 200 does not automatically indicate successful ingestion. Always inspect the top-level `status` and `collector_result`.

---

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
  "profile": "uc1-water-pollutants-collector",
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

Satellite results contain `satellite_submission` and `satellite_collection`. Upstream `succeeded`, `partial`, and `failed` map to `success`, `partial`, and `failed`. A polling timeout or error returns `pending` with `reason` and the latest known job; the remote job is not cancelled or resubmitted. The embedded collector's previous inner result structure is no longer returned. River and sea results preserve their individual upstream responses.

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
    "package_version": "0.5.2",
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

UC3 configuration errors raised by the package are mapped to `400`; provider or storage failures represented as a valid UC3 result may instead produce HTTP `200` with `status: "failed"`. Unhandled failures outside the adapter's mapped exceptions use FastAPI's normal server-error handling.

Messages are sanitized for adapter execution failures. Validation messages may contain the invalid field/value supplied by the caller; never put credentials in request fields.

---

## Execution and deployment notes

- Calls are synchronous and can take as long as catalogue discovery, raster processing, and publication. Set client and reverse-proxy timeouts accordingly.
- The AOI concurrency guard is process-local; it does not coordinate multiple API replicas.
- Readiness reports connectivity/configuration checks and does not guarantee CDSE authentication, a matching scene, or successful writes.
- UC3 API responses include storage object keys and artifact metadata, not raster bytes or a download endpoint.
- The UC3 package must be installed in the runtime image and its server-side `UC3_INGEST_*` settings must be configured.

See [UC3 Integration Documentation](uc3-integration.md) for package installation, environment setup, and manual execution guidance.
