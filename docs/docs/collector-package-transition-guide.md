# Transitioning Team Collection Logic into Independent Collector Packages

## Purpose

This guide explains how a collaborating team should move its existing data-collection requests and processing code into an independently installable collector package that is invoked by the Data Ingestion Module. 

The intended end state is that the Data Ingestion Module becomes the entry point for data acquisition. When data is required, it triggers the appropriate collector package, which retrieves and processes the required source data and stores all information and artifacts needed by the downstream workflows in the TERRA persistence layer.

The target execution flow is:
```text
Request data 
    -> Trigger Data Ingestion Module 
    -> Run collector package 
        -> Store required data in TERRA database/storage 
    -> Workflow requests persisted data from TERRA databases
    -> Workflow executes
```

This represents a transition away from workflows directly retrieving and processing external data on demand. Instead, data acquisition and persistence are handled by the ingestion layer, while downstream workflows consume the already-ingested and stored data they require.

In practice, the responsibilities become:

```text
Collector package -> acquire and prepare source data

Data Ingestion Module -> orchestrate collection and persistence

TERRA database/storage -> provide the persisted source of truth

Workflow -> retrieve required persisted data and execute its domain-specific processing
```

The collector package should therefore persist all data, metadata, references, and artifacts necessary for the corresponding workflow to operate without needing to repeat the original external data-acquisition process.

A more in deapth target separation is:

```text
External caller
  -> Data Ingestion Module HTTP endpoint
  -> validated ingestion profile
  -> application adapter
  -> independently installed collector package
    -> external provider requests
    -> normalization and validation
    -> MongoDB and MinIO persistence
    -> structured collection result
  -> ingestion HTTP response
```

The ingestion application should not contain provider API calls, provider credentials, response parsing, domain transformations, or collector persistence logic. Those responsibilities belong in the independent package. The ingestion application validates and routes requests, invokes the package, and translates its result or exceptions into an HTTP response.

The current reference implementation is `app/packages/collector`, installed as the Python distribution `terra-data-collection` and imported as `data_collection`.

**Important Note on Architecture:** We are temporarily starting with direct package installations. The long-term plan is to migrate to containerized execution via GHCR, where teams publish container images for their packages and the ingestion service dynamically pulls and executes them on demand.

## 1. How the ingestion module calls the current collector

The external entry point is:

```http
POST /api/ingestion/run
Content-Type: application/json
```

A representative request is:

```json
{
  "run_job_id": "job-sperchios-20260831-001",
  "triggered_at": "2026-08-31T10:00:00+03:00",
  "provider": "sentinel-2",
  "profile": "forecaster-collector",
  "aoi_id": "sperchios",
  "bbox": [22.433493, 38.837552, 22.569555, 38.894223],
  "run_name": "sperchios",
  "history_start": "2016-01-01",
  "target_date": "2026-08-31",
  "mode": "auto",
  "max_days_per_run": 1
}
```

The current call chain is:

```text
app/api/routes/ingestion.py
  -> execute_ingestion_profile(request)
  -> PROFILE_RUNNERS[request.profile]
  -> run_sentinel_ingestion(config)
  -> data_collection.collect(CollectionRequest(...))
  -> CollectionResult.to_dict()
```

### HTTP validation

`app/schemas/ingestion.py` defines `IngestionRunRequest`. FastAPI/Pydantic validates the external request before any collector code runs.

The current schema accepts only:

```text
provider = "sentinel-2"
profile  = "forecaster-collector"
```

Therefore, a new team package is not automatically callable just because its directory exists under `app/packages`. The application must explicitly approve its provider/profile and register an adapter.

### Profile selection

`app/services/ingestion.py` contains the server-controlled registry:

```python
PROFILE_RUNNERS = {
    "forecaster-collector": run_sentinel_ingestion,
}
```

The caller selects an approved profile name. It cannot supply a Python module, function name, shell command, or arbitrary import path.

The service converts the validated Pydantic request into JSON-compatible data and runs the synchronous adapter in a thread pool:

```python
async def execute_ingestion_profile(request: IngestionRunRequest) -> dict[str, Any]:
    runner = PROFILE_RUNNERS[request.profile]
    config = request.model_dump(mode="json", exclude_none=True)
    return await run_in_threadpool(runner, config)
```

