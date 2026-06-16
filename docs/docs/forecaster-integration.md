# Forecaster Integration Guide

This guide is for the Forecaster team to test the Data Ingestion Module as the replacement for selected direct CDSE/Sentinel Hub calls.

The Data Ingestion Module must be running and reachable from the Forecaster code before the examples below are called.

## Start The Ingestion Service

Use either Docker Compose or local Node startup.

### Docker Compose

From the Data Ingestion Module repository:

```bash
cp .env.example .env
```

Fill in the CDSE/Sentinel Hub credentials in `.env`, then start the service:

```bash
docker compose up --build
```

Verify the container is running:

```bash
docker compose ps
```

Check the API health endpoint:

```bash
curl http://localhost:3000/api/health
```

If `PORT` is changed in `.env`, use that port in the health check and in `INGESTION_SERVICE_URL`.

### Local Node Startup

From the Data Ingestion Module repository:

```bash
cp .env.example .env
```

Fill in the CDSE/Sentinel Hub credentials in `.env`, then install dependencies and start the service:

```bash
npm install
npm start
```

Check the API health endpoint:

```bash
curl http://localhost:3000/api/health
```

## Forecaster Service URL

After either startup method, configure Forecaster with the ingestion service base URL:

```text
INGESTION_SERVICE_URL=http://localhost:3000
```

The request endpoint used by Forecaster is:

```text
${INGESTION_SERVICE_URL}/api/ingestion/run
```

The ingestion service is stateless. It returns the provider result directly. Forecaster remains responsible for pipeline orchestration, local file paths, model logic, plots, and downstream processing.

## Supported Calls

Only these Forecaster behaviors are covered by this integration guide:

| Forecaster behavior | Ingestion mode | Response profile |
| --- | --- | --- |
| Sentinel-2 water quality statistics | `sentinel-hub-statistics` | `water-quality-statistics` |
| Sentinel-3 surface temperature statistics | `sentinel-hub-statistics` | `sentinel-3-surface-temperature` |
| Sentinel-2 water tile screening | `sentinel-hub-statistics` | `water-tile-screening` |
| Target-date image products | `sentinel-hub-process` | `target-date-image` |

## Common Client Setup

Use this once in the Forecaster-side code that calls the ingestion service:

```python
import base64
import os
from pathlib import Path

import requests


INGESTION_SERVICE_URL = os.getenv("INGESTION_SERVICE_URL", "http://localhost:3000")
INGESTION_RUN_URL = f"{INGESTION_SERVICE_URL.rstrip('/')}/api/ingestion/run"
```

Each example below is written as a direct call, not as a reusable function. Replace the example variable values with the values already available in the Forecaster pipeline.

## Sentinel-2 Water Quality Statistics

Use this instead of constructing `StatisticalCollection` and calling the Forecaster Sentinel-2 statistics request directly.

```python
bbox_wgs84 = [22.1, 39.4, 22.8, 40.1]
start_date = "2025-01-01"
end_date = "2025-01-31"
max_cloud_coverage = 30

response = requests.post(
    INGESTION_RUN_URL,
    json={
        "source": "copernicus",
        "mode": "sentinel-hub-statistics",
        "responseProfile": "water-quality-statistics",
        "requestParams": {
            "bbox": bbox_wgs84,
            "dateFrom": start_date,
            "dateTo": end_date,
            "maxCloudCoverage": max_cloud_coverage,
            "product": "Se2WaQ",
        },
    },
    timeout=180,
)
response.raise_for_status()

body = response.json()
if not body.get("success"):
    raise RuntimeError(body.get("message", "Ingestion service returned success=false"))

water_quality_records = body["data"]
```

Use `"product": "Se2WaQ2"` if the Forecaster caller needs the second Forecaster water-quality statistics evalscript variant.

Returned `water_quality_records` shape:

