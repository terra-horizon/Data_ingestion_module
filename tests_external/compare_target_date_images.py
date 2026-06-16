import hashlib
import json
from pathlib import Path

from providers.forecaster_original import (
    load_dotenv_file,
    target_date_images_original,
)
from providers.ingestion_service import target_date_images_via_ingestion_service


def image_summary(records: list[dict]) -> list[dict]:
    summaries = []
    for record in sorted(records, key=lambda item: item["imageKey"]):
        data_base64 = record.get("dataBase64") or ""
        summaries.append({
            "imageKey": record["imageKey"],
            "status": record["status"],
            "contentType": record.get("contentType"),
            "sizeBytes": record.get("sizeBytes"),
            "sha256": hashlib.sha256(data_base64.encode("ascii")).hexdigest()
            if data_base64 else "",
            "requestedDate": record.get("requestedDate"),
            "actualDate": record.get("actualDate"),
            "collection": record.get("collection"),
        })
    return summaries


def main():
    load_dotenv_file(Path(__file__).resolve().parents[1] / ".env")

    bbox = [22.1, 39.4, 22.2, 39.5]
    target_date = "2026-05-27"
    tile_name = "tile_0"
    tile_size = 400
    image_keys = ["true_color", "chla", "surface_temperature"]

    original = target_date_images_original(
        bbox,
        target_date,
        tile_name,
        image_keys,
        tile_size,
    )
    via_ingestion = target_date_images_via_ingestion_service(
        bbox,
        target_date,
        tile_name,
        image_keys,
        tile_size,
    )

    original_summary = image_summary(original)
    ingestion_summary = image_summary(via_ingestion)

    print("Original forecaster image summary:")
    print(json.dumps(original_summary, indent=2))
    print()
    print("Ingestion service image summary:")
    print(json.dumps(ingestion_summary, indent=2))
    print()
    print("Target-date image comparison:")
    print(json.dumps({
        "same_full_output": original_summary == ingestion_summary,
        "original_count": len(original_summary),
        "ingestion_count": len(ingestion_summary),
    }, indent=2))


if __name__ == "__main__":
    main()
