# Collector service migration

The embedded UC1 collector package has been removed from the Data Ingestion Module. `forecaster-collector` remains as a compatibility alias of `uc1-water-pollutants-collector`; both submit and poll jobs through the remote API. Existing legacy `run_name` is accepted and omitted from the upstream request. Responses now contain `satellite_submission` and `satellite_collection` instead of the former embedded result.

The remote collector owns acquisition, state, provider credentials, MongoDB and MinIO. Configure its URL, key and polling limits as described in [Configuration](configuration.md). UC3 remains an independent Python package and the Hydro river and sea profiles remain separate. See [Workflow](workflow.md) and [API reference](api-reference.md).
