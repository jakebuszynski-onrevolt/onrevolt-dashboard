// src/lib/reportSvgRules.ts

// <g id="Dom - kompresja">
// <rect id="A" x="41" y="519" width="811.2" height="507" fill="url(#pattern0_121_16717)"/>
// <rect id="B" x="41" y="519" width="811.2" height="507" fill="url(#pattern1_121_16717)"/>
// <rect id="C" x="41" y="519" width="811.2" height="507" fill="url(#pattern2_121_16717)"/>
// <rect id="D" x="41" y="519" width="811.2" height="507" fill="url(#pattern3_121_16717)"/>
// <rect id="F" x="41" y="519" width="811.2" height="507" fill="url(#pattern4_121_16717)"/>
// <rect id="konfigurator" x="41" y="519" width="811.2" height="507" fill="url(#pattern5_121_16717)"/>
// <rect id="grzanie elektryczne" x="41" y="519" width="811.2" height="507" fill="url(#pattern9_121_16717)"/>
// <rect id="kondensat gaz" x="41" y="519" width="811.2" height="507" fill="url(#pattern12_121_16717)"/>
// <rect id="olej" x="41" y="519" width="811.2" height="507" fill="url(#pattern14_121_16717)"/>
// <rect id="piec na drewno" x="41" y="519" width="811.2" height="507" fill="url(#pattern15_121_16717)"/>
// <rect id="piec na pellet" x="41" y="519" width="811.2" height="507" fill="url(#pattern16_121_16717)"/>
// <rect id="piec na wegiel" x="41" y="519" width="811.2" height="507" fill="url(#pattern17_121_16717)"/>
// <rect id="pompa ciepla grunt" x="41" y="519" width="811.2" height="507" fill="url(#pattern18_121_16717)"/>
// <rect id="pompa ciepla powietrze" x="41" y="519" width="811.2" height="507" fill="url(#pattern19_121_16717)"/>
// <rect id="kolektor" x="41" y="519" width="811.2" height="507" fill="url(#pattern23_121_16717)"/>
// <rect id="reflow" x="41" y="519" width="811.2" height="507" fill="url(#pattern25_121_16717)"/>
// <rect id="stacja pogodowa" x="41" y="519" width="811.2" height="507" fill="url(#pattern30_121_16717)"/>
// <rect id="stary piec" x="41" y="519" width="811.2" height="507" fill="url(#pattern31_121_16717)"/>
// </g>

import type { ReportField } from "@/types/report";
import { isFormulaName, parseFormulaName } from "@/lib/fieldExpr";
import { tree } from "next/dist/build/templates/app-page";

export type SvgRulesContext = {
    rootSvg: SVGSVGElement;
    fields: ReportField[];
    pdValues: any;
    computedValue: (f: ReportField) => any;
};

