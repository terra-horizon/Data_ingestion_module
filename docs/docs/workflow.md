# Ingestion Workflow

The Data Ingestion Module provides a unified API for executing ingestion workflows through registered collection profiles.

Currently supported profiles:

- **UC1 — `forecaster-collector`:** Sentinel-2 statistical data collection for the forecasting pipeline.
- **UC3 — `coastal-uc3-sentinel2`:** Sentinel-2 L2A scene discovery, quality assessment, raster acquisition, and publication through the externally maintained UC3 ingestion package.

Both profiles share the existing FastAPI application, request dispatcher, execution infrastructure, and API response envelope, while maintaining independent collector implementations and configurations.

## 1. Request validation

The caller sends `POST /api/ingestion/run`.

Pydantic validates common request fields:

- A non-empty `run_job_id` and `aoi_id`.
- A timezone-aware `triggered_at`.
- `provider: sentinel-2`.
- A registered `profile`.
- A four-number WGS84 bounding box with ordered coordinates.
- Profile-specific acquisition parameters and constraints.

**UC1 validation**

The `forecaster-collector` profile requires `run_name` and supports:

- `history_start` and `target_date`.
- Collection mode.
- Optional date and tile limits.
- UC1-specific collection parameters.

**UC3 validation**

The `coastal-uc3-sentinel2` profile requires a dedicated `uc3` configuration containing:

- `contract_version: 2`.
- `mode`: `latest` or `window`.
- `time_from` and `time_to`: timezone-aware timestamps defining an increasing acquisition window.
- `selection_policy`: defaults to `uc3_parity_pilot`; `uc3_monthly_backfill` is also supported.
- `max_scenes`: optional integer between 1 and 24.

UC3 additionally validates the AOI identifier and bounding box against its authorised AOI registry. It does not require UC1-specific fields such as `run_name`, `history_start`, or `target_date`.

Invalid request schemas return HTTP `422` before an adapter executes. Package-level AOI authorisation or configuration failures can return HTTP `400`.

## 2. Profile selection

`app/services/ingestion.py` selects the appropriate registered profile runner.

The current mapping is:

```text
forecaster-collector    -> run_sentinel_ingestion
coastal-uc3-sentinel2   -> UC3 adapter runner
```

Both collectors use synchronous Python execution. The application executes profile runners in a Starlette worker thread to avoid blocking the FastAPI event loop.

The UC3 integration invokes the external package through:

```python
from wp2_uc3_ingestion.profile import run_profile

result = run_profile(config)
```

The canonical profile name `coastal-uc3-sentinel2` is preserved throughout the UC3 request and response.

No additional UC3 microservice, background job queue, or polling mechanism is introduced.

## 3. Adapter translation

Each profile uses its own adapter to translate the validated API request into the corresponding collector contract.

**UC1 adapter**

The adapter converts the validated request into `CollectionRequest`.

It:

- Sets `output_root` to `outputs`.
- Passes AOI information, dates, mode, and collection limits.
- Enables publication of collected results.
- Applies a process-local guard preventing concurrent collection of the same AOI.

**UC3 adapter**

The adapter translates the validated request into the external UC3 package's acquisition configuration.

It:

- Preserves the canonical UC3 profile identifier.
- Passes the authorised AOI, acquisition time window, selection policy, and scene limits.
- Excludes UC1-only request options.
- Invokes `run_profile()` using the installed UC3 package.
- Preserves the package's structured acquisition result and error information.

UC3 also uses a process-local AOI concurrency guard.

These guards are not distributed locks and do not coordinate concurrent requests across multiple application instances.

## 4. Storage preflight and hydration

Both profiles perform storage and configuration checks, but their preparation workflows differ.

### UC1

For a published run, the collector:

1. Loads runtime environment variables.
2. Connects to MongoDB and MinIO and checks required storage resources.
3. Verifies the stable AOI definition.
4. Restores observations from MongoDB when local history is absent.
5. Restores collection state and tile artifacts from MinIO when local files are absent.
6. Creates a `pipeline_runs` record with collector status `running`.

### UC3

The UC3 package uses an independent configuration namespace:

`UC3_INGEST_*`

Its preparation includes:

1. Loading and validating UC3-specific settings.
2. Validating CDSE provider credentials and configured credential pairs.
3. Checking the configured MongoDB and MinIO storage namespaces.
4. Verifying the requested AOI against the authorised registry.
5. Establishing the acquisition configuration, output grid, and publication settings.

