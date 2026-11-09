"""Independent UC1 satellite and Hydro Modeling workflows."""
from datetime import datetime, timezone
from hashlib import sha256
from time import monotonic, sleep
from urllib.parse import quote
from app.adapters.common import CollectorAdapterError, CollectorConfigurationError, CollectorExecutionError, CollectorUnavailableError
from app.adapters.uc1_client import Settings, UC1Client
from app.schemas.uc1 import ReanalysisResult, LocalForecastResult, IfsResult
from pydantic import ValidationError

def submit_satellite(client, config, today):
    # Stable per overall run, with the requested date prefix and distinct run IDs.
    digest = sha256(str(config["run_job_id"]).encode("utf-8")).hexdigest()[:24]
    payload = {
        "run_job_id": f"uc1.collection.water-pollutants_{today}_{digest}",
        "triggered_at": config["triggered_at"], "aoi_id": config["aoi_id"],
        "bbox": config["bbox"], 
    }
    for name in ("sensor", "mode", "history_start", "target_date", "max_days_per_run", "max_tiles_per_run", "discovery_chunk_days", "max_cloud_coverage"):
        if config.get(name) is not None:
            payload[name] = config[name]
    result = client.request("Satellite collector", "POST", "/api/collection/jobs", expected=202, payload=payload)
    if (not isinstance(result, dict) or not isinstance(result.get("job_id"), str)
            or not result["job_id"].strip() or result["job_id"] in {".", ".."}
            or any(c in result["job_id"] for c in "/\\?#")
            or result.get("status") not in {"queued", "running", "succeeded", "partial", "failed"}):
        raise CollectorExecutionError("Satellite collector returned an invalid submission.")
    for key in ("run_job_id", "aoi_id", "sensor"):
        if key in result and key in payload and result[key] != payload[key]:
            raise CollectorExecutionError("Satellite collector returned inconsistent submission metadata.")
    return result

def _validate_ingestion(result, model, area_field, area_id):
    try:
        parsed = model.model_validate(result)
    except ValidationError as exc:
        raise CollectorExecutionError("Hydro Modeling returned an invalid ingestion response.") from exc
    if getattr(parsed, area_field) != area_id or parsed.status.lower() in {"failed", "error"}:
        raise CollectorExecutionError("Hydro Modeling reported a failed or mismatched ingestion.")

def _run(config, sea):
    settings = Settings.from_env("sea" if sea else "river")
    today = datetime.now(timezone.utc).date().isoformat()
    result = {"status": "success"}
    step = "static_marine_analysis" if sea else "static_river_analysis"
    try:
        with UC1Client(settings) as client:
            if sea:
                step = "static_marine_analysis"
                response = client.request("Hydro Modeling", "GET", "/static/marine-analyses", params={"river_analysis_area_id": settings.river_id})
                result[step] = response
                if not isinstance(response, dict):
                    raise CollectorExecutionError("Hydro Modeling returned an invalid marine analysis response.")
                analyses = response.get("analyses")
                count = response.get("count")
                if (not isinstance(analyses, list) or any(not isinstance(item, dict) for item in analyses)
                        or type(count) is not int or count != len(analyses)):
                    raise CollectorExecutionError("Hydro Modeling returned an invalid marine analysis list or count.")
                matches = [item for item in analyses if item.get("marine_analysis_area_id") == settings.marine_id]
                if len(matches) != 1 or matches[0].get("river_analysis_area_id") != settings.river_id:
                    raise CollectorConfigurationError("Configured marine analysis was not found uniquely for the Sperchios river.")
                step = "ifs_ingestion"
                result[step] = client.request("Hydro Modeling", "POST", "/data-ingestion/ifs", payload={"marine_analysis_area_id": matches[0]["marine_analysis_area_id"], "action_date": today, "horizon_days": 6, "source": "ecmwf"})
                _validate_ingestion(result[step], IfsResult, "marine_analysis_area_id", settings.marine_id)
            else:
                step = "static_river_analysis"
                analysis = client.request("Hydro Modeling", "GET", "/static/river-analyses/" + quote(settings.river_id, safe=""))
                result[step] = analysis
                if not isinstance(analysis, dict) or analysis.get("analysis_area_id") != settings.river_id:
                    raise CollectorConfigurationError("Configured Sperchios river analysis was not found or did not match.")
                step = "ecmwf_reanalysis"
                result[step] = client.request("Hydro Modeling", "POST", "/data-ingestion/ecmwf/reanalysis", payload={"analysis_area_id": settings.river_id, "action_date": today})
                _validate_ingestion(result[step], ReanalysisResult, "analysis_area_id", settings.river_id)
                step = "ecmwf_local_forecast"
                result[step] = client.request("Hydro Modeling", "POST", "/data-ingestion/ecmwf/local-forecast", payload={"analysis_area_id": settings.river_id, "horizon_days": 15})
                _validate_ingestion(result[step], LocalForecastResult, "analysis_area_id", settings.river_id)
    except CollectorAdapterError as exc:
        if len(result) == 1:
            raise type(exc)(f"{step}: {exc}") from exc
        result["status"] = "partial"
        result["error"] = {"step": step, "category": type(exc).__name__, "message": str(exc)}
    return result

