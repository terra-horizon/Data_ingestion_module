# Deployment

## Local Python process

Requirements:

- Python 3.12+
- reachable MongoDB and MinIO
- an existing MinIO bucket
- valid CDSE client credentials

Install and run:

```bash
python -m venv .venv
python -m pip install -e app/packages/collector
python -m pip install -e ".[test]"
uvicorn app.main:app --reload
```

The API listens on `127.0.0.1:8000` by default. Swagger UI is at `/docs`.

## Docker image

The repository Dockerfile:

1. starts from `python:3.12-slim`;
2. copies the FastAPI project and bundled collector;
3. installs the collector from `app/packages/collector`;
4. installs the FastAPI application;
5. starts Uvicorn on `0.0.0.0:8000`.

Build directly:

```bash
docker build -t data-ingestion-module:local .
```

## Docker Compose

The application Compose file deploys only the API. MongoDB and MinIO remain
owned by the separately supplied TERRA node stack.

Expected resources:

```text
terra-network
  - terra-mongodb:27017
  - terra-minio:9000
  - data-ingestion-module:8000
```

Start the node stack first, then run:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f data-ingestion-module
```

Stop only the API container with:

```bash
docker compose down
```

Because `terra-network` is external, bringing down this Compose project does
not remove MongoDB, MinIO, or their network.

## Persistent data

MongoDB and MinIO are the durable stores. The current API Compose service does
not mount `outputs/` as a volume, so local collector staging files disappear
when its container is replaced. On the next run, the collector hydrates remote
observations, collection state, and tile artifacts before calculating work.

The collector's CDSE discovery cache is local and is not restored from remote
storage. It is recreated only when a discovery window actually runs.