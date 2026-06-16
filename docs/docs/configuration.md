# Configuration

This configuration applies to the **alpha stateless implementation**. Variables for MongoDB, MinIO, queues, IoT brokers, or workflow state are intentionally absent because those integrations are not implemented in this version.

Configuration is loaded from environment variables through `src/config/env.js`.

Copy `.env.example` to `.env` for local development.

```bash
cp .env.example .env
```

## Environment Variables

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `PORT` | `3000` | No | HTTP server port. |
| `NODE_ENV` | `development` | No | Runtime environment. Controls logging format. |
| `REQUEST_TIMEOUT_MS` | `30000` | No | Axios request timeout in milliseconds. |
| `CDSE_PROCESS_TIMEOUT_MS` | `60000` | No | Sentinel Hub Process API request timeout in milliseconds. |
| `CDSE_STATISTICS_TIMEOUT_MS` | `120000` | No | Sentinel Hub Statistics API request timeout in milliseconds. |
| `CDSE_RATE_LIMIT_RETRY_DELAY_SECONDS` | `180` | No | Delay before retrying rate-limited CDSE requests when no backup credential is available. |
| `CDSE_MAX_RETRIES` | `3` | No | Maximum CDSE provider attempts per request. |
| `MAX_CATALOGUE_LIMIT` | `100` | No | Maximum accepted catalogue limit from caller payloads. |
| `COPERNICUS_API_MODE` | `stac` | No | Default Copernicus mode when payload does not provide `mode`. |
| `COPERNICUS_STAC_BASE_URL` | `https://stac.dataspace.copernicus.eu/v1` | No | STAC base URL used by `mode: "stac"`. |
| `COPERNICUS_SH_CATALOG_URL` | `https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search` | Yes for `sentinel-hub-catalog` | Sentinel Hub Catalog endpoint. |
| `CDSE_SH_STATISTICS_URL` | `https://sh.dataspace.copernicus.eu/api/v1/statistics` | Yes for `sentinel-hub-statistics` | Sentinel Hub Statistics endpoint. |
| `CDSE_SH_PROCESS_URL` | `https://sh.dataspace.copernicus.eu/api/v1/process` | Yes for `sentinel-hub-process` | Sentinel Hub Process endpoint. |
| `COPERNICUS_ODATA_BASE_URL` | `https://catalogue.dataspace.copernicus.eu/odata/v1` | No | Reserved for future OData catalogue support. |
| `CDSE_TOKEN_URL` | CDSE OpenID Connect token endpoint | Required when using client credentials | Token endpoint used when `COPERNICUS_ACCESS_TOKEN` is not set. |
| `COPERNICUS_USERNAME` | empty | No | Reserved for future username/password flows. |
| `COPERNICUS_PASSWORD` | empty | No | Reserved for future username/password flows. |
| `COPERNICUS_ACCESS_TOKEN` | empty | Required unless client credentials are provided for authenticated Sentinel Hub modes | Bearer token used directly for CDSE requests. |
| `CDSE_CLIENT_ID` | empty | Required when no access token is provided for authenticated Sentinel Hub modes | Primary OAuth client ID. |
| `CDSE_CLIENT_SECRET` | empty | Required when no access token is provided for authenticated Sentinel Hub modes | Primary OAuth client secret. |
| `CDSE_BACKUP_CLIENT_ID` | empty | No | Backup OAuth client ID used after provider `403` or `429`. |
| `CDSE_BACKUP_CLIENT_SECRET` | empty | No | Backup OAuth client secret used after provider `403` or `429`. |
| `CDSE_FALLBACK_CLIENT_ID` | empty | No | Alternate backup credential variable name. |
| `CDSE_FALLBACK_CLIENT_SECRET` | empty | No | Alternate backup credential variable name. |
| `CDSE_BACKUP_2_CLIENT_ID` through `CDSE_BACKUP_9_CLIENT_ID` | empty | No | Additional backup OAuth client IDs. |
| `CDSE_BACKUP_2_CLIENT_SECRET` through `CDSE_BACKUP_9_CLIENT_SECRET` | empty | No | Additional backup OAuth client secrets. |

## Authentication Behavior

For authenticated Sentinel Hub modes:

1. If `COPERNICUS_ACCESS_TOKEN` is set, the adapter sends it as a Bearer token.
2. If no access token is set, the service requests a CDSE token using `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET`.
3. Tokens are cached only in process memory when expiry information is available.
4. The service refreshes tokens after provider `401`.
5. The service rotates configured backup credentials after provider `403` or `429`.

Secrets must never be committed to Git.

## Docker Configuration

The Docker image reads the same environment variables as local Node execution.

For local Compose usage, create `.env` at the repository root:

```bash
cp .env.example .env
```

Docker Compose loads this file automatically:

```bash
docker compose up --build
```

For direct `docker run`, pass the file explicitly:

```bash
docker run --rm --env-file .env -p 3000:3000 data-ingestion-module
```

Do not bake credentials into the image. Provide `COPERNICUS_ACCESS_TOKEN`, `COPERNICUS_CLIENT_ID`, and `COPERNICUS_CLIENT_SECRET` through environment variables or the deployment platform secret manager.