UC3 supports a primary CDSE credential and up to four backup credentials, with authentication-based failover, token caching, and retry handling.

UC3 does not use UC1's local observation-history hydration workflow. Its acquisition and publication lifecycle is managed by the external package.

## 5. Discovery and collection

### UC1 — Statistical collection

The collector calculates discovery windows from `mode`, `history_start`, `target_date`, and restored state.

- Existing `cdse_stac_cache` entries are reused when a matching local cache is present.
- Missing windows are requested from CDSE and cached locally.
- If state already covers the target date, no discovery request is made.
- River tiles are restored or generated as needed.
- Missing tile/date units are collected through the Sentinel Hub Statistical API.
- Run limits can restrict dates and tiles for commissioning tests.

The collected information supports the UC1 forecasting workflow through satellite-derived statistics and observations.

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

## 6. Publication

### UC1 publication

The collector updates local history and state, then publishes:

- Observation and tile documents to MongoDB.
- Incremental collection state to MongoDB.
- Stable AOI, tile, observation, result, input-manifest, and log artifacts to MinIO.
- The terminal `success`, `partial`, or `failed` pipeline run status.

Partial runs retain successfully collected data and report retryable failures in `failed_units`.

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

## 7. API response

FastAPI returns a common response envelope containing:

- Request job ID.
- Provider and ingestion profile.
- AOI identifier.
- Trigger, start, and completion timestamps.
- Execution duration.
- Overall ingestion status.
- Serialized collector result.

Each profile preserves its specific result structure within `collector_result`.

**UC1 response**

Contains the collector's execution status, collected observations, generated artifacts, processing metadata, and any failed collection units.

Collector-local paths refer only to the current host or container.

**UC3 response**

Contains the package's structured acquisition information, including:

- Package and contract versions.
- Catalogue discovery and selection statistics.
- Candidate scenes and rejection decisions.
- AOI quality measurements.
- Delivered scene packages.
- Raster metadata.
- MongoDB/MinIO artifact references.
- Structured failure details and retryability information.

For UC3, HTTP `200` does not necessarily indicate a successful acquisition. The caller must inspect the top-level `status` and `collector_result.status`.

### Error handling

| Condition | HTTP status |
|---|---|
| Invalid request schema | `422` |
| Invalid collector configuration or unauthorised AOI | `400` |
| Same AOI already running in this process | `409` |
| Package/runtime unavailable | `503` |
| Unexpected execution failure | `500` |
| UC3 completed acquisition | `200` |
| UC3 no-data acquisition | `200` |
| UC3 structured acquisition failure | `200` |

Known failures are translated through the adapter and API exception-handling mechanisms.

## 8. Health and readiness

The ingestion service provides independent readiness checks for UC1 and UC3.

**UC1 readiness**

`GET /health/ready`

Verifies the UC1 configuration, MongoDB connectivity, and MinIO connectivity.

**UC3 readiness**

`GET /health/ready/coastal-uc3-sentinel2`

Verifies:

- UC3 package availability and bundled resources.
- UC3 configuration validity.
- MongoDB connectivity.
- MinIO connectivity.

Both endpoints return HTTP `200` when ready or `503` when unavailable.

Readiness checks do not execute satellite acquisitions or write data to storage.

UC3 readiness does not prove that CDSE credentials are accepted by the provider or that publication permissions are sufficient.

A readiness failure for one profile does not automatically imply that the other profile is unavailable.

## 9. Execution and deployment considerations

- Both profiles are executed through the existing FastAPI ingestion service.
- UC1 and UC3 maintain separate collector implementations and configuration requirements.
- UC3 is installed as an external Python package and invoked directly through its supported entry point.
- The UC3 wheel must be supplied during application installation and Docker image construction.
- UC3 acquisitions remain synchronous from the HTTP caller's perspective, despite executing in a worker thread.
- Client and reverse-proxy timeouts must accommodate acquisition duration.
- AOI concurrency guards are process-local rather than distributed.
- Storage namespaces and permissions must be configured independently for each profile.

## Disclaimer

The UC3 ingestion functionality depends on `terra-wp2-uc3-ingestion`, a privately maintained Python package developed by an external project team.

The package is not publicly distributed or included in this repository. An authorised package artifact must be obtained from its maintainers or through an approved distribution channel before installation or deployment.

This documentation describes the integration of the external UC3 component into the Data Ingestion Module. It does not claim ownership of the external package or grant redistribution rights. Package usage, modification, and redistribution remain subject to the applicable licence and permissions established by its maintainers.