import os
import base64
from pathlib import Path
from typing import Any

import requests


INGESTION_SERVICE_URL = os.getenv("INGESTION_SERVICE_URL", "http://localhost:3000")


def search_scenes_via_ingestion_service(
    bbox_wgs84: list[float],
    start_date: str,
    end_date: str,
    max_cloud_pct: int,
    max_images: int,
) -> list[dict[str, Any]]:
    payload = {
        "source": "copernicus",
        "mode": "sentinel-hub-catalog",
        "collection": "sentinel-2-l2a",
        "datasetType": "catalogue",
        "format": "json",
        "responseProfile": "scene-search-compatibility",
        "requestParams": {
            "bbox": bbox_wgs84,
            "dateFrom": start_date,
            "dateTo": end_date,
            "cloudCoverageMax": max_cloud_pct,
            "limit": max_images,
            "maxImages": max_images,
        },
        "download": False,
    }

    response = requests.post(
        f"{INGESTION_SERVICE_URL.rstrip('/')}/api/ingestion/run",
        json=payload,
        timeout=90,
    )
    _raise_for_status_with_body(response)
    body: dict[str, Any] = response.json()
    if not body.get("success"):
        raise RuntimeError(body.get("message", "Ingestion service returned success=false"))
    return body["data"]


def download_scene_via_ingestion_service(
    bbox_wgs84: list[float],
    scene: dict[str, Any],
    out_tif_path: Path,
) -> None:
    payload = {
        "source": "copernicus",
        "mode": "sentinel-hub-process",
        "collection": "sentinel-2-l2a",
        "datasetType": "image",
        "format": "tiff",
        "responseProfile": "scene-download-compatibility",
        "requestParams": {
            "bbox": bbox_wgs84,
            "scene": scene,
        },
        "download": True,
    }

    response = requests.post(
        f"{INGESTION_SERVICE_URL.rstrip('/')}/api/ingestion/run",
        json=payload,
        timeout=240,
    )
    _raise_for_status_with_body(response)
    body: dict[str, Any] = response.json()
    if not body.get("success"):
        raise RuntimeError(body.get("message", "Ingestion service returned success=false"))

    image = base64.b64decode(body["data"]["dataBase64"])
    out_tif_path.parent.mkdir(parents=True, exist_ok=True)
    with out_tif_path.open("wb") as file:
        file.write(image)


def water_quality_statistics_via_ingestion_service(
    bbox_wgs84: list[float],
    start_date: str,
    end_date: str,
    max_cloud_coverage: int = 30,
) -> list[dict[str, Any]]:
    payload = {
        "source": "copernicus",
        "mode": "sentinel-hub-statistics",
        "responseProfile": "water-quality-statistics",
        "requestParams": {
            "bbox": bbox_wgs84,
            "dateFrom": start_date,
            "dateTo": end_date,
            "maxCloudCoverage": max_cloud_coverage,
            "product": "Se2WaQ",
        },
    }
    return _post_ingestion(payload, timeout=180)["data"]


def sentinel3_surface_temperature_via_ingestion_service(
    bbox_wgs84: list[float],
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    payload = {
        "source": "copernicus",
        "mode": "sentinel-hub-statistics",
        "responseProfile": "sentinel-3-surface-temperature",
        "requestParams": {
            "bbox": bbox_wgs84,
            "dateFrom": start_date,
            "dateTo": end_date,
        },
    }
    return _post_ingestion(payload, timeout=180)["data"]


def water_tile_screening_via_ingestion_service(
    tiles: list[dict[str, Any]],
    start_date: str,
    end_date: str,
    max_cloud_coverage: int = 30,
) -> list[dict[str, Any]]:
    payload = {
        "source": "copernicus",
        "mode": "sentinel-hub-statistics",
        "responseProfile": "water-tile-screening",
        "requestParams": {
            "tiles": tiles,
            "dateFrom": start_date,
            "dateTo": end_date,
            "maxCloudCoverage": max_cloud_coverage,
        },
    }
    return _post_ingestion(payload, timeout=240)["data"]


def target_date_images_via_ingestion_service(
    bbox_wgs84: list[float],
    target_date: str,
    tile_name: str,
    image_keys: list[str],
    tile_size: int = 400,
    output_format: str = "image/png",
) -> list[dict[str, Any]]:
    payload = {
        "source": "copernicus",
        "mode": "sentinel-hub-process",
        "responseProfile": "target-date-image",
        "requestParams": {
            "bbox": bbox_wgs84,
            "date": target_date,
            "tileName": tile_name,
            "tileSize": tile_size,
            "imageKeys": image_keys,
            "format": output_format,
        },
    }
    return _post_ingestion(payload, timeout=240)["data"]


def _post_ingestion(payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    response = requests.post(
        f"{INGESTION_SERVICE_URL.rstrip('/')}/api/ingestion/run",
        json=payload,
        timeout=timeout,
    )
    _raise_for_status_with_body(response)
    body: dict[str, Any] = response.json()
    if not body.get("success"):
        raise RuntimeError(body.get("message", "Ingestion service returned success=false"))
    return body


def _raise_for_status_with_body(response: requests.Response) -> None:
    if response.status_code >= 400:
        raise RuntimeError(
            f"Ingestion service returned HTTP {response.status_code}: {response.text}"
        )
