"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReportProject, ReportPage, ReportField } from "@/types/report";
import ReportSvgPage from "./ReportSvgPage"; // nowy import
import { computeField } from "@/lib/fieldExpr";
import { buildYeldsPair } from "@/lib/yelds";
import { buildRoseArray16 } from "@/lib/windrose";

// lokalny cache snapshotów map do druku: fieldId -> dataURL
const mapSnapshotCache: Map<number, string> = new Map();


// Typ trybu – wspólne dla całego edytora
export type Mode = "layout" | "content" | "print";


type ReportFieldValueRow = {
  deal_id: number;
  report_field_id: number;
  value_json: string;
};

async function fetchJSON<T>(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

const getMeta = (f: any): any => {
  const raw = (f as any).meta_json;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
};

type PdDealLite = {
  id?: number | string;
  title?: string;
  custom_by_name?: Record<string, any>;
  person?: {
    name?: string;
    email?: any[];
    phone?: any[];
  } | null;
};

function snake(input: string) {
  return (input || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")
    .toLowerCase();
}

// lazy import + cache dla html2canvas (tylko po stronie przeglądarki)
let _h2c: typeof import("html2canvas")["default"] | null = null;
async function getHtml2Canvas() {
  if (_h2c) return _h2c;
  const mod = await import("html2canvas");
  _h2c = mod.default;
  return _h2c;
}

type CreateFormProps = {
  isAdmin?: boolean;
};

export default function CreateForm({ isAdmin = true }: CreateFormProps) {
  const sp = useSearchParams();
  const dealId = sp.get("deal_id") || undefined;
  const projectIdFromUrl = sp.get("projectId") ?? "1";

  const [projects, setProjects] = useState<ReportProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [pages, setPages] = useState<ReportPage[]>([]);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [mode, setMode] = useState<Mode>("print");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [dbValuesLoaded, setDbValuesLoaded] = useState(false);

  const [showHiddenVvvInLayout, setShowHiddenVvvInLayout] = useState(false);

  // opcjonalnie: jak wychodzisz z layout, to wyłącz
  useEffect(() => {
    if (mode !== "layout" && showHiddenVvvInLayout) setShowHiddenVvvInLayout(false);
  }, [mode, showHiddenVvvInLayout]);


  useEffect(() => {
    if (!projectIdFromUrl) return;
    const idNum = Number(projectIdFromUrl);
    if (!Number.isNaN(idNum)) {
      setSelectedProjectId(idNum);
    }
  }, [projectIdFromUrl]);


  // wybór / panel

  type DealFieldChange = {
    dealId?: number | string;
    reportFieldId: number;
    pdKey: string;
    kind: "text" | "single" | "multi";
    displayValue: string;            // to, co widzisz w formularzu
    pdValue: string | string[];      // to, co wyślemy w body do Pipedrive
    source: "pipedrive" | "manual";  // skąd pochodzi pole
    fieldName: string;               // label / nazwa pola z raportu
  };




  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [inspectorFieldId, setInspectorFieldId] = useState<number | null>(null);

  // >>> bufor zmian do wysłania do Pipedrive
  const [dealChanges, setDealChanges] = useState<DealFieldChange[]>([]);

  // Pipedrive – „gołe” dane z API
  const [pdDeal, setPdDeal] = useState<PdDealLite | null>(null);
  const pdValues = useMemo(() => {
    if (!pdDeal) return {};

    const base: Record<string, any> = {
      ...pdDeal,                        // np. title, person, lat/lon itd.
      ...(pdDeal.custom_by_name || {}), // wszystkie customy po nazwie (raport_*)
    };

    // DODANE: aliasy bez "raport_" -> np. raport_yield -> yield
    const extra: Record<string, any> = {};
    const custom = pdDeal.custom_by_name || {};
    for (const [key, value] of Object.entries(custom)) {
      if (/^raport_/i.test(key)) {
        const short = key.replace(/^raport_+/i, "");
        if (!(short in base) && !(short in extra)) {
          extra[short] = value;
        }
      }
    }

    return { ...base, ...extra };
  }, [pdDeal]);
  // >>> lokalne nadpisania z dealChanges (tylko source === "pipedrive")
  const pdOverrides = useMemo(() => {
    const map: Record<string, any> = {};
    for (const c of dealChanges) {
      if (c.source === "pipedrive" && c.pdKey) {
        map[c.pdKey] = c.pdValue;
      }
    }
    return map;
  }, [dealChanges]);

  // >>> to jest to, co ma widzieć UI (ReportSvgPage, BillsModal)
  const pdViewValues = useMemo(
    () => ({ ...pdValues, ...pdOverrides }),
    [pdValues, pdOverrides]
  );

  const pdKeys = useMemo(() => Object.keys(pdViewValues), [pdViewValues]);


  const [pdAllKeys, setPdAllKeys] = useState<string[]>([]);
  const [pdSelectOptions, setPdSelectOptions] = useState<Record<string, string[]>>({});
  const [pdSelectKinds, setPdSelectKinds] = useState<Record<string, "single" | "multi">>({});
  const [pdCanonicalKeys, setPdCanonicalKeys] = useState<Record<string, string>>({});


  // helper do first/last
  function splitFirstLast(name?: string) {
    const s = (name || "").trim();
    if (!s) return { first_name: "", last_name: "" };
    const [f, ...r] = s.split(/\s+/);
    return { first_name: f || "", last_name: r.join(" ") || "" };
  }

  useEffect(() => {
    // zmiana projektu = nowe fields => trzeba ponownie wciągnąć wartości z bazy
    setDbValuesLoaded(false);

    // opcjonalnie, ale polecam:
    setDealChanges([]);
    setSelectedFieldId(null);
    setInspectorFieldId(null);
  }, [selectedProjectId]);


  // Projekty
  useEffect(() => {
    fetchJSON<ReportProject[]>("/api/report-projects").then(setProjects).catch(console.error);
  }, []);

  // Strony projektu
  useEffect(() => {
    if (selectedProjectId == null) return;
    fetchJSON<ReportPage[]>(`/api/report-pages?projectId=${selectedProjectId}`)
      .then(setPages)
      .catch(console.error);
  }, [selectedProjectId]);

  // Pola projektu
  useEffect(() => {
    if (selectedProjectId == null) return;
    fetch(`/api/report-fields?projectId=${selectedProjectId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setFields)
      .catch(console.error);
  }, [selectedProjectId]);

  // Pipedrive deal -> custom_by_name
  useEffect(() => {
    if (!dealId) {
      setPdDeal(null);
      return;
    }
    (async () => {
      try {
        const r = await fetch(`/api/pipedrive/deals/${dealId}`, { cache: "no-store" });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();

        const custom = j?.custom_by_name || {};
        const person = j?.person || null;

        // wyciągnij podstawowe pola osoby
        const { first_name, last_name } = splitFirstLast(person?.name);
        const email =
          Array.isArray(person?.email) && person.email.length
            ? person.email[0]?.value || person.email[0]
            : "";
        const phone =
          Array.isArray(person?.phone) && person.phone.length
            ? person.phone[0]?.value || person.phone[0]
            : "";

        setPdDeal({
          id: j?.id,
          title: j?.title,
          custom_by_name: {
            ...custom,
            // syntetyczne klucze:
            "person.first_name": first_name,
            "person.last_name": last_name,
            "person.email": email,
            "person.phone": phone,
            // dodatkowo można dorzucić kilka:
            "deal.title": j?.title ?? "",
          },
          person: person ? { name: person.name, email: person.email, phone: person.phone } : null,
        });
      } catch (e) {
        console.error("Pipedrive fetch error:", e);
        setPdDeal(null);
      }
    })();
  }, [dealId]);

  useEffect(() => {
    (async () => {
      try {
        const j = await fetchJSON<{ count: number; fields: any[] }>("/api/pipedrive/deal-fields");

        const optsMap: Record<string, string[]> = {};
        const kindMap: Record<string, "single" | "multi"> = {};
        const keySet = new Set<string>();
        const canonical: Record<string, string> = {};

        (j.fields || []).forEach((f: any) => {
          const rawKey = f.key as string | undefined;   // np. "dcf558aa..."
          const rawName = f.name as string | undefined; // np. "Typ budynku"
          const snakeName = rawName ? snake(rawName) : undefined; // "typ_budynku" / "raport_typ_budynku"

          // pełna lista kluczy do UI
          if (rawKey) {
            keySet.add(rawKey);
            canonical[rawKey] = rawKey;  // sam do siebie
          }
          if (snakeName) {
            keySet.add(snakeName);
            if (rawKey) {
              canonical[snakeName] = rawKey; // alias -> prawdziwy key
            }
          }

          // tylko pola z options do selectów
          if (!Array.isArray(f.options) || !f.options.length) return;

          const values = (f.options ?? []).map((o: any) => String(o.label ?? o));

          const ft = String(f.field_type || "").toLowerCase();
          const kind: "single" | "multi" =
            ft === "set" ||
              ft === "multioptions" ||
              ft === "multiple_options" ||
              ft.includes("multi")
              ? "multi"
              : "single";

          const pushSelectField = (key: string | null | undefined) => {
            if (!key) return;
            optsMap[key] = values;
            kindMap[key] = kind;
          };

          pushSelectField(rawKey);
          if (snakeName) {
            pushSelectField(snakeName);
          }
        });

        // --- SPECJALNIE: spróbuj powiązać lat / lon z prawdziwymi kluczami Pipedrive ---
        const latField = (j.fields || []).find((f: any) => {
          const n = String(f.name || "");
          return snake(n) === "lat" || n.trim().toLowerCase() === "lat";
        });
        const lonField = (j.fields || []).find((f: any) => {
          const n = String(f.name || "");
          return snake(n) === "lon" || n.trim().toLowerCase() === "lon";
        });

        if (latField?.key) {
          // podstawowa nazwa
          canonical["lat"] = latField.key;
          // alias używany w raporcie
          canonical["raport_lat"] = latField.key;
        }
        if (lonField?.key) {
          canonical["lon"] = lonField.key;
          canonical["raport_lon"] = lonField.key;
        }
        // --- KONIEC specjalnego mapowania ---


        setPdSelectOptions(optsMap);
        setPdSelectKinds(kindMap);
        setPdAllKeys(Array.from(keySet));
        setPdCanonicalKeys(canonical);

        // opcjonalnie:
        console.log("[PIPEDRIVE] canonical keys map:", canonical);
      } catch (e) {
        console.error("Pipedrive deal-fields error:", e);
      }
    })();
  }, []);


  const refreshFields = async () => {
    if (selectedProjectId == null) return;
    const refreshed = await fetch(`/api/report-fields?projectId=${selectedProjectId}`, {
      cache: "no-store",
    }).then((r) => r.json());
    setFields(refreshed);
  };

  // Pola projektu
  useEffect(() => {
    if (selectedProjectId == null) return;
    fetch(`/api/report-fields?projectId=${selectedProjectId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setFields)
      .catch(console.error);
  }, [selectedProjectId]);

  // ===== PREFILL Z BAZY: /api/report-field-values?dealId=... =====
  useEffect(() => {
    if (!dealId) return;
    if (!fields.length) return;
    if (dbValuesLoaded) return;

    (async () => {
      try {
        const res = await fetch(`/api/report-field-values?dealId=${dealId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          console.warn("report-field-values GET:", res.status);
          setDbValuesLoaded(true);
          return;
        }

        const json = await res.json();
        const rows: ReportFieldValueRow[] = Array.isArray(json.items)
          ? json.items
          : [];

        if (!rows.length) {
          setDbValuesLoaded(true);
          return;
        }

        // Mapa: report_field_id -> parsed value_json
        const byId = new Map<number, any>();
        for (const row of rows) {
          if (!row) continue;
          const fid = Number(row.report_field_id);
          if (!Number.isFinite(fid)) continue;
          if (!row.value_json) continue;

          try {
            const parsed = JSON.parse(row.value_json);
            byId.set(fid, parsed);
          } catch (e) {
            console.warn("Nieprawidłowe value_json dla pola", row.report_field_id, e);
          }
        }

        if (!byId.size) {
          setDbValuesLoaded(true);
          return;
        }

        // Wstrzyknięcie wartości TYLKO do pól, które mają zapis w bazie
        setFields((prev) =>
          prev.map((f) => {
            const fId = Number((f as any).id);
            if (!Number.isFinite(fId)) return f;

            const storedMeta = byId.get(fId);
            if (!storedMeta) return f; // brak rekordu w bazie -> nic nie ruszamy

            const base = getMeta(f); // meta z definicji pola (layout, fonty itd.)

            // Bezpieczny merge: tylko semantyczne rzeczy, layout zostaje z base
            const merged = {
              ...base,
              pdKey: storedMeta.pdKey ?? base.pdKey,
              kind: storedMeta.kind ?? base.kind,
              fieldName: storedMeta.fieldName ?? base.fieldName,
              source: storedMeta.source ?? base.source,
              // NAJWAŻNIEJSZE: treść pola
              displayValue: storedMeta.displayValue ?? base.displayValue,
              pdValue: storedMeta.pdValue ?? base.pdValue,

              // dla rendererów, które biorą meta.value (valueFromSource / computeField)
              value:
                storedMeta.displayValue ??
                storedMeta.pdValue ??
                base.value ??
                base.displayValue ??
                base.pdValue ??
                "",
            };

            return {
              ...f,
              meta_json: merged,
            } as ReportField;
          })
        );
      } catch (e) {
        console.error("Error pre-filling report-field-values:", e);
      } finally {
        setDbValuesLoaded(true);
      }
    })();
  }, [dealId, fields.length, dbValuesLoaded]);


  // // ===== PREFILL Z BAZY: /api/report-field-values?dealId=... =====
  // useEffect(() => {
  //   if (!dealId) return;
  //   if (!fields.length) return;
  //   if (dbValuesLoaded) return;

  //   console.log("[PREFILL] start", {
  //     dealId,
  //     fieldsCount: fields.length,
  //   });

  //   (async () => {
  //     try {
  //       const res = await fetch(`/api/report-field-values?dealId=${dealId}`, {
  //         cache: "no-store",
  //       });

  //       console.log("[PREFILL] response status:", res.status);

  //       if (!res.ok) {
  //         const txt = await res.text();
  //         console.warn("report-field-values GET error:", res.status, txt);
  //         setDbValuesLoaded(true);
  //         return;
  //       }

  //       const json = await res.json();
  //       const rows: ReportFieldValueRow[] = Array.isArray(json.items)
  //         ? json.items
  //         : [];

  //       console.log("[PREFILL] rows from DB:", rows);

  //       if (!rows.length) {
  //         console.log("[PREFILL] brak rekordów w bazie dla dealId", dealId);
  //         setDbValuesLoaded(true);
  //         return;
  //       }

  //       // Mapa: report_field_id -> parsed value_json
  //       const byId = new Map<number, any>();
  //       for (const row of rows) {
  //         if (!row) continue;
  //         const fid = Number(row.report_field_id);
  //         if (!Number.isFinite(fid)) continue;
  //         if (!row.value_json) continue;

  //         try {
  //           const parsed = JSON.parse(row.value_json);
  //           byId.set(fid, parsed);
  //         } catch (e) {
  //           console.warn(
  //             "[PREFILL] Nieprawidłowe value_json dla pola",
  //             row.report_field_id,
  //             e
  //           );
  //         }
  //       }

  //       console.log("[PREFILL] byId map size:", byId.size);

  //       if (!byId.size) {
  //         setDbValuesLoaded(true);
  //         return;
  //       }

  //       // Wstrzyknięcie wartości TYLKO do pól, które mają zapis w bazie
  //       setFields((prev) => {
  //         console.log("[PREFILL] setFields() start; prev.length =", prev.length);

  //         const mapped = prev.map((f) => {
  //           const fId = Number((f as any).id);
  //           if (!Number.isFinite(fId)) {
  //             console.log("[PREFILL] pole bez poprawnego id:", f);
  //             return f;
  //           }

  //           const storedMeta = byId.get(fId);
  //           if (!storedMeta) {
  //             // brak rekordu w bazie -> nic nie ruszamy
  //             return f;
  //           }

  //           const base = getMeta(f); // meta z definicji pola (layout, fonty itd.)

  //           console.log("[PREFILL] dopasowano rekord z bazy", {
  //             fieldId: fId,
  //             fieldName: (f as any).name,
  //             storedMeta,
  //             baseMeta: base,
  //           });

  //           // Bezpieczny merge: layout z "base", wartości z bazy
  //           const merged = {
  //             ...base,
  //             pdKey: storedMeta.pdKey ?? base.pdKey,
  //             kind: storedMeta.kind ?? base.kind,
  //             fieldName: storedMeta.fieldName ?? base.fieldName,
  //             source: storedMeta.source ?? base.source,
  //             displayValue: storedMeta.displayValue ?? base.displayValue,
  //             pdValue: storedMeta.pdValue ?? base.pdValue,
  //           };

  //           return {
  //             ...f,
  //             meta_json: merged,
  //           } as ReportField;
  //         });

  //         console.log("[PREFILL] setFields() done");
  //         return mapped;
  //       });
  //     } catch (e) {
  //       console.error("Error pre-filling report-field-values:", e);
  //     } finally {
  //       setDbValuesLoaded(true);
  //       console.log("[PREFILL] finished for deal", dealId);
  //     }
  //   })();
  // }, [dealId, fields.length, dbValuesLoaded]);


  const refreshPages = async () => {
    if (selectedProjectId == null) return;
    const refreshed = await fetchJSON<ReportPage[]>(`/api/report-pages?projectId=${selectedProjectId}`);
    setPages(refreshed);
  };

  const canAddPage = useMemo(() => (pages?.length ?? 0) < 4, [pages]);

  // ============ STRONY ============

  // Dodaj stronę: upload → POST /report-pages
  async function handleAddPage(file: File) {
    if (selectedProjectId == null) return;
    setIsBusy(true);
    try {
      const form = new FormData();
      form.append("projectId", String(selectedProjectId));
      form.append("pageIndex", String(pages.length));
      form.append("file", file);

      const up = await fetch("/api/report-images", { method: "POST", body: form }).then((r) => r.json());
      if (up.error) throw new Error(up.error);

      const body = {
        project_id: selectedProjectId,
        page_index: pages.length,
        image_url: up.image_url,
        natural_width: up.natural_width,
        natural_height: up.natural_height,
      };

      const created = await fetch("/api/report-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (created.error) throw new Error(created.error);

      await refreshPages();
    } catch (e) {
      console.error(e);
      alert("Błąd dodawania strony");
    } finally {
      setIsBusy(false);
    }
  }

  // Podmień PNG na istniejącej stronie
  async function handleReplaceImage(page: ReportPage, file: File) {
    if (selectedProjectId == null) return;
    setIsBusy(true);
    try {
      const form = new FormData();
      form.append("projectId", String(selectedProjectId));
      form.append("pageIndex", String(page.page_index));
      form.append("file", file);

      const up = await fetch("/api/report-images", { method: "POST", body: form }).then((r) => r.json());
      if (up.error) throw new Error(up.error);

      const patch = await fetch(`/api/report-pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: up.image_url,
          natural_width: up.natural_width,
          natural_height: up.natural_height,
        }),
      }).then((r) => r.json());
      if (patch.error) throw new Error(patch.error);

      await refreshPages();
    } catch (e) {
      console.error(e);
      alert("Błąd podmiany obrazka");
    } finally {
      setIsBusy(false);
    }
  }

  // Usuń stronę
  async function handleDeletePage(page: ReportPage) {
    if (selectedProjectId == null) return;
    if (!confirm("Usunąć tę stronę?")) return;
    setIsBusy(true);
    try {
      const del = await fetch(`/api/report-pages/${page.id}`, { method: "DELETE" }).then((r) => r.json());
      if (del.error) throw new Error(del.error);
      await refreshPages();
    } catch (e) {
      console.error(e);
      alert("Błąd usuwania strony");
    } finally {
      setIsBusy(false);
    }
  }

  // ============ POLA ============

  // Szybkie „Własne pole”
  async function handleAddFieldForPage(page: ReportPage) {
    if (selectedProjectId == null) return;
    const body = {
      project_id: selectedProjectId,
      page_id: page.id,
      type: "text",
      name: "Nowe pole",
      source: "manual",
      x_percent: 5,
      y_percent: 5,
      w_percent: 20,
      h_percent: 2,
      font_family: "DM Sans, system-ui, sans-serif",
      font_size: 16,
      font_weight: "500",
      color: "#2B3674",
      text_align: "left",
    };
    const res = await fetch("/api/report-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (res?.id) {
      await refreshFields();
      setSelectedFieldId(res.id);
      setInspectorFieldId(res.id);
    }
  }

  // PATCH pola
  async function patchField(id: number, patch: Partial<ReportField>) {
    console.log("[patchField] sending", { id, patch });

    await fetch(`/api/report-fields/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    await refreshFields();
  }

  // DELETE pola
  async function deleteField(id: number) {
    if (!confirm("Usunąć to pole?")) return;
    await fetch(`/api/report-fields/${id}`, { method: "DELETE" });
    await refreshFields();
    setSelectedFieldId((cur) => (cur === id ? null : cur));
    setInspectorFieldId((cur) => (cur === id ? null : cur));
  }

  // ============ DRUK ============

  // CreateForm.tsx

  async function saveMapSnapshotsForPage(page: ReportPage, pageFields: ReportField[]) {
    if (typeof window === "undefined") return;

    const maps = pageFields.filter(
      f => String((f as any).name || "").trim().toLowerCase() === "map"
    );

    for (const f of maps) {
      const id = Number((f as any).id);
      const root = document.querySelector<HTMLElement>(`[data-map-field-id="${id}"]`);
      if (!root) continue;

      let dataUrl: string | null = null;

      // 1) bezpośrednio z canvasa Mapboxa (działa dzięki preserveDrawingBuffer=true)
      const glCanvas = root.querySelector<HTMLCanvasElement>(".mapboxgl-canvas");
      if (glCanvas) {
        try {
          // opcjonalnie: zmniejsz jako JPEG, by oszczędzić pamięć
          dataUrl = glCanvas.toDataURL("image/jpeg", 0.9);
        } catch (e) {
          console.warn("[print] canvas.toDataURL failed", e);
        }
      }

      // 2) jeśli nie ma canvasa (nie powinno się zdarzyć), pomiń
      if (!dataUrl) continue;

      // Zapisz TYLKO lokalnie (bez PATCH) – użyjemy przy renderze SVG
      mapSnapshotCache.set(id, dataUrl);
    }
  }

  useEffect(() => {
    const onMetaUpdated = (ev: Event) => {
      const e = ev as CustomEvent<{ id: number; meta_json: any; name?: string }>;
      const { id, meta_json } = e.detail || {};
      if (!id) return;

      setFields((prev) =>
        (prev || []).map((f: any) => {
          if (Number(f?.id) !== Number(id)) return f;

          // UWAGA: u Ciebie meta_json bywa stringiem albo obiektem
          const prevMeta =
            typeof f.meta_json === "string"
              ? (() => {
                try { return JSON.parse(f.meta_json || "{}"); } catch { return {}; }
              })()
              : (f.meta_json || {});

          // scal (zachowaj inne klucze meta)
          const nextMeta = { ...prevMeta, ...meta_json };

          return { ...f, meta_json: nextMeta };
        })
      );
    };

    window.addEventListener("report-fields:meta-updated", onMetaUpdated as any);
    return () => window.removeEventListener("report-fields:meta-updated", onMetaUpdated as any);
  }, [setFields]);


  const registerDealChange = (payload: {
    reportFieldId: number;
    pdKey: string;
    kind: "text" | "single" | "multi";
    displayValue: string;
    pdValue: string | string[];
    source: "pipedrive" | "manual";
    fieldName: string;
  }) => {

    setDealChanges((prev) => {
      const filtered = prev.filter(
        (c) =>
          !(
            c.reportFieldId === payload.reportFieldId &&
            c.pdKey === payload.pdKey
          )
      );

      return [
        ...filtered,
        {
          dealId: pdDeal?.id,
          ...payload,
        },
      ];
    });
  };

  function applyNumberFormatForDisplay(
    raw: string | number | null | undefined,
    meta: any
  ): string {
    const fmt = meta?.number_format; // "int" | "2dec" | undefined
    const orig = raw ?? "";

    // jeśli nie ustawiono formatu – nic nie ruszamy
    if (!fmt) return String(orig);

    // parsowanie liczby (obsługa spacji i przecinka)
    const n =
      typeof orig === "number"
        ? orig
        : Number(String(orig).replace(/\s/g, "").replace(",", "."));

    if (!Number.isFinite(n)) return String(orig);

    if (fmt === "int") {
      // liczba całkowita
      return String(Math.round(n));
    }

    if (fmt === "2dec") {
      // zawsze dwa miejsca po przecinku, PL-format
      return n.toLocaleString("pl-PL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    return String(orig);
  }

  function svgEscape(s: string) {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  // helper (wklej w CreateForm.tsx najlepiej nad handlePrintSingleSVG)
  function parseSelectedMulti(value: any): string[] {
    if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
    const s = String(value ?? "");
    return s.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  }

  function applyMultiSelectStyle(node: Element, selected: Set<string>) {
    // Bardzo “bezpieczna” strategia:
    // - przeleć wszystkie <text> wewnątrz node
    // - jeśli ich tekst pasuje do zaznaczeń -> pełna widoczność
    // - jeśli nie -> przygaś
    const texts = Array.from(node.querySelectorAll("text"));

    for (const t of texts) {
      const label = (t.textContent || "").trim();
      const isOn = selected.has(label);

      // przygaszanie:
      t.setAttribute("fill-opacity", isOn ? "1" : "0.35");

      // często obok <text> jest <rect>/<path> “checkboxa” – też przygaś:
      const parent = t.parentElement;
      if (parent) {
        for (const shape of Array.from(parent.querySelectorAll("rect,path,circle,polygon,line"))) {
          shape.setAttribute("opacity", isOn ? "1" : "0.35");
        }
      }
    }
  }


  async function handlePrintSingleSVG(page: ReportPage, pageFields: ReportField[]) {
    try {
      // 1) Wczytujemy tło
      const resp = await fetch(page.image_url, { cache: "no-store" });
      const blob = await resp.blob();

      // NA POCZĄTKU handlePrintSingleSVG:
      const pdForPrint = pdViewValues; // zamiast pdValues

      const isSvgTemplate =
        blob.type === "image/svg+xml" || page.image_url.toLowerCase().endsWith(".svg");

      let svgText: string | null = null;
      let dataUrl: string | null = null;

      if (isSvgTemplate) {
        // będziemy modyfikować szablon SVG
        svgText = await blob.text();
      } else {
        // jak wcześniej – bitmapa jako tło
        const buf = await blob.arrayBuffer();
        const bin = new Uint8Array(buf);
        let b64 = "";
        for (let i = 0; i < bin.length; i++) b64 += String.fromCharCode(bin[i]);
        const mime = blob.type || "image/png";
        dataUrl = `data:${mime};base64,${b64}`;
      }

      // 2) Fonty + podstawowe parametry
      const W = page.natural_width;
      const H = page.natural_height;

      async function fontToDataURL(url: string) {
        const r = await fetch(url, { cache: "force-cache" });
        const b = new Uint8Array(await r.arrayBuffer());
        let s = "";
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return `data:font/woff2;base64,${btoa(s)}`;
      }
      const dm400 = await fontToDataURL("/fonts/DMSans-Regular.ttf");
      const dm500 = await fontToDataURL("/fonts/DMSans-Medium.ttf");
      const dm600 = await fontToDataURL("/fonts/DMSans-SemiBold.ttf");
      const dm700 = await fontToDataURL("/fonts/DMSans-Bold.ttf");

      const fontCss = `
      @font-face{font-family:'DM Sans';src:url(${dm400}) format('woff2');font-weight:400;font-style:normal;font-display:block}
      @font-face{font-family:'DM Sans';src:url(${dm500}) format('woff2');font-weight:500;font-style:normal;font-display:block}
      @font-face{font-family:'DM Sans';src:url(${dm600}) format('woff2');font-weight:600;font-style:normal;font-display:block}
      @font-face{font-family:'DM Sans';src:url(${dm700}) format('woff2');font-weight:700;font-style:normal;font-display:block}
      text{font-kerning:none;font-variant-ligatures:none;letter-spacing:0}
      `;

      // 3) Jeśli mamy szablon SVG – parsujemy DOM
      let doc: Document | null = null;
      let rootSvg: SVGSVGElement | null = null;


      if (isSvgTemplate && svgText) {
        const parser = new DOMParser();
        doc = parser.parseFromString(svgText, "image/svg+xml");
        rootSvg = doc.documentElement as unknown as SVGSVGElement;

// 🔧 prostokąty z samym stroke domyślnie mają w SVG fill=black.
  // Dla rect ze stroke, ale bez fill – ustawiamy fill na "none".
  doc
    .querySelectorAll("rect[stroke]:not([fill])")
    .forEach((el) => {
      (el as SVGRectElement).setAttribute("fill", "none");
    });

        // dopisz fonty
        const styleEl = doc.createElementNS("http://www.w3.org/2000/svg", "style");
        styleEl.textContent = fontCss;
        const firstChild = rootSvg.firstChild;
        if (firstChild) rootSvg.insertBefore(styleEl, firstChild);
        else rootSvg.appendChild(styleEl);

        if (!rootSvg.getAttribute("viewBox")) {
          rootSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        }
      }

      // --- HEAT SOURCE: wybierz aktywne pole podrzędne (dla DRUKU) ---
      const HEAT_SOURCE_PDKEY = "zrod_o_energii_cieplnej";
      const HEAT_DETAIL_KEYS = new Set([
        "rodzaj_kot_a_na_gaz_ziemny",
        "rodzaj_kot_a_na_olej_opa_owy",
        "rodzaj_kot_a_na_drewno",
        "rodzaj_zrod_a_ciep_a_na_energie_elektryczna",
        "rodzaj_kot_a_na_wegiel",
        "zrodlo_ciepla_null",
      ]);

      const normalizeHeat = (v: any) =>
        String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

      const pickActiveHeatPdKey_UI = (heatSourceRaw: any): string | null => {
        const s = normalizeHeat(heatSourceRaw);

        if (s.includes("gaz ziemny")) return "rodzaj_kot_a_na_gaz_ziemny";
        if (s.includes("olej opałowy")) return "rodzaj_kot_a_na_olej_opa_owy";
        if (s.includes("drewno") || s.includes("pellet")) return "rodzaj_kot_a_na_drewno";
        if (s.includes("energia elektryczna") || s.includes("pompa ciepła"))
          return "rodzaj_zrod_a_ciep_a_na_energie_elektryczna";
        if (s.includes("węgiel") || s.includes("groszek")) return "rodzaj_kot_a_na_wegiel";

        if (s.includes("ciepło systemowe") || s.includes("sieciowe") || s.includes("cieplik")) return "zrodlo_ciepla_null";
        if (s.includes("lpg")) return "zrodlo_ciepla_null";

        return null;
      };

      const heatSourceField = pageFields.find(
        (ff) => snake(String((ff as any).name || "")) === HEAT_SOURCE_PDKEY
      );

      const heatSourceValue = heatSourceField
        ? computeField(heatSourceField as any, pageFields, pdForPrint).value
        : (pdForPrint as any)?.[HEAT_SOURCE_PDKEY];

      const activeHeatDetailKey = pickActiveHeatPdKey_UI(heatSourceValue);


      // 4) Standardowe fieldNodes (yelds, rose, mapy, checkboxy, steppery, teksty itd.)
      const fieldNodes = pageFields
        .map((f) => {
          const x = (Number(f.x_percent) / 100) * W;
          const y = (Number(f.y_percent) / 100) * H;
          const w = (Number(f.w_percent) / 100) * W;
          const h = (Number(f.h_percent) / 100) * H;

          const rawFontSize = Number((f as any).font_size) || 14;
          const meta = getMeta(f);
          if (meta && meta.hide_in_print) {
            return "";
          }
          const baseline =
            Number(meta.font_baseline_w) ||
            Number((page as any).font_baseline_w) ||
            1000;
          const fontSizeSVG = rawFontSize * (W / baseline);

          const fontFamily =
            (meta.font_family as string) ||
            (f as any).font_family ||
            "DM Sans, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

          const fontWeight =
            (meta.font_weight as string) ||
            (f as any).font_weight ||
            "500";

          const fill =
            (meta.color as string) ||
            (f as any).color ||
            "#2B3674";

          const align =
            ((meta.text_align as "left" | "center" | "right") ||
              ((f as any).text_align as "left" | "center" | "right") ||
              "left");

          const name = String((f as any).name || "").trim();

          // wartość z computeField
          const { value } = computeField(f, pageFields, pdForPrint);
          const rawText = String(value ?? "");
          const currentText = applyNumberFormatForDisplay(rawText, meta);

          // --- NOWE: wstrzykiwanie do elementu SVG z id zaczynającym się od "XXX_"
          const svgBoundId = (meta as any)?.svg_id as string | undefined;
          if (
            isSvgTemplate &&
            svgBoundId &&
            svgBoundId.startsWith("XXX_") &&
            doc &&
            rootSvg
          ) {

            const logicalName = snake(String((f as any).name || ""));

            // ✅ kluczowe: w druku tylko aktywne pole podrzędne ma prawo pisać do XXX_
            if (HEAT_DETAIL_KEYS.has(logicalName)) {
              if (!activeHeatDetailKey || logicalName !== activeHeatDetailKey) {
                return ""; // nie generuj overlay i NIE wstrzykuj do XXX_
              }
            }

            const node = doc.getElementById(svgBoundId);
if (node) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SELECTED_COLOR = "#2B3674";
  const UNSELECTED_COLOR = "#C0C3D6";
  const UNSELECTED_OPACITY = "0.4";

  // --- normalizacja tokenów: usuń NBSP, wielokrotne spacje, trim ---
  const norm = (s: any) =>
    String(s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // pdKey jak w UI
  const rawName = String((f as any).name || "").trim().toLowerCase();
  const pdKeyForSvg =
    (meta as any)?.pipedrive_key ||
    (f as any)?.pipedrive_key ||
    rawName;

  const selectKindForSvg = pdSelectKinds?.[pdKeyForSvg];
  const multiOptions =
    selectKindForSvg === "multi" && pdSelectOptions?.[pdKeyForSvg]?.length
      ? pdSelectOptions[pdKeyForSvg]!
      : undefined;

  // Wartość (dla zaznaczeń) – bierzemy RAW, bez formatów liczbowych
  const valueStrRaw = norm(rawText);

  // ===== MULTI SELECT (druk jak ekran) =====
  if (multiOptions && multiOptions.length) {
    // 1) znajdź „kontener” do przebudowy: jeśli id jest na <text>, to bierz rodzica <g>
    const container =
      node.tagName.toLowerCase() === "g"
        ? node
        : (node.closest("g") || node);

    // 2) weź tspany jako wzorzec układu
    const oldTspans = Array.from(container.querySelectorAll("tspan"));
    if (oldTspans.length) {
      type LineInfo = { x: number; y: number };
      let templateText: SVGTextElement | null = null;

      const linesInfo: LineInfo[] = oldTspans
        .map((ts) => {
          const parentText = ts.closest("text") as SVGTextElement | null;
          if (!templateText && parentText) templateText = parentText;

          const xAttr = ts.getAttribute("x") || parentText?.getAttribute("x") || "0";
          const yAttr = ts.getAttribute("y") || parentText?.getAttribute("y") || "0";

          return { x: Number(xAttr), y: Number(yAttr) };
        })
        // KLUCZ: sort jak na ekranie, ale stabilnie dla 2 kolumn: y potem x
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));

      if (templateText) {
        // 3) zaznaczenia: tokeny po tych samych separatorach co UI + norm
        const selectedTokens = valueStrRaw
          .split(/[,;\n]/)
          .map(norm)
          .filter(Boolean);

        const selectedSet = new Set(selectedTokens);
        const selectedFlags = multiOptions.map((opt) => selectedSet.has(norm(opt)));

        // 4) WYCZYŚĆ CAŁY kontener (żeby nie było „tła”)
        while (container.firstChild) container.removeChild(container.firstChild);

        // 5) odtwórz wszystkie linie na podstawie templateText
        const baseAttrs = Array.from(templateText.attributes);
        const count = Math.min(linesInfo.length, multiOptions.length);

        for (let i = 0; i < count; i++) {
          const { x, y } = linesInfo[i];
          const isSelected = !!selectedFlags[i];

          const textEl = doc.createElementNS(SVG_NS, "text");

          // kopiuj atrybuty stylu (jak w ReportSvgPage) – poza fill/x/y/opac.
          for (const attr of baseAttrs) {
            const name = attr.name;
            if (name === "x" || name === "y" || name === "fill" || name === "fill-opacity") continue;
            textEl.setAttribute(name, attr.value);
          }

          if (isSelected) {
            textEl.setAttribute("fill", SELECTED_COLOR);
            textEl.setAttribute("font-weight", "700");
            textEl.removeAttribute("fill-opacity");
          } else {
            textEl.setAttribute("fill", UNSELECTED_COLOR);
            textEl.setAttribute("fill-opacity", UNSELECTED_OPACITY);
            textEl.removeAttribute("font-weight");
          }

          const tspan = doc.createElementNS(SVG_NS, "tspan");
          tspan.setAttribute("x", String(x));
          tspan.setAttribute("y", String(y));
          tspan.textContent = String(multiOptions[i] ?? "");
          textEl.appendChild(tspan);

          container.appendChild(textEl);
        }

        // MULTI obsłużone – nie rób zwykłego textContent
        return "";
      }
    }
    // jeśli layout nietypowy (brak tspan), to nie wywalaj druku – poleci fallback poniżej
  }

  // ===== fallback: zwykłe pole tekstowe =====
  const align =
    ((meta as any)?.text_align as "left" | "center" | "right") ??
    ((f as any)?.text_align as "left" | "center" | "right") ??
    "left";

  const anchor =
    align === "right" ? "end" :
    align === "center" ? "middle" :
    "start";

  const textEl =
    node.tagName.toLowerCase() === "text"
      ? (node as unknown as SVGTextElement)
      : (node.closest("text") as unknown as SVGTextElement | null);

  if (textEl) textEl.setAttribute("text-anchor", anchor);

  const tspan = node.querySelector("tspan");
  if (tspan) {
    (tspan as any).setAttribute?.("text-anchor", anchor);
    tspan.textContent = currentText;
  } else {
    node.textContent = currentText;
  }

  return "";
}


          }

          // --- tu zostawiasz całą swoją istniejącą logikę:
          // yelds, rose, map, checkbox, stepper, zwykły tekst itd.
          // Poniżej szkic – wklej swój dotychczasowy kod zamiast komentarza:

          // specjalne pole yelds
          if (name === "yelds") {
            const { hist, histpv } = buildYeldsPair(pdValues);
            return yeldsSvgString(x, y, w, h, hist, histpv);
          }

          if (name === "rose") {
            const vals16 = buildRoseArray16(pdValues);
            return rosePlotlySvgString(x, y, w, h, vals16);
          }

          // --- MAPA (druk): wstaw snapshot jako <image> ---
          const rawName = name.trim().toLowerCase();
          if (rawName === "map") {
            const idNum = Number((f as any).id);

            const mi =
              mapSnapshotCache.get(idNum) ||
              ((typeof window !== "undefined" && (window as any).__map_snapshots)
                ? (window as any).__map_snapshots[idNum]
                : undefined);

            if (!mi || !/^data:image\//.test(mi)) return "";

            const clipId = `clip-map-${idNum}`;
            const safeMi = String(mi).replaceAll("&", "&amp;"); // minimalnie

            // --- PIN (w środku mapy) ---
            const pinSize = 88;
            const s = pinSize / 24;
            const cx = x + w / 2;
            const cy = y + h / 2;

            const pin = `
                <g transform="translate(${cx},${cy}) scale(${s}) translate(-12,-24)" style="pointer-events:none">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#F59E0B"/>
                  <circle cx="12" cy="9" r="3.2" fill="#fff"/>
                </g>
              `;

            return `
                <g data-field-overlay="1" data-keep-print="1">
                  <defs>
                    <clipPath id="${clipId}">
                      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" ry="24" />
                    </clipPath>
                  </defs>

                  <image
                    href="${safeMi}"
                    x="${x}" y="${y}" width="${w}" height="${h}"
                    preserveAspectRatio="xMidYMid slice"
                    clip-path="url(#${clipId})"
                  />

                  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" ry="24"
                        fill="none" stroke="#E2E8F0" stroke-width="1"/>

                  ${pin}
                </g>
              `;
          }


          // ... checkbox, stepper, zwykły tekst ...
          // (tu NIE zmieniamy nic względem tego, co miałeś, poza dodaniem bloku powyżej)

          // jeśli w tym miejscu dojdzie kod tekstowy – użyj currentText
          // zamiast rawText
          // (to już powinieneś mieć u siebie)

          // typ UI (checkbox / stepper / tekst)
          const metaForSvg = getMeta(f);

          const uiType =
            (metaForSvg as any)?.ui_type ||
            (meta as any)?.ui_type ||
            "text";
          const isCheckboxUI = uiType === "checkbox";
          const isStepperUI = uiType === "stepper";


          // ===== CHECKBOX UI_TYPE: rysujemy graficzny checkbox =====
          if (isCheckboxUI) {
            const raw = currentText.trim().toLowerCase();
            const checked =
              raw === "1" ||
              raw === "true" ||
              raw === "tak" ||
              raw === "yes";

            const size = Math.min(w, h) * 0.4;
            const cx = x + w / 2;
            const cy = y + h / 2;
            const rx = cx - size / 2;
            const ry = cy - size / 2;

            const fillBox = checked ? "#7C3AED" : "#E5E7EB";
            const strokeBox = checked ? "#7C3AED" : "#CBD5E1";

            const checkPath = checked
              ? `<path d="M ${rx + size * 0.25} ${cy} L ${cx} ${cy + size * 0.2
              } L ${rx + size * 0.75} ${cy - size * 0.2}" 
         fill="none" stroke="#FFFFFF" stroke-width="${size * 0.14}"
         stroke-linecap="round" stroke-linejoin="round"/>`
              : "";

            return `
  <g>
    <rect x="${rx}" y="${ry}" width="${size}" height="${size}"
          rx="${size * 0.25}" ry="${size * 0.25}"
          fill="${fillBox}" stroke="${strokeBox}" stroke-width="${size * 0.08}"/>
    ${checkPath}
  </g>
`;
          }

          // ===== STEPPER UI_TYPE: liczba na środku pola =====
          if (isStepperUI) {
            const textVal = currentText;
            const xCenter = x + w / 2;
            const yCenter = y + h / 2;

            return `
  <g>
    <text
      x="${xCenter}"
      y="${yCenter}"
      font-family="${svgEscape(fontFamily)}"
      font-weight="${svgEscape(String(fontWeight))}"
      font-size="${fontSizeSVG}"
      fill="${svgEscape(String(fill))}"
      text-anchor="middle"
      dominant-baseline="central"
      style="font-kerning:none;font-variant-ligatures:none;letter-spacing:0"
    >
      ${svgEscape(textVal)}
    </text>
  </g>
`;
          }




          return ""; // fallback
        })
        .join("");

      // 5) Składamy finalne SVG
      let finalSvg: string;

      // wspólny CSS do skalowania po szerokości (bez 100vw/100vh)
      const printStyle = `
      ${fontCss}
      svg {
        width: 100%;
        height: auto;
      }
      @media print {

  svg [id^="VVV_"] {
    visibility: hidden !important;
  }

  /* i dodatkowo: ukryj wszystko co jest overlay */
  [data-field-overlay="1"]:not([data-keep-print="1"]),
  .report-content-overlay,
  .no-print {
    display: none !important;
  }

        @page { margin: 0; }
        svg {
          width: 100% !important;
          height: auto !important;
        }
      }
    `;

      if (isSvgTemplate && doc && rootSvg) {
        // usuń sztywne rozmiary w pikselach – opieramy się na viewBox + CSS
        rootSvg.removeAttribute("width");
        rootSvg.removeAttribute("height");

        // jeśli są pola bez svg_id, które wygenerowały fieldNodes – dokładamy je jako overlay
        if (fieldNodes && fieldNodes.trim()) {
          const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
          (g as any).innerHTML = fieldNodes;
          rootSvg.appendChild(g);
        }

        // dołóż CSS drukowania do <svg>
        const styleEl = doc.createElementNS("http://www.w3.org/2000/svg", "style");
        styleEl.textContent = printStyle;
        rootSvg.insertBefore(styleEl, rootSvg.firstChild);

        finalSvg = new XMLSerializer().serializeToString(doc);
      } else {
        // bitmapa w tle + pola jako overlay (stare zachowanie, ale z nowym CSS)
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     preserveAspectRatio="xMidYMid meet"
     xml:space="preserve"
     text-rendering="geometricPrecision">
  <style>
${printStyle}
  </style>

  <image href="${dataUrl}" xlink:href="${dataUrl}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>

  ${fieldNodes}
</svg>`;

        finalSvg = svg;
      }


      // 6) Druk
      const blobSVG = new Blob([finalSvg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blobSVG);
      const iframe = document.createElement("iframe");
      Object.assign(iframe.style, {
        position: "fixed",
        right: "0",
        bottom: "0",
        width: "0",
        height: "0",
        border: "0",
      });
      document.body.appendChild(iframe);
      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(iframe);
          }, 300);
        }, 50);
      };
      iframe.src = url;
    } catch (e) {
      console.error(e);
      alert("Nie udało się przygotować wydruku SVG.");
    }
  }


  // ============ MODAL DODAWANIA POLA ============

  const [addForPage, setAddForPage] = useState<ReportPage | null>(null);
  const [addSrc, setAddSrc] = useState<"pipedrive" | "manual">("pipedrive");
  const [pdSelectedKey, setPdSelectedKey] = useState<string>("");
  const [pdFilter, setPdFilter] = useState<string>(""); // 🔍 tekst do filtrowania listy

  const pdOptions = useMemo(() => {
    // baza: to co wiemy z definicji pól Pipedrive
    const isHexish = (k: string) => /^[0-9a-f]{24,}$/i.test(k);
    let rawSrc: string[] =
      pdAllKeys.length ? [...pdAllKeys] : [...pdKeys];

    // DODANE: dołóż kilka syntetycznych kluczy z pdValues,
    // które nie istnieją w deal-fields, ale chcemy je pokazać
    if (pdAllKeys.length) {
      const extras = pdKeys.filter(
        (k) =>
          k.startsWith("person.") || // imię, nazwisko, email, telefon
          k === "title" ||
          k === "deal.title"
      );
      const seen = new Set(rawSrc);
      for (const k of extras) {
        if (!seen.has(k)) {
          seen.add(k);
          rawSrc.push(k);
        }
      }
    }

    // odfiltruj techniczne hexy
    const src = rawSrc.filter((k) => !isHexish(k));

    const items = src.slice().sort((a, b) => a.localeCompare(b, "pl"));
    return items.map((k) => ({
      key: k,
      label: k.startsWith("raport_") ? k.replace(/^raport_+/i, "") : k,
    }));
  }, [pdAllKeys, pdKeys]);

  // 🔍 Widokowe: lista pól po przefiltrowaniu tekstu wyszukiwania
  const filteredPdOptions = useMemo(() => {
    const q = pdFilter.trim().toLowerCase();
    if (!q) return pdOptions;
    return pdOptions.filter((opt) => {
      const label = opt.label.toLowerCase();
      const key = opt.key.toLowerCase();
      return label.includes(q) || key.includes(q);
    });
  }, [pdFilter, pdOptions]);


  async function confirmAddField() {
    if (selectedProjectId == null || !addForPage) return;
    if (addSrc === "pipedrive") {
      if (!pdSelectedKey) {
        alert("Wybierz pole Pipedrive.");
        return;
      }
      const label = pdOptions.find((o) => o.key === pdSelectedKey)?.label || pdSelectedKey;
      const body = {
        project_id: selectedProjectId,
        page_id: addForPage.id,
        type: "text",
        name: label,
        source: "pipedrive" as const,
        pipedrive_key: pdSelectedKey,
        x_percent: 5,
        y_percent: 5,
        w_percent: 20,
        h_percent: 2,
        font_family: "DM Sans, system-ui, sans-serif",
        font_size: 16,
        font_weight: "500",
        color: "#2B3674",
        text_align: "left",
      };
      const res = await fetch("/api/report-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res?.id) {
        await refreshFields();
        setAddForPage(null);
        setPdSelectedKey("");
      } else {
        alert("Nie udało się dodać pola Pipedrive.");
      }
    } else {
      await handleAddFieldForPage(addForPage);
      setAddForPage(null);
    }
  }

  return (
    <>
      <div className="print-scope" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Strony */}
        {selectedProjectId !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Dodaj stronę */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }} data-hide-print>
              <div style={{ display: mode === "layout" ? "flex" : "none" }}>
                <strong>Strony projektu:</strong>
                <span>(max 4)</span>
                <input
                  type="file"
                  accept="image/png,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && canAddPage) handleAddPage(file as File);
                    (e.currentTarget as HTMLInputElement).value = "";
                  }}
                  disabled={!canAddPage || isBusy}
                />

                {!canAddPage && <span style={{ color: "#DC2626" }}>Osiągnięto limit 4 stron</span>}
              </div>

              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  position: "relative",
                }}
              >
                {mode === "content" && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDealChanges([]);
                        // opcjonalnie: powrót do podglądu
                        // setMode("print");
                      }}
                      style={{
                        borderRadius: 9,
                        padding: "8px 14px",
                        border: "none",
                        background: "#E2E8F0",
                        color: "#0F172A",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Anuluj
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        console.log("[PIPEDRIVE SAVE] zmiany do wysłania:", dealChanges);

                        if (!dealChanges.length) {
                          alert("Brak zmian do zapisania.");
                          return;
                        }

                        const summary = dealChanges
                          .map((c) => {
                            const value = Array.isArray(c.pdValue)
                              ? c.pdValue.join(", ")
                              : String(c.pdValue);
                            return `Deal ${c.dealId ?? "(brak deal_id)"}: ${c.pdKey} (${c.kind}) -> ${value}`;
                          })
                          .join("\n");

                        console.log("Podsumowanie zmian:\n" + summary);

                        type DealChangePayload = {
                          dealId: number;
                          reportFieldId: number;
                          pdKey: string | null;
                          kind: string | null;
                          displayValue: any;
                          pdValue: any;
                          fieldName: string | null;
                          source: string | null;
                        };

                        // 1) POLA WŁASNE (manual) -> baza (bulk)
                        const manualItems: DealChangePayload[] = dealChanges
                          .filter((c) => c.source !== "pipedrive")
                          .map((c): DealChangePayload | null => {
                            const dealIdNum =
                              c.dealId != null ? Number(c.dealId) : NaN;
                            if (!Number.isFinite(dealIdNum) || !c.reportFieldId) {
                              return null;
                            }
                            return {
                              dealId: dealIdNum,
                              reportFieldId: c.reportFieldId,
                              pdKey: c.pdKey ?? null,
                              kind: c.kind ?? null,
                              displayValue: c.displayValue ?? null,
                              pdValue: c.pdValue ?? null,
                              fieldName: c.fieldName ?? null,
                              source: c.source ?? null,
                            };
                          })
                          .filter((x): x is DealChangePayload => x !== null);

                        // 2) POLA PIPEDRIVE -> /api/pipedrive/deals/[id]/update-from-report
                        const pipedriveItems = dealChanges.filter(
                          (c) => c.source === "pipedrive" && c.pdKey
                        );

                        const updates: Record<string, any> = {};
                        for (const c of pipedriveItems) {
                          if (!c.pdKey) continue;

                          // użyj klucza kanonicznego (API key z Pipedrive)
                          const apiKey = pdCanonicalKeys[c.pdKey] ?? c.pdKey;

                          if (c.kind === "multi") {
                            updates[apiKey] = Array.isArray(c.pdValue)
                              ? c.pdValue
                              : [String(c.pdValue)];
                          } else {
                            updates[apiKey] = Array.isArray(c.pdValue)
                              ? c.pdValue[0] ?? ""
                              : c.pdValue ?? "";
                          }
                        }

                        console.log("[SAVE] updates (Pipedrive, canonical keys):", updates);

                        if (!manualItems.length && !Object.keys(updates).length) {
                          alert("Brak poprawnych zmian do zapisania (dealId / pola).");
                          return;
                        }

                        console.log("[SAVE] manualItems (DB):", manualItems);
                        console.log("[SAVE] updates (Pipedrive):", updates);

                        try {
                          // 1) Zapis pól własnych w bazie
                          if (manualItems.length) {
                            const resBulk = await fetch("/api/report-field-values/bulk", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ items: manualItems }),
                            });

                            if (!resBulk.ok) {
                              const txt = await resBulk.text();
                              console.error("Błąd bulk save:", resBulk.status, txt);
                              alert("Nie udało się zapisać zmian w bazie.\n\n" + txt);
                              return;
                            }

                            const data = await resBulk.json().catch(() => null);
                            console.log("Bulk save OK:", data);
                          }

                          // 2) Zapis do Pipedrive (tylko jeśli są pola pipedrive)
                          if (Object.keys(updates).length && dealId) {
                            const resPd = await fetch(
                              `/api/pipedrive/deals/${dealId}/update-from-report`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ updates }),
                              }
                            );

                            const txtPd = await resPd.text();
                            if (!resPd.ok) {
                              console.error(
                                "Pipedrive update error:",
                                resPd.status,
                                txtPd
                              );
                              alert(
                                "Nie udało się zapisać zmian w Pipedrive.\n\n" + txtPd
                              );
                              return;
                            }

                            console.log("Pipedrive update OK:", txtPd || "(empty body)");
                          }

                          alert("Zmiany zapisane.");
                          setDealChanges([]);
                        } catch (err) {
                          console.error("Request error:", err);
                          alert("Nie udało się zapisać zmian (błąd sieci / serwera).");
                        }
                      }}
                      style={{
                        borderRadius: 9,
                        padding: "8px 14px",
                        border: "none",
                        background: "#7C3AED",
                        color: "white",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Zapisz
                    </button>


                  </>
                )}

                <div style={{ position: "relative" }}>
                  {isAdmin ? (
                    <>
                      {/* ADMIN – tak jak było */}
                      <button
                        type="button"
                        onClick={() => setShowModeMenu((v) => !v)}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          border: "none",
                          background: "linear-gradient(135deg, #7C3AED, #6366F1)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: "white",
                          boxShadow: "0 12px 30px rgba(79,70,229,0.5)",
                        }}
                        title={mode === "content" ? "Tryb: Treści" : mode === "print" ? "Tryb: Druk" : "Tryb: Układ"}
                      >
                        <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" focusable="false" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M0 0h24v24H0z"></path><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>
                      </button>


                      {showModeMenu && (
                        <div
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "110%",
                            marginTop: 8,
                            background: "white",
                            borderRadius: 12,
                            boxShadow: "0 18px 45px rgba(15,23,42,0.25)",
                            padding: 8,
                            zIndex: 50,
                            minWidth: 140,
                          }}
                        >
                          {[
                            { value: "content", label: "Treści" },
                            { value: "print", label: "Druk" },
                            { value: "layout", label: "Układ" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setMode(opt.value as Mode);
                                setShowModeMenu(false);
                              }}
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "none",
                                background:
                                  mode === opt.value ? "rgba(99,102,241,0.08)" : "transparent",
                                color: mode === opt.value ? "#111827" : "#4B5563",
                                cursor: "pointer",
                                fontSize: 13,
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* UŻYTKOWNIK – prosty toggle Treści/Druk */}
                      <button
                        type="button"
                        onClick={() =>
                          setMode((prev) => (prev === "content" ? "print" : "content"))
                        }
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          border: "none",
                          background: "linear-gradient(135deg, #7C3AED, #6366F1)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: "white",
                          boxShadow: "0 12px 30px rgba(79,70,229,0.5)",
                        }}
                        title={
                          mode === "content"
                            ? "Przełącz na tryb druku"
                            : "Przełącz na tryb treści"
                        }
                      >
                        {/* możesz zostawić tę samą ikonkę, albo prosty tekst */}
                        <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" focusable="false" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M0 0h24v24H0z"></path><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Lista stron */}
            <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
              {pages.map((page) => {
                const pageFields = fields.filter((f) => f.page_id === page.id);
                return (
                  <div key={page.id} className="print-page print-only" id={`print-page-${page.id}`} style={{ border: mode === "layout" ? "1px solid #E2E8F0" : "0px", borderRadius: 8, padding: mode === "layout" ? "16px" : "0px" }}>
                    <div style={{ display: mode === "layout" ? "flex" : "none", alignItems: "center", justifyContent: "space-between" }} data-hide-print>
                      <div>
                        <div style={{ fontSize: 12, color: "#64748B" }}><strong>Strona #{page.page_index + 1}</strong> - wymiary: {page.natural_width}×{page.natural_height} - URL: {page.image_url}</div>
                        {dealId ? (
                          <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4 }}>
                            Pipedrive deal_id: <b>{dealId}</b>{pdKeys.length ? ` • dostępnych pól: ${pdKeys.length}` : " • brak custom_by_name"}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#a16207", marginTop: 4 }}>
                            Brak <b>deal_id</b> w URL – lista pól Pipedrive będzie pusta.
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <label
                          style={{
                            border: "1px solid #CBD5E1",
                            padding: "4px 8px",
                            borderRadius: 6,
                            cursor: "pointer",
                            background: "white",
                            color: "#0F172A",
                          }}
                        >
                          Podmień tło (PNG/SVG)
                          <input
                            type="file"
                            accept="image/png,image/svg+xml"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleReplaceImage(page, file);
                              (e.currentTarget as HTMLInputElement).value = "";
                            }}
                            disabled={isBusy}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => setShowHiddenVvvInLayout((v) => !v)}
                          style={{
                            border: "1px solid #CBD5E1",
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: showHiddenVvvInLayout ? "#E2E8F0" : "white",
                            cursor: "pointer",
                            color: "#0F172A",
                          }}
                        >
                          {showHiddenVvvInLayout ? "Schowaj ukryte" : "Pokaż ukryte"}
                        </button>

                        <button
                          onClick={() => handleDeletePage(page)}
                          disabled={isBusy}
                          style={{
                            border: "1px solid #CBD5E1",
                            padding: "4px 8px",
                            borderRadius: 6,
                            color: "#DC2626",
                            background: "white",
                            cursor: "pointer",
                          }}
                        >
                          Usuń
                        </button>
                      </div>
                    </div>

                    {/* PODGLĄD STRONY z overlayem pól */}
                    <div style={{ marginTop: 16 }}>
                      <ReportSvgPage
                        page={page}
                        fields={pageFields}
                        mode={mode}
                        pdValues={pdViewValues}
                        onRefresh={async () => { await refreshFields(); }}
                        onSelectField={(id) => setSelectedFieldId(id)}
                        selectedFieldId={selectedFieldId}
                        inspectorFieldId={inspectorFieldId}
                        onOpenInspector={(id) => setInspectorFieldId(id)}
                        onCloseInspector={() => setInspectorFieldId(null)}
                        onPatchField={patchField}
                        onDeleteField={deleteField}
                        pdSelectOptions={pdSelectOptions}
                        pdSelectKinds={pdSelectKinds}
                        onFieldContentChange={registerDealChange}
                        showHiddenVvvInLayout={showHiddenVvvInLayout}
                      />

                      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }} data-hide-print>
                        <div style={{ display: mode === "layout" ? "flex" : "none" }}>
                          <button
                            onClick={() => setAddForPage(page)}
                            style={{
                              border: "1px solid #CBD5E1",
                              padding: "4px 8px",
                              borderRadius: 6,
                              background: "white",
                              cursor: "pointer",
                              color: "#0F172A",
                            }}
                          >
                            Dodaj pole
                          </button>

                        </div>
                        <button
                          onClick={async () => {
                            await saveMapSnapshotsForPage(page, pageFields);     // 1) zrób PNG do cache
                            (window as any).__map_snapshots = Object.fromEntries(mapSnapshotCache.entries()); // 2) udostępnij cache

                            await handlePrintSingleSVG(page, pageFields);        // 3) generuj SVG (używa cache)
                          }}


                          style={{
                            border: "1px solid #CBD5E1",
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: "#0F172A",
                            color: "white",
                            cursor: "pointer",
                          }}
                          title="Wydrukuj tylko tę stronę do PDF"
                        >
                          Drukuj tę stronę
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {pages.length === 0 && <div style={{ color: "#64748B" }}>Brak stron – dodaj PNG, aby utworzyć pierwszą stronę.</div>}
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Dodaj pole (Pipedrive / Własne) */}
      {addForPage && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setAddForPage(null)}
        >
          <div
            style={{ width: "min(560px, 100%)", background: "white", borderRadius: 12, boxShadow: "0 10px 24px rgba(0,0,0,0.25)", padding: 16, color: "#0F172A" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
              Dodaj pole do strony #{addForPage.page_index + 1}
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <label><input type="radio" name="add-src" value="pipedrive" checked={addSrc === "pipedrive"} onChange={() => setAddSrc("pipedrive")} /> Pipedrive</label>
              <label><input type="radio" name="add-src" value="manual" checked={addSrc === "manual"} onChange={() => setAddSrc("manual")} /> Własne pole</label>
            </div>

            {addSrc === "pipedrive" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#64748B" }}>
                  {dealId
                    ? pdOptions.length
                      ? "Wybierz pole Pipedrive (alfabetycznie) lub wyszukaj po nazwie:"
                      : "Brak dostępnych pól (custom_by_name jest puste)."
                    : "Brak deal_id w URL – nie można wczytać pól Pipedrive."}
                </div>

                {/* 🔍 pole wyszukiwania */}
                <input
                  type="text"
                  placeholder="Filtruj pola po nazwie lub kluczu..."
                  value={pdFilter}
                  onChange={(e) => setPdFilter(e.target.value)}
                  disabled={!dealId || pdOptions.length === 0}
                  style={{
                    border: "1px solid #CBD5E1",
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: "white",
                    color: "#0F172A",
                    fontSize: 12,
                  }}
                />

                {/* lista po przefiltrowaniu */}
                <select
                  value={pdSelectedKey}
                  onChange={(e) => setPdSelectedKey(e.target.value)}
                  disabled={!dealId || filteredPdOptions.length === 0}
                  size={Math.min(10, Math.max(4, filteredPdOptions.length || 4))} // trochę większa lista
                  style={{
                    border: "1px solid #CBD5E1",
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: "white",
                    color: "#0F172A",
                    width: "100%",
                  }}
                >
                  <option value="">— wybierz pole —</option>
                  {filteredPdOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label} ({opt.key})
                    </option>
                  ))}
                </select>

                {dealId && pdOptions.length > 0 && filteredPdOptions.length === 0 && (
                  <div style={{ fontSize: 12, color: "#DC2626" }}>
                    Brak pól pasujących do filtra „{pdFilter}”.
                  </div>
                )}

                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  * Etykiety pokazujemy bez prefiksu <code>raport_</code>. Zapisujemy oryginalny klucz Pipedrive.
                </div>
              </div>
            ) : (

              <div style={{ fontSize: 13, color: "#475569" }}>
                Zostanie dodane pole „Nowe pole” (źródło: własne). Później ustawisz czcionkę, kolor, rozmiar i treść.
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setAddForPage(null)} style={{ border: "1px solid #CBD5E1", padding: "6px 10px", borderRadius: 8, background: "white", color: "#0F172A" }}>
                Anuluj
              </button>
              <button
                onClick={confirmAddField}
                style={{ border: "1px solid transparent", padding: "6px 10px", borderRadius: 8, background: "#2B3674", color: "white" }}
              >
                Dodaj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Globalny CSS do wydruku (scoping, by chować całą resztę) */}
      <style jsx global>{`
  @media print {
    /* 1) User wybiera format (A4/A3/A2) w oknie drukarki, my nie wymuszamy rozmiaru strony */
    @page {
      margin: 10mm;   /* możesz dać 0, jeśli chcesz „pod ramkę” */
      size: auto;
    }

    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: auto !important;
      height: auto !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      overflow: visible !important;
    }

    /* 2) Schowaj wszystko poza zakresem druku */
    body * {
      visibility: hidden !important;
    }
    .print-scope,
    .print-scope * {
      visibility: visible !important;
    }

    /* 3) Kontener strony – dopasuj do szerokości kartki, NIE do ekranu */
    .print-scope .print-page.print-only {
      position: static !important;
      width: 100% !important;        /* 100% szerokości obszaru drukowania */
      max-width: 100% !important;
      height: auto !important;       /* może rosnąć w pionie */
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      page-break-inside: avoid !important;
      overflow: visible !important;
    }

    /* 4) Samo SVG – skalujemy TYLKO po szerokości */
    .print-scope .print-page.print-only svg {
      display: block !important;
      width: 100% !important;        /* dopasowanie do szerokości kartki */
      height: auto !important;       /* zachowanie proporcji */
      max-width: 100% !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* 5) Usuń wszystkie edytorskie nakładki */
    .no-print { 
      display: none !important; 
    }
    .print-scope .print-page.print-only [title="Liczba pól na tej stronie"] {
      display: none !important;
    }
    [data-hide-print] {
      display: none !important;
    }
  }
`}</style>


    </>
  );
}

