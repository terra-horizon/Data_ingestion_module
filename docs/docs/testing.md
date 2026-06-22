# Testing

## Overview

The Data Ingestion Module is tested as the access layer between TERRA modules and external Earth Observation providers. The tests cover request intake, normalization, validation, authentication, adapter routing, provider request construction, response wrapping, and compatibility with consuming module workflows.

## Automated Test Suite

Run the automated test suite with:

```bash
npm test
```

The test suite uses the Node.js built-in test runner through `node --test`.

Current safe local result:

```text
1..47
# tests 47
# pass 47
# fail 0
# skipped 0
```

The automated tests use mocked provider responses where appropriate, so they do not require live CDSE/Sentinel Hub access during every run.

## Test Coverage Areas

| Area | Existing evidence |
| --- | --- |
| API-level ingestion tests | `test/ingestion-api.test.js` |
| CDSE authentication tests | `test/cdse-auth.service.test.js` |
| Copernicus validation tests | `test/copernicus-validation.test.js` |
| Copernicus routing/execution tests | `test/copernicus-fetch-data.test.js` |
| Sentinel Hub Statistics adapter tests | `test/sentinel-hub-statistics.test.js` |
| Sentinel Hub Process adapter tests | `test/sentinel-hub-process.test.js` |
| Water tile screening tests | `test/water-tile-screening.test.js` |

## Request Validation Examples

Valid sanitized Copernicus statistics request:

```json
{
  "source": "copernicus",
  "mode": "sentinel-hub-statistics",
  "responseProfile": "water-quality-statistics",
  "requestParams": {
    "bbox": [22.1, 39.4, 22.8, 40.1],
    "dateFrom": "2025-01-01",
    "dateTo": "2025-01-31",
    "maxCloudCoverage": 30
  }
}
```

Invalid request example:

```json
{
  "source": "copernicus",
  "requestParams": {
    "bbox": [22.1, 39.4]
  }
}
```

Expected validation response:

```json
{
  "success": false,
  "message": "bbox must contain exactly four numbers",
  "code": "VALIDATION_ERROR"
}
```

| Case | Expected result |
| --- | --- |
| Unknown Copernicus mode | `UNSUPPORTED_MODE` |
| Unsupported mode/profile pair | `UNSUPPORTED_PROFILE` |
| Download requested for STAC/statistics | `DOWNLOAD_NOT_SUPPORTED` |
| Missing scene for scene download | `VALIDATION_ERROR` |
| Missing or empty image keys | `VALIDATION_ERROR` |
| Missing or empty tiles | `VALIDATION_ERROR` |
| Invalid bbox/date fields | `VALIDATION_ERROR` |

## Provider Adapter Evidence

| Adapter | Responsibility | Evidence |
| --- | --- | --- |
| Copernicus adapter | Validates mode/profile, routes requests, builds STAC/Catalog/Process requests | `test/copernicus-fetch-data.test.js`, `test/copernicus-validation.test.js` |
| Sentinel Hub Statistics adapter | Builds Sentinel-2 and Sentinel-3 Statistics API payloads | `test/sentinel-hub-statistics.test.js` |
| Sentinel Hub Process adapter | Builds image Process API payloads and handles image responses | `test/sentinel-hub-process.test.js` |
| Water tile screening logic | Builds per-tile SWBM statistics requests | `test/water-tile-screening.test.js` |

Sanitized normalized-to-provider payload example:

```json
{
  "normalized": {
    "mode": "sentinel-hub-statistics",
    "responseProfile": "water-quality-statistics",
    "query": {
      "bbox": [22.1, 39.4, 22.8, 40.1],
      "dateFrom": "2025-01-01",
      "dateTo": "2025-01-31"
    }
  },
  "providerPayload": {
    "input": {
      "bounds": {
        "bbox": [22.1, 39.4, 22.8, 40.1]
      },
      "data": [
        {
          "type": "sentinel-2-l2a"
        }
      ]
    },
    "aggregation": {
      "aggregationInterval": {
        "of": "P1D"
      }
    }
  }
}
```

This example intentionally omits authorization headers, tokens, and full provider payload details.

## Wrapper Transformation Evidence

| Wrapper/Profile | What is checked |
| --- | --- |
| `water-quality-statistics` | Parses Sentinel-2 bands into water-quality metrics |
| `sentinel-3-surface-temperature` | Converts provider Kelvin mean values to Celsius |
| `water-tile-screening` | Parses valid pixels, water percentage, cloud percentage, and tile selection |
| `target-date-image` | Returns image metadata and base64 data from mocked image bytes |
| `scene-search-compatibility` | Covered by external comparison scripts and README examples |
| `scene-download-compatibility` | Covered by external download comparison script |

Sanitized Sentinel-3 before/after transformation example:

```json
{
  "providerInput": {
    "data": [
      {
        "interval": {
          "from": "2025-01-01T00:00:00Z"
        },
        "outputs": {
          "data": {
            "bands": {
              "B0": {
                "stats": {
                  "mean": 291.57
                }
              }
            }
          }
        }
      }
    ]
  },
  "wrappedOutput": {
    "date": "2025-01-01",
    "metrics": {
      "s3_surface_temperature": 18.42
    }
  }
}
```

## External Workflow and Live Validation

Live validation scripts compare direct provider calls with equivalent requests routed through the Data Ingestion Module.

| Script | Purpose |
| --- | --- |
| `compare_scene_search.py` | Compares direct CDSE scene IDs/order with ingestion-service scene IDs/order |
| `compare_scene_download.py` | Compares direct TIFF download with ingestion-service TIFF download by size/SHA-256 |
| `compare_water_quality_statistics.py` | Compares original forecaster water-quality records with ingestion records |
| `compare_sentinel3_surface_temperature.py` | Compares Sentinel-3 surface temperature outputs |
| `compare_water_tile_screening.py` | Compares water tile screening outputs |
| `compare_target_date_images.py` | Compares target-date image summaries |

Run the service and live validation scripts locally:

```bash
npm run dev
python tests_external/compare_scene_search.py
python tests_external/compare_scene_download.py
python tests_external/compare_water_quality_statistics.py
python tests_external/compare_sentinel3_surface_temperature.py
python tests_external/compare_water_tile_screening.py
python tests_external/compare_target_date_images.py
```

Required local configuration placeholders:

```text
INGESTION_SERVICE_URL=http://localhost:3000
COPERNICUS_ACCESS_TOKEN=
CDSE_CLIENT_ID=
CDSE_CLIENT_SECRET=
FORECASTER_REPO_PATH=C:\path\to\uc1.forecaster.uth.alpha
```

Do not commit `.env`, access tokens, client IDs, client secrets, raw provider responses, image base64 payloads, TIFF/image outputs, or files under `tests_external/output/`.

Sanitized comparison output:

```json
{
  "only_direct": [],
  "only_ingestion": [],
  "same_order": true,
  "same_full_output": true
}
```

Sanitized download comparison shape:

```json
{
  "sameSize": true,
  "sameSha256": true
}
```

## What Should Not Be Published

- `.env`
- access tokens
- client IDs
- client secrets
- authorization headers
- full OAuth token responses
- full live CDSE/Sentinel Hub responses
- full base64 image data
- TIFF/image outputs
- files under `tests_external/output/`
- private local repository paths
- private URLs
- local usernames