This keeps long-running provider and storage work off the FastAPI event loop.

### Application adapter

`app/adapters/collector.py` is the boundary between the ingestion application and the independent package. Its essential behavior is:

```python
from data_collection import CollectionRequest, collect


def run_sentinel_ingestion(config: Mapping[str, Any]) -> dict[str, Any]:
    request = CollectionRequest(
        aoi_id=str(config["aoi_id"]),
        aoi_bbox=list(config["bbox"]),
        run_name=str(config["run_name"]),
        output_root=Path("outputs"),
        history_start=str(config.get("history_start", "2016-01-01")),
        target_date=str(config.get("target_date") or current_utc_date()),
        mode=str(config.get("mode", "auto")),
        max_days_per_run=config.get("max_days_per_run"),
        max_tiles_per_run=config.get("max_tiles_per_run"),
        publish=True,
    )
    result = collect(request)
    return result.to_dict()
```

The adapter also:

- prevents concurrent collection for the same `aoi_id` within the API process;
- maps collector configuration errors to controlled application errors;
- maps MongoDB/MinIO connection failures to service-unavailable errors;
- hides internal tracebacks from HTTP clients;
- preserves a collector result with `status="partial"` as a valid HTTP response.

### Package entry point

The package exports this interface from `data_collection/__init__.py`:

```python
from .models import CollectionRequest, CollectionResult
from .service import CollectionService, collect

__all__ = ["CollectionRequest", "CollectionResult", "CollectionService", "collect"]
```

The application uses only:

```python
def collect(request: CollectionRequest) -> CollectionResult:
    ...
```

The application does not call the provider directly and does not interpret raw provider responses.

## 2. Target architecture for each collaborating team

Each team should deliver a separately installable package with a unique Python import namespace.

Example:

```text
app/packages/<team-collector>/
├── pyproject.toml
├── README.md
├── DATA_CONTRACT.md
├── <team_collection>/
│   ├── __init__.py
│   ├── models.py
│   ├── service.py
│   ├── provider.py
│   ├── normalization.py
│   ├── validation.py
│   ├── remote_storage.py
│   └── schemas/
│       ├── collection-result.schema.json
│       └── observation.schema.json
└── tests/
    ├── test_service.py
    ├── test_provider.py
    └── test_remote_storage.py
```

The package should expose:

```python
from <team_collection> import CollectionRequest, CollectionResult, collect
```

with:

```python
def collect(request: CollectionRequest) -> CollectionResult:
    ...
```

The exact import name for a new team package is not defined by the current collector contract. It must be unique and agreed during integration. A side-by-side collector should not also claim the `data_collection` namespace.

## 3. Moving existing collection requests into the package

The most important transition is to move provider communication out of the ingestion application or team-specific wrapper scripts and behind the package's `collect()` entry point.

### Before transition

A team may currently have logic similar to:

```text
HTTP/controller/scheduler
  -> build provider URL and headers
  -> send request
  -> parse provider response
  -> transform values
  -> write files or database rows
```

This tightly couples the external provider to the caller.

### After transition

The desired ownership is:

```text
Ingestion adapter
  -> build typed CollectionRequest
  -> team_collection.collect(request)

Team package
  -> provider discovery/request construction
  -> authentication and retry policy
  -> provider response parsing
  -> normalization and validation
  -> idempotent persistence
  -> CollectionResult
```

### Step 1: inventory the existing request

For every existing provider request, document:

- provider endpoint;
- HTTP method;
- authentication mechanism;
- required identifiers;
- spatial inputs;
- time interval inputs;
- pagination;
- rate limits and retry rules;
- response format;
- how genuine no-data is represented;
- how transient provider failure is represented;
- output files or database writes;
- current duplicate-prevention logic.

Do not expose secrets, tokens, provider headers, or provider-specific response structures in the ingestion HTTP API unless they are genuinely caller-controlled business inputs.

### Step 2: define the typed package request

Convert caller-controlled business inputs into a dataclass or equivalent typed model.

