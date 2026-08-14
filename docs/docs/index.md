# TERRA Data Ingestion Module

The Data Ingestion Module is a Python 3.12+ FastAPI service that exposes
server-approved ingestion processes through one validated HTTP endpoint.

The current `forecaster-collector` profile invokes the TERRA UC1 Sentinel-2
collector. The collector is temporarily bundled as an installable package at
`app/packages/collector`; it will be replaced by the organization-managed
package when that distribution path is available.

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

## Supported profile

| Profile | Provider | Process |
| --- | --- | --- |
| `forecaster-collector` | `sentinel-2` | Restore collector state, discover and collect required observations, and publish the collector contract. |
