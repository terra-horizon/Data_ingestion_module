FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY vendor/terra_wp2_uc3_ingestion-0.5.2-py3-none-any.whl /tmp/uc3/
COPY pyproject.toml README.md ./
COPY app ./app
RUN python -m pip install --no-cache-dir /tmp/uc3/terra_wp2_uc3_ingestion-0.5.2-py3-none-any.whl . \
    && rm -rf /tmp/uc3

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