function toNumberPL(v: any): number {
  const s = String(v ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findFieldByNameOrFormulaLabel(fields: ReportField[], name: string): ReportField | undefined {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return undefined;

  // 1) exact name match
  const direct = fields.find(
    (ff) => String((ff as any).name || "").trim().toLowerCase() === needle
  );
  if (direct) return direct;

  // 2) formula label match: =|label|expr
  return fields.find((ff) => {
    const rawName = String((ff as any).name || "").trim();
    if (!isFormulaName(rawName)) return false;
    const parsed = parseFormulaName(rawName);
    const label = String(parsed?.label || "").trim().toLowerCase();
    return label === needle;
  });
}

export function getFieldValueByName(ctx: SvgRulesContext, name: string): any {
  const f = findFieldByNameOrFormulaLabel(ctx.fields as any[], name);
  if (f) {
    try {
      return ctx.computedValue(f as any);
    } catch {
      // ignore
    }
  }

  // fallback: pdValues
  const pv: any = ctx.pdValues as any;
  if (pv && pv[name] != null) return pv[name];

  return undefined;
}

function setVisible(ctx: SvgRulesContext, id: string, visible: boolean) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;
    const el =
        rootSvg.querySelector<SVGGraphicsElement>(`[id="${id}"]`);
    if (!el) return;
    if (visible) {
        el.removeAttribute("display");
    } else {
        el.setAttribute("display", "none");
    }
};

// ===== CONFIG CACHE (SQL -> memory) =====
type ConfigRow = {
  fieldName: string;           // np. "config_bank"
  label: string;               // np. "15 kWh"
  item_type?: string | null;
  price1?: number | null;
  price2?: number | null;
  price3plus?: number | null;
  percent?: number | null;
  maxdot?: number | null;
  par1?: string | null;
  par2?: string | null;
  pd_field_id?: number;
  pd_option_id?: number;
};

declare global {
  interface Window {
    __CFG_CACHE?: {
      // fieldName -> label(lowercase) -> ConfigRow
      byField: Record<string, Record<string, ConfigRow>>;

      // fieldName -> pd_option_id -> ConfigRow
      byFieldOptionId: Record<string, Record<number, ConfigRow>>;

      loadedAt: number;
    };
  }
}


/**
 * Wywołaj raz po starcie strony (async w UI), a potem w regułach tylko sync lookup.
 */
export function primeConfigCacheFromApiPayload(payload: {
  idToName: Record<string, string>;
  rows: any[];
}) {
  if (typeof window === "undefined") return;

  const idToName = payload?.idToName || {};
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  // label -> row
  const byField: Record<string, Record<string, ConfigRow>> = {};

  // optionId -> row (przydatne gdy multiselect zwraca ID zamiast label)
  const byFieldOptionId: Record<string, Record<number, ConfigRow>> = {};

  for (const r of rows) {
    const pd_field_id = Number(r.pd_field_id);
    const pd_option_id = Number(r.pd_option_id);

    const fieldName = String(idToName[String(pd_field_id)] || "").trim(); // np. config_bank
    if (!fieldName) continue;

    const label = String(r.label ?? "").trim();
    if (!label) continue;

    const fKey = fieldName.toLowerCase();
    const lKey = label.toLowerCase();

    const row: ConfigRow = {
      fieldName,
      label,
      item_type: r.item_type ?? null,
      price1: r.price1 ?? null,
      price2: r.price2 ?? null,
      price3plus: r.price3plus ?? null,
      percent: r.percent ?? null,
      maxdot: r.maxdot ?? null,
      par1: r.par1 ?? null,
      par2: r.par2 ?? null,
      pd_field_id,
      pd_option_id,
    };

    byField[fKey] ||= {};
    byField[fKey][lKey] = row;

    if (Number.isFinite(pd_option_id)) {
      byFieldOptionId[fKey] ||= {};
      byFieldOptionId[fKey][pd_option_id] = row;
    }
  }

  window.__CFG_CACHE = {
    byField,
    // @ts-ignore - jeśli nie masz tego w typie, dopisz do definicji Window.__CFG_CACHE
    byFieldOptionId,
    loadedAt: Date.now(),
  };
}


/**
 * Uniwersalnie:
 * - czyta z formularza aktualną wartość pola config_* (label)
 * - zwraca rekord z cache SQL dla (fieldName + label)
 */
export function getSelectedConfigRow(ctx: SvgRulesContext, fieldName: string): ConfigRow | undefined {
  if (typeof window === "undefined") return undefined;
  const cache = window.__CFG_CACHE?.byField;
  if (!cache) return undefined;

  const getFieldValueByName = (name: string): any => {
    const f = ctx.fields.find(
      (ff) => String((ff as any).name || "").trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (!f) return undefined;
    return ctx.computedValue(f);
  };

  const selectedLabelRaw =
    getFieldValueByName(fieldName) ??
    (ctx.pdValues as any)?.[fieldName] ??
    (ctx.pdValues as any)?.custom_by_name?.[fieldName] ??
    (ctx.pdValues as any)?.customByName?.[fieldName] ??
    (ctx.pdValues as any)?.fields?.[fieldName];

  const selectedLabel = String(selectedLabelRaw ?? "").trim();
  if (!selectedLabel) return undefined;

  const fKey = fieldName.trim().toLowerCase();
  const lKey = selectedLabel.toLowerCase();

  return cache[fKey]?.[lKey];
}

/**
 * Uniwersalnie: ustaw wartość pola formularza po name.
 * Best-effort: próbuje kilka strategii bez znajomości Twoich wewnętrznych setterów.
 */
export function setMetaValueByName(ctx: SvgRulesContext, name: string, nextVal: any) {
  const targetName = name.trim().toLowerCase();

  const target = ctx.fields.find(
    (ff) => String((ff as any).name || "").trim().toLowerCase() === targetName
  );
  if (!target) {
    console.warn(`[CFG] setMetaValueByName: field not found: ${name}`);
    return false;
  }

  const id = Number((target as any).id);

  // meta_json może być stringiem → parse
  const rawMeta = (target as any).meta_json;
  let metaObj: any;
  if (typeof rawMeta === "string") {
    try {
      metaObj = JSON.parse(rawMeta || "{}");
    } catch {
      metaObj = {};
    }
  } else {
    metaObj = rawMeta || {};
  }

  const valStr = String(nextVal ?? "");

  // jeśli bez zmian — i tak odśwież UI (jak u Ciebie)
  if (String(metaObj?.value ?? "") === valStr) {
    window.dispatchEvent(new Event("recalc-ui"));
    return true;
  }

  const nextMeta = { ...metaObj, value: valStr };

  // in-memory (computeField zobaczy)
  (target as any).meta_json = nextMeta;

  // odśwież UI
  window.dispatchEvent(
    new CustomEvent("report-fields:meta-updated", {
      detail: { id, meta_json: nextMeta, name },
    })
  );

  return true;
}


function normalizeSelectedLabels(raw: any): string[] {
  if (raw == null) return [];

  // 1) tablica labeli / obiektów
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "string") return x;
        if (typeof x === "object") return String((x as any).label ?? (x as any).name ?? (x as any).value ?? "");
        return String(x);
      })
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // 2) pojedynczy obiekt {label:...}
  if (typeof raw === "object") {
    const s = String((raw as any).label ?? (raw as any).name ?? (raw as any).value ?? "").trim();
    return s ? [s] : [];
  }

  // 3) string – może być "A, B, C" albo "A;B;C" albo "A\nB"
  const s = String(raw).trim();
  if (!s) return [];

  // PD często zwraca CSV z przecinkami, czasem średniki
  const parts = s.split(/[,\n;]+/g).map((p) => p.trim()).filter(Boolean);

  // jeśli nie dało się sensownie rozdzielić, traktuj jako single
  return parts.length ? parts : [s];
}

