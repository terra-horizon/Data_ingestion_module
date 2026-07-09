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

## Testing

Run the automated mock-based test suite:

```bash
npm test
```

The tests use mocked provider responses where appropriate and do not require live CDSE/Sentinel Hub access for every run.

For full testing documentation, see [`docs/docs/testing.md`](docs/docs/testing.md).

Live validation scripts under `tests_external/` require local credentials, a running ingestion service, and provider availability. Do not commit `.env`, access tokens, raw provider responses, image payloads, or files under `tests_external/output/`.

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
    "provider": "copernicus",
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
## Persisted Ingestion Results

When MongoDB and MinIO are available from the TERRA node stack, the existing endpoint can persist results directly:

- `POST /api/ingestion/run`

Successful `/run` responses are persisted by default. Callers cannot bypass persistence with a request flag.

The persisted flow reuses the existing provider workflow, uploads the wrapped result to S3/MinIO, stores metadata and object references in MongoDB, and returns the normal ingestion response with an additional `persistence` object. For image/download responses, `dataBase64` is removed from the returned payload and replaced with a `storage` reference to the MinIO object.

Docker network configuration for `terra-node-stack-master`:

```env
MONGO_URI=mongodb://terra_service_user:<password>@terra-mongodb:27017/terra_db?authSource=terra_db
MONGO_DB_NAME=terra_db
MONGO_METADATA_COLLECTION=ingestion_metadata
S3_ENDPOINT=http://terra-minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=terra_service_user
S3_SECRET_KEY=<password>
S3_BUCKET=terra-bucket
S3_FORCE_PATH_STYLE=true
```

If running the ingestion service directly on the host with `npm run dev`, use `localhost` instead of `terra-mongodb` and `terra-minio`.

Example persisted request:

```bash
curl -X POST http://localhost:3000/api/ingestion/run \
  -H "Content-Type: application/json" \
  -d '{
    "useCaseId": "1",
    "provider": "copernicus",
    "collection": "sentinel-2-l2a",
    "mode": "stac",
    "responseProfile": "standard",
    "persist": true,
    "requestParams": {
      "bbox": [22.8, 39.4, 23.1, 39.7],
      "dateFrom": "2024-01-01",
      "dateTo": "2024-01-31",
      "limit": 1
    }
  }'
```




## MinIO Object Verification

Do not inspect files under the MinIO data volume to validate uploaded images. MinIO stores objects internally, and an object key such as `image.png` may appear on disk as a directory containing `xl.meta`. The S3 API is the authoritative interface.

Use MinIO Client from the host or from a temporary container on `terra-network`:

```bash
mc alias set terra http://localhost:9000 <access-key> <secret-key>
mc find terra/terra-bucket
mc stat terra/terra-bucket/ingestions/<yyyy>/<mm>/<dd>/<ingestion-id>/assets/<asset>.png
mc cp terra/terra-bucket/ingestions/<yyyy>/<mm>/<dd>/<ingestion-id>/assets/<asset>.png ./downloaded-asset.png
```

PowerShell checksum validation:

```powershell
Get-FileHash .\downloaded-asset.png -Algorithm SHA256
```

Docker-network validation without installing `mc` locally:

```bash
docker run --rm --network terra-network --entrypoint=/bin/sh minio/mc:RELEASE.2025-08-13T08-35-41Z -c "mc alias set terra http://terra-minio:9000 <access-key> <secret-key> && mc stat terra/terra-bucket/ingestions/<yyyy>/<mm>/<dd>/<ingestion-id>/assets/<asset>.png"
```
