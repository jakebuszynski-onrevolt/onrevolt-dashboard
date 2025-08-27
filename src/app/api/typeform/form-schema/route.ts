import { NextRequest } from "next/server";

// === Pomocnicze typy UI ===
type UiField = {
  ref: string;
  label: string;
  uiType:
    | "text" | "textarea" | "email" | "number" | "phone" | "date"
    | "select" | "multiselect" | "radio" | "yesno" | "file" | "checkbox";
  options?: string[];
  multiple?: boolean;
};

function mapTfToUiType(tfType: string, multiple?: boolean): UiField["uiType"] | null {
  switch (tfType) {
    case "short_text":       return "text";
    case "long_text":        return "textarea";
    case "email":            return "email";
    case "number":           return "number";
    case "phone_number":     return "phone";
    case "date":             return "date";
    case "dropdown":         return "select";
    case "multiple_choice":  return multiple ? "multiselect" : "radio";
    case "yes_no":           return "yesno";
    case "file_upload":      return "file";
    case "legal":            return "checkbox";
    // grupy/separatory stron obsługujemy osobno:
    case "group":
    case "inline_group":
      return null;
    default:
      return null; // inne typy (statement, picture, ranking etc.) pomijamy
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const formId =
      url.searchParams.get("form_id") ||
      process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID ||
      "";

    const token = process.env.TYPEFORM_TOKEN || "";
    if (!formId) return new Response("Missing form_id or NEXT_PUBLIC_TYPEFORM_FORM_ID", { status: 400 });
    if (!token) return new Response("Missing TYPEFORM_TOKEN", { status: 500 });

    // 1) Pobierz surowy formularz z Typeform
    const r = await fetch(`https://api.typeform.com/forms/${encodeURIComponent(formId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) {
      return new Response(`Typeform /forms/${formId} ${r.status}: ${await r.text()}`, { status: 502 });
    }
    const form = await r.json();

    // 2) Funkcja: zamień pole TF → 1..N pól UI i dołóż do podanej strony
    function pushField(acc: UiField[], f: any) {
      const t: string = f?.type;

      // Contact info rozwijamy na 4 pod-pola
      if (t === "contact_info") {
        const base = String(f?.ref || "");
        acc.push(
          { ref: `${base}__first_name`, label: `${f.title}: first_name`, uiType: "text", multiple: false },
          { ref: `${base}__last_name`,  label: `${f.title}: last_name`,  uiType: "text", multiple: false },
          { ref: `${base}__email`,      label: `${f.title}: email`,      uiType: "email", multiple: false },
          { ref: `${base}__phone`,      label: `${f.title}: phone_number`, uiType: "phone", multiple: false },
        );
        return;
      }

      // multiple_choice / dropdown: wyciągnij listę opcji
      const choices: string[] =
        Array.isArray(f?.properties?.choices)
          ? f.properties.choices.map((c: any) => c?.label).filter(Boolean)
          : [];

      const multiple =
        t === "multiple_choice"
          ? !!f?.properties?.allow_multiple_selections
          : false;

      const ui = mapTfToUiType(t, multiple);
      if (!ui) return;

      acc.push({
        ref: String(f?.ref || f?.id),
        label: String(f?.title || ""),
        uiType: ui,
        options: ui === "radio" || ui === "multiselect" || ui === "select" || ui === "yesno"
          ? (ui === "yesno" ? ["Yes", "No"] : choices)
          : undefined,
        multiple: ui === "multiselect",
      });
    }

    // 3) Buduj strony:
    // - pola na początku (przed 1. grupą) -> strona 1
    // - każde pole 'group' (lub 'inline_group') tworzy nową stronę z tytułem i własnymi polami
    const pages: Array<{ title?: string; fields: UiField[] }> = [];
    let preGroup: UiField[] = [];

    const topFields: any[] = Array.isArray(form?.fields) ? form.fields : [];

    for (const f of topFields) {
      const t = f?.type;

      // Jeżeli to grupa → domknij „preGroup” (jeśli coś w nim jest), potem zbuduj stronę z wnętrza grupy
      if (t === "group" || t === "inline_group") {
        if (preGroup.length) {
          pages.push({ title: undefined, fields: preGroup });
          preGroup = [];
        }

        const inner: any[] =
          Array.isArray(f?.properties?.fields)
            ? f.properties.fields
            : Array.isArray(f?.fields)
              ? f.fields
              : [];

        const pageFields: UiField[] = [];
        inner.forEach((sf) => pushField(pageFields, sf));

        pages.push({ title: String(f?.title || undefined), fields: pageFields });
      } else {
        // Zwykłe pole na top-level → trafia do „preGroup”
        pushField(preGroup, f);
      }
    }

    if (preGroup.length) {
      pages.push({ title: undefined, fields: preGroup });
    }

    // Fallback – gdyby nic nie wyszło (bardzo mało prawdopodobne)
    if (pages.length === 0) {
      pages.push({ title: undefined, fields: [] });
    }

    return Response.json({
      id: form?.id,
      title: form?.title,
      pages,
    });
  } catch (e: any) {
    return new Response(`form-schema error: ${e?.message || e}`, { status: 500 });
  }
}