export function getSelectedConfigRows(ctx: SvgRulesContext, fieldName: string): ConfigRow[] {
  if (typeof window === "undefined") return [];
  const cache = window.__CFG_CACHE?.byField;
  if (!cache) return [];

  // UWAGA: tu warto użyć Twojego uniwersalnego getFieldValueByName (obsługa computed),
  // ale jeśli jeszcze go nie podpiąłeś, zostawiam minimalnie jak masz:
  const getFieldValueByNameLocal = (name: string): any => {
    const f = ctx.fields.find(
      (ff) => String((ff as any).name || "").trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (!f) return undefined;
    return ctx.computedValue(f);
  };

  const raw =
    getFieldValueByNameLocal(fieldName) ??
    (ctx.pdValues as any)?.[fieldName] ??
    (ctx.pdValues as any)?.custom_by_name?.[fieldName] ??
    (ctx.pdValues as any)?.customByName?.[fieldName] ??
    (ctx.pdValues as any)?.fields?.[fieldName];

  const labels = normalizeSelectedLabels(raw);
  if (!labels.length) return [];

  const fKey = fieldName.trim().toLowerCase();
  const dict = cache[fKey];
  if (!dict) return [];

  // map labels -> rows (pomijamy te nieznalezione)
  const rows: ConfigRow[] = [];
  for (const lab of labels) {
    const lKey = lab.toLowerCase();
    const row = dict[lKey];
    if (row) rows.push(row);
  }
  return rows;
}


/**
 * Główna funkcja – tutaj odpalamy wszystkie „reguły” dla SVG.
 * W przyszłości dokładamy kolejne applyXxxLayers(ctx).
 */
export function applySvgDynamicLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;
    const klimRect = rootSvg.querySelector<SVGGraphicsElement>('[id="klimatyzacja"]');
    if (!klimRect) {
        // nie ta strona / nie ten szablon – nic nie robimy
        return;
    }

    try {
        applyBankLayers(ctx);
        applyPumpLayers(ctx);
        applyInverterLayers(ctx);
        applyPVLayers(ctx);
        applyTurbinyLayers(ctx);
        applyEVLayers(ctx);
        applyJacuzziLayers(ctx);
        applyKlimaLayers(ctx);
        applyKolektorsLayers(ctx);
        applyZrodlaCieplaLayers(ctx);
        applyStandardEnergetycznyLayers(ctx);
        applyStacjaPogodowaLayers(ctx);
        applyDotacjaLayers(ctx);
        applyKredytLayers(ctx);
        applyReLayers(ctx);        
        
    } catch (e) {
        console.error("[SVG RULES] applySvgDynamicLayers error:", e);
    }
}

//Banki
function applyBankLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    // 1) najpierw próbujemy z pól formularza (lokalne chk_bank / sp_bank),
    //    dopiero potem ewentualnie z pdValues jako fallback.
    const rawChk = getFieldValueByName(ctx,"chk_bank");
    const rawCount = getFieldValueByName(ctx,"sp_bank")


    const toBool = (v: any) => {
        if (v === null || v === undefined) return false;
        const s = String(v).trim().toLowerCase();
        if (!s) return false;
        return (
            s === "1" ||
            s === "true" ||
            s === "tak" ||
            s === "yes" ||
            s === "on"
        );
    };

    const enabled = toBool(rawChk);
    const count = enabled ? Number(rawCount ?? 0) : 0;
    if (count<0) setMetaValueByName(ctx,"sp_bank",0);

    const ids = ["resource1 1", "resource2 1", "resource3 1"];

    // właściwa logika widoczności
    setVisible(ctx, "resource 1", enabled && count >= 1);
    setVisible(ctx, "resource 2", enabled && count >= 2);
    setVisible(ctx, "resource 3", enabled && count >= 3);


    const Row = getSelectedConfigRow(ctx, "config_bank");
    // tiers: cena za sztukę zależnie od ilości
    const unitPrice =
      count <= 1 ? (Row?.price1 ?? 0)
      : count === 2 ? (Row?.price2 ?? Row?.price1 ?? 0)
      : (Row?.price3plus ?? Row?.price2 ?? Row?.price1 ?? 0);

    const total = enabled ? unitPrice * Math.max(0, count) : 0;
    
    // wpisz do pola formularza (np. "w_bank")
    setMetaValueByName(ctx, "w_bank", total ? Number(total).toFixed(2) : "");
    if (count==1)
        setMetaValueByName(ctx, "chk_bank", 1);
    if (count==0)
        setMetaValueByName(ctx, "chk_bank", 0);
}

//Pump
function applyPumpLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    // 1) najpierw próbujemy z pól formularza (lokalne chk_bank / sp_bank),
    //    dopiero potem ewentualnie z pdValues jako fallback.
    const rawChk = getFieldValueByName(ctx,"chk_pump");
    const rawCount = getFieldValueByName(ctx, "sp_pump");

    const toBool = (v: any) => {
        if (v === null || v === undefined) return false;
        const s = String(v).trim().toLowerCase();
        if (!s) return false;
        return (
            s === "1" ||
            s === "true" ||
            s === "tak" ||
            s === "yes" ||
            s === "on"
        );
    };

    const enabled = toBool(rawChk);
    const count = enabled ? Number(rawCount ?? 0) : 0;

    // const ids = ["resource1 1", "resource2 1", "resource3 1"];

    // // właściwa logika widoczności
    // setVisible(ctx, "resource 1", enabled && count >= 1);
    // setVisible(ctx, "resource 2", enabled && count >= 2);
    // setVisible(ctx, "resource 3", enabled && count >= 3);


    const Row = getSelectedConfigRow(ctx, "config_pump_type");
    // tiers: cena za sztukę zależnie od ilości
    // tiers: cena za sztukę zależnie od ilości
    const unitPrice = count <= 1 ? (Row?.price1 ?? 0) : count === 2 ? (Row?.price2 ?? Row?.price1 ?? 0) : (Row?.price3plus ?? Row?.price2 ?? Row?.price1 ?? 0);
    const total = enabled ? unitPrice * Math.max(0, count) : 0;   
    // wpisz do pola formularza (np. "w_bank")
    setMetaValueByName(ctx, "w_pump", total ? Number(total).toFixed(2) : "");
}

