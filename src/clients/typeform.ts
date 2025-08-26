// src/clients/typeform.ts
export type TypeformField =
  | "short_text"
  | "long_text"
  | "email"
  | "number"
  | "phone_number"
  | "yes_no"
  | "date"
  | "dropdown"
  | "multiple_choice"
  | "opinion_scale"
  | "rating"
  | "file_upload"
  | "legal"
  | "contact_info"
  | "group"
  | "inline_group"
  | string;

export type TFField = {
  id: string;
  ref: string;
  title: string;
  type: TypeformField;
  properties?: {
    choices?: { id?: string; label: string }[];
    allow_multiple_selection?: boolean;
    // w group/inline_group/others mogą pojawić się zagnieżdżone struktury:
    fields?: any[];
    items?: any[];
    elements?: any[];
    questions?: any[];
  };
  // niektóre odpowiedzi mogą mieć inne atrybuty — zostawiamy „any”
  [k: string]: any;
};

export type TFForm = {
  id: string;
  title: string;
  fields: TFField[];
  hidden?: string[];
};

const TF_BASE = "https://api.typeform.com";

export async function getTypeformForm(formId: string, token?: string): Promise<TFForm> {
  const auth = token ?? process.env.TYPEFORM_TOKEN;
  if (!auth) throw new Error("Missing TYPEFORM_TOKEN");
  const r = await fetch(`${TF_BASE}/forms/${formId}`, {
    headers: { Authorization: `Bearer ${auth}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Typeform GET /forms/${formId} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as TFForm;
}

/** Rekurencyjnie zbiera wszystkie „field-like” obiekty (mają type + id/ref) z dowolnych tablic w properties */
function collectAllFields(form: TFForm): TFField[] {
  const out: TFField[] = [];

  const visit = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node === "object") {
      // jeżeli wygląda jak pole (ma type oraz id/ref) -> do listy
      if (typeof node.type === "string" && (node.id || node.ref)) {
        const f = node as TFField;
        // ensure ref
        (f as any).ref = f.ref || f.id;
        out.push(f);
      }
      // szukaj zagnieżdżonych tablic potencjalnych pól
      const p = node.properties;
      if (p) {
        visit(p.fields);
        visit(p.items);
        visit(p.elements);
        visit(p.questions);
      }
      visit((node as any).fields);
      visit((node as any).items);
      visit((node as any).elements);
      visit((node as any).questions);
    }
  };

  visit(form.fields);
  return out;
}

export type SimplifiedTFField = {
  ref: string;        // unikalny identyfikator (dla pól wirtualnych dodajemy sufiks)
  title: string;      // label użyteczna do porównań
  type: TypeformField;// typ TF (dla „rozbitych” contact_info: short_text/email/phone_number)
  options?: string[];
  multi?: boolean;
  from_container?: {  // info o pochodzeniu (np. rozbicie contact_info)
    parent_ref: string;
    parent_type: string;
  } | null;
};

/** Rozbija contact_info na 4 wirtualne pola (first_name, last_name, email, phone_number) */
function explodeContactInfo(f: TFField): SimplifiedTFField[] {
  const base = {
    from_container: { parent_ref: f.ref || f.id, parent_type: f.type },
  };
  const parentTitle = f.title?.trim() || "Contact info";

  return [
    { ref: `${f.ref}__first_name`, title: `${parentTitle}: first_name`, type: "short_text", ...base },
    { ref: `${f.ref}__last_name`,  title: `${parentTitle}: last_name`,  type: "short_text", ...base },
    { ref: `${f.ref}__email`,      title: `${parentTitle}: email`,      type: "email",      ...base },
    { ref: `${f.ref}__phone`,      title: `${parentTitle}: phone_number`, type: "phone_number", ...base },
  ];
}

/** Spłaszcza wszystkie pola i daje prostą listę do porównań/mappingu */
export function simplifyTypeformFieldsFull(form: TFForm): SimplifiedTFField[] {
  const all = collectAllFields(form);

  const simple: SimplifiedTFField[] = [];
  for (const f of all) {
    // pomijamy czysto layoutowe kontenery – ale zbieramy ich dzieci (już zebrane wyżej)
    if (f.type === "group" || f.type === "inline_group") {
      continue;
    }
    // rozbij contact_info
    if (f.type === "contact_info") {
      simple.push(...explodeContactInfo(f));
      continue;
    }
    simple.push({
      ref: f.ref || f.id,
      title: f.title,
      type: f.type,
      options: f.properties?.choices?.map((c: any) => c.label),
      multi: !!f.properties?.allow_multiple_selection,
      from_container: null,
    });
  }

  // deduplikacja po (ref,title,type) – czasem kontenery zwracają te same dzieci w kilku miejscach
  const seen = new Set<string>();
  return simple.filter((x) => {
    const key = `${x.ref}|${x.title}|${x.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
