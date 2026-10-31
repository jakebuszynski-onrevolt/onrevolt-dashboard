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

export const OFFER_TEMPLATE_V4_KEY = 'REFORM_B2C/2026_10_V4' as const;
export const OFFER_TEMPLATE_V4_PAGE_COUNT = 10 as const;
export type OfferTemplateV4PageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type OfferTemplateV4FieldBinding = {
  id: string;
  selector: string;
  sourceTextSha256: string;
};

export type OfferTemplateV4SemanticGroup = {
  id: string;
  selector: string;
};

export type OfferTemplateV4PageManifest = {
  page: OfferTemplateV4PageNumber;
  file: string;
  width: number;
  height: number;
  viewBox: string;
  sourceSha256: string;
  fields: OfferTemplateV4FieldBinding[];
  semanticGroups: OfferTemplateV4SemanticGroup[];
};

export type OfferTemplateV4Manifest = {
  key: typeof OFFER_TEMPLATE_V4_KEY;
  pageCount: typeof OFFER_TEMPLATE_V4_PAGE_COUNT;
  fontFamily: 'DM Sans';
  pages: OfferTemplateV4PageManifest[];
  limitations: readonly string[];
};

export type OfferTemplateV4RenderResult = {
  page: OfferTemplateV4PageNumber;
  svg: string;
  sourceSha256: string;
  replacedFieldIds: string[];
};

const TEMPLATE_DIRECTORY = path.join(
  process.cwd(), 'assets', 'offer-templates', 'REFORM_B2C', '2026_10_V4',
);

const PAGE_GEOMETRY: Readonly<Record<OfferTemplateV4PageNumber, { width: number; height: number; viewBox: string }>> = {
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

const SOURCE_SHA256: Readonly<Record<OfferTemplateV4PageNumber, string>> = {
  1: '8cd3db6f7b7838ed4e0c16c08f2ec515f18f4774aa5da6120451d349a8155933',
  2: '4e7624a265996f1df6578efe6c3118a3f350d6eb72a14f48c2723e8678c4d6d2',
  3: '52b16fc6a33ce2021bbfe6a522c44118aea7730e353421680b784b09e0a4804d',
  4: '5fb0b97135e9955ab7d2d176e23cc15c99c2d536d5dd26a8d564fbdacd06b9c6',
  5: 'efaff2a32d846522ce378c19e01064961ce4f2d2f17f52b380aa48693ccbca89',
  6: 'd4327f6380969d53b3ed44435841826bcaccd17d05f076e18db751c03f3b8f45',
  7: '86140c1da37471ccd665e20f2aff3ffabb6f699c36e8fe851758fda4873074d3',
  8: 'c67eaed73a91c0b0012749d8daed010cb929755872573b458ed4468bcf575cc9',
  9: 'd42f1948384bae50931583b4d40172158598fcf8140e6b4d43df1065a170050b',
  10: '7b18ededc6ccc2ae04408b05e8ec52eb2a1aabb0af378a8af2b422fd35b4c85b',
};

export const OFFER_TEMPLATE_V4_LIMITATIONS = Object.freeze([
  'V4 zachowuje źródłowe SVG; renderer podmienia tylko jawne pola #b2c_ oraz dane wykresów.',
  'Prognoza, rozliczenia taryfowe, dotacje, ulgi, oszczędności i zwrot wymagają osobnych wyników obliczeń; tutaj pozostają nieznane.',
  'Nie należy traktować dokumentu jako finalnej oferty, dopóki braki danych i obliczeń nie zostaną uzupełnione.',
]);

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
  if (errors.length || !document.documentElement || document.documentElement.localName !== 'svg') {
    throw new Error(`Niepoprawny SVG ${fileName}${errors.length ? `: ${errors.join('; ')}` : ''}`);
  }
  return document as XmlDocument & { documentElement: XmlElement };
}

function elementSelector(element: XmlElement) {
  const chain: Array<{ name: string; index: number }> = [];
  for (let current: XmlNode | null = element; current && current.nodeType === 1; current = current.parentNode) {
    const siblings = Array.from(current.parentNode?.childNodes || []).filter((node) => node.nodeType === 1);
    chain.unshift({ name: (current as XmlElement).localName || (current as XmlElement).tagName, index: siblings.indexOf(current) + 1 });
  }
  return chain.map(({ name, index }) => `/${name}[${index}]`).join('');
}

function pageFile(page: OfferTemplateV4PageNumber) {
  return `page-${String(page).padStart(2, '0')}.svg`;
}

function readPage(page: OfferTemplateV4PageNumber) {
  const file = pageFile(page);
  const bytes = fs.readFileSync(path.join(TEMPLATE_DIRECTORY, file));
  const sourceSha256 = sha256(bytes);
  if (sourceSha256 !== SOURCE_SHA256[page]) throw new Error(`Hash szablonu ${file} nie odpowiada wersji ${OFFER_TEMPLATE_V4_KEY}.`);
  const document = parseXml(bytes.toString('utf8'), file);
  const root = document.documentElement;
  const geometry = {
    width: Number(root.getAttribute('width')),
    height: Number(root.getAttribute('height')),
    viewBox: root.getAttribute('viewBox') || '',
  };
  const expected = PAGE_GEOMETRY[page];
  if (geometry.width !== expected.width || geometry.height !== expected.height || geometry.viewBox !== expected.viewBox) {
    throw new Error(`Geometria strony ${page} nie odpowiada oryginalnemu SVG V4.`);
  }
  return { source: bytes.toString('utf8'), document, sourceSha256, geometry };
}

