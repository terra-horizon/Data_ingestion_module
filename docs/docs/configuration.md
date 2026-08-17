# Configuration

The FastAPI layer does not maintain a second settings object yet. It passes the
request to the bundled collector, which reads storage and CDSE configuration
from the process environment. Copy `.env.example` to `.env` and never commit
the populated file.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATA_COLLECTION_ENV_FILE` | No | Optional explicit collector environment-file path. |
| `MONGO_URI` | Yes | Full MongoDB URI including database and, when required, `authSource`. |
| `MINIO_ENDPOINT` | Yes | MinIO S3 API URL. Use port `9000`, not the console port `9001`. |
| `MINIO_ACCESS_KEY` | Yes | MinIO application/root user for the current local stack. |
| `MINIO_SECRET_KEY` | Yes | Matching MinIO secret. |
| `MINIO_BUCKET_NAME` | Yes | Existing bucket used by the collector. |
| `MINIO_VERIFY_TLS` | No | Enables TLS certificate verification; defaults to `true`. |
| `MINIO_CA_BUNDLE` | No | Optional CA bundle path for private certificate authorities. |
| `CDSE_CLIENT_ID` | Yes | Primary CDSE OAuth client ID. |
| `CDSE_CLIENT_SECRET` | Yes | Primary CDSE OAuth client secret. |
| `CDSE_BACKUP_CLIENT_ID`, `CDSE_BACKUP_CLIENT_SECRET` | No | First backup credential pair. |
| `CDSE_BACKUP_2_*` through `CDSE_BACKUP_9_*` | No | Additional ordered backup pairs. |

The database name is taken from `MONGO_URI`; a separate `MONGO_DATABASE` value
is not used by the collector.

## Local host execution

When Uvicorn runs directly on Windows and MongoDB/MinIO publish their standard
ports to the host, endpoints may use loopback:

```env
MONGO_URI=mongodb://<user>:<url-encoded-password>@127.0.0.1:27017/terra_db?authSource=admin
MINIO_ENDPOINT=http://127.0.0.1:9000
```

## Docker execution

Inside a container, `localhost`, `127.0.0.1`, and `::1` identify the API
container itself. The application Compose file attaches to the external
`terra-network`, so use Docker DNS names and internal ports:

```env
MONGO_URI=mongodb://<user>:<url-encoded-password>@terra-mongodb:27017/terra_db?authSource=admin
MINIO_ENDPOINT=http://terra-minio:9000
```

For the provided local stack, source MongoDB and MinIO credentials from: [terra-node-stack](https://github.com/terra-horizon/terra-node-stack/blob/master/docker-files/.env_example)

## Applying changes

Compose injects `.env` when it creates a container. After environment-only
changes, recreate without rebuilding:

```bash
docker compose up -d --force-recreate
```

Use `--build` only after Dockerfile, dependency, or application-source changes.