function roundedTopPathStr(x: number, yTop: number, width: number, height: number, r: number) {
  const w = Math.max(0, width), h = Math.max(0, height);
  const rr = Math.min(r, w / 2, h);
  const yBottom = yTop + h;
  return `M ${x} ${yBottom} L ${x} ${yTop + rr} Q ${x} ${yTop} ${x + rr} ${yTop} ` +
    `L ${x + w - rr} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + rr} L ${x + w} ${yBottom} Z`;
}

// w CreateForm.tsx
function yeldsSvgString(x: number, y: number, w: number, h: number, hist: number[], histpv: number[]) {
  const pad = 8, X = x + pad, Y = y + pad, W = Math.max(0, w - 2 * pad), H = Math.max(0, h - 2 * pad);
  const max = 200, months = 12;
  const unit = W / (months * 3);          // 3 jednostki: blue, orange, gap
  const barW = Math.max(2, unit);
  const baseY = Y + H, k = H / max;
  const colorA = "#5CB6FF", colorB = "#F6B23A";

  const grid = Array.from({ length: 5 }, (_, i) => {
    const yy = Y + (H * i) / 5;
    return `<line x1="${X}" y1="${yy}" x2="${X + W}" y2="${yy}" stroke="#EEF3FA" stroke-width="1"/>`;
  }).join("");

  const bars = Array.from({ length: months }, (_, i) => {
    const vA = Math.max(0, Math.min(max, Number(hist[i] || 0)));
    const vB = Math.max(0, Math.min(max, Number(histpv[i] || 0)));
    const hA = vA * k, hB = vB * k;

    const groupX = X + i * (3 * unit);
    const ax = groupX;
    const bx = groupX + unit;

    const ry = 12;//Math.min(6, barW);
    const p1 = roundedTopPathStr(ax, baseY - hA, barW, hA, ry);
    const p2 = roundedTopPathStr(bx, baseY - hB, barW, hB, ry);
    const r1 = `<path d="${p1}" fill="${colorA}"/>`;
    const r2 = `<path d="${p2}" fill="${colorB}"/>`;
    return r1 + r2;

  }).join("");

  const grid2 = "";

  return `<g>${grid2}${bars}</g>`;
}

