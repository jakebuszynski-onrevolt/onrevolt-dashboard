import { NextRequest, NextResponse } from 'next/server';
import {
  getTypeformForm,
  simplifyTypeformFieldsFull,
  type TypeformField,
  type SimplifiedTFField,
} from '../../../../clients/typeform';

// ---- CONFIG ----
const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : '');
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || '';

type Entity = 'deal' | 'person';

// prefiks dla pól raportowych
const NAME_PREFIX = 'raport_';

// ---- PIPEDRIVE HELPERS ----
function ep(entity: Entity) {
  return entity === 'person' ? 'personFields' : 'dealFields';
}

async function listFields(entity: Entity) {
  let start = 0;
  const limit = 500;
  const out: any[] = [];
  for (;;) {
    const url = `${BASE}/${ep(entity)}?start=${start}&limit=${limit}`;
    const r = await fetch(url, {
      headers: { 'x-api-token': TOKEN },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${await r.text()}`);
    const j = await r.json();
    out.push(...(j?.data ?? []));
    const more = j?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start = j?.additional_data?.pagination?.next_start ?? start + limit;
  }
  return out.map((f: any) => ({
    id: f.id,
    key: f.key,
    name: f.name,
    field_type: f.field_type,
    options: (f.options ?? []).map((o: any) => o.label),
  }));
}

// ---- SANITIZER / NORMALIZER ----
function sanitizeToSnakeCase(input: string, refForFallback?: string, maxLen = 50) {
  let s = (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^A-Za-z0-9]+/g, '_');
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  s = s.toLowerCase();
  if (!s || /^\d/.test(s)) s = `f_${s}`;
  if (s.length > maxLen) s = s.slice(0, maxLen);
  if (!s) s = `field_${(refForFallback || '').slice(0, 8).toLowerCase()}`;
  return s;
}
function normalizeForCompare(name: string) {
  return sanitizeToSnakeCase(name || '', '', 200);
}

// ---- MAPOWANIE TF -> PD ----
type PdType = 'varchar' | 'text' | 'double' | 'enum' | 'set' | 'phone' | 'date';

function mapTfToPdType(tfType: TypeformField, multi?: boolean): PdType | undefined {
  switch (tfType) {
    case 'short_text':
    case 'email':
      return 'varchar';
    case 'long_text':
    case 'file_upload':
      return 'text';
    case 'number':
    case 'opinion_scale':
    case 'rating':
      return 'double';
    case 'date':
      return 'date';
    case 'dropdown':
      return 'enum';
    case 'multiple_choice':
      return multi ? 'set' : 'enum';
    case 'yes_no':
      return 'enum';
    case 'phone_number':
      return 'phone';
    case 'contact_info':
    case 'group':
    case 'inline_group':
    case 'legal':
      return undefined;
    default:
      return undefined;
  }
}

function isPersonish(tf: SimplifiedTFField) {
  const t = tf.type;
  const ref = tf.ref || '';
  const title = (tf.title || '').toLowerCase();
  if (t === 'email' || t === 'phone_number') return true;
  if (/__(first_name|last_name|email|phone)$/.test(ref)) return true;
  if (/\b(first\s*name|last\s*name)\b/i.test(title)) return true;
  if (title === 'user_id' || /user[_\s]?id/.test(ref)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  try {
    if (!TOKEN) return new Response('Missing PIPEDRIVE_API_TOKEN', { status: 500 });
    if (!BASE) return new Response('Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN', { status: 500 });

    const url = new URL(req.url);
    const formId = url.searchParams.get('form_id') || process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID || '';
    const entity = (url.searchParams.get('entity') as Entity) || 'deal';

    if (!formId) {
      return new Response('Missing form_id (query) or NEXT_PUBLIC_TYPEFORM_FORM_ID', { status: 400 });
    }

    // 1) Typeform (spłaszczone pola)
    const form = await getTypeformForm(formId);
    const tfFlat = simplifyTypeformFieldsFull(form);

    // 2) Filtr encji
    const tfForEntity = tfFlat.filter((tf) => {
      if (entity === 'deal' && isPersonish(tf)) return false;
      if (entity === 'person' && !isPersonish(tf)) return false;
      return true;
    });

    // 3) Mapowanie + SUGEROWANA NAZWA z prefiksem "raport_"
    const seen = new Set<string>(); // trzymamy znormalizowane nazwy, żeby były unikalne
    const tfMappable = tfForEntity
      .map((tf) => {
        const pdType = mapTfToPdType(tf.type, tf.multi);
        if (!pdType) return null;

        const base = sanitizeToSnakeCase(tf.title, tf.ref);
        const withPrefixBase = `${NAME_PREFIX}${base}`; // << prefiks
        let suggested = withPrefixBase;

        // zapewnij unikalność (sprawdzamy po znormalizowanej nazwie)
        let normalized = normalizeForCompare(suggested);
        let i = 1;
        while (seen.has(normalized)) {
          suggested = `${withPrefixBase}_${(tf.ref || '').slice(0, 6).toLowerCase()}${i > 1 ? `_${i}` : ''}`;
          normalized = normalizeForCompare(suggested);
          i++;
        }
        seen.add(normalized);

        return {
          ref: tf.ref,
          title: tf.title,
          tf_type: tf.type,
          pd_type: pdType,
          options: tf.type === 'yes_no' ? ['Yes', 'No'] : (tf as any).options,
          suggested_name: suggested, // << już z prefiksem
        };
      })
      .filter(Boolean) as Array<{
        ref: string;
        title: string;
        tf_type: TypeformField;
        pd_type: PdType;
        options?: string[];
        suggested_name: string;
      }>;

    // 4) Pipedrive – pola
    const pdFields = await listFields(entity);

    // 5) Porównanie: PD po znormalizowanych nazwach
    const pdByNormName = new Map(pdFields.map((f) => [normalizeForCompare(f.name), f]));

    const missing = tfMappable
      .map((tf) => {
        const match = pdByNormName.get(normalizeForCompare(tf.suggested_name)); // porównanie do "raport_*"
        if (match) {
          return {
            tf_ref: tf.ref,
            tf_title: tf.title,
            tf_type: tf.tf_type,
            pd_suggested: { name: tf.suggested_name, field_type: tf.pd_type, options: tf.options },
            exists_in_pipedrive: true,
            existing_pd: match,
          };
        }
        return {
          tf_ref: tf.ref,
          tf_title: tf.title,
          tf_type: tf.tf_type,
          pd_suggested: { name: tf.suggested_name, field_type: tf.pd_type, options: tf.options },
          exists_in_pipedrive: false,
        };
      })
      .filter((row) => !row.exists_in_pipedrive);

    return NextResponse.json({
      form: { id: form.id, title: form.title },
      entity,
      typeform_fields: tfMappable,
      pipedrive_fields: pdFields,
      missing_on_pipedrive: missing,
      // legacy key for older UI:
      missing,
      naming_convention:
        'prefix "raport_" + snake_case ascii (no diacritics), lowercase, non-alnum -> _, collapse _, prefix f_ if starts with digit',
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'coś poszło nie tak' }, { status: 400 });
  }
}
