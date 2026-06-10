# Pipeline Test Scenarios

These scenarios verify the **alpha service** as a stateless replacement for direct external calls.

They do not validate MongoDB persistence, MinIO storage, orchestrator callbacks, or IoT ingestion because those features are outside the current alpha implementation.

## Prerequisites

Install Node dependencies:

```bash
npm install
```

Configure `.env` with either:

```env
COPERNICUS_ACCESS_TOKEN=...
```

or:

```env
COPERNICUS_CLIENT_ID=...
COPERNICUS_CLIENT_SECRET=...
```

Start the service:

```bash
npm run dev
```

## Scenario 1: Health Check

```bash
curl http://localhost:3000/api/health
```

Expected:

```json
{
  "success": true,
  "service": "data-ingestion-service",
  "status": "ok",
  "mode": "stateless"
}
```

## Scenario 2: Registered Sources

```bash
curl http://localhost:3000/api/sources
```

Expected source list includes `copernicus`.

## Scenario 3: Direct Vs Ingestion Scene Search

Run:

```bash
python tests_external/compare_scene_search.py
```

The script:

- calls CDSE directly
- calls the ingestion service
- prints both outputs
- compares scene IDs
- compares ordering
- compares full output equality

Expected comparison:

```json
{
  "only_direct": [],
  "only_ingestion": [],
  "same_order": true,
  "same_full_output": true
}
```

## Scenario 4: Direct Vs Ingestion Scene Download

Run:

```bash
python tests_external/compare_scene_download.py
```

The script:

- searches for a scene
- downloads the TIFF directly from CDSE
- downloads the TIFF through the ingestion service
- writes both files under `tests_external/output`
- compares byte size and SHA-256

Expected:

- matching file size
- matching SHA-256

The Node service does not store either file.

## Scenario 5: Validation Failure

Send an invalid bounding box:

```bash
curl -X POST http://localhost:3000/api/ingestion/run \
  -H "Content-Type: application/json" \
  -d '{
    "source": "copernicus",
    "requestParams": {
      "bbox": [22.1, 39.4]
    }
  }'
```

Expected:

```json
{
  "success": false,
  "message": "bbox must contain exactly four numbers",
  "code": "VALIDATION_ERROR"
}
```

## Scenario 6: Missing Credentials

Run a Sentinel Hub Catalog request without `COPERNICUS_ACCESS_TOKEN` or client credentials.

Expected error code:

```text
COPERNICUS_AUTH_MISSING
```

## Scenario 7: Timeout Behavior

Set a very low timeout:

```env
REQUEST_TIMEOUT_MS=1
```

Then run a provider request.

Expected error code:

```text
EXTERNAL_API_TIMEOUT
```