```json
[
  {
    "date": "2025-01-01",
    "metrics": {
      "Chl_a": 1.2,
      "Cya": 3.4,
      "Turb": 5.6,
      "CDOM": 7.8,
      "DOC": 9.0,
      "Color": 2.1,
      "WQI": 0.4
    }
  }
]
```

## Sentinel-3 Surface Temperature

Use this instead of constructing `Sentinel3Collection` and calling the Forecaster Sentinel-3 statistics request directly.

```python
bbox_wgs84 = [22.1, 39.4, 22.8, 40.1]
start_date = "2025-01-01"
end_date = "2025-01-31"

response = requests.post(
    INGESTION_RUN_URL,
    json={
        "source": "copernicus",
        "mode": "sentinel-hub-statistics",
        "responseProfile": "sentinel-3-surface-temperature",
        "requestParams": {
            "bbox": bbox_wgs84,
            "dateFrom": start_date,
            "dateTo": end_date,
        },
    },
    timeout=180,
)
response.raise_for_status()

body = response.json()
if not body.get("success"):
    raise RuntimeError(body.get("message", "Ingestion service returned success=false"))

surface_temperature_records = body["data"]
```

Returned `surface_temperature_records` shape:

```json
[
  {
    "date": "2025-01-01",
    "metrics": {
      "surface_temperature": 12.3
    }
  }
]
```

## Water Tile Screening

Use this instead of calling `WaterTileSelector._query_tile(...)` against Sentinel Hub Statistics directly.

```python
tiles = [
    {
        "name": "tile_0",
        "bbox": [22.1, 39.4, 22.2, 39.5],
    }
]
start_date = "2025-01-01"
end_date = "2026-01-01"
max_cloud_coverage = 30

response = requests.post(
    INGESTION_RUN_URL,
    json={
        "source": "copernicus",
        "mode": "sentinel-hub-statistics",
        "responseProfile": "water-tile-screening",
        "requestParams": {
            "tiles": tiles,
            "dateFrom": start_date,
            "dateTo": end_date,
            "maxCloudCoverage": max_cloud_coverage,
        },
    },
    timeout=240,
)
response.raise_for_status()

body = response.json()
if not body.get("success"):
    raise RuntimeError(body.get("message", "Ingestion service returned success=false"))

screening_records = body["data"]
```

Returned `screening_records` shape:

```json
[
  {
    "tileName": "tile_0",
    "bbox": [22.1, 39.4, 22.2, 39.5],
    "selected": true,
    "score": 0.161743,
    "scenes": [
      {
        "date": "2025-01-15",
        "validPixels": 12345,
        "sampleCount": 160000,
        "noDataCount": 0,
        "waterPct": 0.21,
        "cloudPct": 4.5
      }
    ]
  }
]
```

## Target-Date Image Products

Use this instead of constructing `ImageCollection` and calling `run(image_keys)`.

The ingestion service returns base64 image bytes. If Forecaster still needs local image files, decode `dataBase64` and write the bytes to the desired Forecaster output directory.

```python
bbox_wgs84 = [22.1, 39.4, 22.2, 39.5]
target_date = "2026-05-27"
tile_name = "tile_0"
tile_size = 400
image_keys = ["true_color", "chla", "surface_temperature"]
output_dir = Path("output/images")

response = requests.post(
    INGESTION_RUN_URL,
    json={
        "source": "copernicus",
        "mode": "sentinel-hub-process",
        "responseProfile": "target-date-image",
        "requestParams": {
            "bbox": bbox_wgs84,
            "date": target_date,
            "tileName": tile_name,
            "tileSize": tile_size,
            "imageKeys": image_keys,
            "format": "image/png",
        },
    },
    timeout=240,
)
response.raise_for_status()

body = response.json()
if not body.get("success"):
    raise RuntimeError(body.get("message", "Ingestion service returned success=false"))

image_records = body["data"]

output_dir.mkdir(parents=True, exist_ok=True)
for record in image_records:
    data_base64 = record.get("dataBase64")
    if not data_base64:
        continue

    image_path = output_dir / f"{tile_name}_{record['imageKey']}.png"
    image_path.write_bytes(base64.b64decode(data_base64))
```

