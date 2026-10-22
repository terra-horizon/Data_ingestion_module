<!-- # Architecture

## Components

The service is intentionally small and separates HTTP concerns from process
selection and collector integration.

| Layer | Location | Responsibility |
| --- | --- | --- |
| FastAPI application | `app/main.py` | Create the application and register API routers. |
| HTTP route | `app/api/routes/ingestion.py` | Measure execution, map known failures to HTTP responses, and construct the response envelope. |
| Request/response schemas | `app/schemas/ingestion.py` | Validate domain inputs and define the public API contract. |
| Profile service | `app/services/ingestion.py` | Map a server-approved profile to its adapter and run blocking work in a thread. |
| Collector adapter | `app/adapters/collector.py` | Translate API input into `CollectionRequest`, guard concurrent AOI execution, and normalize collector exceptions. |
| Collector package | Pinned `terra-data-collection` Git dependency | Own discovery, tiling, collection state, local staging, MongoDB writes, and MinIO uploads. |

## Request dispatch

```text
POST /api/ingestion/run
  -> Pydantic validation
  -> profile registry
  -> forecaster-collector adapter
  -> worker thread
  -> data_collection.collect()
  -> collector result
  -> FastAPI response envelope
```

Profiles are a controlled extension point. A request selects a registered
profile such as `forecaster-collector`; it cannot supply a module path,
function name, or arbitrary command. A future process should add its own
adapter and one registry entry rather than adding branches to the route.

## Collector persistence boundary

The API does not query MongoDB or MinIO after collection. Persistence is owned
by the collector package.

```text
FastAPI adapter
  -> Collector
       |-> CDSE STAC and Statistical APIs
       |-> Local staging under outputs/
       |-> MongoDB (read and write)
       `-> MinIO   (read and write)
```

MongoDB stores queryable observations, tiles, collection state, and pipeline
run records. MinIO stores the stable AOI definition, canonical JSON/GeoJSON,
and run-scoped artifacts. Local `outputs/<run_name>` files support execution
and resumption inside the running process, but they are not cross-service
resource identifiers.

## State and restart behavior

Deleting the local `outputs` directory does not necessarily cause a historical
re-fetch. For a published run, the collector first hydrates observations from
MongoDB and state/tile files from MinIO. If restored state says backfill is
complete and `last_checked_date` already covers the target date, the discovery
window count is zero and CDSE is not queried again.

Use a new AOI identity for an isolated fresh run, or deliberately reset both
MongoDB and MinIO state when testing a complete replay.

## Current operational limits

- Requests wait for collection to finish; long runs are subject to client,
  proxy, and server timeouts.
- The in-process AOI lock applies to one API process only.
- Multiple replicas do not share a distributed lock.
- The Compose setup expects MongoDB and MinIO to exist on `terra-network`.
- Authentication and authorization are not implemented yet. -->

# Architecture

## Overview

The Data Ingestion Module is a FastAPI-based service that provides a unified interface for executing different data ingestion workflows.

The architecture follows a **profile-based execution model**, separating HTTP request handling, validation, profile selection, collector integration, and data persistence.

Each ingestion profile encapsulates a specific collection workflow while sharing the application's API and execution infrastructure.

Currently supported profiles:

- **`forecaster-collector` (UC1):** Sentinel satellite data collection and statistical processing for forecasting applications.
- **`coastal-uc3-sentinel2` (UC3):** Sentinel-2 scene acquisition, quality assessment, raster processing, and publication.

New ingestion workflows can be introduced by implementing an adapter and registering the corresponding profile, without modifying the core API architecture.

## Components

The application separates common infrastructure from profile-specific functionality.

| Layer | Location | Responsibility |
|---|---|---|
| FastAPI application | `app/main.py` | Initialise the application and register API routers. |
| HTTP routes | `app/api/routes/` | Handle requests, translate errors into HTTP responses, and construct response envelopes. |
| Request/response schemas | `app/schemas/` | Validate common and profile-specific inputs and define API contracts. |
| Profile service | `app/services/ingestion.py` | Resolve registered profiles and coordinate execution. |
| Profile adapters | `app/adapters/` | Translate API requests into collector-specific contracts, manage execution boundaries, and normalise errors. |
| External collector packages | Installed dependencies | Implement acquisition, processing, and persistence operations. |
| Configuration | Environment-based settings | Provide profile-specific credentials, storage connections, and runtime parameters. |
| Storage infrastructure | MongoDB and MinIO | Persist collection metadata, processing state, and generated artifacts. |

The FastAPI application remains independent of the internal implementation details of individual collectors.

## Request Dispatch

All supported ingestion profiles are accessed through a common endpoint:

`POST /api/ingestion/run`

```text
                    HTTP Client
                         |
                         v
                  FastAPI Endpoint
                         |
                         v
                  Request Validation
                         |
                         v
                   Profile Registry
                         |
             +-----------+-----------+
             |                       |
             v                       v
        UC1 Adapter              UC3 Adapter
             |                       |
             v                       v
       UC1 Collector             UC3 Package
             |                       |
             +-----------+-----------+
                         |
                         v
              Profile-Specific Result
                         |
                         v
                API Response Envelope
