# FAQ

## What does `profile` select?

It selects a server-registered process adapter. The only current value is
`forecaster-collector`, which invokes the bundled Sentinel-2 collector.
Arbitrary commands and module names are not accepted.

## How do I add another process?

Create an adapter with a request-to-process translation, register it in
`PROFILE_RUNNERS` in `app/services/ingestion.py`, and extend the request profile
type and tests. Keep process-specific branching out of the HTTP route.

## Why is the collector inside `app/packages/collector`?

It is a temporary vendored dependency while we establishe an
installable organizational package. Docker and local setup install it through
its own `pyproject.toml`; FastAPI does not import it as `app.packages`.

## Does deleting `outputs/` force a complete replay?

No. Published collector state is restored from MongoDB and MinIO. If that state
says the historical backfill is complete, the collector requests only new or
incomplete work. Use a new AOI identity or deliberately reset both durable
stores for a genuinely fresh test.

## Does the endpoint run in the background?

No. It waits for the selected profile to finish. The blocking collector runs in
a worker thread, but the HTTP request remains open.

## Is authentication implemented?

No. The current API has no caller authentication or authorization layer.
