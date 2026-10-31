import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OFFER_TEMPLATE_V3_KEY = 'REFORM_B2C/2026_10_V3' as const;
export const OFFER_TEMPLATE_V3_PAGE_COUNT = 10 as const;

export type OfferTemplateV3PageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type OfferTemplateV3FieldKind =
  | 'client'
  | 'narrative'
  | 'measurement'
  | 'chart-value'
  | 'product'
  | 'financial'
  | 'other-data';

export type OfferTemplateV3TextBinding = {
  selector: string;
  dynamic: boolean;
  fieldKey?: string;
  kind?: OfferTemplateV3FieldKind;
  idHints: string[];
  groupSelector: string;
  groupIdHint?: string;
  sourceTextLength: number;
  sourceTextSha256: string;
};

export type OfferTemplateV3GroupBinding = {
  selector: string;
  idHint?: string;
  fieldKeys: string[];
  scope: 'text-only';
};

export type OfferTemplateV3PageManifest = {
  page: OfferTemplateV3PageNumber;
  file: string;
  width: number;
  height: number;
  viewBox: string;
  sourceSha256: string;
  textBindings: OfferTemplateV3TextBinding[];
  groupBindings: OfferTemplateV3GroupBinding[];
};

export type OfferTemplateV3Manifest = {
  key: typeof OFFER_TEMPLATE_V3_KEY;
  pageCount: typeof OFFER_TEMPLATE_V3_PAGE_COUNT;
  fontFamily: 'DM Sans';
  pages: OfferTemplateV3PageManifest[];
  limitations: readonly string[];
};

export type OfferTemplateV3RenderResult = {
  page: OfferTemplateV3PageNumber;
  svg: string;
  sourceSha256: string;
  replacedFieldKeys: string[];
  limitations: readonly string[];
};

const TEMPLATE_DIRECTORY = path.join(
  process.cwd(),
  'assets',
  'offer-templates',
  'REFORM_B2C',
  '2026_10_V3',
);

const PAGE_GEOMETRY: Readonly<Record<OfferTemplateV3PageNumber, { width: number; height: number; viewBox: string }>> = {
  1: { width: 595, height: 843, viewBox: '0 0 595 843' },
  2: { width: 595, height: 843, viewBox: '0 0 595 843' },
  3: { width: 595, height: 843, viewBox: '0 0 595 843' },
  4: { width: 595, height: 843, viewBox: '0 0 595 843' },
  5: { width: 595, height: 842, viewBox: '0 0 595 842' },
  6: { width: 595, height: 842, viewBox: '0 0 595 842' },
  7: { width: 595, height: 842, viewBox: '0 0 595 842' },
  8: { width: 595, height: 842, viewBox: '0 0 595 842' },
  9: { width: 595, height: 843, viewBox: '0 0 595 843' },
  10: { width: 595, height: 843, viewBox: '0 0 595 843' },
};

const SOURCE_SHA256: Readonly<Record<OfferTemplateV3PageNumber, string>> = {
  1: 'cc399314c2891c456a8612184dd46edec5f63d63154b0dd440acf0cb3320d852',
  2: '6785ea3d2325ede6bc6a3fc7ec77e99421d99d1946124af998578cd8547a12e3',
  3: '6b58ad5cf061e51e78ba5ce4a16d5011922edbfc2e8815aa97368ad28a152177',
  4: '5f549d3899e2ed3fa28edd21b0daf038f5807d340626d07fe48fddb2dbc16ae2',
  5: 'e7a119c3f987cc2bf75b3e3ecac1bc469642fa907d81d25dfcfdc3f6e8d3f6c6',
  6: '01745a4afcdf25d48653be26e5c2882a60962c3b88ff38cdeb5626549d4b7797',
  7: 'db269175d56245239a2a7354aea9fd123da8d50a074e3e0bd1ef7f45c4522b63',
  8: 'afb4e25efaed7cde4551261bdb6a7584da94281b128533480cc05c43c1bc8be5',
  9: '5fdbe78a4e72f8765fa4ccc3f9c0bb749eb8bff822040c7aab2890196c2ae8b0',
  10: 'a50745e6f0905e4e722acfd39b0132efe4304637dbb9b3970fd2eef16a183438',
};

