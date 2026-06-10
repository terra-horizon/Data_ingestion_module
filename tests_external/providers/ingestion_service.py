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
    response.raise_for_status()
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
    response.raise_for_status()
    body: dict[str, Any] = response.json()
    if not body.get("success"):
        raise RuntimeError(body.get("message", "Ingestion service returned success=false"))

    image = base64.b64decode(body["data"]["dataBase64"])
    out_tif_path.parent.mkdir(parents=True, exist_ok=True)
    with out_tif_path.open("wb") as file:
        file.write(image)