//Pump
function applyInverterLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    // 1) najpierw próbujemy z pól formularza (lokalne chk_bank / sp_bank),
    //    dopiero potem ewentualnie z pdValues jako fallback.
    const rawChk = getFieldValueByName(ctx,"chk_inverter");
    const rawCount = getFieldValueByName(ctx,"sp_inverter");

    const toBool = (v: any) => {
        if (v === null || v === undefined) return false;
        const s = String(v).trim().toLowerCase();
        if (!s) return false;
        return (
            s === "1" ||
            s === "true" ||
            s === "tak" ||
            s === "yes" ||
            s === "on"
        );
    };

    const enabled = toBool(rawChk);
    const count = enabled ? Number(rawCount ?? 0) : 0;

    // const ids = ["resource1 1", "resource2 1", "resource3 1"];

    // // właściwa logika widoczności
    // setVisible(ctx, "resource 1", enabled && count >= 1);
    // setVisible(ctx, "resource 2", enabled && count >= 2);
    // setVisible(ctx, "resource 3", enabled && count >= 3);


    const Row = getSelectedConfigRow(ctx, "config_inverter");
    // tiers: cena za sztukę zależnie od ilości
    // tiers: cena za sztukę zależnie od ilości
    const unitPrice = count <= 1 ? (Row?.price1 ?? 0) : count === 2 ? (Row?.price2 ?? Row?.price1 ?? 0) : (Row?.price3plus ?? Row?.price2 ?? Row?.price1 ?? 0);
    const total = enabled ? unitPrice * Math.max(0, count) : 0;   
    // wpisz do pola formularza (np. "w_bank")
    setMetaValueByName(ctx, "w_inverter", total ? Number(total).toFixed(2) : "");
}


//PV
function applyPVLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    const rawChk = getFieldValueByName(ctx, "chk_PV");
    const rawCount = getFieldValueByName(ctx,"sp_PV");

    const enabled = String(rawChk).trim().toLowerCase() == "1" ? true : false;
    const count = enabled ? Number(rawCount ?? 0) : 0;

    const ids = ["pv1 1", "pv2 1", "pv3 1", "pv4 1"];

    // właściwa logika widoczności
    setVisible(ctx, "pv", enabled && count >= 1);
    setVisible(ctx, "pv2", enabled && count > 4);
    setVisible(ctx, "pv3", enabled && count > 8);
    setVisible(ctx, "pv4", enabled && count > 12);

    const Row = getSelectedConfigRow(ctx, "config_pv_type");
    // tiers: cena za sztukę zależnie od ilości
    const unitPrice = count <= 1 ? (Row?.price1 ?? 0) : count === 2 ? (Row?.price2 ?? Row?.price1 ?? 0) : (Row?.price3plus ?? Row?.price2 ?? Row?.price1 ?? 0);
    const total = enabled ? unitPrice * Math.max(0, count) : 0;  
    setMetaValueByName(ctx, "w_PV", total ? Number(total).toFixed(2) : "");    
}

//Turbiny
function applyTurbinyLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    const rawChk = getFieldValueByName(ctx,"chk_turbina");
    const rawCount = getFieldValueByName(ctx,"sp_turbina");

    const enabled = String(rawChk).trim().toLowerCase() == "1" ? true : false;
    const count = enabled ? Number(rawCount ?? 0) : 0;

    // właściwa logika widoczności
    setVisible(ctx, "turbina 1", enabled && count >= 1);
    setVisible(ctx, "turbina 2", enabled && count >= 2);
    setVisible(ctx, "turbina 3", enabled && count >= 3);
}

//Stacja pogodowa
function applyStacjaPogodowaLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    const rawChk = getFieldValueByName(ctx, "chk_flow");
    const rawCount = getFieldValueByName(ctx, "sp_flow");

    const enabled = String(rawChk).trim().toLowerCase() == "1" ? true : false;
    const count = enabled ? Number(rawCount ?? 0) : 0;

    // właściwa logika widoczności
    setVisible(ctx, "stacja pogodowa", enabled && count >= 1);
}

// EV
function applyEVLayers(ctx: SvgRulesContext) {
  const { rootSvg, fields, pdValues, computedValue } = ctx;

  const FIELD_KEY = "jakie_urzadzenia_o_duzym_poborze_energii_posiadasz";
  const EV_LABEL = "Samochód elektryczny/hybrydowy";

  // 1) spróbuj z lokalnego pola (jeśli masz pole o tej nazwie w fields)
  let rawVal: any = getFieldValueByName(ctx, FIELD_KEY);

  let enabled = false;

  if (Array.isArray(rawVal)) {
    // klasyczny multi-select z PD
    enabled = rawVal.includes(EV_LABEL);
  } else if (rawVal != null) {
    // jeśli computedValue zwraca stringa z listą po przecinku, itp.
    const tokens = String(rawVal)
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    enabled = tokens.includes(EV_LABEL);
  } else {
    enabled = false;
  }

  // jeśli kiedyś zmienisz nazwę opcji w PD, możesz zrobić fallback na „zawiera słowo samochód…”
  // if (!enabled && rawVal) {
  //   const s = String(rawVal).toLowerCase();
  //   enabled = s.includes("samochód") && s.includes("elektryczny");
  // }

  setVisible(ctx, "samochod", enabled);
}

// Jacuzzi
function applyJacuzziLayers(ctx: SvgRulesContext) {
  const { rootSvg, fields, pdValues, computedValue } = ctx;

  const FIELD_KEY = "jakie_urzadzenia_o_duzym_poborze_energii_posiadasz";
  const EV_LABEL = "Jacuzzi";

  // 1) spróbuj z lokalnego pola (jeśli masz pole o tej nazwie w fields)
  let rawVal: any = getFieldValueByName(ctx, FIELD_KEY);

  let enabled = false;

  if (Array.isArray(rawVal)) {
    // klasyczny multi-select z PD
    enabled = rawVal.includes(EV_LABEL);
  } else if (rawVal != null) {
    // jeśli computedValue zwraca stringa z listą po przecinku, itp.
    const tokens = String(rawVal)
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    enabled = tokens.includes(EV_LABEL);
  } else {
    enabled = false;
  }

  // jeśli kiedyś zmienisz nazwę opcji w PD, możesz zrobić fallback na „zawiera słowo samochód…”
  // if (!enabled && rawVal) {
  //   const s = String(rawVal).toLowerCase();
  //   enabled = s.includes("samochód") && s.includes("elektryczny");
  // }

  setVisible(ctx, "jacuzzi", enabled);
}

