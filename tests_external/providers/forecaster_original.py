import base64
import os
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any


DEFAULT_FORECASTER_REPO = Path(r"C:\tmp\uc1.forecaster.uth.alpha")


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

    _mirror_copernicus_env_to_cdse()


def _mirror_copernicus_env_to_cdse() -> None:
    mappings = {
        "COPERNICUS_CLIENT_ID": "CDSE_CLIENT_ID",
        "COPERNICUS_CLIENT_SECRET": "CDSE_CLIENT_SECRET",
        "COPERNICUS_TOKEN_URL": "CDSE_TOKEN_URL",
        "COPERNICUS_SH_PROCESS_URL": "CDSE_SH_PROCESS_URL",
    }
    for source, target in mappings.items():
        if os.getenv(source) and not os.getenv(target):
            os.environ[target] = os.environ[source]


def forecaster_repo_path() -> Path:
    return Path(os.getenv("FORECASTER_REPO_PATH", str(DEFAULT_FORECASTER_REPO))).resolve()


def ensure_forecaster_import_path() -> Path:
    repo_path = forecaster_repo_path()
    if not repo_path.exists():
        raise RuntimeError(
            f"Forecaster repository not found at {repo_path}. "
            "Set FORECASTER_REPO_PATH to a local clone of terra-horizon/uc1.forecaster.uth.alpha."
        )

    repo_text = str(repo_path)
    if repo_text not in sys.path:
      sys.path.insert(0, repo_text)
    return repo_path


@contextmanager
def temporary_cwd(path: Path):
    original = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(original)


def water_quality_statistics_original(
    bbox_wgs84: list[float],
    start_date: str,
    end_date: str,
    max_cloud_coverage: int = 30,
) -> list[dict[str, Any]]:
    repo_path = ensure_forecaster_import_path()
    with temporary_cwd(repo_path):
        from forecaster.data.collectors.sentinel2 import StatisticalCollection

        collector = StatisticalCollection(
            time_interval=(start_date, end_date),
            bbox=bbox_wgs84,
            dir=str(Path(tempfile.mkdtemp(prefix="forecaster_s2_"))),
            max_cloud_coverage=max_cloud_coverage,
        )
        response = collector.get_request(collector.evalscripts["Se2WaQ"], [start_date, end_date], bbox_wgs84)
        if response is None:
            raise RuntimeError("Original forecaster Sentinel-2 statistics returned no response")
        response.raise_for_status()
        return _normalize_original_water_quality(collector.compute_values(response.json()))


def sentinel3_surface_temperature_original(
    bbox_wgs84: list[float],
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    repo_path = ensure_forecaster_import_path()
    with temporary_cwd(repo_path):
        from forecaster.data.collectors.sentinel3 import Sentinel3Collection

        collector = Sentinel3Collection(
            time_interval=(start_date, end_date),
            bbox=bbox_wgs84,
            dir=str(Path(tempfile.mkdtemp(prefix="forecaster_s3_"))),
        )
        response = collector.get_request(collector.evalscript, [start_date, end_date], bbox_wgs84)
        if response is None:
            raise RuntimeError("Original forecaster Sentinel-3 statistics returned no response")
        response.raise_for_status()
        return _normalize_original_sentinel3(collector.compute_values(response.json()))


def water_tile_screening_original(
    tiles: list[dict[str, Any]],
    start_date: str,
    end_date: str,
    max_cloud_coverage: int = 30,
) -> list[dict[str, Any]]:
    repo_path = ensure_forecaster_import_path()
    with temporary_cwd(repo_path):
        from forecaster.water_tile_selector import WaterTileSelector, TileConfig

        selector = WaterTileSelector(
            geojson_path="unused.geojson",
            water_check_interval=(start_date, end_date),
            reference_last_n=0,
            max_cloud_coverage=max_cloud_coverage,
        )
        results = []
        for index, tile in enumerate(tiles):
            tile_config = TileConfig(
                name=str(tile.get("name", f"tile_{index}")),
                bbox=list(tile["bbox"]),
            )
            scenes = selector._query_tile(tile_config)
            score = selector._score_tile(scenes)
            results.append({
                "tileName": tile_config.name,
                "bbox": tile_config.bbox,
                "selected": score > 0,
                "score": score,
                "scenes": [
                    {
                        "date": scene["date"],
                        "validPixels": scene["valid_pixels"],
                        "sampleCount": scene["sample_count"],
                        "noDataCount": scene["no_data_count"],
                        "waterPct": scene["water_pct"],
                        "cloudPct": scene["cloud_pct"],
                    }
                    for scene in scenes
                ],
            })
        return results


def target_date_images_original(
    bbox_wgs84: list[float],
    target_date: str,
    tile_name: str,
    image_keys: list[str],
    tile_size: int = 400,
) -> list[dict[str, Any]]:
    repo_path = ensure_forecaster_import_path()
    with temporary_cwd(repo_path):
        from forecaster.data.collectors.sentinel2 import ImageCollection

        output_root = Path(tempfile.mkdtemp(prefix="forecaster_images_"))
        collector = ImageCollection(
            bbox=bbox_wgs84,
            dir=str(output_root),
            tile_name=tile_name,
            tile_size=tile_size,
            time_from=f"{target_date}T00:00:00Z",
            time_to=f"{target_date}T23:59:59Z",
        )
        records = collector.run(image_keys)
        normalized = []
        for image_key in image_keys:
            record = records[image_key]
            path = record.get("path")
            data = Path(path).read_bytes() if path else b""
            normalized.append({
                "imageKey": image_key,
                "status": record.get("status"),
                "contentType": "image/png",
                "dataBase64": base64.b64encode(data).decode("ascii") if data else "",
                "sizeBytes": len(data),
                "requestedDate": record.get("requested_date"),
                "actualDate": record.get("actual_date"),
                "collection": record.get("collection"),
            })
        return normalized


def _normalize_original_water_quality(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for record in records:
        for date_text, stats in record.items():
            normalized.append({
                "date": _date_to_iso(date_text),
                "metrics": stats["mean"],
            })
    return sorted(normalized, key=lambda item: item["date"])


def _normalize_original_sentinel3(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for record in records:
        for date_text, stats in record.items():
            normalized.append({
                "date": _date_to_iso(date_text),
                "metrics": stats["mean"],
            })
    return sorted(normalized, key=lambda item: item["date"])


def _date_to_iso(date_text: str) -> str:
    parts = date_text.split("-")
    if len(parts) == 3 and len(parts[0]) == 2:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return date_text
