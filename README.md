# Data Ingestion Service

Alpha stateless HTTP Data Ingestion Module for TERRA services.

This is an alpha version of the wider TERRA Data Ingestion Module. It focuses on validating external-provider calls, Copernicus/CDSE integration, request normalization, and response wrappers. It intentionally does not yet implement MongoDB persistence, MinIO storage, IoT ingestion, full external repository coverage, DAG progression, or orchestrator callback reporting.

Other TERRA modules call this service instead of calling external providers directly. The module receives a request, calls the external provider, wraps or transforms the provider response, and returns the result to the caller.

It does not store jobs, datasets, files, database rows, ingestion history, or workflow state. In this alpha version, an external orchestrator is responsible for job tracking, retries, persistence, pipeline progression, DB updates, and storage.

## Architecture

```text
HTTP request
-> controller
-> ingestion.service.runIngestion(payload)
-> request normalizer
-> source adapter
-> wrapper
-> stateless HTTP response
```

The ingestion service does not depend on Express request/response objects. If a queue is reintroduced later, a worker can still call `runIngestion(payload)`.

## Structure

```text
src/
  app.js
  server.js
  config/env.js
  routes/
  controllers/
  services/ingestion.service.js
  handlers/request-normalizer.js
  sources/
  wrappers/
  middleware/
  utils/
```

## Install

```bash
npm install
```

## Environment

```env
PORT=3000
NODE_ENV=development

REQUEST_TIMEOUT_MS=30000
MAX_CATALOGUE_LIMIT=100

COPERNICUS_API_MODE=stac
COPERNICUS_STAC_BASE_URL=https://stac.dataspace.copernicus.eu/v1
COPERNICUS_SH_CATALOG_URL=https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search
COPERNICUS_SH_PROCESS_URL=https://sh.dataspace.copernicus.eu/api/v1/process
COPERNICUS_ODATA_BASE_URL=https://catalogue.dataspace.copernicus.eu/odata/v1
COPERNICUS_TOKEN_URL=https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token

COPERNICUS_USERNAME=
COPERNICUS_PASSWORD=
COPERNICUS_ACCESS_TOKEN=
COPERNICUS_CLIENT_ID=
COPERNICUS_CLIENT_SECRET=
```

For `sentinel-hub-catalog`, configure either `COPERNICUS_ACCESS_TOKEN` or `COPERNICUS_CLIENT_ID` plus `COPERNICUS_CLIENT_SECRET`.

## Run

```bash
npm run dev
```

## Docker

Build the image from the repository root:

```bash
docker build -t data-ingestion-module .
```

Run it with local environment variables:

```bash
docker run --rm --name data-ingestion-module --env-file .env -p 3000:3000 data-ingestion-module
```

Or use Docker Compose:

```bash
docker compose up --build
```

Stop Compose:

```bash
docker compose down
```

The container exposes `/api/health` and does not include a database, queue, or storage service.

## Endpoints

- `GET /api/health`
- `GET /api/sources`
- `GET /api/sources/:source/health`
- `POST /api/ingestion/run`

Health response:

```json
{
  "success": true,
  "service": "data-ingestion-service",
  "status": "ok",
  "mode": "stateless"
}
```

## Scene Search Compatibility

Use this profile when replacing the direct Python `_search_scenes_cdse(...)` call.

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

Response shape:

```json
{
  "success": true,
  "source": "copernicus",
  "mode": "sentinel-hub-catalog",
  "collection": "sentinel-2-l2a",
  "responseProfile": "scene-search-compatibility",
  "data": [
    {
      "scene_id": "S2C_MSIL2A_...",
      "datetime": "2025-01-27T09:29:53.031Z",
      "cloud_pct": 11.75,
      "collection": "sentinel-2-l2a",
      "bbox": [],
      "properties": {
        "platform": "sentinel-2c",
        "constellation": "sentinel-2"
      }
    }
  ],
  "metadata": {
    "type": "scene-search-results",
    "count": 1,
    "provider": "copernicus",
    "mode": "sentinel-hub-catalog",
    "collection": "sentinel-2-l2a",
    "queriedAt": "..."
  }
}
```

## Standard Catalogue Profile

Use `responseProfile: "standard"` for the internal T-compatible catalogue object.

## Copernicus Compatibility Profile

Use `responseProfile: "copernicus-compatibility"` for a simpler product list that is easier for teams migrating away from direct Copernicus calls.

## Direct Vs Ingestion Comparison

Start the Node service:

```bash
npm run dev
```

Then run:

```bash
python tests_external/compare_scene_search.py
```

The script:

- calls CDSE directly
- calls this ingestion service
- prints both outputs
- compares scene IDs
- checks order
- checks full output equality

Expected comparison:

```json
{
  "only_direct": [],
  "only_ingestion": [],
  "same_order": true,
  "same_full_output": true
}
```

## Direct Vs Ingestion Download Comparison

The download harness mirrors `_download_scene_cdse(...)`.

The Node service stays stateless: it calls CDSE Process API and returns the TIFF bytes as base64. The Python replacement writes those bytes to the requested local path, matching the original function contract.

Run the Node service:

```bash
npm run dev
```

Then run:

```bash
python tests_external/compare_scene_download.py
```

The script writes:

```text
tests_external/output/direct_scene.tif
tests_external/output/ingestion_scene.tif
```

and compares file size plus SHA-256. The output folder is ignored by Git.

## Add A Source

Add a source adapter under `src/sources`, then register it in `source.registry.js`.

## Add A Wrapper

Add a wrapper under `src/wrappers`, then register it in `wrapper.registry.js`.

Wrappers select output shape using `datasetType`, `format`, `source`, and `responseProfile`.
