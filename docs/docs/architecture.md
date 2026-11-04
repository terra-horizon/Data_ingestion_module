# Architecture

All profiles use `POST /api/ingestion/run`, Pydantic validation, registered runners, and a worker thread. The common envelope retains request identifiers, timings and each profile result.

```text
TERRA Orchestrator -> Data Ingestion Module -> Satellite Water Pollutants Collector API
                                                 -> independent collection worker -> MongoDB / MinIO
```

`forecaster-collector` is a compatibility alias for `uc1-water-pollutants-collector`. Both submit and monitor a remote job. The remote collector owns CDSE access, collection state and persistence; this application does not initialize its storage. The separate `uc1-sperchios-river` and `uc1-sperchios-sea` profiles invoke Hydro Modeling sequentially. The `coastal-uc3-sentinel2` profile invokes the independent UC3 package with its own storage and provider settings and process-local AOI guard. See [UC3 integration](uc3-integration.md).

The ingestion HTTP request remains open while the profile runs. Remote satellite jobs may continue after the polling limit; the returned `pending` result retains the remote ID. A POST is never retried automatically. Readiness for the collector delegates to its read-only health endpoint; UC3 readiness remains independent.
