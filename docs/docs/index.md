<!-- # TERRA Data Ingestion Module

The Data Ingestion Module is a Python 3.12+ FastAPI service that exposes
server-approved ingestion processes through one validated HTTP endpoint.

The current `forecaster-collector` profile invokes the TERRA UC1 Sentinel-2
collector. The independently maintained collector is installed from the
`collector` subdirectory of `terra-horizon/uc1.forecaster.uth.alpha` at the
Git commit pinned by this application's `pyproject.toml`.

## Current capabilities

- Validate ingestion requests with Pydantic.
- Select a process adapter through the required `profile` field.
- Run the synchronous collector in a worker thread so FastAPI's event loop is
  not blocked.
- Prevent concurrent collection for the same AOI inside one API process.
- Restore previously published observations, state, and tile definitions.
- Discover new Sentinel-2 observations through CDSE when the state requires it.
- Publish queryable records to MongoDB and artifacts to MinIO.
- Return orchestration timings and the collector's structured result.
- Map configuration, storage, concurrency, and execution failures to controlled
  HTTP responses.

## Runtime flow

```text
TERRA caller
  -> FastAPI /api/ingestion/run
  -> request validation
  -> profile registry
  -> collector adapter
  -> data_collection.collect()
  -> CDSE + MongoDB + MinIO
  -> IngestionRunResponse
```

The HTTP request is synchronous: the response is returned after the selected
profile finishes or fails. There is currently no queue, worker service,
callback, authentication layer, or persisted API-level job model.

## Supported profiles

| Profile | Provider | Process |
| --- | --- | --- |
| `forecaster-collector` | `sentinel-2` | Restore collector state, discover and collect required observations, and publish the collector contract. |

The additional `coastal-uc3-sentinel2` acquires UC3 coastal scenes through a locally supplied
wheel, with independent configuration and readiness. See [UC3 integration](uc3-integration.md). -->

# TERRA Data Ingestion Module

The Data Ingestion Module is a Python 3.12+ FastAPI service that exposes server-approved ingestion processes through a unified, validated HTTP endpoint.

The service currently integrates two independently maintained ingestion components:

- **UC1 — `forecaster-collector`:** Invokes the TERRA UC1 Sentinel-2 collector, installed from the `collector` subdirectory of `terra-horizon/uc1.forecaster.uth.alpha` at the Git commit pinned in the application's `pyproject.toml`.
- **UC3 — `coastal-uc3-sentinel2`:** Invokes the TERRA UC3 Sentinel-2 ingestion package, distributed as a privately supplied Python wheel. It provides coastal scene acquisition, quality assessment, raster processing, and publication.

Both profiles share the application's API and execution infrastructure while retaining independent collector implementations, runtime configurations, and storage responsibilities.

## Current capabilities

- Validate ingestion requests with Pydantic, including profile-specific parameters.
- Select registered ingestion processes through the required `profile` field.
- Execute synchronous collectors in worker threads without blocking FastAPI's event loop.
- Prevent concurrent collection for the same AOI within one API process.
- Support profile-specific ingestion workflows, including:
  - **UC1:** Restore previously published observations, collection state, and tile definitions; discover and collect new Sentinel-2 observations.
  - **UC3:** Discover Sentinel-2 L2A scenes, evaluate acquisition quality, retrieve and validate raster data.
- Integrate with the Copernicus Data Space Ecosystem (CDSE) for satellite data acquisition.
- Publish queryable records to MongoDB and generated artifacts to MinIO.
- Maintain independent configuration and readiness checks for supported profiles.
- Return orchestration timings and structured collector results.
- Map configuration, storage, concurrency, and execution failures to controlled HTTP responses.

## Runtime flow

```text id="thgv5u"
TERRA caller
  -> FastAPI /api/ingestion/run
  -> Request validation
  -> Profile registry
  -> Profile-specific adapter
       |-> UC1: data_collection.collect()
       |-> UC3: wp2_uc3_ingestion.profile.run_profile()
  -> CDSE + MongoDB + MinIO
  -> IngestionRunResponse
```

The HTTP request is synchronous: the response is returned after the selected profile finishes or fails.

There is currently no background job queue, separate worker service, callback mechanism, application-level authentication layer, or persisted API-level job model.

## Supported profiles

| Profile | Provider | Process |
|---|---|---|
| `forecaster-collector` | `sentinel-2` | Restore collection state, discover and collect required Sentinel-2 observations, and publish statistical data and collection artifacts. |
| `coastal-uc3-sentinel2` | `sentinel-2` | Discover Sentinel-2 L2A acquisitions, perform AOI quality assessment, retrieve raster imagery, validate outputs, and publish scene metadata and artifacts. |

Each profile uses its own request parameters, execution contract, and collector-specific result structure.

UC3 requires an independently supplied Python wheel and uses dedicated configuration and readiness checks.

## Documentation

- [Architecture](architecture.md) — Application components, profile dispatch, adapter boundaries, persistence, and operational limitations.
- [Ingestion Workflow](ingestion-workflow.md) — Request validation, profile execution, acquisition, publication, and responses.
- [API Reference](api.md) — HTTP endpoints, request schemas, supported profiles, response structures, and error handling.
- [UC3 Integration](uc3-integration.md) — UC3 package installation, configuration, Docker deployment, validation, and upgrades.
- [UC3 Verification Report](uc3-verification.md) — Integration verification, executed tests, and compatibility checks.

## External dependencies

The ingestion service integrates independently developed collector packages:

- **UC1:** Maintained as an external Git dependency with a pinned revision.
- **UC3:** Maintained in a private repository and provided separately as a Python wheel.

The ingestion application provides the integration and orchestration layer but does not maintain the underlying collector implementations.

**Disclaimer:** The UC1 and UC3 collectors are independently maintained project components. The UC3 package is privately distributed and is not included in this repository. Access, usage, modification, and redistribution remain subject to the permissions and applicable licensing terms established by the respective maintainers.