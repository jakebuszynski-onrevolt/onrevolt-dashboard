#!/usr/bin/env python3
"""Collect selected OPSD 60-minute household profiles into a local catalog.

Usage: python scripts/profile-catalog/opsd_collect.py
Downloads the immutable OPSD 2020-04-15 CSV and datapackage metadata when absent.
The generated interval series are adjacent counter differences. Nulls and source
interpolation flags are retained; no missing energy values are filled.
"""
from __future__ import annotations

import csv
import hashlib
import json
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "profile-catalog-20261106" / "opsd"
CSV_NAME = "household_data_60min_singleindex.csv"
META_NAME = "datapackage.json"
BASE = "https://data.open-power-system-data.org/household_data/2020-04-15/"
CSV_URL = BASE + CSV_NAME
META_URL = BASE + META_NAME

# OPSD field documentation describes grid_import as public-grid imports in kWh;
# it is not whole-house consumption. Heat-pump columns are device consumption.
SELECTED = [
    ("DE_KN_residential1_grid_import", "Household 1 public-grid import", "household_grid_import", "household", "Energy imported from the public grid in a residential building, located in the suburban area in kWh"),
    ("DE_KN_residential1_heat_pump", "Household 1 heat pump", "heat_pump_consumption", "household", "Heat pump energy consumption in a residential building, located in the suburban area in kWh"),
    ("DE_KN_residential4_grid_import", "Household 4 public-grid import", "household_grid_import", "household", "Energy imported from the public grid in a residential building, located in the urban area in kWh"),
    ("DE_KN_residential4_heat_pump", "Household 4 heat pump", "heat_pump_consumption", "household", "Heat pump energy consumption in a residential building, located in the urban area in kWh"),
    ("DE_KN_industrial1_grid_import", "Industrial warehouse public-grid import", "business_grid_import", "business", "Energy imported from the public grid in a industrial warehouse building in kWh"),
    ("DE_KN_industrial3_grid_import", "Research institute public-grid import", "business_grid_import", "business", "Energy imported from the public grid in a industrial building, part of a research institute in kWh"),
]


