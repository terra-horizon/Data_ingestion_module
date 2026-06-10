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


def scene_ids(scenes):
    return [scene["scene_id"] for scene in scenes]


def main():
    load_dotenv_file(Path(__file__).resolve().parents[1] / ".env")

    from providers.cdse_direct import search_scenes_cdse
    from providers.ingestion_service import search_scenes_via_ingestion_service

    bbox = [22.1, 39.4, 22.8, 40.1]
    start_date = "2025-01-01"
    end_date = "2025-01-31"
    max_cloud_pct = 20
    max_images = 5

    direct = search_scenes_cdse(bbox, start_date, end_date, max_cloud_pct, max_images)
    via_ingestion = search_scenes_via_ingestion_service(
        bbox,
        start_date,
        end_date,
        max_cloud_pct,
        max_images,
    )

    direct_ids = scene_ids(direct)
    ingestion_ids = scene_ids(via_ingestion)

    print("Direct CDSE output:")
    print(json.dumps(direct, indent=2))
    print()
    print("Ingestion service output:")
    print(json.dumps(via_ingestion, indent=2))
    print()
    print("Scene ID comparison:")
    print(json.dumps({
        "direct_ids": direct_ids,
        "ingestion_ids": ingestion_ids,
        "only_direct": sorted(set(direct_ids) - set(ingestion_ids)),
        "only_ingestion": sorted(set(ingestion_ids) - set(direct_ids)),
        "same_order": direct_ids == ingestion_ids,
        "same_full_output": direct == via_ingestion,
    }, indent=2))


if __name__ == "__main__":
    main()