function makePageManifest(page: OfferTemplateV4PageNumber): OfferTemplateV4PageManifest {
  const parsed = readPage(page);
  const elements = Array.from(parsed.document.getElementsByTagName('*')) as XmlElement[];
  const fieldElements = elements.filter((element) => /^#b2c_.+_strona_\d{2}(?:_\d+)?$/.test(element.getAttribute('id')));
  const fieldIds = fieldElements.map((element) => element.getAttribute('id'));
  if (new Set(fieldIds).size !== fieldIds.length) throw new Error(`Powielone pole #b2c_ na stronie ${page}.`);
  const pageSuffix = String(page).padStart(2, '0');
  if (fieldIds.some((id) => id.match(/_strona_(\d{2})(?:_\d+)?$/)?.[1] !== pageSuffix)) {
    throw new Error(`Pole #b2c_ wskazuje niewłaściwą stronę ${page}.`);
  }
  const fields = fieldElements.map((element) => ({
    id: element.getAttribute('id'),
    selector: elementSelector(element),
    sourceTextSha256: sha256(element.textContent || ''),
  }));
  if (!fields.length) throw new Error(`Brak jawnych pól #b2c_ na stronie ${page}.`);
  const semanticGroups = elements
    .filter((element) => /^(?:sekcja|blok|grafika)\s*\//i.test(element.getAttribute('id')))
    .map((element) => ({ id: element.getAttribute('id'), selector: elementSelector(element) }));
  const groupIds = semanticGroups.map((group) => group.id);
  if (new Set(groupIds).size !== groupIds.length) throw new Error(`Powielona semantyczna grupa SVG na stronie ${page}.`);
  return { page, file: pageFile(page), ...parsed.geometry, sourceSha256: parsed.sourceSha256, fields, semanticGroups };
}

export function inspectOfferTemplateV4(): OfferTemplateV4Manifest {
  const pages = Array.from({ length: OFFER_TEMPLATE_V4_PAGE_COUNT }, (_, index) => makePageManifest((index + 1) as OfferTemplateV4PageNumber));
  const ids = pages.flatMap((page) => page.fields.map((field) => field.id));
  if (new Set(ids).size !== ids.length) throw new Error('Powielone jawne pole #b2c_ w manifeście V4.');
  return { key: OFFER_TEMPLATE_V4_KEY, pageCount: OFFER_TEMPLATE_V4_PAGE_COUNT, fontFamily: 'DM Sans', pages, limitations: OFFER_TEMPLATE_V4_LIMITATIONS };
}

function resolveElement(document: XmlDocument, selector: string): XmlElement {
  let current: XmlNode = document;
  for (const part of selector.split('/').filter(Boolean)) {
    const match = /^([^[]+)\[(\d+)\]$/.exec(part);
    if (!match) throw new Error(`Nieobsługiwany selektor SVG ${selector}.`);
    const [, expectedName, index] = match;
    const elements = Array.from(current.childNodes || []).filter((node) => node.nodeType === 1) as XmlElement[];
    const next = elements[Number(index) - 1];
    if (!next || (next.localName || next.tagName) !== expectedName) throw new Error(`Nie znaleziono selektora SVG ${selector}.`);
    current = next;
  }
  if (current.nodeType !== 1) throw new Error(`Selektor SVG ${selector} nie wskazuje elementu.`);
  return current as XmlElement;
}

function replaceText(element: XmlElement, value: string) {
  const spans = Array.from(element.getElementsByTagName('tspan')) as XmlElement[];
  if (!spans.length) {
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(element.ownerDocument!.createTextNode(value));
    return;
  }
  const textNodes: Array<XmlNode & { data: string }> = [];
  const walk = (node: XmlNode) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3 || child.nodeType === 4) textNodes.push(child as XmlNode & { data: string });
      else if (child.nodeType === 1) walk(child);
    }
  };
  walk(element);
  if (textNodes.length) {
    textNodes[0].data = value;
    textNodes.slice(1).forEach((node) => { node.data = ''; });
  } else spans[0].appendChild(element.ownerDocument!.createTextNode(value));
}

export function renderOfferTemplateV4Page(
  page: OfferTemplateV4PageNumber,
  values: Readonly<Record<string, string>>,
): OfferTemplateV4RenderResult {
  const manifest = makePageManifest(page);
  const required = new Set(manifest.fields.map((field) => field.id));
  const provided = Object.keys(values);
  const missing = [...required].filter((id) => !Object.prototype.hasOwnProperty.call(values, id));
  const unexpected = provided.filter((id) => !required.has(id));
  const empty = [...required].filter((id) => typeof values[id] !== 'string');
  if (missing.length || unexpected.length || empty.length) {
    throw new Error([
      missing.length ? `Brak wartości pól V4: ${missing.join(', ')}` : '',
      empty.length ? `Niepoprawne wartości pól V4: ${empty.join(', ')}` : '',
      unexpected.length ? `Nieznane pola V4: ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; '));
  }
  const parsed = readPage(page);
  for (const field of manifest.fields) replaceText(resolveElement(parsed.document, field.selector), values[field.id]);
  const svg = new XMLSerializer().serializeToString(parsed.document);
  parseXml(svg, manifest.file);
  return { page, svg, sourceSha256: manifest.sourceSha256, replacedFieldIds: [...required] };
}