def fetch(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size:
        return
    request = urllib.request.Request(url, headers={"User-Agent": "OPSD-profile-catalog/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, path.open("wb") as target:
        while chunk := response.read(1024 * 1024):
            target.write(chunk)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_time(value: str) -> datetime:
    # Provider timestamps are UTC and terminate in Z.
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    csv_path, meta_path = OUT / CSV_NAME, OUT / META_NAME
    fetch(CSV_URL, csv_path)
    fetch(META_URL, meta_path)
    fetch('https://raw.githubusercontent.com/isc-konstanz/household_data/2020-04-15/processing.ipynb', OUT / 'processing.ipynb')
    package = json.loads(meta_path.read_text(encoding="utf-8"))
    license_info = package["licenses"][0]
    retrieval_path = OUT / 'retrieved-at.txt'
    if not retrieval_path.exists():
        # Preserve the timestamp of the first catalog instead of changing it on rebuild.
        old_catalog = OUT / 'catalog.json'
        retrieved = json.loads(old_catalog.read_text(encoding='utf-8'))['sources'][0]['retrievedAt'] if old_catalog.exists() else datetime.now(timezone.utc).isoformat()
        retrieval_path.write_text(retrieved, encoding='utf-8')
    columns: dict[str, list[tuple[str, float | None, bool]]] = {item[0]: [] for item in SELECTED}
    with csv_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"utc_timestamp", "interpolated", *(item[0] for item in SELECTED)}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"OPSD CSV missing required fields: {sorted(missing)}")
        for row in reader:
            stamp = parse_time(row["utc_timestamp"]).isoformat(timespec="seconds").replace("+00:00", "Z")
            imputed_fields = set((row.get("interpolated") or "").split(";"))
            for column, _, _, _, _ in SELECTED:
                raw = (row.get(column) or "").strip()
                value = float(raw) if raw else None
                columns[column].append((stamp, value, column in imputed_fields))

    profiles = []
    for column, name, category, audience, description in SELECTED:
        rows = columns[column]
        # OPSD's documentation says feeds are cumulative meter readings. Convert
        # adjacent hourly counter readings to interval kWh; never bridge a blank
        # hour, since that would turn a multi-hour delta into a false hourly value.
        interval_rows: list[tuple[str, float | None, bool]] = []
        reset_count = 0
        for previous, current in zip(rows, rows[1:]):
            previous_stamp, previous_value, previous_flag = previous
            current_stamp, current_value, current_flag = current
            if parse_time(current_stamp) - parse_time(previous_stamp) != timedelta(hours=1):
                raise ValueError('Source timestamps are not consecutive hours; no multi-hour differences allowed')
            delta = None
            if previous_value is not None and current_value is not None:
                difference = current_value - previous_value
                if difference >= 0:
                    delta = difference
                else:
                    reset_count += 1
            # Official processing.ipynb uses resample('60min').last(), left labels.
            # A delta therefore belongs to the CURRENT hourly bucket, not the
            # preceding label. Raw counter readings remain in the original CSV.
            interval_rows.append((current_stamp, delta, previous_flag or current_flag))
        rows = interval_rows
        populated_indices = [i for i, (_, value, _) in enumerate(rows) if value is not None]
        if not populated_indices:
            raise ValueError(f"Selected OPSD profile has no numeric rows: {column}")
        first, last = populated_indices[0], populated_indices[-1]
        window = rows[first:last + 1]
        values = [value for _, value, _ in window]
        flags = [flag for _, _, flag in window]
        nonnull = [value for value in values if value is not None]
        null_count = len(values) - len(nonnull)
        imputed_count = sum(flags)
        profile_key = "opsd_20200415_" + column.lower()
        complete_years = []
        for year in range(parse_time(window[0][0]).year, parse_time(window[-1][0]).year + 1):
            year_rows = [(stamp, value) for stamp, value, _ in window if stamp.startswith(str(year))]
            first_hour = datetime(year, 1, 1, tzinfo=timezone.utc)
            next_year = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            expected_count = int((next_year-first_hour).total_seconds() / 3600)
            if len(year_rows) == expected_count and all(value is not None for _, value in year_rows):
                complete_years.append(year)
        profiles.append({
            "key": profile_key,
            "sourceKey": "opsd_household_data_2020_04_15",
            "name": name,
            "category": category,
            "kind": "MEASURED_WITH_SOURCE_IMPUTATION" if imputed_count else "MEASURED",
            "quantity": "energy_import" if "grid_import" in column else "device_energy_consumption",
            "unit": "kWh",
            "timeBasis": "UTC_HOURLY_BUCKET",
            "resolutionMinutes": 60,
            "start": window[0][0],
            "end": window[-1][0],
            "series": [
                {"timestamp": stamp, "value": value, **({"interpolated": True} if flag else {})}
                for stamp, value, flag in window
            ],
            "metadata": {
                "reviewStatus": "CANDIDATE",
                "country": "DE",
                "licenseUrl": license_info['url'],
                "providerColumn": column,
                "providerDescription": description,
                "audience": audience,
                "geography": "Southern Germany; individual site location generalized by provider",
                "sourceInterpolationField": "interpolated",
                "gridImportDefinition": "Public-grid import only; not whole-house load. Onsite generation/self-consumption is not added.",
                "intervalSemantics": "OPSD processing.ipynb resamples cumulative counters using resample('60min').last() with left labels. Difference is assigned to the current hour bucket; actual readings are the last samples within consecutive buckets, not exact hour-boundary readings. Missing readings are not bridged; negative counter deltas remain null.",
                "derivation": "counter[current_hour]-counter[previous_hour], timestamp=current_hour label",
                "processingSourceUrl": "https://github.com/isc-konstanz/household_data/blob/2020-04-15/processing.ipynb",
                "processingSourceSha256": sha256(OUT / 'processing.ipynb'),
            },
            "quality": {
                "sourceRowsInProfileRange": len(window),
                "numericRows": len(nonnull),
                "nullRows": null_count,
                "intervalsAffectedBySourceInterpolation": imputed_count,
                "numericIntervalsAffectedBySourceInterpolation": sum(flag and value is not None for _, value, flag in window),
                "rawCounterReadingsMarkedInterpolated": sum(flag for _, _, flag in columns[column]),
                "resetIntervals": reset_count,
                "coverageFraction": round(len(nonnull) / len(window), 6),
                "minimumValue": min(nonnull),
                "maximumValue": max(nonnull),
                "completeCalendarYearsUtc": complete_years,
            },
        })

    retrieved = retrieval_path.read_text(encoding='utf-8').strip()
    catalog = {
        "sources": [{
            "key": "opsd_household_data_2020_04_15",
            "title": package["title"] + " (version " + package["version"] + ")",
            "publisher": "Open Power System Data; primary data contributed by CoSSMic / ISC Konstanz",
            "url": BASE,
            "downloadUrl": CSV_URL,
            "retrievedAt": retrieved,
            "license": license_info['id'],
            "sha256": sha256(csv_path),
            "notes": "Hourly singleindex CSV. OPSD documents gaps and states missing source data were interpolated linearly or filled using prior-day data. Catalog preserves every source interpolated marker and leaves blank values null. Metadata sidecar: datapackage.json (SHA-256 " + sha256(meta_path) + "). Data covers 11 households in southern Germany; starts/ends and coverage vary by series. Attribution: Open Power System Data. 2020. Data Package Household Data. Version 2020-04-15. " + BASE + " (Primary data from various sources, see package URL).",
        }],
        "profiles": profiles,
    }
    output = OUT / "catalog.json"
    output.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"catalog": str(output), "csvBytes": csv_path.stat().st_size, "csvSha256": sha256(csv_path), "metadataSha256": sha256(meta_path), "profiles": [{"key": p["key"], "start": p["start"], "end": p["end"], **p["quality"]} for p in profiles]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