Example:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class CollectionRequest:
    dataset_id: str
    run_name: str
    start_date: str
    target_date: str
    mode: str = "auto"
    max_units_per_run: int | None = None

    def __post_init__(self) -> None:
        if self.mode not in {"auto", "backfill", "incremental"}:
            raise ValueError("Unsupported collection mode")
        if self.max_units_per_run is not None and self.max_units_per_run < 1:
            raise ValueError("max_units_per_run must be positive")
```

Use names appropriate to the team's domain. AOI bounding boxes and tiles are required only when the source/domain actually uses them.

The package request must not contain:

- MongoDB passwords;
- MinIO secrets;
- provider client secrets;
- access tokens;
- arbitrary executable code;
- arbitrary module or function paths.

### Step 3: isolate provider communication

Move all provider-specific request construction and response parsing into a provider client.

```python
class ProviderClient:
    @classmethod
    def from_env(cls) -> "ProviderClient":
        ...

    def discover(self, start_date: str, end_date: str) -> list[SourceUnit]:
        ...

    def fetch(self, source_unit: SourceUnit) -> ProviderResponse:
        ...
```

This layer owns:

- API URLs;
- provider authentication;
- request payloads and headers;
- pagination;
- provider timeouts;
- bounded retries;
- rate-limit handling;
- provider response decoding.

It should return structured Python values to the service, not write directly into FastAPI responses.

### Step 4: add a collection service

The service coordinates the complete run:

```python
def collect(request: CollectionRequest) -> CollectionResult:
    store = CollectorStore.from_env(dataset_id=request.dataset_id)
    provider = ProviderClient.from_env()
    run_id = create_run_id()

    store.initialize()
    try:
        store.record_run(run_id, status="running", request=request)

        discovered = provider.discover(
            start_date=request.start_date,
            end_date=request.target_date,
        )
        pending = store.find_missing_units(discovered)

        if request.max_units_per_run is not None:
            pending = pending[:request.max_units_per_run]

        collected = []
        failed = []

        for source_unit in pending:
            try:
                raw = provider.fetch(source_unit)
                normalized = normalize_and_validate(raw, source_unit)
                artifact = store.publish_canonical(normalized)
                store.upsert_observation(
                    normalized,
                    artifact=artifact,
                    run_id=run_id,
                )
                collected.append(source_unit.id)
            except RetryableProviderError as exc:
                failed.append({
                    "unit_id": source_unit.id,
                    "retryable": True,
                    "code": exc.code,
                    "message": str(exc),
                })

        result = CollectionResult(
            status="partial" if failed else "success",
            run_id=run_id,
            run_summary=build_summary(collected, failed),
            discovered_units=[unit.id for unit in discovered],
            collected_units=collected,
            failed_units=failed,
        )
        store.record_run(run_id, status=result.status, result=result)
        return result
    except Exception as exc:
        store.record_failed_run(run_id, exc)
        raise
    finally:
        store.close()
```

The example illustrates the architecture only. Provider-specific discovery, units, transformations, and schemas remain team-owned.

### Step 5: distinguish failure from genuine no data

The package must make this distinction explicit:

```text
Timeout, authentication error, rate limit, provider 5xx
  -> retryable failed unit
  -> do not write a terminal no-data observation

Valid provider response proving no data exists
  -> terminal unavailable/no-data observation
  -> may be persisted idempotently
```

Do not convert request failure into zeros, empty measurements, or a successful observation. Missing numeric values must be JSON `null`, not `NaN` or infinity.

### Step 6: make writes idempotent

Define a stable logical identity for every collected record.

The reference observation identity is:

```text
aoi_id + tile_id + observation_date
```

Another domain may use:

```text
dataset_id + station_id + observation_timestamp
```

or another documented compound key. The exact identity for another domain is not defined by the current collector contract, but it must be stable and must prevent duplicates when a run is retried.

## 4. Package output returned to ingestion

The package should return orchestration metadata, not the complete collected dataset.

A common result model should contain at least:

```python
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class CollectionResult:
    status: str
    run_id: str
    run_summary: str
    discovered_units: list[str] = field(default_factory=list)
    collected_units: list[str] = field(default_factory=list)
    failed_units: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
