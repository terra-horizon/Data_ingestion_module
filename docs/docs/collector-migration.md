# UC1 collector migration

The production UC1 collection path now lives inside the Data Ingestion Module. The old
collector is reference-only until it is archived; it is not called, deployed, or retained as
a second production path. Legacy JSON/CSV/GeoJSON outputs are not a source of truth.

## AOI ingestion contract

Send `POST /api/ingestion/run` with persistence enabled:

```json
{
  "useCaseId": "uc1-forecaster",
  "provider": "uc1",
  "mode": "aoi-water-quality",
  "responseProfile": "uc1-water-quality-aoi",
  "aoi": {
    "aoiId": "sperchios",
    "name": "Sperchios",
    "bbox": [22.0, 38.0, 22.1, 38.1]
  },
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-07",
  "tile": {
    "spacingM": 400,
    "sizeM": 400,
    "minRiverLengthM": 10000,
    "maxTiles": 500
  },
  "options": {
    "includeTiles": true,
    "includeSentinel2Statistics": true,
    "includeSentinel2Images": false,
    "includeSentinel3": false
  },
  "idempotencyKey": "orchestrator-run-123"
}
```

The service validates the AOI and interval, queries Overpass for river ways, converts them
to normalized line strings, generates deterministic river tiles, discovers Sentinel-2
products, collects statistics for every tile, validates observations, upserts MongoDB
projections, and stores the normalized run in `ingestion_results`.

The Overpass endpoint and timeout are configurable. Empty, malformed, timeout, throttling,
and upstream failure cases are returned as typed provider errors. No river cache or local
GeoJSON is written.

Tile IDs hash the AOI identity, tile geometry, river-network hash, and generation parameters.
The same AOI and parameters therefore produce the same tile keys; changed parameters
produce a new canonical set.

## Persistence model

MongoDB is the structured source of truth:

| Collection | Purpose | Indexes |
| --- | --- | --- |
| `ingestion_results` | Normalized operation result, request summary, object metadata, and changed entries | unique idempotency key, request hash, sparse unique ingestion run ID |
| `uc1_tiles` | Canonical, query-friendly river tiles | unique `(aoiId, tileId)`, `aoiId`, `aoiDefinitionHash` |
| `uc1_observations` | Forecast-ready water-quality observations | unique `(aoiId, tileId, observationDate, provider, sourceProductId)`, `(aoiId, observationDate)`, `(tileId, observationDate)`, `ingestionRunId` |

Tile records contain AOI and river hashes, bbox, polygon, centroid, source, generation
parameters, status, timestamps, and the latest ingestion-run reference. Observation records
contain identity, AOI/tile/date, provider/product identity, bbox, the seven metrics, quality
flags, provenance, water-status fields, object references, status, and timestamps.

MinIO stores validated binary objects through the existing object-store port. MongoDB
contains references only, for example:

```json
{
  "objectId": "obj_0123456789abcdef01234567",
  "bucket": "terra-bucket",
  "key": "ingestions/2026/01/01/orchestrator-run-123/objects/scene-obj_0123456789abcdef01234567.tif",
  "contentType": "image/tiff",
  "size": 12345,
  "etag": "etag",
  "sha256": "sha256-value",
  "role": "scene"
}
```

Bytes are signature-checked, content-addressed, deduplicated with object metadata, and
removed from the MongoDB representation after upload. Buckets remain private.

## Idempotency and change tracking

An explicit idempotency key is honored; otherwise one is derived from the normalized
request hash. MongoDB uses atomic upserts and unique keys for runs, tiles, and observations.
Object keys include a content-derived object ID and existing object metadata is checked
before upload. Transient timestamps are excluded from comparisons, so identical retries
remain `unchanged`; meaningful data changes produce `created`, `updated`, `unchanged`, or
`removed` changed-entry records with previous/current hashes.

## Run lookup

- `GET /api/ingestion/runs/:id` returns run metadata, object references, and change counts.
- `GET /api/ingestion/runs/:id/status` returns terminal status and summary counts.
- `GET /api/ingestion/runs/:id/results` returns the normalized result, object metadata,
  changed entries, and projected observations.

`:id` may be the Mongo record ID, ingestion run ID, or idempotency key. Binary content and
base64 are never returned by these endpoints.

## Configuration

```env
PERSISTENCE_ENABLED=true
MONGO_URI=mongodb://terra_user:terra_password@terra-mongodb:27017/terra_db?authSource=terra_db
MONGO_DB_NAME=terra_db
MONGO_INGESTION_COLLECTION=ingestion_results
MONGO_UC1_TILES_COLLECTION=uc1_tiles
MONGO_UC1_OBSERVATIONS_COLLECTION=uc1_observations

S3_ENDPOINT=terra-minio
S3_PORT=9000
S3_USE_SSL=false
S3_ACCESS_KEY=terra_service_user
S3_SECRET_KEY=change-me
S3_BUCKET=terra-bucket

OSM_OVERPASS_URL=https://overpass-api.de/api/interpreter
OSM_OVERPASS_TIMEOUT_MS=30000
UC1_TILE_SPACING_METERS=400
UC1_TILE_SIZE_METERS=400
UC1_MIN_RIVER_LENGTH_METERS=10000
UC1_MAX_TILES_PER_RUN=500
UC1_MAX_DAYS_PER_RUN=366
UC1_ENABLE_SENTINEL3=false
```

Docker joins the external `terra-network` and uses the MongoDB and MinIO services supplied
by the TERRA node stack.

## Supported and limited behavior

- OSM river acquisition, canonical tiling, AOI orchestration, Sentinel-2 discovery and
  statistics, projections, persistence, idempotency, and lookup are implemented.
- Sentinel-2 Process API acquisition and MinIO binary persistence exist in the module.
  AOI orchestration currently requires explicit scene selection before images can be
  enabled and returns `UC1_IMAGE_SCENE_REQUIRED` otherwise.
- The legacy Sentinel-3 contract could not be confirmed as a stable production contract.
  The adapter boundary exists and returns `SENTINEL3_NOT_CONFIGURED` when disabled or
  `SENTINEL3_CONTRACT_UNCONFIRMED` when enabled, instead of silently producing data.
- Water eligibility remains `water_status: unknown` and
  `water_check_status: not_performed`; a verified water-mask policy is still required.

Future forecaster integration should query `uc1_tiles` and `uc1_observations` rather than
collector-local files.

## Tests

Unit tests use provider mocks and in-memory MongoDB/MinIO projection fakes:

```bash
npm test
```

Real storage tests are opt-in:

```bash
npm run test:integration
```