// Klimatyzacja
function applyKlimaLayers(ctx: SvgRulesContext) {
  const { rootSvg, fields, pdValues, computedValue } = ctx;

  const FIELD_KEY = "jakie_urzadzenia_o_duzym_poborze_energii_posiadasz";
  const EV_LABEL = "Klimatyzacja";

  // 1) spróbuj z lokalnego pola (jeśli masz pole o tej nazwie w fields)
  let rawVal: any = getFieldValueByName(ctx, FIELD_KEY);

  let enabled = false;

  if (Array.isArray(rawVal)) {
    // klasyczny multi-select z PD
    enabled = rawVal.includes(EV_LABEL);
  } else if (rawVal != null) {
    // jeśli computedValue zwraca stringa z listą po przecinku, itp.
    const tokens = String(rawVal)
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    enabled = tokens.includes(EV_LABEL);
  } else {
    enabled = false;
  }

  // jeśli kiedyś zmienisz nazwę opcji w PD, możesz zrobić fallback na „zawiera słowo samochód…”
  // if (!enabled && rawVal) {
  //   const s = String(rawVal).toLowerCase();
  //   enabled = s.includes("samochód") && s.includes("elektryczny");
  // }

  setVisible(ctx, "klimatyzacja", enabled);
}


function applyZrodlaCieplaLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    //LPG
    const rawVal = getFieldValueByName(ctx, "zrod_o_energii_cieplnej");
    const tokens = String(rawVal);
    let enabled = false;
    let enabled1 = false;
    let enabled2 = false;
    let enabled2b = false;
    let enabled2c = false;
    let enabled3 = false;
    let enabled4 = false;
    let enabled5 = false;
    let enabled6 = false;
    let enabled7 = false;
    let enabled8 = false;
    let enabled9 = false;

    //LPG
    enabled = tokens.includes("LPG");
    enabled9 = enabled;

    //olej
    if (enabled==false)
        enabled3 = tokens.includes("Olej opałowy");

    if (enabled==false && enabled3==false) 
        enabled4 = tokens.includes("Ciepło systemowe (sieciowe)");
   
    if (enabled==false && enabled3==false && enabled4==false && tokens.includes("Energia elektryczna")) {
        //Energia Elektryczna
        const rawVal2 = getFieldValueByName(ctx, "rodzaj_zrod_a_ciep_a_na_energie_elektryczna");
        const tokens2 = String(rawVal2);
        enabled1 = tokens2.includes("Pompa ciepła powietrzna");
        enabled2 = tokens2.includes("Pompa ciepła - gruntowa");
        enabled2b = tokens2.includes("grzanie prądem");
        enabled2c = tokens2.includes("grzania");

    }

    if (enabled==false && enabled1==false && enabled2==false && enabled2b==false && enabled2c==false && enabled3==false && enabled4==false && tokens.includes("Drewno")) {
        //Drewno
        const rawVal2 = getFieldValueByName(ctx, "rodzaj_kot_a_na_drewno");
        const tokens2 = String(rawVal2);
        enabled5 = tokens2.includes("Pellet");
        enabled6 = tokens2.includes("drewno");
        enabled7 = tokens2.includes("zasypowy");
    }

    if (enabled==false && enabled1==false && enabled2==false && enabled2b==false && enabled2c==false && enabled3==false && enabled4==false && enabled5==false && enabled6==false && enabled7==false && tokens.includes("Gaz ziemny")) {
        //Gaz 
        //const rawVal2 = getFieldValueByName(ctx, "rodzaj_kot_a_na_gaz_ziemny");
        //const tokens2 = String(rawVal2);
        enabled9 = true;//tokens2.includes("kondensacyjny");
    }

    if (enabled9==false && tokens.includes("Węgiel")) {
        //Węgiel
        //const rawVal2 = getFieldValueByName(ctx, "rodzaj_kot_a_na_gaz_ziemny");
        //const tokens2 = String(rawVal2);
        enabled7 = true;
    }

    if (enabled9==false && enabled7==false && tokens.includes("Ciepło systemowe (sieciowe)")) {
        //Węgiel
        //const rawVal2 = getFieldValueByName(ctx, "rodzaj_kot_a_na_gaz_ziemny");
        //const tokens2 = String(rawVal2);
        enabled2b = true;
    }


    setVisible(ctx, "LPG", enabled);
    setVisible(ctx, "olej", enabled3);
    setVisible(ctx, "pompa ciepla powietrze", enabled1);
    setVisible(ctx, "pompa ciepla grunt", enabled2);
    setVisible(ctx, "grzanie elektryczne", enabled2b);
    setVisible(ctx, "piec na pellet", enabled5);
    setVisible(ctx, "piec na drewno", enabled6);
    setVisible(ctx, "piec na wegiel", enabled7);
    setVisible(ctx, "kondensat gaz", enabled9);
    if (enabled2c)
      setVisible(ctx, "klimatyzacja", enabled2c);
    setVisible(ctx, "stary piec", enabled8);  
}

function applyStandardEnergetycznyLayers(ctx: SvgRulesContext) {
    const { rootSvg, fields, pdValues, computedValue } = ctx;

    const rawVal = getFieldValueByName(ctx, "standard_energetyczny");
    const tokens = String(rawVal);
    
    const enabled1 = tokens.includes("Starszy dom (bez docieplenia)");
    const enabled2 = tokens.includes("Starszy dom (docieplony)");
    const enabled3 = tokens.includes("Nowe budownictwo");
    const enabled4 = tokens.includes("Dom energooszczędny");
    const enabled5 = tokens.includes("Dom pasywny");
    
    setVisible(ctx, "A", enabled5);
    setVisible(ctx, "B", enabled4);
    setVisible(ctx, "C", enabled3);
    setVisible(ctx, "D", enabled2);
    setVisible(ctx, "F", enabled1);
}

