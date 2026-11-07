"""Collect a dated, review-only Polish subset of the public When2Heat release.

No client data, interpolation or assumed household consumption is used.
Run: python scripts/profile-catalog/when2heat.py [--download]
"""
import csv
import datetime as dt
import hashlib
import json
import math
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/profile-catalog-20261106/when2heat'
BASE = 'https://data.open-power-system-data.org/when2heat/2023-07-27/'
YEAR = 2022


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if '--download' in sys.argv:
        for name in ['README.md', 'datapackage.json', 'when2heat.csv']:
            target = OUT / name
            if target.exists():
                raise ValueError(f'Preserve existing download: {target}')
            with urllib.request.urlopen(BASE + name, timeout=120) as response, target.open('wb') as out:
                while chunk := response.read(1024 * 1024):
                    out.write(chunk)
        (OUT / 'retrieved-at.txt').write_text(dt.datetime.now(dt.timezone.utc).isoformat(), encoding='utf-8')
    raw = OUT / 'when2heat.csv'
    with raw.open('rb') as f:
        sha = hashlib.file_digest(f, 'sha256').hexdigest()
    fields = [f'PL_heat_profile_{purpose}_{building}' for purpose in ['space', 'water'] for building in ['SFH', 'MFH', 'COM']]
    fields += [f'PL_COP_{source}_{sink}' for source in ['ASHP', 'GSHP'] for sink in ['floor', 'radiator', 'water']]
    series = {field: [] for field in fields}
    package = json.loads((OUT / 'datapackage.json').read_text(encoding='utf-8'))
    resource = next(r for r in package['resources'] if r['path'] == 'when2heat.csv')
    with raw.open('rb') as f:
        md5 = hashlib.file_digest(f, 'md5').hexdigest()
    if raw.stat().st_size != resource['bytes'] or md5 != resource['hash']:
        raise ValueError('Original source size/MD5 differs from publisher datapackage')
    descriptions = {field['name']: field.get('description', '') for resource in package['resources'] for field in resource.get('schema', {}).get('fields', [])}
    with raw.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        if not set(['utc_timestamp'] + fields).issubset(reader.fieldnames or []):
            raise ValueError(f'Unexpected source columns: {reader.fieldnames}')
        for row in reader:
            timestamp = row['utc_timestamp']
            if not row['cet_cest_timestamp'].startswith(str(YEAR)):
                continue
            for field in fields:
                # The published CSV uses a semicolon delimiter and decimal comma.
                value = float(row[field].replace(',', '.')) if row[field] else None
                if value is not None and (not math.isfinite(value) or value < 0):
                    raise ValueError(f'Invalid {field} {timestamp}')
                series[field].append({'timestamp': timestamp, 'value': value})
    profiles = []
    # Calendar year in Poland: January boundaries are CET (+01:00).
    expected = [dt.datetime(YEAR, 1, 1, tzinfo=dt.timezone(dt.timedelta(hours=1))).astimezone(dt.timezone.utc) + dt.timedelta(hours=i) for i in range(8760)]
    for field, points in series.items():
        actual = [dt.datetime.fromisoformat(p['timestamp'].replace('Z', '+00:00')) for p in points]
        if len(actual) != len(set(actual)) or actual != sorted(actual) or not set(actual).issubset(expected):
            raise ValueError(f'Duplicate/shifted/out-of-period timestamps: {field}')
        indexed = dict(zip(actual, points))
        missing = [t.isoformat().replace('+00:00', 'Z') for t in expected if t not in indexed]
        # Missing source hours are explicitly NULL, never interpolated or copied.
        points = [indexed.get(t, {'timestamp': t.isoformat().replace('+00:00', 'Z'), 'value': None, 'missingInSource': True}) for t in expected]
        series[field] = points
        cop = '_COP_' in field
        profiles.append({
            'key': f'when2heat-20230727-{field.lower()}-{YEAR}', 'sourceKey': 'when2heat-20230727',
            'name': f'{field} — Polska {YEAR}', 'category': 'HEAT_PUMP_EFFICIENCY' if cop else 'HEAT_DEMAND',
            'kind': 'SIMULATED', 'quantity': 'coefficient_of_performance' if cop else 'normalized_thermal_power',
            'unit': '1' if cop else 'MW/TWh', 'timeBasis': 'UTC', 'resolutionMinutes': 60,
            'start': points[0]['timestamp'], 'end': points[-1]['timestamp'], 'series': points,
            'metadata': {'country': 'PL', 'year': YEAR, 'calendarTimezone': 'Europe/Warsaw', 'originalColumn': field, 'description': descriptions.get(field),
                         'geographicalResolution': 'country', 'reviewStatus': 'CANDIDATE',
                         'endSemantics': 'last_interval_start', 'sourceVersion': '2023-07-27',
                         'limitations': 'Model ogólnopolski; nie jest pomiarem pojedynczego budynku. Ciepło i COP nie są zużyciem energii elektrycznej.'},
            'quality': {'pointCount': len(points), 'nullCount': sum(p['value'] is None for p in points), 'expectedPointCount': 8760, 'missingSourceTimestamps': missing, 'filledByImporter': 0}
        })
    # Explicit analytical candidates, not inferred client consumption. The shape
    # is derived from heat/COP and normalized to sum 1 over the UTC year.
    heat = series['PL_heat_profile_space_SFH']
    for source, sink in [('ASHP', 'floor'), ('ASHP', 'radiator'), ('GSHP', 'floor')]:
        cop_field = f'PL_COP_{source}_{sink}'
        coefficients = series[cop_field]
        if any(p['value'] is None or c['value'] is None or c['value'] <= 0 for p, c in zip(heat, coefficients)):
            print(f'Skipped derived profile {source}/{sink}: incomplete heat/COP, no gap filling.', file=sys.stderr)
            continue
        weights = [p['value'] / c['value'] for p, c in zip(heat, coefficients)]
        total = math.fsum(weights)
        points = [{'timestamp': p['timestamp'], 'value': value / total} for p, value in zip(heat, weights)]
        assert abs(math.fsum(p['value'] for p in points) - 1) < 1e-12
        profiles.append({'key': f'when2heat-20230727-pl-electric-space-sfh-{source.lower()}-{sink}-{YEAR}',
                         'sourceKey': 'when2heat-20230727', 'name': f'Pompa {source}, {sink} — udział godzinowy CO, Polska {YEAR}',
                         'category': 'HEAT_PUMP_ELECTRICITY', 'kind': 'DERIVED_SIMULATION', 'quantity': 'annual_electricity_fraction',
                         'unit': 'fraction_of_annual_electricity', 'timeBasis': 'UTC', 'resolutionMinutes': 60,
                         'start': points[0]['timestamp'], 'end': points[-1]['timestamp'], 'series': points,
                         'metadata': {'country': 'PL', 'year': YEAR, 'calendarTimezone': 'Europe/Warsaw', 'reviewStatus': 'CANDIDATE',
                                      'endSemantics': 'last_interval_start', 'inputs': ['PL_heat_profile_space_SFH', cop_field],
                                      'formula': 'w[t]=(heat[t]/COP[t])/sum(heat/COP)',
                                      'limitations': 'Wzorzec szacunkowy z danych zagregowanych. Tylko CO; bez CWU, urządzeń domowych, grzałki pomocniczej i sterowania taryfą. Nie jest wynikiem dla klienta.'},
                         'quality': {'pointCount': 8760, 'nullCount': 0, 'filledByImporter': 0, 'sum': math.fsum(p['value'] for p in points)}})
    catalog = {'sources': [{'key': 'when2heat-20230727', 'title': 'When2Heat Heating Profiles 2023-07-27',
                            'publisher': 'Oliver Ruhnau, Jarusch Muessel / Open Power System Data',
                            'url': BASE, 'downloadUrl': BASE + 'when2heat.csv',
                            'retrievedAt': (OUT / 'retrieved-at.txt').read_text(encoding='utf-8').strip(),
                            'license': 'CC-BY-4.0', 'sha256': sha,
                            'notes': 'Ruhnau, O., Muessel, J. (2023), doi:10.25832/when2heat/2023-07-27. Dane wejściowe: ECMWF, Eurostat, JRC, BDEW/BGW. Wybrano Polskę i rok lokalny 2022; znaczniki zapisano w UTC. Bez uzupełniania braków. Sprawdzono MD5 i rozmiar z datapackage. CSV używa przecinka dziesiętnego, mimo deklaracji decimalChar kropka w metadanych wydawcy.'}],
               'profiles': profiles}
    (OUT / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'profiles': len(profiles), 'points': sum(len(p['series']) for p in profiles), 'sha256': sha, 'nulls': sum(p['quality']['nullCount'] for p in profiles)}))


if __name__ == '__main__':
    main()
