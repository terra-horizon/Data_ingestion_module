# Collector service migration

The embedded UC1 collector package and the former `forecaster-collector` profile have been removed from the Data Ingestion Module. Clients must use `uc1-water-pollutants-collector` and remove `run_name` from requests. Responses contain `satellite_submission` and `satellite_collection` instead of the former embedded result.

The remote collector owns acquisition, state, provider credentials, MongoDB and MinIO. Configure its URL, key and polling limits as described in [Configuration](configuration.md). UC3 remains an independent Python package and the Hydro river and sea profiles remain separate. See [Workflow](workflow.md) and [API reference](api-reference.md).