//Kolektory słonaczne
function applyKolektorsLayers(ctx: SvgRulesContext) {
  const { fields, pdValues, computedValue } = ctx;

  const kolektory = getFieldValueByName(ctx, "prosimy_o_podanie_mocy_instalacji_kw");
  const enabled = String(kolektory).trim().toLowerCase() != "" && String(kolektory).trim().toLowerCase() != "0";

  setVisible(ctx, "kolektor", enabled);
}

//Dotacje
function applyDotacjaLayers(ctx: SvgRulesContext) {
  // baza systemu (computed)
  const wwRaw = getFieldValueByName(ctx, "ww_systemu");
  const wwSystemu = toNumberPL(wwRaw);

  // warunki
  const hasTurbina = String(getFieldValueByName(ctx, "chk_turbina") ?? (ctx.pdValues as any)?.chk_turbina ?? "").trim() === "1";
  const hasBank    = String(getFieldValueByName(ctx, "chk_bank")    ?? (ctx.pdValues as any)?.chk_bank    ?? "").trim() === "1";
  const hasPump    = String(getFieldValueByName(ctx, "chk_pump")    ?? (ctx.pdValues as any)?.chk_pump    ?? "").trim() === "1";

  // ilość turbin
  const turbQtyRaw = getFieldValueByName(ctx, "sp_turbina") ?? (ctx.pdValues as any)?.sp_turbina;
  const turbQty = Math.max(0, Math.floor(toNumberPL(turbQtyRaw)));

  // wartość pompy (computed/meta)
  const wPumpRaw = getFieldValueByName(ctx, "w_pump") ?? (ctx.pdValues as any)?.w_pump;
  const wPump = Math.max(0, toNumberPL(wPumpRaw));

  // wybrane dotacje (multi-select)
  const rows = getSelectedConfigRows(ctx, "config_dotacja2");

  let sumDotacji = 0;

  for (const r of rows) {
    const pTurb = toNumberPL(r.price1);                     // turbina: na sztukę
    const pBank = toNumberPL(r.price2);                     // bank: jednorazowo
    const pPumpMax = toNumberPL((r as any).price3plus);     // pompa: maksymalna kwota dofinansowania (limit)
    const pct = Math.max(0, Math.min(1, toNumberPL(r.par1))); // np. 0.5
    const maxdot = Math.max(0, toNumberPL(r.maxdot));       // limit kwotowy per dotacja

    // baza tej dotacji (zależna od zaznaczeń)
    let base = 0;

    // turbina
    if (hasTurbina && turbQty > 0 && pTurb > 0) {
      base += pTurb * turbQty;
    }

    // bank
    if (hasBank && pBank > 0) {
      base += pBank;
    }

    // pompa ciepła: dotacja nie większa niż min(w_pump, price3)
    if (hasPump && wPump > 0 && pPumpMax > 0) {
      base += Math.min(wPump, pPumpMax);
    }

    if (base <= 0) continue;

    // LIMITY PER DOTACJA:
    const capPct = wwSystemu * pct;
    const capMaxdot = maxdot > 0 ? maxdot : Number.POSITIVE_INFINITY;

    const grant = Math.min(base, capPct, capMaxdot);
    sumDotacji += grant;
  }

  // finalnie obniżamy cenę o sumę dotacji (tnij do 0)
  const wwPoDotacjach = Math.max(0, wwSystemu - sumDotacji);
  const wwPoDotacjachMax = Math.max(wwSystemu*0.5, wwPoDotacjach);

  setMetaValueByName(ctx, "ww_kredytu", wwPoDotacjachMax ? wwPoDotacjachMax.toFixed(2) : "");
}

function calcPaybackYears(investment: number, oldYear: number, newYearWithLoan: number): number {
  const savings = Math.max(0, oldYear - newYearWithLoan);
  if (savings <= 0) return Infinity; // brak zwrotu
  return investment / savings;
}


function applyKredytLayers(ctx: SvgRulesContext) {
  // kwota po dotacjach (wejście)
  const kwRaw = getFieldValueByName(ctx, "ww_kredytu");
  const sumrokold = getFieldValueByName(ctx, "rachunek_rok");
  const sumrok = getFieldValueByName(ctx, "suma_rok_new");
  const chk_OZE = getFieldValueByName(ctx, "chk_OZE");
  const P = Math.max(0, toNumberPL(kwRaw)); // kapitał

  // wybrany kredyt
  const row = getSelectedConfigRow(ctx, "config_kredyt_oze");

  // oprocentowanie roczne (%)
  const aprPct = row?.percent != null ? Number(row.percent) : 0;
  const years = row?.par1 != null ? Math.max(0, Math.floor(toNumberPL(row.par1))) : 0;

  // jeśli brak kredytu / 0 lat / 0% -> wpisz po prostu P
  if (!row || P <= 0 || years <= 0 || chk_OZE=="0") {
    setMetaValueByName(ctx, "ww_systemu_OZE", P > 0 ? P.toFixed(2) : "");
    setMetaValueByName(ctx, "suma_rok_kredyt", 0);
    const yearsZ = calcPaybackYears(P, toNumberPL(sumrokold), toNumberPL(sumrok));
    setMetaValueByName(ctx, "czas_zwrotu", Number.isFinite(yearsZ) ? yearsZ.toFixed(2) : "");
    return;
  }

  const apr = Math.max(0, aprPct) / 100;       // np. 0.075
  const n = years * 12;                        // liczba miesięcy
  const r = apr / 12;                          // miesięczna stopa

  let totalPaid = 0;

  if (r === 0) {
    // kredyt 0%: równe raty kapitałowe
    totalPaid = P;
  } else {
    // rata annuitetowa
    const pow = Math.pow(1 + r, n);
    const pmt = P * (r * pow) / (pow - 1);     // równoważne: P*r / (1 - (1+r)^-n)
    totalPaid = pmt * n;
  }

  setMetaValueByName(ctx, "ww_systemu_OZE", totalPaid > 0 ? totalPaid.toFixed(2) : "");
  setMetaValueByName(ctx, "suma_rok_kredyt", totalPaid/10+toNumberPL(sumrok) > 0 ? (totalPaid/10+toNumberPL(sumrok)).toFixed(2) : "");
  const yearsZ = calcPaybackYears(P, toNumberPL(sumrokold), toNumberPL(totalPaid/10+toNumberPL(sumrok)));
  setMetaValueByName(ctx, "czas_zwrotu", Number.isFinite(yearsZ) ? yearsZ.toFixed(2) : "");
}