export const OFFER_TEMPLATE_V3_LIMITATIONS = Object.freeze([
  'Renderowanie podmienia wyłącznie jawnie dostarczone węzły tekstowe.',
  'Wykresy, tabele wektorowe, zdjęcia i grupy ilustracji nie są jeszcze przeliczane ani podmieniane.',
  'Nie ma jeszcze zawijania tekstu, dopasowania fontu, podglądu w CRM ani generowania PDF.',
  'Nie należy używać pakietu jako gotowej oferty, dopóki komplet danych i elementy graficzne nie zostaną zintegrowane.',
]);

type LocatedText = {
  node: XmlNode & { data: string };
  selector: string;
  textElement: XmlElement;
  groupElement: XmlElement;
  idHints: string[];
  groupIdHint?: string;
};

type ParsedPage = {
  source: string;
  sourceSha256: string;
  document: XmlDocument & { documentElement: XmlElement };
  geometry: { width: number; height: number; viewBox: string };
  textNodes: LocatedText[];
};

function pageFile(page: OfferTemplateV3PageNumber) {
  return `page-${String(page).padStart(2, '0')}.svg`;
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function parseXml(source: string, fileName: string): XmlDocument & { documentElement: XmlElement } {
  const errors: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') errors.push(`${level}: ${message}`);
    },
  }).parseFromString(source, 'image/svg+xml');
  if (errors.length) throw new Error(`Niepoprawny XML ${fileName}: ${errors.join('; ')}`);
  if (!document.documentElement || document.documentElement.localName !== 'svg') {
    throw new Error(`Plik ${fileName} nie ma elementu głównego <svg>.`);
  }
  return document as XmlDocument & { documentElement: XmlElement };
}

function elementName(element: XmlElement) {
  return element.localName || element.tagName;
}

function elementSelector(element: XmlElement) {
  const chain: Array<{ name: string; index: number }> = [];
  let current: XmlNode | null = element;
  while (current && current.nodeType === 1) {
    const siblings = Array.from(current.parentNode?.childNodes || []).filter((node) => node.nodeType === 1);
    chain.unshift({ name: elementName(current as XmlElement), index: siblings.indexOf(current) + 1 });
    current = current.parentNode;
  }
  return chain.map(({ name, index }) => `/${name}[${index}]`).join('');
}

function nodeSelector(node: XmlNode) {
  if (!node.parentNode || node.parentNode.nodeType !== 1) throw new Error('Tekst SVG nie ma rodzica-elementu.');
  const siblings = Array.from(node.parentNode.childNodes || []).filter((child) => child.nodeType === 3 || child.nodeType === 4);
  const index = siblings.indexOf(node) + 1;
  if (index < 1) throw new Error('Nie można wyznaczyć ścieżki węzła tekstowego SVG.');
  return `${elementSelector(node.parentNode as XmlElement)}/text()[${index}]`;
}

function allAncestorIds(element: XmlElement) {
  const ids: string[] = [];
  for (let current: XmlNode | null = element; current && current.nodeType === 1; current = current.parentNode) {
    const id = (current as XmlElement).getAttribute('id');
    if (id) ids.push(id);
  }
  return ids;
}

function collectTextNodes(document: XmlDocument): LocatedText[] {
  const found: LocatedText[] = [];
  const textElements = Array.from(document.getElementsByTagName('text')) as XmlElement[];

  const walkText = (node: XmlNode, textElement: XmlElement, groupElement: XmlElement) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        const data = (child as XmlNode & { data: string }).data;
        if (data.trim()) {
          const ids = allAncestorIds(textElement);
          const groupIdHint = groupElement.getAttribute('id') || undefined;
          found.push({
            node: child as XmlNode & { data: string },
            selector: nodeSelector(child),
            textElement,
            groupElement,
            idHints: ids,
            groupIdHint,
          });
        }
      } else if (child.nodeType === 1) {
        walkText(child, textElement, groupElement);
      }
    }
  };

  for (const textElement of textElements) {
    let groupElement: XmlElement = textElement;
    for (let parent = textElement.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
      if (elementName(parent as XmlElement).toLowerCase() === 'g') {
        groupElement = parent as XmlElement;
        break;
      }
    }
    walkText(textElement, textElement, groupElement);
  }
  return found;
}

