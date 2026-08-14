# Architecture

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
| Bundled collector | `app/packages/collector/data_collection` | Own discovery, tiling, collection state, local staging, MongoDB writes, and MinIO uploads. |

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
- Authentication and authorization are not implemented yet.
