import os
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests


CDSE_TOKEN_URL = os.getenv(
    "COPERNICUS_TOKEN_URL",
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
)
CDSE_CATALOG_URL = os.getenv(
    "COPERNICUS_SH_CATALOG_URL",
    "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search",
)
CDSE_PROCESS_URL = os.getenv(
    "COPERNICUS_SH_PROCESS_URL",
    "https://sh.dataspace.copernicus.eu/api/v1/process",
)


def get_cdse_access_token() -> str:
    access_token = os.getenv("COPERNICUS_ACCESS_TOKEN")
    if access_token:
        return access_token

    client_id = os.getenv("COPERNICUS_CLIENT_ID")
    client_secret = os.getenv("COPERNICUS_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError(
            "Set COPERNICUS_ACCESS_TOKEN or COPERNICUS_CLIENT_ID/COPERNICUS_CLIENT_SECRET"
        )

    response = requests.post(
        CDSE_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=60,
    )
    response.raise_for_status()
    token = response.json().get("access_token")
    if not token:
        raise RuntimeError("CDSE token response did not include access_token")
    return token


def _try_parse_iso(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def _scene_time_window(scene_datetime: str) -> tuple[str, str]:
    dt = _try_parse_iso(scene_datetime)
    start = (dt - timedelta(hours=12)).astimezone(timezone.utc)
    end = (dt + timedelta(hours=12)).astimezone(timezone.utc)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z")


def _bbox_dimensions_for_10m(bbox_wgs84: list[float]) -> tuple[int, int]:
    min_lon, min_lat, max_lon, max_lat = bbox_wgs84
    lon_span = max(1e-8, float(max_lon - min_lon))
    lat_span = max(1e-8, float(max_lat - min_lat))
    lat_mid = (float(min_lat) + float(max_lat)) / 2.0
    cos_lat = max(float(math.cos(math.radians(lat_mid))), 0.1)
    meters_x = lon_span * 111_320.0 * cos_lat
    meters_y = lat_span * 110_540.0
    width = int(math.ceil(meters_x / 10.0))
    height = int(math.ceil(meters_y / 10.0))
    width = int(min(max(width, 64), 2500))
    height = int(min(max(height, 64), 2500))
    return width, height


def _evalscript_raw_bands() -> str:
    return """
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "B08", "B11"], units: "REFLECTANCE" }],
    output: { bands: 5, sampleType: "FLOAT32" }
  };
}

function evaluatePixel(sample) {
  return [sample.B02, sample.B03, sample.B04, sample.B08, sample.B11];
}
"""


def search_scenes_cdse(
    bbox_wgs84: list[float],
    start_date: str,
    end_date: str,
    max_cloud_pct: int,
    max_images: int,
) -> list[dict[str, Any]]:
    try:
        token = get_cdse_access_token()
    except Exception as exc:
        raise RuntimeError(
            f"Unable to acquire CDSE token for catalog search: {exc}") from exc

    payload = {
        "bbox": bbox_wgs84,
        "datetime": f"{start_date}T00:00:00Z/{end_date}T23:59:59Z",
        "collections": ["sentinel-2-l2a"],
        "limit": min(100, max(max_images * 4, 40)),
    }

    headers = {"Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}
    response = requests.post(
        CDSE_CATALOG_URL, json=payload, headers=headers, timeout=60)
    response.raise_for_status()
    features = response.json().get("features", [])

    scenes: list[dict[str, Any]] = []
    for feature in features:
        props = feature.get("properties", {})
        dt = props.get("datetime")
        cloud = float(props.get("eo:cloud_cover", 100.0))
        if not dt:
            continue
        if cloud > float(max_cloud_pct):
            continue
        scenes.append(
            {
                "scene_id": feature.get("id", f"scene_{len(scenes)}"),
                "datetime": dt,
                "cloud_pct": cloud,
                "collection": feature.get("collection", "sentinel-2-l2a"),
                "bbox": feature.get("bbox", bbox_wgs84),
                "properties": {
                    "platform": props.get("platform"),
                    "constellation": props.get("constellation"),
                },
            }
        )

    scenes.sort(key=lambda scene: _try_parse_iso(
        scene["datetime"]), reverse=True)
    return scenes[:max_images]


def download_scene_cdse(
    bbox_wgs84: list[float],
    scene: dict[str, Any],
    out_tif_path: Path,
) -> None:
    try:
        token = get_cdse_access_token()
    except Exception as exc:
        raise RuntimeError(
            f"Unable to acquire CDSE token for process download: {exc}") from exc

    t_from, t_to = _scene_time_window(scene["datetime"])
    width, height = _bbox_dimensions_for_10m(bbox_wgs84)
    payload = {
        "input": {
            "bounds": {
                "bbox": bbox_wgs84,
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {"from": t_from, "to": t_to},
                        "mosaickingOrder": "leastCC",
                    },
                }
            ],
        },
        "output": {
            "responses": [
                {
                    "identifier": "default",
                    "format": {"type": "image/tiff"},
                }
            ],
            "width": width,
            "height": height,
        },
        "evalscript": _evalscript_raw_bands(),
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "image/tiff",
    }

    response = requests.post(
        CDSE_PROCESS_URL, json=payload, headers=headers, timeout=180)
    if response.status_code != 200:
        snippet = (response.text or "")[:500]
        raise RuntimeError(
            f"CDSE process error {response.status_code}: {snippet}")

    out_tif_path.parent.mkdir(parents=True, exist_ok=True)
    with out_tif_path.open("wb") as file:
        file.write(response.content)
