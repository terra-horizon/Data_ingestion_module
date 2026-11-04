# Ingestion Workflow

All five profiles run via `POST /api/ingestion/run` in a worker thread. `forecaster-collector` is a compatibility alias for `uc1-water-pollutants-collector`; `run_name` is accepted for legacy callers but never forwarded.

The satellite adapter submits one remote job, then polls its job status until `succeeded`, `partial`, or `failed`, or until the configured deadline. It maps these to `success`, `partial`, and `failed`. A timeout or poll error returns `pending`, the submission and latest known job response; it does not cancel or resubmit the job. The remote worker owns data acquisition and persistence.

River independently looks up the configured static river, runs reanalysis, and then a 15-day forecast. Sea looks up the marine analyses, validates the configured ID and river association, and runs six-day IFS. Failed dependent steps stop execution and preserve earlier responses. UC3 uses its own independently configured package:

### UC3 — Scene discovery and raster acquisition

The UC3 package performs the following sequence:

1. **Catalogue discovery:** Queries the CDSE Catalogue API for Sentinel-2 Level-2A scenes intersecting the requested AOI and time interval.
2. **Scene deduplication:** Groups catalogue entries belonging to the same satellite acquisition across MGRS tiles.
3. **Catalogue prefiltering:** Evaluates scene-level cloud coverage and prepares eligible acquisitions.
4. **AOI quality assessment:** Uses the Sentinel Hub Process API to retrieve Scene Classification Layer (SCL) data and evaluates cloud coverage, cloud shadows, no-data pixels, and unusable areas within the AOI.
5. **Scene selection:** Rejects scenes that fail the configured quality policy and selects eligible acquisitions according to the requested selection policy.
6. **Raster acquisition:** Requests the selected Sentinel-2 imagery through the CDSE Process API.
7. **Raster validation:** Verifies raster metadata, required bands, spatial coverage, and preflight quality conditions.
8. **Scene packaging:** Constructs the acquisition metadata and corresponding raster artifact for publication.

The UC3 raster contains five Sentinel-2 bands:

`B02`, `B03`, `B04`, `B08`, `B11`

Raster data is delivered in GeoTIFF format with Float32 reflectance values.

The `max_scenes` parameter limits the number of delivered scenes.

UC3 retains acquisition identifiers, observation timestamps, scene quality metrics, processing metadata, and provenance information.


### UC3 publication

The UC3 package publishes its acquisition outputs to the configured MongoDB and MinIO infrastructure.

MongoDB stores records associated with:

- `scenes`
- `scene_assets`
- `artifacts`

In shared deployment configurations, these collections use the `uc3_` prefix.

MinIO stores the acquired raster artifacts under the configured UC3 object prefix.

Publication records include:

- Provider scene identifiers and acquisition metadata.
- Raster characteristics, including dimensions, bands, format, and CRS.
- AOI quality assessment results.
- Processing parameters and provenance.
- Artifact identifiers, object references, sizes, and checksums.
- Publication state and reuse metadata.

The package reports committed artifacts and their storage references in the acquisition result.

UC3 publication outcomes are:

- `completed`: acquisition and publication completed.
- `no_data`: no suitable scenes were available.
- `failed`: an acquisition, processing, or publication failure occurred.

These statuses remain distinct from the UC1 collector's `success`, `partial`, and `failed` outcomes.


## Readiness and execution

`/health/ready` checks the collector's read-only readiness endpoint, while `/health/ready/coastal-uc3-sentinel2` independently checks UC3. Requests remain open during execution, so configure client and proxy timeouts for the expected duration. UC3 concurrency guards are process-local.
