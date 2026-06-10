# Quality Assurance

QA for this alpha version focuses on HTTP availability, request normalization, Copernicus/CDSE connectivity, wrappers, and direct-vs-ingestion compatibility.

## What To Verify Before Handoff

Run the API locally:

```bash
npm run dev
```

Then verify:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/sources
```

For Copernicus compatibility work, run:

```bash
python tests_external/compare_scene_search.py
python tests_external/compare_scene_download.py
```

The scene search comparison should show no missing items and the same ordering.

## Troubleshooting

### `COPERNICUS_AUTH_MISSING`

The Sentinel Hub Catalog or Process mode needs credentials.

Set either:

```env
COPERNICUS_ACCESS_TOKEN=...
```

or:

```env
COPERNICUS_CLIENT_ID=...
COPERNICUS_CLIENT_SECRET=...
```

### `COPERNICUS_AUTH_ERROR`

The service tried to acquire a token but CDSE rejected the request.

Check:

- client ID
- client secret
- token URL
- account permissions

### `EXTERNAL_API_ERROR`

The external provider returned a non-success response.

The error message includes provider status and a short response detail. It should not include secrets.

### `EXTERNAL_API_TIMEOUT`

The provider request exceeded `REQUEST_TIMEOUT_MS`.

Increase the timeout for large Process API calls:

```env
REQUEST_TIMEOUT_MS=180000
```

### `ROUTE_NOT_FOUND` for `/api/ingestion/run`

The route only supports `POST`.

Use:

```bash
curl -X POST http://localhost:3000/api/ingestion/run
```

### Scene Search Results Differ

Check that both direct and ingestion paths use the same:

- bbox
- date range
- maximum cloud percentage
- maximum images
- credentials
- CDSE catalog endpoint

The compatibility wrapper filters cloud coverage and sorts by datetime descending to match the original Python implementation.

### Download Comparison Differs

Check that both paths use the same scene datetime and bbox. The Process API request depends on the time window and calculated output dimensions.

Also confirm the caller writes the ingestion response bytes exactly after base64 decoding.
