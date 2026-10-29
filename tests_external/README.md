# Manual ingestion requests

This guide explains how to send UC1 and UC3 requests using the examples in this directory. The ingestion endpoint runs synchronously and may call CDSE and write to the configured MongoDB and MinIO. A local URL can still point to production storage if the local service is configured that way; check its settings before sending an ingestion request.

## 1. Choose the service and HTTP client

| Service | Base URL | When to use it |
| --- | --- | --- |
| Local Compose | `http://127.0.0.1:18000` | The port mapped by the repository's Compose file. |
| Local Python | `http://127.0.0.1:8000` | The default Uvicorn port, unless started with another port. |
| Production | `https://server.iprism.eu/data-ingestion` | The live service behind its reverse-proxy prefix. |

For local testing, start the application with the required package, configuration and reachable storage already in place. See the [deployment guide](../docs/docs/deployment.md) and [UC3 integration guide](../docs/docs/uc3-integration.md). Use separate test storage when testing locally.

Use any HTTP client, such as curl, Postman, or an editor extension. Select the base URL for the target environment, append the endpoint path, and provide the HTTP method, headers, and JSON body shown below. For example, this curl command checks local liveness:

```bash
curl -i http://127.0.0.1:18000/health/live
```

The `.http` files in this directory provide ready-made examples for compatible clients. Their `@baseUrl` and `@productionUrl` variables select the target service; the UC1 production example uses the production URL directly. Adjust the local port to match the running service.

Alternatively, open `/docs` at the chosen base URL, select an endpoint, choose **Try it out**, enter the JSON body and execute it. For production the documentation URL is `https://server.iprism.eu/data-ingestion/docs`. Any proxy access requirements are managed by the server operator.

## 2. Check health before ingestion

In [healthChecks.http](healthChecks.http), send the requests for the selected environment:

1. `GET /health/live` checks that the API process responds.
2. `GET /health/ready` checks UC1 configuration and storage connectivity.
3. `GET /health/ready/coastal-uc3-sentinel2` checks the UC3 package, configuration and storage connectivity.

Readiness returns HTTP `200` with `status: "ready"` when its checks pass, or `503` with individual check states when they do not. These checks do not start ingestion or write data. Readiness does not prove CDSE authentication, scene availability or storage write permission.

## 3. Structure an ingestion request

Both use cases send `POST /api/ingestion/run` with `Content-Type: application/json` and `Accept: application/json`. Append that path to the selected base URL; for example, the production endpoint is `https://server.iprism.eu/data-ingestion/api/ingestion/run`.

| Common field | Value |
| --- | --- |
| `run_job_id` | Non-empty identifier for this run; choose a meaningful new identifier. |
| `triggered_at` | ISO 8601 timestamp with a timezone, for example `2026-10-29T10:00:00Z`. |
| `provider` | `sentinel-2`. |
| `profile` | `forecaster-collector` for UC1 or `coastal-uc3-sentinel2` for UC3. |
| `aoi_id` | Identifier of the area to process. |
| `bbox` | WGS84 coordinates `[min_lon, min_lat, max_lon, max_lat]`, in that order. |

The examples below contain illustrative dates and AOIs. Update the run ID, timestamps, date range and AOI for the intended test. Confirm the environment and production authorisation before sending a live POST. Credentials and storage settings belong in the service configuration, not the request body.

## 4. Run UC1

1. Open [ingestion.http](ingestion.http). For local testing use a request targeting `{{baseUrl}}`; for production use the section labelled **Live testing of data ingestion endpoint on the production server**.
2. Set `@baseUrl` if the local service uses port `8000` instead of `18000`. Review the target URL immediately above the request.
3. Set the common fields, `run_name`, dates and limits for the intended run. For a small initial test use `max_days_per_run: 1` and `max_tiles_per_run: 1`.
4. Send that request and wait for the response. UC1 may discover data, process observations and publish results to its configured stores.

Example body:

```json
{
  "run_job_id": "uc1-sperchios-example-001",
  "triggered_at": "2026-10-29T10:00:00Z",
  "provider": "sentinel-2",
  "profile": "forecaster-collector",
  "aoi_id": "sperchios",
  "bbox": [22.433493, 38.837552, 22.569555, 38.894223],
  "run_name": "sperchios",
  "history_start": "2026-10-01",
  "target_date": "2026-10-28",
  "mode": "auto",
  "max_days_per_run": 1,
  "max_tiles_per_run": 1
}
```

`run_name` is required for UC1. `history_start` defaults to `2016-01-01`, and `target_date` defaults to the current UTC date. `mode` defaults to `auto` and can also be `backfill` or `incremental`. The two limits are optional positive integers; omitting a limit can increase work. The examples in `ingestion.http` show additional combinations, including processing a queued date and omitting the tile limit.

## 5. Run UC3

1. Open [uc3.http](uc3.http). Choose the local acquisition request using `{{baseUrl}}` or the explicitly labelled **LIVE UC3 acquisition** request using `{{productionUrl}}`.
2. Set the local base URL if needed. Check that `aoi_id` and `bbox` match an AOI in the target service's authorised registry; an example AOI is not necessarily authorised in every environment.
3. Set a new run ID, trigger timestamp and acquisition window. Start with `max_scenes: 1` and confirm the window is appropriate for the test.
4. Send the chosen POST and wait for completion. UC3 can query CDSE, download raster data and publish scene metadata and artifacts to its configured storage.

Example body:

```json
{
  "run_job_id": "uc3-aoi02-example-001",
  "triggered_at": "2026-10-29T10:00:00Z",
  "provider": "sentinel-2",
  "profile": "coastal-uc3-sentinel2",
  "aoi_id": "aoi_02",
  "bbox": [-2.84437, 56.39264, -2.78475, 56.43782],
  "uc3": {
    "contract_version": 2,
    "mode": "latest",
    "time_from": "2026-09-29T00:00:00Z",
    "time_to": "2026-10-29T00:00:00Z",
    "selection_policy": "uc3_parity_pilot",
    "max_scenes": 1
  }
}
```

The nested `uc3` object requires `contract_version: 2`, `mode` (`latest` or `window`), and timezone-aware `time_from` and `time_to` values in increasing order. `selection_policy` is optional: `uc3_parity_pilot` is the default, and `uc3_monthly_backfill` is also supported. `max_scenes` is an optional integer from 1 to 24. Optional metadata fields include `project_id`, `request_id`, `registry_version`, and `window_id`; unknown nested fields are rejected. UC1's `run_name`, `history_start`, and `target_date` are not needed for UC3.

## 6. Interpret the response

The HTTP call stays open until the run completes, so allow enough time in the client and any proxy. There is no polling endpoint. An HTTP `200` alone does not guarantee that data was acquired.

- **UC1:** inspect `status` and `collector_result`; common statuses include `success`, `partial`, and `failed`. Paths in the result may refer to files on the worker rather than downloadable URLs.
- **UC3:** inspect `status`, `collector_result.outcome`, `reason`, `error`, `scene_packages`, and `scene_asset_ids`. `completed` indicates an acquisition completed, `no_data` means no suitable data was delivered, and `failed` contains failure details. All three can be returned with HTTP `200`.
- **HTTP errors:** `422` indicates an invalid request; `400` can indicate invalid configuration or an unauthorised UC3 AOI; `409` indicates an existing run for the guarded AOI; `503` indicates an unavailable dependency; and `500` indicates an execution error. Inspect the response details.

See the [API reference](../docs/docs/api-reference.md) for the complete request and response contracts.