```

Status meanings should be explicit:

| Status | Meaning |
|---|---|
| `success` | Invocation completed without retryable failed units |
| `partial` | Some work completed, but one or more units remain retryable |
| `dry_run` | Planning/discovery completed without persistence, if supported |

The result may include diagnostic local paths, but local paths are container-specific implementation details. Durable consumers should use MongoDB identifiers and MinIO artifact references.

The reference API wraps the package result in:

```json
{
  "run_job_id": "caller-owned-job-id",
  "provider": "approved-provider",
  "profile": "approved-profile",
  "aoi_id": "stable-dataset-id",
  "triggered_at": "2026-08-31T10:00:00+03:00",
  "started_at": "2026-08-31T07:00:01Z",
  "completed_at": "2026-08-31T07:01:15Z",
  "duration_ms": 74000,
  "status": "partial",
  "collector_result": {
    "status": "partial",
    "run_id": "collector-run-...",
    "run_summary": "80 units persisted; 2 remain retryable",
    "discovered_units": ["..."],
    "collected_units": ["..."],
    "failed_units": [
      {
        "unit_id": "...",
        "retryable": true,
        "code": "PROVIDER_REQUEST_FAILED",
        "message": "Provider request failed"
      }
    ],
    "artifacts": [],
    "warnings": []
  }
}
```

## 5. Persistence ownership

In the current architecture, the collector package owns MongoDB and MinIO persistence. The ingestion application does not expose a shared persistence service to collector packages.

Until a shared abstraction is introduced, a team package must either:

1. implement its persistence inside the package following the established conventions; or
2. use an explicitly approved shared library if one is introduced later.

Teams must not assume the ingestion route will persist returned domain records.

### MongoDB responsibilities

Use MongoDB for queryable records and current state, such as:

- normalized observations;
- stable collection units or geometry definitions;
- incremental checkpoints;
- pipeline run lifecycle and result metadata.

The reference collections are:

```text
observations
tiles
collection_state
pipeline_runs
```

These exact names are mandatory only when producing the existing UC1 collector/forecaster contract. Collection names for unrelated domains require agreement with the consuming application.

Each document should preserve:

- stable dataset/AOI identifier;
- stable domain-record identifier;
- collector run ID;
- schema version;
- creation and update timestamps;
- provider provenance;
- MinIO artifact reference, when applicable.

Use UTC ISO timestamps and preserve `created_at` during upsert while updating `updated_at`.

### MinIO responsibilities

Use MinIO/S3 for canonical JSON, GeoJSON, large source-derived artifacts, manifests, and run logs.

The reference namespace is:

```text
terra-uc1/<aoi_id>/aoi/...
terra-uc1/<aoi_id>/observations/...
terra-uc1/<aoi_id>/runs/<run_id>/...
```

A different domain should receive an agreed namespace rather than placing unrelated records under `terra-uc1`.

### MongoDB-to-MinIO reference

MongoDB documents should reference their corresponding MinIO object explicitly:

```json
{
  "artifact": {
    "bucket": "terra-data",
    "key": "<namespace>/<dataset-id>/observations/<unit-id>.json",
    "sha256": "<64-character SHA-256>",
    "content_type": "application/json"
  }
}
```

Use stable object keys and SHA-256 checksums. Before uploading a stable object, compare its checksum with the existing object metadata where possible. MongoDB writes should use stable selectors and `upsert=True` semantics.

### Run lifecycle

The package should:

1. generate a unique collector `run_id`;
2. write `pipeline_runs.status="running"` before collection;
3. collect and publish data;
4. update the same run to `success` or `partial`;
5. attempt to update it to `failed` when an unexpected exception occurs and MongoDB remains reachable.

The caller-owned `run_job_id` and collector-generated `run_id` are different identifiers and should not be conflated.

## 6. Adding a new package to the ingestion application

### Step 1: install the package

The root application currently installs the reference package explicitly:

```dockerfile
RUN python -m pip install --no-cache-dir ./app/packages/collector .
```

Add the new package to the image build, for example:

```dockerfile
RUN python -m pip install --no-cache-dir \
    ./app/packages/collector \
    ./app/packages/<team-collector> \
    .
