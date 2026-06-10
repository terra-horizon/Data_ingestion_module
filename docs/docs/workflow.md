# Workflow

The current alpha workflow is request-response only.

## Workflow Boundary

The production TERRA concept includes orchestrator-driven DAGs, storage operations, and metadata reports describing changed database entries and file locations. Those steps are not owned by this alpha service.

In this version:

- the caller sends a request
- the service calls the external provider
- the service wraps the response
- the service returns the wrapped response
- the caller or orchestrator owns persistence and next pipeline steps

## Standard Runtime Workflow

The standard runtime workflow is:

1. The caller builds an ingestion payload and sends `POST /api/ingestion/run`.
2. The service normalizes and validates the request.
3. If the requested source is not registered, the service returns `UNKNOWN_SOURCE`.
4. If the source exists, the service builds the external provider request and calls the provider.
5. If the provider call fails, the service returns `EXTERNAL_API_ERROR` or `EXTERNAL_API_TIMEOUT`.
6. If the provider call succeeds, the service selects a wrapper using `responseProfile`.
7. The wrapper transforms the provider response.
8. The service returns the stateless result to the caller.