Supported `imageKeys`:

```text
true_color
chla
cdom
turb
doc
cya
surface_temperature
```

Returned `image_records` shape:

```json
[
  {
    "imageKey": "chla",
    "status": "ok",
    "contentType": "image/png",
    "dataBase64": "...",
    "sizeBytes": 12345,
    "requestedDate": "2026-05-27",
    "actualDate": "2026-05-27",
    "collection": "sentinel-2-l2a"
  }
]
```

## Error Handling

Successful responses use this envelope:

```json
{
  "success": true,
  "source": "copernicus",
  "mode": "sentinel-hub-statistics",
  "collection": null,
  "responseProfile": "water-quality-statistics",
  "data": [],
  "metadata": {}
}
```

Handled failures use this envelope:

```json
{
  "success": false,
  "message": "error message",
  "code": "ERROR_CODE",
  "error": {
    "code": "ERROR_CODE",
    "message": "error message",
    "provider": "sentinel-hub",
    "retryable": true
  }
}
```

Forecaster should treat HTTP `429`, retryable provider errors, and transient network failures as retry candidates. Validation errors and unsupported profile errors should be treated as caller bugs.

## Parity Test Setup

The parity tests compare original Forecaster calls with Data Ingestion Module calls.

Prerequisites:

1. Clone the Forecaster repository locally.
2. Use Python `3.10+`; Python `3.9` is not compatible with Forecaster `match` syntax.
3. Start the Data Ingestion Module.
4. Configure CDSE credentials in the Data Ingestion Module `.env`.
5. Set `FORECASTER_REPO_PATH` if the Forecaster repository is not at `C:\tmp\uc1.forecaster.uth.alpha`.

Example PowerShell setup:

```powershell
$env:FORECASTER_REPO_PATH="C:\tmp\uc1.forecaster.uth.alpha"
$env:INGESTION_SERVICE_URL="http://localhost:3000"
```

Run the parity scripts from the Data Ingestion Module repository:

```bash
python tests_external/compare_water_quality_statistics.py
python tests_external/compare_sentinel3_surface_temperature.py
python tests_external/compare_water_tile_screening.py
python tests_external/compare_target_date_images.py
```

## What To Verify

For statistics and tile screening:

- `same_full_output` should be `true` after rounding in the parity script.
- Record counts should match.
- Dates should match.
- Metric names should match.

For target-date images:

- Image keys should match.
- Status values should match.
- Content type should match.
- Output hashes should match when Sentinel Hub returns identical imagery for both requests.

Small differences can still happen if the two requests are run at different times and Sentinel Hub returns different scenes, if credentials have different access limits, or if one request is retried after rate limiting.

## Original Forecaster Call Locations

The parity tests call these original Forecaster locations:

| Capability | Original Forecaster location |
| --- | --- |
| Sentinel-2 statistics | `forecaster/data/collectors/sentinel2.py`, `StatisticalCollection` |
| Sentinel-3 statistics | `forecaster/data/collectors/sentinel3.py`, `Sentinel3Collection` |
| Water tile screening | `forecaster/water_tile_selector.py`, `WaterTileSelector` |
| Target-date images | `forecaster/data/collectors/sentinel2.py`, `ImageCollection` |

The Data Ingestion Module equivalents are:

| Capability | Data Ingestion Module location |
| --- | --- |
| Sentinel Hub statistics | `src/services/copernicus/sentinel-hub-statistics.adapter.js` |
| Sentinel Hub process images | `src/services/copernicus/sentinel-hub-process.adapter.js` |
| Water tile screening | `src/services/copernicus/water-tile-screening.service.js` |
| Image product evalscripts | `src/services/copernicus/earth-observation-product-registry.js` |
| Response wrappers | `src/wrappers/` |