function isFixedAxisOrPageText(page: OfferTemplateV3PageNumber, text: string, ids: string[]) {
  if (/^\d+\/10$/.test(text.trim())) return true;
  const joinedIds = ids.join(' ').toLowerCase();
  if (/jednostki_wykres|jenostki_wykres|group 1258/.test(joinedIds) && /^[-+]?\d[\d\s,.]*$/.test(text.trim())) return true;
  if (page >= 5 && page <= 8 && /^\d{2}$/.test(text.trim()) && /group 1258/i.test(joinedIds)) return true;
  return false;
}

function semanticIds(ids: string[]) {
  return ids.filter((id) => {
    const normalized = id.trim().replace(/^_+/, '');
    return !/^(?:\d+|group\s+\d+|xxx(?:_adres(?:_\d+)?|_\d+)?|dane osobowe)$/i.test(normalized);
  });
}

function fieldKind(page: OfferTemplateV3PageNumber, text: string, ids: string[]): OfferTemplateV3FieldKind {
  const joinedIds = semanticIds(ids).join(' ').toLowerCase();
  const normalized = text.toLowerCase();
  if (/opis_oferty/.test(joinedIds) || text.length > 100) return 'narrative';
  if (/model|produkt|pozycja_|ilosc_|cena_jednostkowa|nazwa_modelu|nazwa_pozycji/.test(joinedIds)) return 'product';
  if (/kwota_|rachunek|koszt|wartosc_|oszczed|depozyt|dotac|ulga|oplata|cena_|pln|vat/.test(joinedIds)) return 'financial';
  if (/#|klient|nazw|firma|adres|telefon|mail|kod_poczt|miasto/.test(joinedIds)) return 'client';
  if (/taryf|okres_|miesiac|rok_|zuzycie|energia|produkc|autokonsump|kwh|kwp|moc_|pv|magazyn/.test(joinedIds)) return 'measurement';
  if (/wykres|podsumowanie_roczne|przeplyw|rozliczenie|group 1258|xxx/.test(joinedIds) || /\b(?:solis|dyness|g\d{1,2}|enea|net-billing|net-metering)\b/i.test(normalized)) return 'chart-value';
  if (page >= 3 && page <= 9 && /\d|x{2,}/i.test(normalized)) return 'chart-value';
  if (page === 2 && text.length > 40) return 'narrative';
  return 'other-data';
}

function isDynamicText(page: OfferTemplateV3PageNumber, text: string, ids: string[]) {
  const normalized = text.trim();
  const directId = ids[0]?.toLowerCase().replace(/^_+/, '') || '';
  if (!normalized || isFixedAxisOrPageText(page, normalized, ids)) return false;
  if (/^#|numer_oferty|nazwa_(?:modelu|pozycji)|pozycja_\d|ilosc_|cena_|wartosc_|kwota_|rachunek|zuzycie|energia_.*(?:kwh|pln)|taryfa(?:_\d)?$|system_rozliczeniowy(?:_\d)?$|miesiac_|okres_|depozyt|oplaty_.*kwota|dotac|ulga|oszczed.*(?:kwota|%)|opis_oferty_opis|produkc.*(?:kwh|pln)|autokonsump.*(?:kwh|pln)|moc_.*(?:kw|kwp)|^xxx(?:_\d+)?$/i.test(directId)) {
    return true;
  }
  if (ids.some((id) => /opis_oferty_opis/i.test(id))) return true;
  if (/^(?:xx+|x{2,}|nr\s+x|x\s*x{2,}|\+xx?%|xxx)$/i.test(normalized) || /\b(?:Solis|Dyness|G\d{1,2}(?:\s?active)?|ENEA|PGE|net-billing|net-metering)\b/i.test(normalized)) return true;
  if (/\d/.test(normalized)) return true;
  if (text.length > 80) return true;
  return false;
}

function readPage(page: OfferTemplateV3PageNumber): ParsedPage {
  const file = pageFile(page);
  const filePath = path.join(TEMPLATE_DIRECTORY, file);
  const bytes = fs.readFileSync(filePath);
  const source = bytes.toString('utf8');
  const sourceSha256 = sha256(bytes);
  if (sourceSha256 !== SOURCE_SHA256[page]) {
    throw new Error(`Hash szablonu ${file} nie odpowiada wersji ${OFFER_TEMPLATE_V3_KEY}.`);
  }

  const document = parseXml(source, file);
  const root = document.documentElement;
  const geometry = {
    width: Number(root.getAttribute('width')),
    height: Number(root.getAttribute('height')),
    viewBox: root.getAttribute('viewBox') || '',
  };
  const expected = PAGE_GEOMETRY[page];
  if (geometry.width !== expected.width || geometry.height !== expected.height || geometry.viewBox !== expected.viewBox) {
    throw new Error(`Geometria strony ${page} nie odpowiada oryginalnemu SVG.`);
  }

  return { source, sourceSha256, document, geometry, textNodes: collectTextNodes(document) };
}

function makePageManifest(page: OfferTemplateV3PageNumber): OfferTemplateV3PageManifest {
  const parsed = readPage(page);
  const groupFields = new Map<string, OfferTemplateV3GroupBinding>();
  const fieldKeyCounts = new Map<string, number>();

  const textBindings = parsed.textNodes.map((entry) => {
    const sourceText = entry.node.data;
    const dynamic = isDynamicText(page, sourceText, entry.idHints);
    const kind = dynamic ? fieldKind(page, sourceText, entry.idHints) : undefined;
    const semanticId = semanticIds(entry.idHints)[0] || kind || 'text';
    const slug = semanticId
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'text';
    const count = dynamic ? (fieldKeyCounts.get(slug) || 0) + 1 : 0;
    if (dynamic) fieldKeyCounts.set(slug, count);
    const binding: OfferTemplateV3TextBinding = {
      selector: entry.selector,
      dynamic,
      ...(dynamic ? {
        fieldKey: `p${String(page).padStart(2, '0')}-${slug}-${String(count).padStart(3, '0')}`,
        kind,
      } : {}),
      idHints: entry.idHints,
      groupSelector: elementSelector(entry.groupElement),
      groupIdHint: entry.groupIdHint,
      sourceTextLength: sourceText.length,
      sourceTextSha256: sha256(sourceText),
    };
    if (dynamic && binding.fieldKey) {
      const key = binding.groupSelector;
      const existing = groupFields.get(key);
      if (existing) existing.fieldKeys.push(binding.fieldKey);
      else groupFields.set(key, {
        selector: key,
        idHint: entry.groupIdHint,
        fieldKeys: [binding.fieldKey],
        scope: 'text-only',
      });
    }
    return binding;
  });

  const selectors = textBindings.map((binding) => binding.selector);
  if (new Set(selectors).size !== selectors.length) {
    throw new Error(`Powielona ścieżka tekstu na stronie ${page}.`);
  }
  return {
    page,
    file: pageFile(page),
    ...parsed.geometry,
    sourceSha256: parsed.sourceSha256,
    textBindings,
    groupBindings: Array.from(groupFields.values()),
  };
}

export function inspectOfferTemplateV3(): OfferTemplateV3Manifest {
  const pages = Array.from({ length: OFFER_TEMPLATE_V3_PAGE_COUNT }, (_, index) => makePageManifest((index + 1) as OfferTemplateV3PageNumber));
  const keys = pages.flatMap((page) => page.textBindings.filter((binding) => binding.dynamic).map((binding) => binding.fieldKey!));
  if (new Set(keys).size !== keys.length) throw new Error('Powielony klucz dynamicznego pola w manifeście V3.');
  return {
    key: OFFER_TEMPLATE_V3_KEY,
    pageCount: OFFER_TEMPLATE_V3_PAGE_COUNT,
    fontFamily: 'DM Sans',
    pages,
    limitations: OFFER_TEMPLATE_V3_LIMITATIONS,
  };
}

function resolveTextNode(document: XmlDocument, selector: string) {
  const parts = selector.split('/').filter(Boolean);
  let current: XmlNode = document;
  for (const part of parts) {
    const textMatch = /^text\(\)\[(\d+)\]$/.exec(part);
    if (textMatch) {
      const textNodes = Array.from(current.childNodes || []).filter((node) => node.nodeType === 3 || node.nodeType === 4);
      const textNode = textNodes[Number(textMatch[1]) - 1] as (XmlNode & { data: string }) | undefined;
      if (!textNode) throw new Error(`Nie znaleziono selektora tekstowego SVG ${selector}.`);
      return textNode;
    }
    const elementMatch = /^([^[]+)\[(\d+)\]$/.exec(part);
    if (elementMatch) {
      const [, expectedName, indexText] = elementMatch;
      const elements = Array.from(current.childNodes || []).filter((node) => node.nodeType === 1) as XmlElement[];
      const next = elements[Number(indexText) - 1];
      if (!next || elementName(next) !== expectedName) throw new Error(`Nie znaleziono selektora SVG ${selector}.`);
      current = next;
      continue;
    }
    throw new Error(`Nieobsługiwany selektor SVG ${selector}.`);
  }
  throw new Error(`Selektor SVG ${selector} nie wskazuje węzła tekstowego.`);
}

export function renderOfferTemplateV3Page(
  page: OfferTemplateV3PageNumber,
  values: Readonly<Record<string, string>>,
): OfferTemplateV3RenderResult {
  const manifest = makePageManifest(page);
  const dynamicBindings = manifest.textBindings.filter((binding) => binding.dynamic);
  const requiredKeys = new Set(dynamicBindings.map((binding) => binding.fieldKey!));
  const providedKeys = Object.keys(values);
  const missing = Array.from(requiredKeys).filter((key) => !Object.prototype.hasOwnProperty.call(values, key));
  const unexpected = providedKeys.filter((key) => !requiredKeys.has(key));
  const empty = Array.from(requiredKeys).filter((key) => typeof values[key] !== 'string' || values[key].trim().length === 0);
  if (missing.length || unexpected.length || empty.length) {
    throw new Error([
      missing.length ? `Brak dynamicznych wartości: ${missing.join(', ')}` : '',
      empty.length ? `Puste dynamiczne wartości: ${empty.join(', ')}` : '',
      unexpected.length ? `Nieznane pola: ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; '));
  }

  const parsed = readPage(page);
  for (const binding of dynamicBindings) {
    try {
      resolveTextNode(parsed.document, binding.selector).data = values[binding.fieldKey!];
    } catch (error) {
      throw new Error(`Nie można podmienić pola ${binding.fieldKey} (${binding.selector}): ${String(error)}`);
    }
  }

  const root = parsed.document.documentElement;
  const geometryAfter = {
    width: Number(root.getAttribute('width')),
    height: Number(root.getAttribute('height')),
    viewBox: root.getAttribute('viewBox') || '',
  };
  if (JSON.stringify(geometryAfter) !== JSON.stringify(manifest.width ? {
    width: manifest.width,
    height: manifest.height,
    viewBox: manifest.viewBox,
  } : null)) throw new Error('Renderer zmienił geometrię strony SVG.');

  const svg = new XMLSerializer().serializeToString(parsed.document);
  parseXml(svg, manifest.file);
  return {
    page,
    svg,
    sourceSha256: manifest.sourceSha256,
    replacedFieldKeys: Array.from(requiredKeys),
    limitations: OFFER_TEMPLATE_V3_LIMITATIONS,
  };
}
