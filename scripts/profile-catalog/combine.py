"""Build a source-preserving catalog and compact comparison index, without DB access."""
import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = root / 'output/profile-catalog-20261106'
catalog = {'sources': [], 'profiles': []}
for family in ['bdew', 'opsd', 'when2heat']:
    data = json.loads((out / family / 'catalog.json').read_text(encoding='utf-8'))
    for key in catalog:
        catalog[key].extend(data[key])
for key in catalog:
    assert len({entry['key'] for entry in catalog[key]}) == len(catalog[key]), 'Duplicate keys'
assert all(p['metadata']['reviewStatus'] == 'CANDIDATE' for p in catalog['profiles'])
(out / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
with (out / 'profile-index.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f, delimiter=';')
    writer.writerow(['Klucz', 'Nazwa', 'Źródło', 'Rodzaj', 'Wielkość', 'Jednostka', 'Rozdzielczość min', 'Punkty', 'Brakujące wartości', 'Od', 'Do', 'Status'])
    for p in catalog['profiles']:
        writer.writerow([p['key'], p['name'], p['sourceKey'], p['kind'], p['quantity'], p['unit'], p['resolutionMinutes'], len(p['series']), sum(v['value'] is None for v in p['series']), p['start'], p['end'], 'DO PORÓWNANIA'])
print(json.dumps({'sources':len(catalog['sources']), 'profiles':len(catalog['profiles']), 'points':sum(len(p['series']) for p in catalog['profiles'])}))
