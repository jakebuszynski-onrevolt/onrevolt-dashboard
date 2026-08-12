import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(
  process.cwd(),
  'public',
  'offer-templates',
  'reform-b2c',
  '2026-08-v2',
);

function repairMojibake(value: string) {
  if (!/[ÃÄÅ]/.test(value)) return value;
  return Buffer.from(value, 'latin1').toString('utf8');
}

function asciiId(value: string) {
  return repairMojibake(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.:#-]+/g, '_')
    .replace(/_+/g, '_');
}

for (const layer of ['master', 'editable']) {
  const directory = path.join(root, layer);
  for (const fileName of fs.readdirSync(directory).filter((name) => name.endsWith('.svg'))) {
    const filePath = path.join(directory, fileName);
    const document = new DOMParser().parseFromString(fs.readFileSync(filePath, 'utf8'), 'image/svg+xml');
    const elements = Array.from(document.getElementsByTagName('*'));
    const mapping = new Map<string, string>();
    const used = new Set<string>();

    elements.forEach((element) => {
      const oldId = element.getAttribute('id');
      if (!oldId) return;
      const normalized = asciiId(oldId);
      let nextId = normalized;
      let suffix = 2;
      while (used.has(nextId)) nextId = `${normalized}_${suffix++}`;
      used.add(nextId);
      mapping.set(oldId, nextId);
      element.setAttribute('id', nextId);
    });

    elements.forEach((element) => {
      for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index);
        if (!attribute || attribute.name === 'id') continue;
        let value = attribute.value;
        mapping.forEach((nextId, oldId) => {
          value = value.replaceAll(`#${oldId}`, `#${nextId}`);
        });
        if (value !== attribute.value) element.setAttribute(attribute.name, value);
      }
    });

    fs.writeFileSync(filePath, new XMLSerializer().serializeToString(document), 'utf8');
    console.log(`${layer}/${fileName}: ${mapping.size} identyfikatorów`);
  }
}
