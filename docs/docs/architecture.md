# Architecture

This is the **alpha version** of the Data Ingestion Module architecture.

The service is intentionally lightweight in its current form and is designed primarily to validate external integrations, data wrapper implementations, and provider communication workflows. It is an HTTP boundary around external-provider calls and response transformation, not the complete persistence-owning ingestion subsystem.

## Runtime Components

The runtime is split into four small layers:

- Express layer: `app.js`, routes, controllers, and middleware expose the HTTP API and handle request/response concerns.
- Core layer: `ingestion.service.js`, `request-normalizer.js`, `source.registry.js`, and `wrapper.registry.js` coordinate validation, provider selection, and response shaping.
- Provider layer: source adapters, currently including `copernicus.adapter.js`, isolate external-provider communication.
- Output layer: wrappers such as `standard-catalogue.wrapper.js`, `copernicus-compatibility.wrapper.js`, and `scene-search-compatibility.wrapper.js` transform provider responses into caller-facing contracts.

Requests enter through Express routes, pass through controllers into the ingestion service, call the selected source adapter, and return through the selected wrapper before the HTTP response is sent.

## Stateless Boundary

The alpha module uses request-local variables while handling a request, but it does not persist anything after the response is returned.

The service has no:

- job status map
- queue consumer
- database client
- dataset repository
- storage service
- ingestion history table

In the alpha version, these capabilities are intentionally out of scope and are not implemented within the service.

## Core Flow

The core request flow is:

1. The TERRA orchestrator or caller sends `POST /api/ingestion/run` to the Express API.
2. The API passes the payload to `runIngestion(payload)`.
3. The ingestion service normalizes and validates the request.
4. The selected source adapter fetches data from Copernicus/CDSE.
5. The adapter returns raw provider data, external request metadata, and provider metadata.
6. The selected wrapper transforms the raw data into the requested response profile.
7. The API returns the transformed result as a stateless JSON response.

## Extension Points

Add a new provider by creating a source adapter and registering it in `src/sources/source.registry.js`.

Add a new response contract by creating a wrapper and registering it in `src/wrappers/wrapper.registry.js`.

The ingestion service should not need provider-specific controller logic.
