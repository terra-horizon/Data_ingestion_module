# Data Ingestion Service

The Data Ingestion Service is currently an **alpha version** of the TERRA Data Ingestion Module.

This alpha focuses on validating external-provider access, Copernicus/CDSE calls, request normalization, and response wrapping. It is intentionally stateless while the wider TERRA orchestration, storage, and persistence responsibilities are still being finalized.

The service is a stateless HTTP module used by TERRA services to replace direct calls to external data providers.

Other modules send provider requests to this service. The service validates and normalizes the request, calls the external provider through a source adapter, transforms the provider response through a wrapper, and returns the result to the caller.

It does not own workflow state.

## Alpha Scope

This alpha implementation provides the connector and wrapper foundation of the full Data Ingestion Module. It does not yet implement the complete production architecture described for TERRA Big Data integration.

## What It Does

- Receives ingestion requests over HTTP.
- Calls external providers through isolated adapters.
- Wraps provider responses into standard or compatibility formats.
- Returns the transformed response immediately.
- Keeps Copernicus Data Space Ecosystem as the first supported provider.

## Current Provider Support

The current implementation registers one source adapter:

| Source | Supported modes | Purpose |
| --- | --- | --- |
| `copernicus` | `stac`, `sentinel-hub-catalog`, `sentinel-hub-process` | Catalogue search and stateless Sentinel Hub Process API pass-through |

The Sentinel Hub Process mode returns file bytes as base64 in the HTTP response. The caller decides where to store the file.

## Request Path

The request path is:

1. A calling TERRA module sends `POST /api/ingestion/run`.
2. The request normalizer validates and standardizes the payload.
3. The source registry selects the configured provider adapter.
4. The Copernicus adapter calls the external CDSE API.
5. The wrapper registry selects the requested response profile.
6. The response wrapper transforms the provider response.
7. The service returns a stateless HTTP response to the caller.

## Main Endpoint

Use `POST /api/ingestion/run` for all current ingestion calls.

```bash
curl -X POST http://localhost:3000/api/ingestion/run \
  -H "Content-Type: application/json" \
  -d '{
    "source": "copernicus",
    "mode": "sentinel-hub-catalog",
    "collection": "sentinel-2-l2a",
    "datasetType": "catalogue",
    "format": "json",
    "responseProfile": "scene-search-compatibility",
    "requestParams": {
      "bbox": [22.1, 39.4, 22.8, 40.1],
      "dateFrom": "2025-01-01",
      "dateTo": "2025-01-31",
      "maxImages": 5,
      "maxCloudPct": 20,
      "cloudCoverageMax": 20
    },
    "download": false
  }'
```

See the [API Reference](api-reference.md) for all endpoints and response profiles.