def run_uc1_river_adapter(config):
    return _run(config, False)

def run_uc1_sea_adapter(config):
    return _run(config, True)


def _validate_job_id(job_id):
    if (not isinstance(job_id, str) or not job_id.strip() or job_id in {".", ".."}
            or any(c in job_id for c in "/\\?#")):
        raise CollectorExecutionError("Satellite collector returned an invalid job ID.")


def _get_satellite_job(client, job_id, timeout=None, submission=None):
    _validate_job_id(job_id)
    job = client.request("Satellite collector", "GET", "/api/collection/jobs/" + quote(job_id, safe=""), timeout=timeout)
    if (not isinstance(job, dict) or job.get("job_id") != job_id
            or job.get("status") not in {"queued", "running", "succeeded", "partial", "failed"}):
        raise CollectorExecutionError("Satellite collector returned an invalid job response.")
    if submission:
        for key in ("run_job_id", "aoi_id", "sensor"):
            if key in submission and job.get(key) != submission[key]:
                raise CollectorExecutionError("Satellite collector returned inconsistent job metadata.")
    return job


def get_satellite_job(job_id):
    settings = Settings.from_env("satellite")
    with UC1Client(settings) as client:
        return _get_satellite_job(client, job_id)


def run_uc1_water_pollutants_adapter(config):
    settings = Settings.from_env("satellite")
    # Derive the date from the request so retries of the same run keep the same ID.
    trigger_date = datetime.fromisoformat(str(config["triggered_at"]).replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
    with UC1Client(settings) as client:
        submission = submit_satellite(client, config, trigger_date)
        latest = submission
        deadline = monotonic() + settings.max_wait
        result = {"status": "pending", "satellite_submission": submission, "satellite_collection": latest}
        statuses = {"succeeded": "success", "partial": "partial", "failed": "failed"}
        transient_failures = 0
        while True:
            remaining = deadline - monotonic()
            if remaining <= 0:
                result["reason"] = "poll_timeout"
                return result
            try:
                job = _get_satellite_job(client, submission["job_id"], timeout=min(remaining, settings.read_timeout), submission=submission)
                transient_failures = 0
                result["satellite_collection"] = job
                status = job["status"]
                if status in statuses:
                    result["status"] = statuses[status]
                    return result
            except CollectorAdapterError as exc:
                if isinstance(exc, CollectorUnavailableError):
                    transient_failures += 1
                    if transient_failures < 3:
                        remaining = deadline - monotonic()
                        if remaining > 0:
                            sleep(min(settings.poll_interval, remaining))
                        continue
                result["reason"] = "poll_error"
                result["error"] = {"step": "satellite_poll", "category": type(exc).__name__, "message": str(exc)}
                return result
            remaining = deadline - monotonic()
            if remaining > 0:
                sleep(min(settings.poll_interval, remaining))