type ReCalcResult = {
  // tu możesz doprecyzować typ po Twoim JSON-ie
  yearCostCash?: number;
  depositAfterYear?: number;
  depositPayout20?: number;
  greenYearGenKWh?: number;
  greenYearSoldKWh?: number;
  finalSocKWh?: number;
  [k: string]: any;
};

// prościutki global cache (żeby nie strzelać fetch co render)
declare global {
  interface Window {
    __RE_DEBOUNCE?: any;
    __RE_LAST_KEY?: string;
    __RE_LAST?: ReCalcResult | null;
    __RE_INFLIGHT?: boolean;
  }
}

function applyReLayers(ctx: SvgRulesContext) {
  if (typeof window === "undefined") return;

  const { fields, pdValues, computedValue } = ctx;

  const getByName = (name: string): any => {
    const f = fields.find(
      (ff) => String((ff as any).name || "").trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (!f) return undefined;
    return computedValue(f);
  };

  const toNumStr = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).trim().replace(",", ".");
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? m[0] : "";
  };

  const toBool01 = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).trim().toLowerCase();
    if (s === "") return "";
    return s === "1" || s === "true" || s === "yes" || s === "on" ? "1" : "0";
  };

  // --- URL params (deal/person/project) ---
  const sp = new URLSearchParams(window.location.search);
  const deal_id = sp.get("deal_id") || "";
  const person_id = sp.get("person_id") || "";
  const projectId = sp.get("projectId") || "";

  // --- INPUTS ---
  // Jeśli chcesz potem wrócić do dynamicznych provider/tariff, odkomentuj:
  // const provider = toNumStr(getByName("osd_id") ?? (pdValues as any)?.osd_id);
  // const tariff   = toNumStr(getByName("tariff_id") ?? (pdValues as any)?.tariff_id);

  // ===== Operator OSD z Pipedrive =====
  const osdOperatorRaw = String(
    getByName("dystrybutor_osd") ?? (pdValues as any)?.dystrybutor_osd ?? ""
  ).trim();

  // ułatwienie: normalizacja (żeby działało dla "Enea Operator", "ENEA", itp.)
  const osdNorm = osdOperatorRaw.toLowerCase();

  // Mapowanie nazwa -> provider
  const OSD_TO_PROVIDER: Record<string, string> = {
    "enea": "1",
    "energa": "2",
    "pge": "4",
    "tauron": "3",
  };

  // Mapowanie provider -> tariff
  const PROVIDER_TO_TARIFF: Record<string, string> = {
    "1": "27",
    "2": "28",
    "4": "31",
    "3": "34",
  };

  // znajdź provider po fragmencie nazwy (bo w PD może być np. "Enea Operator")
  const provider =
    Object.entries(OSD_TO_PROVIDER).find(([k]) => osdNorm.includes(k))?.[1] || "";

  const tariff = provider ? (PROVIDER_TO_TARIFF[provider] || "") : "";

  if (!provider || !tariff) {
    console.warn(
      "[RE] Nie rozpoznano dystrybutor_osd -> provider/tariff:",
      { osdOperatorRaw, provider, tariff }
    );
    return;
  }

  const usageRaw = getFieldValueByName(ctx,"prad_rok");
  
  const UsageKWh = toNumberPL(usageRaw) || 4000;
  const annualUsageKWh = toNumStr(UsageKWh * 0.9);

  console.log("[RE] Usage raw:", annualUsageKWh);

  const kWp = toNumStr(getByName("sp_PV") ?? (pdValues as any)?.sp_PV);

  const chkPV = toBool01(getByName("chk_PV") ?? (pdValues as any)?.chk_PV);
  const chkWind = toBool01(getByName("chk_turbina") ?? (pdValues as any)?.chk_turbina);
  const chkSell = toBool01("1");
  const chkBank = toBool01(getByName("chk_bank") ?? (pdValues as any)?.chk_bank);

  const windV =
    toNumStr(getByName("sp_turbina") ?? (pdValues as any)?.sp_turbina) ||
    (chkWind === "1" ? "1" : "0");

  const bankV =
    toNumStr(getByName("sp_bank") ?? (pdValues as any)?.sp_bank) ||
    (chkBank === "1" ? "1" : "0");

  const from = String(getByName("re_start") ?? (pdValues as any)?.re_start ?? "2025-01-01").trim() || "2026-01-01";
  const days = toNumStr(getByName("re_days") ?? (pdValues as any)?.re_days) || "365";
  const lat = toNumStr(getByName("lat") ?? getByName("LAT") ?? getByName("map_lat") ?? (pdValues as any)?.lat ?? (pdValues as any)?.LAT);
  const lon = toNumStr(getByName("lon") ?? getByName("LON") ?? getByName("map_lon") ?? (pdValues as any)?.lon ?? (pdValues as any)?.LON);

  // --- build query ---
  const q = new URLSearchParams();
  if (deal_id) q.set("deal_id", deal_id);
  if (person_id) q.set("person_id", person_id);
  if (projectId) q.set("projectId", projectId);

  if (provider) q.set("provider", provider);
  if (tariff) q.set("tariff", tariff);
  if (annualUsageKWh) q.set("annualUsageKWh", annualUsageKWh);
  if (kWp) q.set("kWp", kWp);

  if (chkPV !== "") q.set("chkPV", chkPV);
  if (chkWind !== "") q.set("chkWind", chkWind);
  if (chkSell !== "") q.set("chkSell", chkSell);
  if (chkBank !== "") q.set("chkBank", chkBank);

  q.set("windV", windV);
  q.set("bankV", bankV);

  q.set("from", from);
  q.set("days", days);

  if (lat) q.set("lat", lat);
  if (lon) q.set("lon", lon);

  const key = q.toString();

  if (!key) return;

  // --- globals ---
  const W = window as any;
  W.__RE_SEQ = W.__RE_SEQ || 0;             // numer requestu
  W.__RE_ACTIVE = W.__RE_ACTIVE || 0;       // seq ostatniego requestu który ma wygrać
  W.__RE_PENDING_KEY = W.__RE_PENDING_KEY || null;
  W.__RE_DEBOUNCE && clearTimeout(W.__RE_DEBOUNCE);

  // jeśli key się nie zmienił - nic nie rób
  if (W.__RE_LAST_KEY === key) return;
  
  W.__RE_DEBOUNCE = setTimeout(async () => {
    // jeśli coś leci, to NIE skipujemy — tylko kolejkowanie latest
    if (W.__RE_INFLIGHT) {
      W.__RE_PENDING_KEY = W.__RE_LAST_KEY; // zapamiętaj najnowszy
      console.log("[RE] inflight -> queued pending key");
      return;
    }

    W.__RE_LAST_KEY = key;

    // start request
    W.__RE_INFLIGHT = true;
    const mySeq = ++W.__RE_SEQ;
    W.__RE_ACTIVE = mySeq;

    const myKey = W.__RE_LAST_KEY; // bierzemy najnowszy key w momencie startu
    const url = `/api/re/calc?${myKey}`;

    console.log("[RE] start req seq=", mySeq, "GET:", url);

    try {
      const resp = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const j = await resp.json();

      // jeśli w międzyczasie wystartował nowszy request, ignorujemy odpowiedź
      if (mySeq !== W.__RE_ACTIVE) {
        console.log("[RE] stale response ignored seq=", mySeq, "active=", W.__RE_ACTIVE);
        return;
      }

      if (!j?.ok) {
        console.warn("[RE] calc failed:", j);
        (pdValues as any).__re = null;
        W.__RE_LAST = null;
        return;
      }

      const data: ReCalcResult = (j?.data?.data ?? j?.data) as ReCalcResult;

      // jeśli ok, ale brak danych — też nie nadpisuj
      if (!data) {
        console.warn("[RE] ok but empty data:", j);
        return;
      }

      const sum = Number(data?.yearCostCash ?? 0) - Number(data?.depositPayout20 ?? 0);
      console.log("[RE] apply seq=", mySeq, "yearCostCash=", data?.yearCostCash, "depositPayout20=", data?.depositPayout20, "sum=", sum);

      // cache
      (pdValues as any).__re = data;
      W.__RE_LAST = data;

      // --- save to meta of custom field prad_rok_new ---
      const target = fields.find(
        (ff) => String((ff as any).name || "").trim().toLowerCase() === "prad_rok_new"
      );

      if (!target) {
        console.warn('[RE] field "prad_rok_new" NOT FOUND in fields[]');
        return;
      }

      const id = Number((target as any).id);

      // meta_json może być stringiem → parse
      const rawMeta = (target as any).meta_json;
      let metaObj: any;
      if (typeof rawMeta === "string") {
        try {
          metaObj = JSON.parse(rawMeta || "{}");
        } catch {
          metaObj = {};
        }
      } else {
        metaObj = rawMeta || {};
      }

      const nextVal = String(Number(sum || 0).toFixed(2));

      if (String(metaObj?.value ?? "") === nextVal) {
        console.log('[RE] prad_rok_new unchanged -> no PATCH');
        window.dispatchEvent(new Event("recalc-ui"));
        return;
      }

      const nextMeta = { ...metaObj, value: nextVal };

      // in-memory (computeField zobaczy)
      (target as any).meta_json = nextMeta;

      // odśwież UI      
window.dispatchEvent(
  new CustomEvent("report-fields:meta-updated", {
    detail: { id, meta_json: nextMeta, name: "prad_rok_new" },
  })
);
      

      // patch (trwałe)
      const patchResp = await fetch(`/api/report-fields/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ meta_json: nextMeta }),
      });

      if (!patchResp.ok) {
        const patchText = await patchResp.text().catch(() => "");
        console.warn("[RE] PATCH failed", patchResp.status, patchText);
      } else {
        console.log('[RE] PATCH OK -> "prad_rok_new" saved');
      }

      // odśwież UI
      window.dispatchEvent(new Event("recalc-ui"));
    } catch (e) {
      console.warn("[RE] calc error:", e);
      (pdValues as any).__re = null;
      W.__RE_LAST = null;
    } finally {
      W.__RE_INFLIGHT = false;

      // jeśli w trakcie ktoś zmienił key, to odpal jeszcze raz (latest)
      const pending = W.__RE_PENDING_KEY;
      W.__RE_PENDING_KEY = null;

      if (pending && pending !== W.__RE_LAST_KEY) {
        // W praktyce pending ustawiamy na __RE_LAST_KEY, więc tu zwykle nie wejdzie
        // ale zostawiam jako bezpiecznik.
        console.log("[RE] pending mismatch -> rerun");
        W.__RE_LAST_KEY = ""; // wymuś
        applyReLayers(ctx);
        return;
      }

      // Jeśli pending był ustawiony, to znaczy, że ktoś zmienił formularz w trakcie inflight.
      // Odpalamy ponownie na najnowszym key.
      if (pending) {
        console.log("[RE] run pending latest");
        const latestKey = W.__RE_LAST_KEY;
        W.__RE_LAST_KEY = ""; // wymuś przejście guard-a
        // ponowny przelicz
        applyReLayers(ctx);
        // przywróć (żeby key był spójny, ale i tak applyReLayers go odbuduje)
        W.__RE_LAST_KEY = latestKey;
      }
    }
  }, 350);
}