function rosePlotlySvgString(x: number, y: number, w: number, h: number, values16: number[] | null) {
  const stroke = "#54A0FF";
  const grid = "#E6ECF6";
  const label = "#9FB2CC";
  const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const DEG = Math.PI / 180;

  const cx = x + w / 2, cy = y + h / 2;
  const rMax = Math.max(0, Math.min(w, h) / 2 - 6);
  const vals = (values16 && values16.length === 16) ? values16 : new Array(16).fill(0);
  const maxVal = Math.max(1, ...vals.map(v => Number(v) || 0));

  // siatka
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map((f, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${f * rMax}" fill="none" stroke="${grid}" stroke-width="1"/>`).join("");
  const spokes = Array.from({ length: 16 }, (_, i) => {
    const a = (i * 22.5 - 90) * DEG;
    const x2 = cx + rMax * Math.cos(a), y2 = cy + rMax * Math.sin(a);
    return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${grid}" stroke-width="1"/>`;
  }).join("");

  // etykiety
  const labelR = rMax + 10;
  const labels = DIRS.map((d, i) => {
    const a = (i * 22.5 - 90) * DEG;
    const lx = cx + labelR * Math.cos(a), ly = cy + labelR * Math.sin(a);
    const ax = Math.cos(a);
    const anchor = Math.abs(ax) < 0.3 ? "middle" : (ax > 0 ? "start" : "end");
    const fs = Math.max(10, rMax * 0.11);
    return `<text x="${lx}" y="${ly}" font-size="${fs}" fill="${label}" text-anchor="${anchor}"
                  dominant-baseline="middle">${d}</text>`;
  }).join("");

  // kliny tylko obrys
  const half = 11.25;
  const wedges = vals.map((v, i) => {
    const frac = Math.max(0, Math.min(1, (Number(v) || 0) / maxVal));
    const R = frac * rMax; if (R <= 0) return "";
    const cDeg = i * 22.5 - 90;
    const a1 = (cDeg - half) * DEG, a2 = (cDeg + half) * DEG;
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2} Z`;
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="3"/>`;
  }).join("");

  return `<g>${rings}${spokes}${wedges}<circle cx="${cx}" cy="${cy}" r="1.5" fill="${grid}"/>${labels}</g>`;
}
