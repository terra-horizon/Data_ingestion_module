# API Reference

This API reference describes the **alpha stateless API**. It does not expose job, storage, database, or workflow-management endpoints yet.

Base URL for local development:

```text
http://localhost:3000
```

## GET /api/health

Returns basic service status.

```bash
curl http://localhost:3000/api/health
```

Response:

```json
{
  "success": true,
  "service": "data-ingestion-service",
  "status": "ok",
  "mode": "stateless"
}
```

## GET /api/sources

Lists registered source adapters.

```bash
curl http://localhost:3000/api/sources
```

Response:

```json
{
  "success": true,
  "sources": [
    {
      "name": "copernicus",
      "adapter": "CopernicusAdapter"
    }
  ]
}
```

## GET /api/sources/:source/health

Calls the selected source adapter health check.

```bash
curl http://localhost:3000/api/sources/copernicus/health
```

The exact health payload depends on the adapter.

## POST /api/ingestion/run

Executes one stateless ingestion call.

In the alpha version, this endpoint returns transformed data directly. It does not return MongoDB entry IDs, MinIO paths, job IDs, or persistent storage locations.

The response shape is:

```json
{
  "success": true,
  "source": "copernicus",
  "mode": "sentinel-hub-catalog",
  "collection": "sentinel-2-l2a",
  "responseProfile": "scene-search-compatibility",
  "data": [],
  "metadata": {}
}
```

### Standard STAC Catalogue

Use `responseProfile: "standard"` for the platform catalogue object.

```bash
curl -X POST http://localhost:3000/api/ingestion/run \
  -H "Content-Type: application/json" \
  -d '{
    "source": "copernicus",
    "mode": "stac",
    "collection": "sentinel-2-l2a",
    "datasetType": "catalogue",
    "format": "json",
    "responseProfile": "standard",
    "requestParams": {
      "bbox": [22.1, 39.4, 22.8, 40.1],
      "dateFrom": "2025-01-01",
      "dateTo": "2025-01-31",
      "limit": 5,
      "cloudCoverageMax": 20
    },
    "download": false
  }'
```

### Scene Search Compatibility

Use this profile to replace the existing Python `_search_scenes_cdse(...)` function.

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

The `data` field is a list matching the old function contract:

```json
[
  {
    "scene_id": "S2C_MSIL2A_...",
    "datetime": "2025-01-27T09:29:53.031Z",
    "cloud_pct": 11.75,
    "collection": "sentinel-2-l2a",
    "bbox": [22.1, 39.4, 22.8, 40.1],
    "properties": {
      "platform": "sentinel-2c",
      "constellation": "sentinel-2"
    }
  }
]
```

### Scene Download Compatibility

Use this profile to replace the existing Python `_download_scene_cdse(...)` call.

The Node service remains stateless. It calls CDSE Process API and returns TIFF bytes as base64. The caller writes the file to its own target path.

```bash
curl -X POST http://localhost:3000/api/ingestion/run \
  -H "Content-Type: application/json" \
  -d '{
    "source": "copernicus",
    "mode": "sentinel-hub-process",
    "collection": "sentinel-2-l2a",
    "datasetType": "image",
    "format": "tiff",
    "responseProfile": "scene-download-compatibility",
    "requestParams": {
      "bbox": [22.1, 39.4, 22.8, 40.1],
      "scene": {
        "scene_id": "S2C_MSIL2A_...",
        "datetime": "2025-01-27T09:29:53.031Z"
      }
    },
    "download": true
  }'
```

Response `data` contains:

```json
{
  "scene_id": "S2C_MSIL2A_...",
  "datetime": "2025-01-27T09:29:53.031Z",
  "contentType": "image/tiff",
  "format": "tiff",
  "dataBase64": "...",
  "sizeBytes": 123456,
  "width": 512,
  "height": 512,
  "bbox": [22.1, 39.4, 22.8, 40.1]
}
```

### Sentinel-2 Water Quality Statistics