```

The package must support the application's Python 3.12 runtime and must declare all dependencies in its own `pyproject.toml`.

### Step 2: define validated HTTP input

If the new collector uses the same existing request fields, extend the approved `provider` and `profile` literal values.

If it requires materially different inputs, add a provider/profile-specific validated Pydantic request model or discriminated union. Do not replace validation with an unrestricted `dict[str, Any]` payload.

The current application does not yet define this generic multi-provider schema. It must be designed as part of onboarding the first collector whose inputs do not fit `IngestionRunRequest`.

### Step 3: add an adapter

Create an application adapter that imports the package and maps validated HTTP fields into its typed request:

```python
from pathlib import Path
from typing import Any, Mapping

from team_collection import CollectionRequest, collect


def run_team_ingestion(config: Mapping[str, Any]) -> dict[str, Any]:
    request = CollectionRequest(
        dataset_id=str(config["dataset_id"]),
        run_name=str(config["run_name"]),
        start_date=str(config["start_date"]),
        target_date=str(config["target_date"]),
        max_units_per_run=config.get("max_units_per_run"),
    )
    result = collect(request)
    return result.to_dict()
```

The adapter may translate application vocabulary into package vocabulary, but it must not contain:

- external provider requests;
- authentication logic;
- provider response parsing;
- domain calculations;
- MongoDB observation writes;
- MinIO object uploads.

### Step 4: register the profile

Register the adapter in the server-controlled registry:

```python
PROFILE_RUNNERS = {
    "forecaster-collector": run_sentinel_ingestion,
    "team-collector": run_team_ingestion,
}
```

Also add the profile/provider to the validated schema. Registration must be explicit; package discovery by filesystem scanning is not part of the current architecture.

### Step 5: map exceptions

The adapter should translate package-specific exceptions into the application's controlled categories:

```text
invalid package configuration -> HTTP 400
same dataset already running  -> HTTP 409
MongoDB/MinIO unavailable      -> HTTP 503
unexpected execution failure  -> HTTP 500 without traceback
partial collection result      -> HTTP 200 with status="partial"
```

Provider failures affecting individual units should normally be reported in `failed_units`, not raised as an application-wide exception when the run can safely continue.

## 7. Configuration and secrets

Provider and storage configuration must be supplied through environment variables or an approved secret manager.

Each package should document:

- required provider URL/configuration;
- provider client ID/secret or API key;
- optional fallback credentials;
- MongoDB URI requirements;
- MinIO endpoint, bucket, access key and secret;
- TLS verification and custom CA configuration.

Secrets must never be:

- hardcoded in source;
- committed in `.env` files;
- included in HTTP requests;
- written into collection results;
- persisted in pipeline metadata;
- printed in logs.

Prefer environment variables injected by Docker/Kubernetes. The reference package's local `.env` search is useful for standalone development, but production packages should not override already injected environment variables.

## 8. Logging and error behavior

Use structured logs containing:

```text
timestamp
level
collector/component
run_id
dataset_id or aoi_id
phase
unit_id when applicable
message
```

Required failure behavior:

| Situation | Package behavior |
|---|---|
| Provider timeout/network error | Bounded retry, then retryable failed unit |
| Authentication failure | Bounded credential handling; never log secrets |
| Rate limit | Respect `Retry-After` where available and use bounded backoff |
| Provider 5xx | Retryable failure unless provider contract states otherwise |
| Invalid response | Validation/parsing failure; do not fabricate values |
| Genuine no data | Terminal no-data record using null values |
| MongoDB/MinIO preflight failure | Fail before expensive collection work |
| Duplicate data | Idempotent update/no-op |
| Unexpected exception | Record failed run where possible, close clients, re-raise |

Do not copy the reference mixture of `print()` and JSONL logging. New packages should route provider and service messages through one structured logging system.

## 9. Minimum package tests

Before delivery, each package should provide tests for:

- public `CollectionRequest`, `CollectionResult`, and `collect` imports;
- request validation;
- first successful collection;
- normalization and schema validation;
- incremental rerun without duplicates;
- stable MongoDB upsert selectors;
- MinIO key generation and checksum metadata;
- provider pagination, timeout and invalid response behavior;
- retryable failure followed by successful resume;
- genuine no-data handling with JSON nulls;
- partial result reporting;
- pipeline run lifecycle;
- storage-client cleanup;
- credential redaction;
- adapter mapping from HTTP request to package request;
- controlled HTTP error responses;
- successful installation and import in the Python 3.12 application image.

Tests should use fake provider and storage implementations. Live-provider tests should be opt-in and use non-production credentials.

## 10. Transition checklist for collaborating teams

### Extract the collector

- [ ] Existing provider requests are inventoried.
- [ ] Provider calls have been removed from controllers, routes and schedulers.
- [ ] An independently installable package exists.
- [ ] The package has a unique Python import namespace.
- [ ] `CollectionRequest`, `CollectionResult`, and `collect()` are public.
- [ ] Provider communication is isolated behind a client/service.
- [ ] Normalization and validation occur inside the package.
- [ ] Retryable failure and genuine no data are distinct.
- [ ] Stable record identities are documented.

### Persistence

- [ ] MongoDB collections and unique keys are agreed.
- [ ] MinIO namespace and object keys are agreed.
- [ ] MongoDB documents reference MinIO artifacts.
- [ ] References include bucket, key, SHA-256 and content type.
- [ ] Upserts and uploads are idempotent.
- [ ] Pipeline run lifecycle is persisted.
- [ ] Local files are treated as staging, not durable external contracts.

### Ingestion integration

- [ ] Package is installed by the root image.
- [ ] HTTP input is validated by Pydantic.
- [ ] An application adapter constructs the package request.
- [ ] Provider/profile is explicitly registered.
- [ ] Collector runs in the thread pool.
- [ ] Adapter exceptions map to controlled HTTP errors.
- [ ] Partial results remain HTTP-successful structured responses.

### Security and quality

- [ ] No credentials are hardcoded.
- [ ] Secrets are not logged, returned or persisted.
- [ ] Dependencies are declared in `pyproject.toml`.
- [ ] Package runs under Python 3.12.
- [ ] Tests do not require live services by default.
- [ ] README and data contract document the delivered behavior.

## 11. Current-contract limitations teams must know

The following are not generic capabilities of the current application and require explicit integration work:

- automatic discovery of packages placed under `app/packages`;
- arbitrary provider/profile registration by the caller;
- a shared application-level collector interface or abstract base class;
- a shared application-level MongoDB/MinIO persistence service;
- a generic multi-provider HTTP request schema;
- common domain-record fields for sources that are not UC1 observations;
- common MongoDB collection names for unrelated domains;
- common MinIO namespaces for unrelated domains;
- generic scheduling or late-arriving-data policy.

These items are **not defined by the current collector contract**. Teams should not invent incompatible solutions independently; they should agree them with the ingestion-module maintainers during package onboarding.

## 12. Rules that are mandatory versus recommended

### Mandatory for integration

- Deliver an installable package, not loose scripts copied into the ingestion application.
- Expose a typed request, structured result, and one callable collection entry point.
- Add a server-side adapter and explicit profile/provider registration.
- Keep provider requests and business transformations inside the package.
- Validate inputs and normalized records.
- Distinguish retryable failures from genuine no data.
- Define stable identifiers and idempotent persistence.
- Use MongoDB/MinIO according to an agreed data contract.
- Return status/references rather than complete provider payloads.
- Supply configuration through environment variables or an approved secret manager.
- Declare dependencies and support the hosting runtime.
- Provide automated tests.

### Recommended implementation patterns

- Match the reference separation into models, service, provider, validation and storage modules.
- Use dependency injection for provider and storage clients.
- Ship JSON Schemas as package data.
- Maintain local staging artifacts for recovery and diagnosis.
- Use deterministic JSON and SHA-256 checksums.
- Keep a resumable collection checkpoint.
- Provide a standalone CLI and optional standalone container.
- Use structured logging throughout.
- Store the effective request and package/schema version with every pipeline run.

### Reference-specific behavior not to copy blindly

- Sentinel-specific STAC calls and evalscripts;
- river extraction and tile generation;
- UC1 water-quality metric names;
- the `terra-uc1` namespace for unrelated domains;
- unused Sentinel-3/image collector classes;
- mutable defaults such as `bbox=[]`;
- direct `print()` logging;
- ambiguous use of `collected` for terminal unavailable records;
- strict non-overlapping discovery without a late-arrival lookback policy;
- returning operating-system-specific local paths as durable references.

