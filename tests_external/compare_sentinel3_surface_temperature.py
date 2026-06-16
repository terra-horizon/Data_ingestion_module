import json
import math
from pathlib import Path

from providers.forecaster_original import (
    load_dotenv_file,
    sentinel3_surface_temperature_original,
)
from providers.ingestion_service import sentinel3_surface_temperature_via_ingestion_service


def rounded_records(records: list[dict], decimals: int = 6) -> list[dict]:
    return [
        {
            "date": record["date"],
            "metrics": {
                key: round(float(value), decimals)
                for key, value in sorted(record["metrics"].items())
                if value is not None and math.isfinite(float(value))
            },
        }
        for record in sorted(records, key=lambda item: item["date"])
    ]


def main():
    load_dotenv_file(Path(__file__).resolve().parents[1] / ".env")

    bbox = [22.1, 39.4, 22.8, 40.1]
    start_date = "2025-01-01"
    end_date = "2025-01-31"

    original = sentinel3_surface_temperature_original(bbox, start_date, end_date)
    via_ingestion = sentinel3_surface_temperature_via_ingestion_service(bbox, start_date, end_date)

    original_normalized = rounded_records(original)
    ingestion_normalized = rounded_records(via_ingestion)

    print("Original forecaster output:")
    print(json.dumps(original_normalized, indent=2))
    print()
    print("Ingestion service output:")
    print(json.dumps(ingestion_normalized, indent=2))
    print()
    print("Sentinel-3 surface temperature comparison:")
    print(json.dumps({
        "same_full_output": original_normalized == ingestion_normalized,
        "original_count": len(original_normalized),
        "ingestion_count": len(ingestion_normalized),
        "original_dates": [record["date"] for record in original_normalized],
        "ingestion_dates": [record["date"] for record in ingestion_normalized],
    }, indent=2))


if __name__ == "__main__":
    main()
