# Deployment

This deployment guide applies to the **alpha stateless version** of the Data Ingestion Module.

The service runs as a standard Node.js HTTP process.

It currently has no database, queue, or filesystem storage dependency because persistence and workflow state are outside the alpha scope.

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Start the API:

```bash
npm run dev
```

The default server URL is:

```text
http://localhost:3000
```

## Health Check

Use:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "success": true,
  "service": "data-ingestion-service",
  "status": "ok",
  "mode": "stateless"
}
```

## Local Docker Run

Build the image from the repository root:

```bash
docker build -t data-ingestion-module .
```

Run the container with environment variables from `.env`:

```bash
docker run --rm --name data-ingestion-module --env-file .env -p 3000:3000 data-ingestion-module
```

Check health:

```bash
curl http://localhost:3000/api/health
```

## Docker Compose Run

Start the service:

```bash
docker compose up --build
```

Run in the background:

```bash
docker compose up --build -d
```

Stop the service:

```bash
docker compose down
```

The Compose file loads `.env`, maps `${PORT:-3000}`, and defines a health check against `/api/health`.

## Production Deployment Notes

Required runtime inputs:

- `PORT`
- `REQUEST_TIMEOUT_MS`
- Copernicus endpoint URLs
- `COPERNICUS_ACCESS_TOKEN` or `COPERNICUS_CLIENT_ID` plus `COPERNICUS_CLIENT_SECRET` for authenticated Sentinel Hub modes

Operational notes:

- expose the configured `PORT`
- use `/api/health` for health checks
- inspect logs with the container platform logs command, for example `docker logs data-ingestion-module`
- scale horizontally by running more container instances behind a load balancer
- keep provider credentials in platform secrets or environment variables
- do not add database, queue, or storage containers unless the architecture changes