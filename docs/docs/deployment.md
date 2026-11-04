# Deployment

For the `coastal-uc3-sentinel2` package, local wheel installation and independent runtime
settings, see [UC3 integration](uc3-integration.md). Supply its wheel in `vendor/`
before installing the application or building its Docker image.

For the UC1 river and sea profiles, configure the `UC1_HYDRO_*` settings and static IDs described in [Configuration](configuration.md). Hydro owns its data storage.

## Local Python process

Requirements: Python 3.12+, the UC3 wheel, and the selected profile's configured dependencies.

Install and run:

```bash
python -m venv .venv
python -m pip install vendor/terra_wp2_uc3_ingestion-0.5.2-py3-none-any.whl -e ".[test]"
uvicorn app.main:app --reload
```

The API listens on `127.0.0.1:8000` by default. Swagger UI is at `/docs`.

## Docker image

The repository Dockerfile:

1. starts from `python:3.12-slim`;
2. installs CA certificates;
3. copies the FastAPI project;
4. installs the FastAPI application and UC3 wheel;
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

The remote collector and UC3 package manage their respective storage. The API does not maintain UC1 collection state or staging files.
