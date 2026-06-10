import hashlib
import json
import os
from pathlib import Path


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def file_info(path: Path) -> dict:
    data = path.read_bytes()
    return {
        "path": str(path),
        "sizeBytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "tiffHeader": data[:4].hex(),
    }


def main():
    load_dotenv_file(Path(__file__).resolve().parents[1] / ".env")

    from providers.cdse_direct import download_scene_cdse, search_scenes_cdse
    from providers.ingestion_service import download_scene_via_ingestion_service

    bbox = [22.1, 39.4, 22.2, 39.5]
    start_date = "2025-01-01"
    end_date = "2025-01-31"
    max_cloud_pct = 20
    max_images = 1
    output_dir = Path("tests_external/output")

    scenes = search_scenes_cdse(bbox, start_date, end_date, max_cloud_pct, max_images)
    if not scenes:
        raise RuntimeError("No scene found for download comparison")

    scene = scenes[0]
    direct_path = output_dir / "direct_scene.tif"
    ingestion_path = output_dir / "ingestion_scene.tif"

    download_scene_cdse(bbox, scene, direct_path)
    download_scene_via_ingestion_service(bbox, scene, ingestion_path)

    direct_info = file_info(direct_path)
    ingestion_info = file_info(ingestion_path)

    print("Scene used:")
    print(json.dumps(scene, indent=2))
    print()
    print("Download comparison:")
    print(json.dumps({
        "direct": direct_info,
        "ingestion": ingestion_info,
        "sameSize": direct_info["sizeBytes"] == ingestion_info["sizeBytes"],
        "sameSha256": direct_info["sha256"] == ingestion_info["sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
