"""Build a UTC typical-hourly PV climatology from the OnRevolt PV model."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import sys


MAX_INPUT_BYTES = 16 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_HOURS = 366 * 24
MODEL = "Hay-Davies · Martin–Ruiz · Faiman · Huld (cSi 2025)"
SOURCE = "PVGIS 6 / SARAH-3"
UTC_HOUR = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$")


def _reject_json_constant(value: str):
    raise ValueError(f"Niedozwolona wartość JSON: {value}.")


def _read_request() -> dict:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("Dane wejściowe przekraczają limit rozmiaru.")
    value = json.loads(raw.decode("utf-8"), parse_constant=_reject_json_constant)
    required = {
        "latitude", "longitude", "powerKw", "tiltDegrees", "azimuthDegrees",
        "lossPercent", "fromUtc", "untilUtc",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("Nieprawidłowy zestaw pól wejściowych profilu PV.")
    return value


def _number(payload: dict, name: str, minimum: float, maximum: float) -> float:
    value = payload[name]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Pole {name} musi być liczbą.")
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise ValueError(f"Pole {name} jest poza dozwolonym zakresem.")
    return result


def _utc_hour(value: object, name: str) -> datetime:
    if not isinstance(value, str) or not UTC_HOUR.fullmatch(value):
        raise ValueError(f"Pole {name} musi wskazywać pełną godzinę UTC z sufiksem Z.")
    try:
        return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ValueError(f"Nieprawidłowa data w polu {name}.") from exc


def _tools_directory() -> Path:
    configured = os.environ.get("ONREVOLT_PV_TOOLS_DIR", "")
    if not configured:
        raise RuntimeError("Brak wymaganej zmiennej ONREVOLT_PV_TOOLS_DIR.")
    path = Path(configured)
    if not path.is_absolute():
        raise RuntimeError("ONREVOLT_PV_TOOLS_DIR musi być ścieżką bezwzględną.")
    resolved = path.resolve(strict=True)
    if not resolved.is_dir():
        raise RuntimeError("ONREVOLT_PV_TOOLS_DIR nie wskazuje katalogu.")
    return resolved


def _profile(payload: dict) -> dict:
    latitude = _number(payload, "latitude", -90, 90)
    longitude = _number(payload, "longitude", -180, 180)
    power_kw = _number(payload, "powerKw", 0.001, 100000)
    tilt = _number(payload, "tiltDegrees", 0, 90)
    azimuth = _number(payload, "azimuthDegrees", 0, 360)
    loss = _number(payload, "lossPercent", 0, 99.9)
    start = _utc_hour(payload["fromUtc"], "fromUtc")
    until = _utc_hour(payload["untilUtc"], "untilUtc")
    seconds = (until - start).total_seconds()
    if seconds <= 0 or seconds % 3600:
        raise ValueError("Przedział UTC musi zawierać co najmniej jedną godzinę.")
    count = int(seconds // 3600)
    if count > MAX_HOURS:
        raise ValueError("Przedział profilu PV przekracza limit 366 dni.")

    tools_dir = _tools_directory()
    sys.path.insert(0, str(tools_dir))
    import engine as core
    import numpy as np
    import pandas as pd
    import pvlib
    from pvgis_data import PERIOD, interpolate_short_gaps, load_location, validate
    from solar_model import plane_power

    installation = core._installation({"installation": {
        "lat": latitude,
        "lon": longitude,
        "capacityKwp": power_kw,
        "tilt": tilt,
        "azimuth": azimuth,
        "lossPercent": loss,
        "layout": "single",
    }}, require_capacity=True, require_geometry=True)
    frame, _metadata = load_location(installation["lat"], installation["lon"])
    times = validate(frame)
    radiation, _estimated, _night_estimated = interpolate_short_gaps(frame, times)
    altitude = np.rad2deg(frame["Altitude"].to_numpy())
    sun_azimuth = np.rad2deg(frame["Azimuth"].to_numpy())
    bhi = radiation["Direct Horizontal Irradiance"].to_numpy()
    dhi = radiation["Diffuse Horizontal Irradiance"].to_numpy()
    cosz = np.sin(np.deg2rad(altitude))
    dni = np.divide(bhi, cosz, out=np.zeros(len(bhi)), where=cosz > 0)
    dni[frame["In shade"].to_numpy(dtype=bool)] = 0
    common = (
        90 - altitude,
        sun_azimuth,
        bhi + dhi,
        dni,
        dhi,
        np.asarray(pvlib.irradiance.get_extra_radiation(times)),
        frame["Temperature"].to_numpy(),
        frame["Wind Speed"].to_numpy(),
        frame["Spectral factor"].to_numpy(),
    )
    power_per_kwp = plane_power(installation["tilt"], installation["azimuth"], *common)
    energy = power_per_kwp * installation["capacityKwp"] * (1 - installation["lossPercent"] / 100)
    if not np.isfinite(energy).all() or (energy < 0).any():
        raise ValueError("Model PV zwrócił nieprawidłową produkcję.")

    typical = pd.DataFrame({
        "month": times.month,
        "day": times.day,
        "hour": times.hour,
        "pvKwh": energy,
    }).groupby(["month", "day", "hour"], sort=False)["pvKwh"].mean()
    hours = []
    for index in range(count):
        start_utc = start + timedelta(hours=index)
        key = (start_utc.month, start_utc.day, start_utc.hour)
        if key not in typical.index:
            raise ValueError(f"Brak pokrycia klimatologii dla godziny {start_utc.isoformat()}.")
        amount = float(typical.loc[key])
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("Średnia godzinowa PV jest nieprawidłowa.")
        hours.append({
            "startUtc": start_utc.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "pvKwh": amount,
        })

    return {
        "hours": hours,
        "source": SOURCE,
        "model": MODEL,
        "referencePeriod": PERIOD,
    }


def main() -> int:
    if len(sys.argv) != 1:
        raise ValueError("Skrypt nie przyjmuje argumentów; wejście należy przekazać przez stdin.")
    result = _profile(_read_request())
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    body = encoded.encode("utf-8")
    if len(body) > MAX_OUTPUT_BYTES:
        raise ValueError("Wynik profilu PV przekracza limit rozmiaru.")
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        message = str(error) or error.__class__.__name__
        sys.stderr.write(f"{message}\n")
        raise SystemExit(1)