```

The profile registry maps a predefined profile identifier to its corresponding adapter.

```text
forecaster-collector   -> UC1 collector adapter
coastal-uc3-sentinel2  -> UC3 ingestion adapter
```

Profiles are controlled extension points. API callers may select only registered profiles and cannot specify arbitrary modules, functions, or executable commands.

Because collector operations are potentially blocking, adapters execute through the application's worker-thread infrastructure.

The HTTP request remains open until execution completes.

## Adapter and Collector Integration

Each adapter provides a consistent boundary between the ingestion API and its underlying collection implementation.

Adapters are responsible for:

- Translating validated API requests into collector-specific input contracts.
- Invoking the corresponding collector or external Python package.
- Managing process-local concurrency restrictions.
- Translating known exceptions into application-level errors.
- Returning structured results compatible with the shared API response envelope.

The collectors retain responsibility for their domain-specific operations, including data discovery, acquisition, processing, validation, and publication.

This design allows collectors to evolve independently without requiring changes to the common HTTP interface.

## Persistence Boundary

The ingestion API does not directly manage collector data persistence.

Each collector owns its storage operations and interacts with the infrastructure according to its own data model.

```text
                  FastAPI Application
                          |
                    Profile Adapter
                          |
                          v
                  Collector Package
                          |
              +-----------+-----------+
              |           |           |
              v           v           v
         External API   MongoDB     MinIO
              |
         Data Acquisition
              |
         Processing / Validation
              |
         Result Publication
```

The main persistence responsibilities are:

- **MongoDB:** Stores queryable collection metadata, observations, scene information, processing state, and execution records, depending on the profile.
- **MinIO:** Stores raster files, JSON/GeoJSON artifacts, collection outputs, manifests, and other binary or structured artifacts.
- **Local storage:** Provides temporary execution and processing space where required by the collector.

Storage namespaces, collection structures, and persistence strategies remain profile-specific.

Local filesystem artifacts are not assumed to be persistent or accessible across container instances.

## Configuration and Dependency Isolation

Each ingestion profile maintains its own runtime configuration and credentials.

Configuration is supplied through environment variables and validated by the corresponding collector or adapter.

For example:

- UC1 uses its existing collection and storage configuration.
- UC3 uses the dedicated `UC3_INGEST_*` configuration namespace.

Although profiles may share infrastructure such as MongoDB, MinIO, or external data providers, their configuration and data namespaces remain logically separated.

External collector packages are installed as application dependencies. The UC3 integration uses a privately distributed Python wheel, whereas the UC1 collector uses its established dependency mechanism.

## State and Restart Behavior

State management is delegated to individual collectors.

Depending on the profile, collectors may support:

- Restoration of previously collected data.
- Incremental acquisition based on stored processing state.
- Reuse of previously published artifacts.
- Skipping already completed collection units.
- Recovery from interrupted or partially completed operations.

The application does not impose a common persistence or recovery algorithm on all profiles.

Container restarts do not automatically imply a complete re-acquisition. Actual recovery behavior depends on each collector's implementation and the availability of its persisted state.

## Health and Readiness

The service provides common liveness checks and independent readiness checks for supported ingestion profiles.

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Application liveness |
| `GET /health/ready` | UC1 configuration and storage readiness |
| `GET /health/ready/coastal-uc3-sentinel2` | UC3 package, configuration, and storage readiness |

Profile-specific readiness checks validate the dependencies required for that profile without triggering collection operations.

A failure in one profile's readiness does not necessarily indicate that other profiles are unavailable.

## Current Operational Limits

- Ingestion requests are synchronous from the HTTP client's perspective and remain subject to client, reverse-proxy, and server timeouts.
- Collector execution occurs in worker threads to avoid blocking the FastAPI event loop.
- Concurrent execution guards operate within individual application processes.
- Multiple application replicas do not share a distributed execution lock.
- The deployment expects required external services, including MongoDB and MinIO, to be accessible through the configured infrastructure.
- There is currently no centralised background job queue or persistent job polling mechanism.
- The application does not introduce its own dedicated authentication and authorisation mechanism for ingestion requests; access control must be enforced at the deployment boundary.

## Extensibility

The architecture is designed to accommodate additional ingestion profiles without restructuring the application.

Integrating a new collector generally involves:

1. Defining its request validation requirements.
2. Implementing an adapter for the collector's execution contract.
3. Registering the profile in the application dispatcher.
4. Configuring its dependencies and storage access.
5. Adding profile-specific readiness checks and integration tests.

This maintains a consistent API while allowing different ingestion implementations, data providers, processing pipelines, and storage models to coexist within the same service.