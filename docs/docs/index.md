# TERRA Data Ingestion Module

The Data Ingestion Module is a Python 3.12+ FastAPI service that exposes registered Sentinel-2 ingestion processes through a validated HTTP API.

It integrates two independently maintained components:

- **UC1 — `forecaster-collector`:** Runs the TERRA UC1 Sentinel-2 collector, installed from a pinned Git revision.
- **UC3 — `coastal-uc3-sentinel2`:** Runs the TERRA UC3 ingestion package, supplied as a private Python wheel.

Both profiles use the same API and execution infrastructure while keeping their collector implementations, configuration, and storage responsibilities separate.

## Capabilities

- Validate common and profile-specific requests with Pydantic.
- Dispatch requests only to registered profiles.
- Run synchronous collectors in worker threads.
- Prevent concurrent runs for the same AOI within one API process.
- Connect to CDSE, MongoDB, and MinIO through the selected collector.
- Return orchestration metadata and structured collector results.
- Report independent readiness for UC1 and UC3.

## Supported profiles

| Profile | Workflow |
|---|---|
| `forecaster-collector` | Restore UC1 collection state, discover and collect observations, and publish statistical data and artifacts. |
| `coastal-uc3-sentinel2` | Discover Sentinel-2 L2A scenes, assess acquisition quality, retrieve raster imagery, and publish scene metadata and artifacts. |

Requests are synchronous: the API responds after the selected profile finishes. The service does not provide a background job queue or a persisted API-level job model.

## Documentation

- [Architecture](architecture.md) — Components, profile dispatch, persistence, and operational limits.
- [API Reference](api-reference.md) — Endpoints, request schemas, responses, and errors.
- [Ingestion Workflow](workflow.md) — Request validation, profile execution, acquisition, and publication.
- [UC3 Integration](uc3-integration.md) — Private wheel installation, configuration, Docker deployment, and verification.
- [Quality Assurance](qa.md) — Automated and manual test guidance.
- [Deployment](deployment.md) and [Configuration](configuration.md) — Runtime setup and service settings.

## External dependencies

The UC1 collector is installed from its pinned Git revision. The UC3 package is privately distributed and is not included in this repository; supply it through an authorized handoff or private artifact channel. Access, use, modification, and redistribution remain subject to the respective maintainers' permissions and licensing terms.