Use `mode: "sentinel-hub-statistics"` and `responseProfile: "water-quality-statistics"` to retrieve Sentinel-2 statistics and convert band statistics into TERRA water-quality metrics.

```json
{
  "source": "copernicus",
  "mode": "sentinel-hub-statistics",
  "responseProfile": "water-quality-statistics",
  "requestParams": {
    "bbox": [22.1, 39.4, 22.8, 40.1],
    "dateFrom": "2025-01-01",
    "dateTo": "2025-01-31",
    "maxCloudCoverage": 30,
    "product": "Se2WaQ"
  }
}
```

The response `data` array contains records like:

```json
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
```

### Sentinel-3 Surface Temperature

Use `responseProfile: "sentinel-3-surface-temperature"` to retrieve Sentinel-3 SLSTR statistics and convert Kelvin to Celsius.

```json
{
  "source": "copernicus",
  "mode": "sentinel-hub-statistics",
  "responseProfile": "sentinel-3-surface-temperature",
  "requestParams": {
    "bbox": [22.1, 39.4, 22.8, 40.1],
    "dateFrom": "2025-01-01",
    "dateTo": "2025-01-31"
  }
}
```

### Water Tile Screening

Use `responseProfile: "water-tile-screening"` to score one or more tiles using the Sentinel-2 SWBM statistics workflow.

```json
{
  "source": "copernicus",
  "mode": "sentinel-hub-statistics",
  "responseProfile": "water-tile-screening",
  "requestParams": {
    "tiles": [
      {
        "name": "tile_0",
        "bbox": [22.1, 39.4, 22.2, 39.5]
      }
    ],
    "dateFrom": "2025-01-01",
    "dateTo": "2026-01-01",
    "maxCloudCoverage": 30
  }
}
```

### Target-Date Image Products

Use `mode: "sentinel-hub-process"` and `responseProfile: "target-date-image"` to request image products without writing files locally. The service returns base64 image bytes and metadata.

```json
{
  "source": "copernicus",
  "mode": "sentinel-hub-process",
  "responseProfile": "target-date-image",
  "requestParams": {
    "bbox": [22.1, 39.4, 22.2, 39.5],
    "date": "2026-05-27",
    "tileName": "tile_0",
    "tileSize": 400,
    "imageKeys": ["true_color", "chla", "surface_temperature"],
    "format": "image/png"
  }
}
```

## Error Response

All handled errors use:

```json
{
  "success": false,
  "message": "error",
  "code": "ERROR_CODE",
  "error": {
    "code": "ERROR_CODE",
    "message": "error",
    "provider": "sentinel-hub",
    "retryable": true
  }
}
```

Common error codes:

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Request payload failed validation. |
| `INVALID_REQUEST` | The requested provider operation is not valid. |
| `UNKNOWN_SOURCE` | No adapter is registered for the requested source. |
| `UNSUPPORTED_MODE` | The adapter does not support the requested mode. |
| `DOWNLOAD_NOT_SUPPORTED` | Download was requested for a mode that does not support it. |
| `COPERNICUS_AUTH_MISSING` | CDSE credentials or token are missing. |
| `COPERNICUS_AUTH_ERROR` | Token acquisition failed. |
| `EXTERNAL_API_ERROR` | External provider returned an error response. |
| `EXTERNAL_API_TIMEOUT` | External request timed out. |
| `EXTERNAL_PROVIDER_TIMEOUT` | External provider request timed out. |
| `EXTERNAL_PROVIDER_ERROR` | External provider returned an unrecoverable error. |
| `EMPTY_PROVIDER_RESPONSE` | External provider returned no usable payload. |
| `INVALID_PROVIDER_RESPONSE` | External provider response did not match the expected schema. |
| `UNSUPPORTED_PROFILE` | The requested mode/profile combination is not supported. |
| `UNSUPPORTED_PRODUCT` | Requested image product key is not registered. |
| `UNSUPPORTED_WRAPPER` | No wrapper supports the requested response profile. |
| `ROUTE_NOT_FOUND` | No matching route exists. |
