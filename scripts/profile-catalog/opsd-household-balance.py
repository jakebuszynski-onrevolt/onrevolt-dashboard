#!/usr/bin/env python3
"""Derive the OPSD residential 4 whole-house seasonal pattern.

Uses only complete adjacent hourly counter pairs from 2016. Any interval marked
interpolated in a counter used by the balance is excluded; gaps are never filled.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "output" / "profile-catalog-20261106" / "opsd" / "household_data_60min_singleindex.csv"
OUTPUT = ROOT / "assets" / "reference-profiles" / "opsd-residential4-whole-house.json"
SOURCE_URL = "https://data.open-power-system-data.org/household_data/2020-04-15/"
SOURCE_KEY = "opsd_household_data_2020_04_15"
PROFILE_KEY = "opsd_20200415_de_kn_residential4_household_heat_pump"
YEAR = 2016

COUNTERS = {
    "grid_import": "DE_KN_residential4_grid_import",
    "pv": "DE_KN_residential4_pv",
    "grid_export": "DE_KN_residential4_grid_export",
    "ev": "DE_KN_residential4_ev",
}
FORMULA = "delta(grid_import) + delta(pv) - delta(grid_export) - delta(ev)"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"Expected timezone-aware source timestamp: {value}")
    return parsed.astimezone(timezone.utc)


def marked_columns(row: dict[str, str]) -> set[str]:
    raw = (row.get("interpolated") or "").replace("|", ";")
    return {part.strip() for part in raw.split(";") if part.strip()}


def interval_is_interpolated(previous: dict[str, str], current: dict[str, str]) -> bool:
    return bool((marked_columns(previous) | marked_columns(current)).intersection(COUNTERS.values()))


def derive_interval(previous: dict[str, str], current: dict[str, str]) -> tuple[datetime, float]:
    deltas: dict[str, float] = {}
    for channel, column in COUNTERS.items():
        current_raw = (current.get(column) or "").strip()
        previous_raw = (previous.get(column) or "").strip()
        if not current_raw or not previous_raw:
            raise ValueError(f"Missing {column} counter at {current['utc_timestamp']}; gaps are not filled")
        delta = float(current_raw) - float(previous_raw)
        if delta < 0:
            raise ValueError(f"Counter reset in {column} at {current['utc_timestamp']}")
        deltas[channel] = delta

    current_civil = datetime.fromisoformat(current["cet_cest_timestamp"])
    load_kwh = deltas["grid_import"] + deltas["pv"] - deltas["grid_export"] - deltas["ev"]
    return current_civil, load_kwh


def self_test_current_label() -> None:
    previous = {
        "utc_timestamp": "2016-04-03T00:00:00Z",
        "cet_cest_timestamp": "2016-04-03T02:00:00+0200",
        "interpolated": "",
        COUNTERS["grid_import"]: "100",
        COUNTERS["pv"]: "50",
        COUNTERS["grid_export"]: "20",
        COUNTERS["ev"]: "5",
    }
    current = {
        "utc_timestamp": "2016-04-03T01:00:00Z",
        "cet_cest_timestamp": "2016-04-03T03:00:00+0200",
        "interpolated": "",
        COUNTERS["grid_import"]: "105",
        COUNTERS["pv"]: "53",
        COUNTERS["grid_export"]: "21",
        COUNTERS["ev"]: "6",
    }
    civil_time, load_kwh = derive_interval(previous, current)
    if (civil_time.year, civil_time.month, civil_time.hour, civil_time.weekday() >= 5) != (2016, 4, 3, True):
        raise AssertionError("Counter delta must be grouped by the current Berlin bucket label")
    if load_kwh != 6:
        raise AssertionError("Whole-house balance must be grid import + PV - grid export - EV")

    current["interpolated"] = f"{COUNTERS['ev']} | DE_KN_residential4_heat_pump"
    if not interval_is_interpolated(previous, current):
        raise AssertionError("Pipe-separated interpolation flags must exclude a used counter")
    current["interpolated"] = "DE_KN_residential4_heat_pump"
    if interval_is_interpolated(previous, current):
        raise AssertionError("Interpolation in an unused heat-pump channel must not exclude the interval")


def read_source() -> tuple[list[dict[str, object]], dict[str, object]]:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing source CSV: {SOURCE}")

    required = {"utc_timestamp", "cet_cest_timestamp", "interpolated", *COUNTERS.values()}
    groups: dict[tuple[int, str, int], list[float]] = defaultdict(list)
    negative_diagnostics: list[dict[str, object]] = []
    previous: dict[str, str] | None = None
    previous_stamp: datetime | None = None
    berlin_year_intervals = 0
    interpolated_excluded = 0
    used_intervals = 0

    with SOURCE.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"OPSD CSV is missing required fields: {sorted(missing)}")

        for row in reader:
            stamp = parse_utc(row["utc_timestamp"])
            if previous is not None and previous_stamp is not None and stamp - previous_stamp != timedelta(hours=1):
                raise ValueError(f"Non-consecutive counter rows at {row['utc_timestamp']}; gaps are not filled")

            current_civil = datetime.fromisoformat(row["cet_cest_timestamp"])
            if current_civil.year == YEAR:
                if previous is None or previous_stamp is None:
                    raise ValueError("2016 starts without a previous source counter row")
                berlin_year_intervals += 1
                if interval_is_interpolated(previous, row):
                    interpolated_excluded += 1
                else:
                    berlin, load_kwh = derive_interval(previous, row)
                    day_type = "weekend" if berlin.weekday() >= 5 else "workday"
                    groups[(berlin.month, day_type, berlin.hour)].append(load_kwh)
                    if load_kwh < 0:
                        negative_diagnostics.append({
                            "timestampUtc": row["utc_timestamp"],
                            "monthBerlin": berlin.month,
                            "dayTypeBerlin": day_type,
                            "hourBerlin": berlin.hour,
                            "loadKwh": load_kwh,
                        })
                    used_intervals += 1
            previous = row
            previous_stamp = stamp

    expected_keys = {(month, day_type, hour)
                     for month in range(1, 13)
                     for day_type in ("workday", "weekend")
                     for hour in range(24)}
    if set(groups) != expected_keys:
        missing_groups = sorted(expected_keys - set(groups))
        extra_groups = sorted(set(groups) - expected_keys)
        raise ValueError(f"Unexpected month/day/hour groups; missing={missing_groups}, extra={extra_groups}")
    if berlin_year_intervals != 8784:
        raise ValueError(f"Expected 8784 intervals on the full Berlin civil 2016 axis, got {berlin_year_intervals}")
    if used_intervals + interpolated_excluded != berlin_year_intervals:
        raise ValueError("Used and interpolation-excluded intervals do not cover the Berlin 2016 axis")

    points: list[dict[str, object]] = []
    for month, day_type, hour in sorted(expected_keys):
        samples = groups[(month, day_type, hour)]
        if not samples:
            raise ValueError(f"Group {(month, day_type, hour)} has no non-interpolated source samples; no filling is allowed")
        mean = sum(samples) / len(samples)
        if not mean > 0:
            raise ValueError(f"Group {(month, day_type, hour)} does not have a positive mean")
        points.append({
            "month": month,
            "dayType": day_type,
            "hour": hour,
            "slot": hour,
            "value": mean,
            "samples": len(samples),
        })

    negative_energy = sum(float(row["loadKwh"]) for row in negative_diagnostics)
    if sum(len(values) for values in groups.values()) != used_intervals:
        raise ValueError("Group counts do not match used source intervals")

    diagnostics = {
        "sourceIntervalsInBerlinYear": berlin_year_intervals,
        "usedIntervals": used_intervals,
        "interpolatedIntervalsExcluded": interpolated_excluded,
        "groupCount": len(points),
        "minimumSamplesPerGroup": min(int(point["samples"]) for point in points),
        "maximumSamplesPerGroup": max(int(point["samples"]) for point in points),
        "allGroupMeansPositive": True,
        "rawNegativeHours": len(negative_diagnostics),
        "rawNegativeEnergyKwh": negative_energy,
        "negativeHourlyLoadDiagnostics": negative_diagnostics,
        "negativeValuesClipped": False,
        "gapsFilled": False,
    }
    return points, diagnostics


def build_profile(points: list[dict[str, object]], diagnostics: dict[str, object]) -> dict[str, object]:
    source_hash = sha256(SOURCE)
    return {
        "key": PROFILE_KEY,
        "sourceKey": SOURCE_KEY,
        "name": "Dom z pompą ciepła — bez ładowania auta (OPSD 4)",
        "category": "household_whole_house",
        "kind": "DERIVED_SEASONAL_PATTERN",
        "quantity": "whole_building_energy_consumption",
        "unit": "kWh",
        "timeBasis": "EUROPE_BERLIN_MONTH_DAYTYPE_HOUR",
        "resolutionMinutes": 60,
        "start": None,
        "end": None,
        "series": points,
        "metadata": {
            "reviewStatus": "CANDIDATE",
            "country": "DE",
            "geography": "Jedno gospodarstwo domowe OPSD 4 w południowych Niemczech; lokalizacja uogólniona przez dostawcę.",
            "sourceUrl": SOURCE_URL,
            "sourceKey": SOURCE_KEY,
            "sourceColumnSet": list(COUNTERS.values()),
            "sourceSha256": source_hash,
            "sourceYear": YEAR,
            "sourceTimestampBasis": "OPSD uses left-labeled hourly buckets; the current-minus-previous counter delta is assigned to the current row label, with an approximately one-minute offset inherent in the last observation within that hour",
            "civilTimeBasis": "Europe/Berlin from cet_cest_timestamp",
            "derivation": FORMULA,
            "wholeHouseBoundaryInference": "grid import plus onsite PV minus grid export approximates building load; EV charging is subtracted to represent household load without the car. This is an inferred boundary, not a direct whole-building meter.",
            "heatPumpTreatment": "The heat pump is already included in whole-house electricity and is not added again.",
            "evTreatment": "EV counter delta is subtracted from the inferred building load.",
            "aggregation": "Arithmetic mean by current Berlin civil month, workday/weekend, and hour label; no holiday adjustment.",
            "interpolatedPolicy": "Skip an interval if any used counter is marked interpolated on either its start or end counter row; source flags are pipe-separated column names.",
            "negativeBalancePolicy": "Retain negative raw hourly balance values in group means and diagnostics; apply no clipping.",
            "confidence": "LOW: empirical pattern from one household in one source year; not guaranteed representative of other households.",
            "processingScript": "scripts/profile-catalog/opsd-household-balance.py",
        },
        "quality": {
            **diagnostics,
            "sourceSha256": source_hash,
            "sourceYear": YEAR,
            "minimumGroupMeanKwh": min(float(point["value"]) for point in points),
            "maximumGroupMeanKwh": max(float(point["value"]) for point in points),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="Run the small interval-label regression fixture without reading the CSV")
    args = parser.parse_args()
    if args.self_test:
        self_test_current_label()
        print("current-label and interpolation-flag fixture passed")
        return

    points, diagnostics = read_source()
    profile = build_profile(points, diagnostics)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT),
        "sourceSha256": profile["metadata"]["sourceSha256"],
        "sourceIntervalsInBerlinYear": diagnostics["sourceIntervalsInBerlinYear"],
        "sourceIntervalsUsed": diagnostics["usedIntervals"],
        "interpolatedIntervalsExcluded": diagnostics["interpolatedIntervalsExcluded"],
        "groups": diagnostics["groupCount"],
        "minimumSamplesPerGroup": diagnostics["minimumSamplesPerGroup"],
        "rawNegativeHours": diagnostics["rawNegativeHours"],
        "rawNegativeEnergyKwh": diagnostics["rawNegativeEnergyKwh"],
        "minimumGroupMeanKwh": profile["quality"]["minimumGroupMeanKwh"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
