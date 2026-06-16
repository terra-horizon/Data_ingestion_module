import json
import math
from pathlib import Path

from providers.forecaster_original import (
    load_dotenv_file,
    water_tile_screening_original,
)
from providers.ingestion_service import water_tile_screening_via_ingestion_service


def rounded_screening(records: list[dict], decimals: int = 6) -> list[dict]:
    normalized = []
    for record in records:
        normalized.append({
            "tileName": record["tileName"],
            "bbox": record["bbox"],
            "selected": record["selected"],
            "score": round(float(record["score"]), decimals),
            "scenes": [
                {
                    "date": scene["date"],
                    "validPixels": int(scene["validPixels"]),
                    "sampleCount": int(scene["sampleCount"]),
                    "noDataCount": int(scene["noDataCount"]),
                    "waterPct": round(float(scene["waterPct"]), decimals)
                    if math.isfinite(float(scene["waterPct"])) else scene["waterPct"],
                    "cloudPct": round(float(scene["cloudPct"]), decimals)
                    if math.isfinite(float(scene["cloudPct"])) else scene["cloudPct"],
                }
                for scene in sorted(record["scenes"], key=lambda item: item["date"])
            ],
        })
    return sorted(normalized, key=lambda item: item["tileName"])


def main():
    load_dotenv_file(Path(__file__).resolve().parents[1] / ".env")

    tiles = [
        {
            "name": "tile_0",
            "bbox": [22.1, 39.4, 22.2, 39.5],
        }
    ]
    start_date = "2025-01-01"
    end_date = "2026-01-01"
    max_cloud_coverage = 30

    original = water_tile_screening_original(
        tiles,
        start_date,
        end_date,
        max_cloud_coverage,
    )
    via_ingestion = water_tile_screening_via_ingestion_service(
        tiles,
        start_date,
        end_date,
        max_cloud_coverage,
    )

    original_normalized = rounded_screening(original)
    ingestion_normalized = rounded_screening(via_ingestion)

    print("Original forecaster output:")
    print(json.dumps(original_normalized, indent=2))
    print()
    print("Ingestion service output:")
    print(json.dumps(ingestion_normalized, indent=2))
    print()
    print("Water tile screening comparison:")
    print(json.dumps({
        "same_full_output": original_normalized == ingestion_normalized,
        "original_tile_count": len(original_normalized),
        "ingestion_tile_count": len(ingestion_normalized),
    }, indent=2))


if __name__ == "__main__":
    main()
