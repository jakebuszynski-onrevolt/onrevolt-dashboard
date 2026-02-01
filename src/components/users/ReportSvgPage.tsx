"use client";

import React, { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";

// Dostosuj ścieżki do swoich typów
import type { ReportField, ReportPage } from "@/types/report";
import type { Mode } from "./CreateForm";
import { computeField, isFormulaName } from "@/lib/fieldExpr";
import RosePlotlySvg from "@/components/rose/RosePlotlySvg";
import { buildRoseArray16 } from "@/lib/windrose";
import { buildYeldsPair } from "@/lib/yelds";
import YeldsSvg from "@/components/yelds/YeldsSvg";
import dynamic from "next/dynamic";
import { log } from "console";
import { applySvgDynamicLayers } from "@/lib/reportSvgRules";
import { primeConfigCacheFromApiPayload } from "@/lib/reportSvgRules";

const MapAny: any = dynamic(() => import("@/components/map/MapComponent"), { ssr: false });

// Jednoźródłowe metryki
const PAD = 4;            // padding treści po każdej stronie
const LINE_H = 1.2;       // line-height

declare global {
  interface Window { __map_snapshots?: Record<number, string>; }
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

type BillsModalState = {
  type: "electric" | "heat";
  fieldId: number;
};


function getLogicalFieldName(name: string | null | undefined): string {
  const raw = String(name || "");

  // jeśli to formuła w stylu =|pradMies|raport_...
  if (isFormulaName(raw)) {
    const m = raw.match(/^=\|([^|]+)\|/);
    if (m && m[1]) {
      return m[1].trim().toLowerCase();
    }
  }

  // zwykła nazwa
  return raw.trim().toLowerCase();
}


type Props = {
  page: ReportPage;
  fields: ReportField[];
  mode: Mode; // "layout" | "content"
  pdValues?: Record<string, any>;
  pdSelectOptions?: Record<string, string[]>;
  pdSelectKinds?: Record<string, "single" | "multi">;

  onRefresh: () => void;
  onSelectField: (id: number | null) => void;
  selectedFieldId: number | null;

  inspectorFieldId: number | null;
  onOpenInspector: (id: number) => void;
  onCloseInspector: () => void;

  onPatchField?: (id: number, patch: Partial<ReportField>) => Promise<void> | void;
  onDeleteField?: (id: number) => Promise<void> | void;
  onFieldContentChange?: (info: {
    reportFieldId: number;
    pdKey: string;
    kind: "text" | "single" | "multi";
    displayValue: string;
    pdValue: string | string[];
    source: "pipedrive" | "manual";
    fieldName: string;
  }) => void;
  showHiddenVvvInLayout?: boolean;

};

function PinMarker({ cx, cy, size = 28, color = "#F59E0B" }: { cx: number; cy: number; size?: number; color?: string }) {
  // Ikona bazuje na siatce 24×24 (Material-like). Skalujemy i centrowo kotwiczymy.
  const s = size / 24;
  const outer = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z";
  return (
    <g transform={`translate(${cx},${cy}) scale(${s}) translate(-12,-24)`} style={{ pointerEvents: "none" }}>
      <path d={outer} fill={color} />
      {/* „Oko” */}
      <circle cx={12} cy={9} r={3.2} fill="#fff" />
    </g>
  );
}

function getLatLon(pd: Record<string, any>): { lat?: number; lon?: number } {
  const lat = Number(pd?.raport_lat);
  const lon = Number(pd?.raport_lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };

  const cbn = (pd as any)?.custom_by_name || (pd as any)?.customByName || {};
  const tryPick = (obj: any, keys: string[]) => {
    for (const k of Object.keys(obj)) if (keys.includes(k.toLowerCase())) return obj[k];
  };
  const lat2 = Number(tryPick(cbn, ["lat", "latitude"]));
  const lon2 = Number(tryPick(cbn, ["lon", "lng", "long", "longitude"]));
  if (Number.isFinite(lat2) && Number.isFinite(lon2)) return { lat: lat2, lon: lon2 };
  return {};
}

function getMarkerTitle(pd: Record<string, any>): string {
  const p = (pd as any)?.person || {};
  const name = p?.name || (pd as any)?.title || "";
  return String(name || "");
}

export default function ReportSvgPage({
  page,
  fields,
  mode,
  pdValues = {},
  pdSelectOptions = {},
  pdSelectKinds = {},
  onRefresh,
  onSelectField,
  selectedFieldId,
  inspectorFieldId,
  onOpenInspector,
  onCloseInspector,
  onPatchField,
  onDeleteField,
  onFieldContentChange,
  showHiddenVvvInLayout = false,
}: Props) {

  useEffect(() => {
    // console.log(
    //   "[ReportSvgPage] pdSelectOptions keys:",
    //   Object.keys(pdSelectOptions || {}),
    // );
  }, [pdSelectOptions]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hiddenOverlayFieldIds, setHiddenOverlayFieldIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (mode === "content" || mode === "print") hideAllVvv();
  }, [mode]);


  // lokalne nadpisania pozycji mapy: klucz = id pola, wartość = {lat, lon}
  const [localMapPos, setLocalMapPos] = useState<
    Record<number, { lat: number; lon: number }>
  >({});

  // Szablon SVG (oryginał z pliku) + aktualny markup po wstrzyknięciu wartości
  const [svgTemplate, setSvgTemplate] = useState<string | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);

  // BBox dla elementów SVG z id zaczynającym się od "XXX_"
  const [inlineSvgMarkup, setInlineSvgMarkup] = useState<string | null>(null);
  const [svgBoxes, setSvgBoxes] = useState<
    { id: string; x: number; y: number; width: number; height: number }[]
  >([]);

  // ref do <svg> – użyjemy do liczenia getBBox
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Zapamiętujemy, dla których pól zapisaliśmy już pozycję z SVG,
  // żeby nie robić PATCH w kółko
  const syncedSvgPositionsRef = useRef<Set<number>>(new Set());

useEffect(() => {
  (async () => {
    try {
      const r = await fetch("/api/config-editor/cache", { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) primeConfigCacheFromApiPayload(j);
    } catch (e) {
      console.warn("[CFG] cache load failed", e);
    }
  })();
}, []);

  const isSvgNodeVisible = (el: Element | null): boolean => {
    let cur: Element | null = el;
    while (cur) {
      const visAttr = (cur.getAttribute("visibility") || "").toLowerCase();
      const dispAttr = (cur.getAttribute("display") || "").toLowerCase();

      if (visAttr === "hidden") return false;
      if (dispAttr === "none") return false;

      const style = (cur.getAttribute("style") || "").toLowerCase();
      if (style.includes("visibility:hidden")) return false;
      if (style.includes("display:none")) return false;

      cur = cur.parentElement;
    }
    return true;
  };

  const getFieldSvgId = (f: any): string | null => {
    const meta = getMeta(f);
    const id = String(meta?.svg_id ?? "").trim();
    return id || null;
  };

  const getVvvTarget = (f: ReportField): string | null => {
    const meta = getMeta(f as any);

    // 1) preferowane: jawny klucz w meta (pole w inspectorze)
    const raw =
      meta?.vvv_target ??
      meta?.vvv_id ??
      meta?.show_svg_id ??
      meta?.toggle_svg_id ??
      "";

    const s = String(raw || "").trim();
    if (!s) return null;

    // dopuszczamy zarówno "VVV_cos" jak i "cos" (ale docelowo id w SVG)
    return s;
  };

  const [activeVvvId, setActiveVvvId] = useState<string | null>(null);

  const showVvv = (id: string) => setActiveVvvId(String(id || "").trim() || null);
  const hideAllVvv = () => setActiveVvvId(null);
  const hideAllVvvSafely = () => {
    // jeśli coś jest edytowane (input/textarea w panelu), wymuś blur, żeby odpalił się commit(onBlur)
    const ae = document.activeElement as HTMLElement | null;
    if (ae && wrapRef.current?.contains(ae)) {
      try { ae.blur(); } catch { }
    }

    // schowaj panel dopiero w następnym ticku (żeby blur/commit miały szansę się wykonać)
    window.setTimeout(() => {
      hideAllVvv();
    }, 0);
  };


  const [fieldOwnerVvv, setFieldOwnerVvv] = useState<Record<number, string | null>>({});
  const findOwnerVvvId = (el: Element | null): string | null => {
    let cur: Element | null = el;
    while (cur) {
      const id = cur.getAttribute("id") || "";
      if (id.startsWith("VVV_")) return id;
      cur = cur.parentElement;
    }
    return null;
  };

  const getOwnerVvvForSvgId = (svgId?: string): string | null => {
    if (!svgId) return null;
    const svgEl = svgRef.current;
    if (!svgEl) return null;

    // bezpieczne szukanie po id
    const esc = (window as any).CSS?.escape ? (window as any).CSS.escape(svgId) : svgId.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, "\\$1");
    const node = svgEl.querySelector(`#${esc}`) as Element | null;
    if (!node) return null;

    let cur: Element | null = node;
    while (cur) {
      const id = cur.getAttribute("id") || "";
      if (id.startsWith("VVV_")) return id;
      cur = cur.parentElement;
    }
    return null;
  };



  // Wciągnięcie szablonu SVG, jeśli tło jest plikiem .svg
  useEffect(() => {
    const url = page.image_url || "";

    if (!url.toLowerCase().endsWith(".svg")) {
      setSvgTemplate(null);
      setSvgMarkup(null);
      setSvgBoxes([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(url, { cache: "no-store" });
        const text = await resp.text();
        if (!cancelled) {
          setSvgTemplate(text);
        }
      } catch (e) {
        console.error("[ReportSvgPage] Nie udało się wczytać SVG", e);
        if (!cancelled) {
          setSvgTemplate(null);
          setSvgMarkup(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page.image_url]);


  // live preview treści podczas edycji (id -> text)
  const [editing, setEditing] = useState<Record<number, string>>({});

  // temp pozycje/rozmiary podczas drag/resize (do "blink" jak w Twoim komponencie)
  const [temp, setTemp] = useState<Record<number, { x: number; y: number; w: number; h: number }>>({});
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [liveStyle, setLiveStyle] = useState<Record<number, Partial<ReportField>>>({});

  const [billsModal, setBillsModal] = useState<BillsModalState | null>(null);


  const [geoUpdating, setGeoUpdating] = useState(false);

  const handleGeoUpdate = async (dealId: string | number | null | undefined) => {
    if (!dealId || geoUpdating) return;

    try {
      setGeoUpdating(true);

      const r = await fetch(`/api/pipedrive/deals/${dealId}/geocode?save=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      // spróbujmy przeczytać odpowiedź, jak coś jest
      let j: any = null;
      try {
        j = await r.json();
      } catch {
        // brak body też OK
      }

      if (!r.ok || (j && j.error)) {
        console.error("[geo update] error", j?.error || r.statusText);
      }

      // ✅ po zakończeniu czegokolwiek – pełny reload strony
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (e) {
      console.error("[geo update] exception", e);
    } finally {
      setGeoUpdating(false);
    }
  };



  const getSelectOptionsForField = (f: any): string[] | undefined => {
    const meta = getMeta(f);

    const pdKey =
      meta.pipedrive_key ||
      (f as any).pipedrive_key ||
      String((f as any).name || "").trim().toLowerCase();

    const opts = pdSelectOptions[pdKey];
    const kind = pdSelectKinds[pdKey]; // "single" | "multi" | undefined

    // console.log("[getSelectOptionsForField]", {
    //   fieldId: f.id,
    //   name: f.name,
    //   pdKey,
    //   kind,
    //   hasOptions: !!opts,
    //   optionsSample: opts ? opts.slice(0, 5) : null,
    // });

    if (!opts || !opts.length) return undefined;
    return opts;
  };


  // responsywny box (zachowuje proporcje naturalnych wymiarów obrazu)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ratio = page.natural_height / page.natural_width;
    const update = () => {
      const w = el.clientWidth || 0;
      setBox({ w, h: Math.max(1, Math.round(w * ratio)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.natural_width, page.natural_height]);

  // Wczytaj SVG jako tekst (inline), gdy tło jest plikiem .svg
  useEffect(() => {
    setInlineSvgMarkup(null);
    setSvgBoxes([]);

    const url = page.image_url || "";
    if (!url.toLowerCase().endsWith(".svg")) return;

    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(url, { cache: "no-store" });
        const text = await resp.text();

        // wyciągnij wnętrze <svg>...</svg>, żeby nie mieć zagnieżdżonego <svg><svg>...</svg></svg>
        const match = text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
        const inner = match ? match[1] : text;

        if (!cancelled) {
          setInlineSvgMarkup(inner);
        }
      } catch (e) {
        console.error("[ReportSvgPage] Nie udało się wczytać SVG", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page.image_url]);


  // Po wyrenderowaniu SVG policz bbox dla wszystkich elementów z atrybutem id
  useEffect(() => {
    if (!inlineSvgMarkup) return;
    const svgEl = svgRef.current;
    if (!svgEl) return;

    try {
      const elements = svgEl.querySelectorAll<SVGGraphicsElement>("[id^='XXX_']");
      const boxes: { id: string; x: number; y: number; width: number; height: number }[] = [];

      elements.forEach((el) => {
        if (typeof el.getBBox === "function") {
          const bb = el.getBBox();
          if (bb.width > 0 && bb.height > 0) {
            boxes.push({
              id: el.id,
              x: bb.x,
              y: bb.y,
              width: bb.width,
              height: bb.height,
            });
          }
        }
      });

      setSvgBoxes(boxes);
    } catch (e) {
      console.error("[ReportSvgPage] Błąd getBBox dla SVG:", e);
    }
  }, [inlineSvgMarkup, page.natural_width, page.natural_height]);


  // przeskaluj temp przy zmianie rozmiaru boxa
  const prevBoxRef = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const prev = prevBoxRef.current;
    if (!prev) { prevBoxRef.current = box; return; }
    if (prev.w !== box.w || prev.h !== box.h) {
      setTemp(old => {
        const cp: typeof old = {};
        for (const [sid, v] of Object.entries(old)) {
          const id = Number(sid);
          cp[id] = {
            x: (v.x / prev.w) * box.w,
            y: (v.y / prev.h) * box.h,
            w: (v.w / prev.w) * box.w,
            h: (v.h / prev.h) * box.h,
          };
        }
        return cp;
      });
      prevBoxRef.current = box;
    }
  }, [box]);

  // utils
  const safeText = (v: any) =>
    v == null ? "" : typeof v === "string" ? v : Array.isArray(v) || typeof v === "object" ? JSON.stringify(v) : String(v);

  const valueFromSource = (f: ReportField) => {
    // @ts-ignore
    if (f.source === "pipedrive" && (f as any).pipedrive_key) {
      // @ts-ignore
      return safeText(pdValues?.[(f as any).pipedrive_key]);
    }
    // @ts-ignore
    const meta = getMeta(f);
    return safeText(meta.value ?? "");
  };

  // wartość efektowna (jeśli edytujemy pole, pokaż live preview)
  const getValue = (f: ReportField) => {
    const id = (f as any).id as number;
    return editing[id] ?? valueFromSource(f);
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


  const computedValue = (f: ReportField) => {
    const id = (f as any).id as number;

    // 1) zawsze licz z uwzględnieniem aktualnych wpisów (editing)
    const { value } = computeField(f, fields, pdValues, editing);

    // 2) dla pola, które właśnie edytujemy – pokazuj surowy tekst z inputa
    if (editing[id] != null) {
      return editing[id]!;
    }

    // 3) dla reszty – formatuj (int / 2dec itd.)
    const meta = getMeta(f as any);
    return applyNumberFormatForDisplay(value, meta);
  };


  // Wstrzykiwanie wartości pól wprost do szablonu SVG (tylko dla id zaczynających się od "XXX_")
  useEffect(() => {
    if (!svgTemplate) {
      setSvgMarkup(null);
      return;
    }

    // mały helper do porównywania stringów
    const normalize = (s: any) =>
      String(s ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgTemplate, "image/svg+xml");
      const rootSvg = doc.documentElement as unknown as SVGSVGElement;

      // 🔧 prostokąty z samym stroke domyślnie mają w SVG fill=black.
      // Dla rect ze stroke, ale bez fill – ustawiamy fill na "none".
      doc
        .querySelectorAll<SVGRectElement>("rect[stroke]:not([fill])")
        .forEach((el) => {
          el.setAttribute("fill", "none");
        });

      // kolory linii dla multi
      const SVG_NS = "http://www.w3.org/2000/svg";
      const SELECTED_COLOR = "#2B3674";
      const UNSELECTED_COLOR = "#C0C3D6";
      const UNSELECTED_OPACITY = "0.4";

      const heatSourceField = fields.find(
        (ff) => getLogicalFieldName((ff as any).name || "") === HEAT_SOURCE_PDKEY
      );

      const heatSourceValue =
        heatSourceField != null
          ? computedValue(heatSourceField as any)
          : (pdValues as any)?.[HEAT_SOURCE_PDKEY];

      const activeHeatDetailKey = pickActiveHeatPdKey_UI(heatSourceValue);


      // Dla każdego pola z meta.svg_id zaczynającym się od "XXX_" modyfikujemy grupę <g>
      for (const f of fields) {
        const meta = getMeta(f as any);
        const svgId = meta?.svg_id as string | undefined;
        if (!svgId || !svgId.startsWith("XXX_")) continue;

        const logicalName = getLogicalFieldName((f as any).name || "");



        // ✅ kluczowe: nieaktywne detale NIE MOGĄ wstrzykiwać do XXX_
        if ((mode === "content" || mode === "print") && HEAT_DETAIL_KEYS.has(logicalName)) {
          if (!isActiveHeatDetailField(logicalName, activeHeatDetailKey)) {
            continue;
          }
        }


        const vvvTarget = String(meta?.vvv_target ?? meta?.vvv_id ?? "").trim() || null; // jeśli używasz tego klucza
        const ownerVvv = getOwnerVvvForSvgId(svgId);

        // 1) jeśli pole jest wewnątrz jakiegoś VVV_, a ten panel NIE jest aktywny -> ukryj overlay (czyli zniknie ramka+caret)
        if ((mode === "content" || mode === "print") && ownerVvv && ownerVvv !== activeVvvId) {
          continue;
        }

        // 2) jeśli to pole jest "wyzwalaczem" (ma vvvTarget) i akurat ten panel jest aktywny -> też ukryj to pole (żeby nie było dublowania)
        if ((mode === "content" || mode === "print") && vvvTarget && vvvTarget === activeVvvId) {
          continue;
        }


        const node = doc.getElementById(svgId);
        if (!node) continue;

        const rawName = String((f as any).name || "").trim().toLowerCase();
        const pdKeyForSvg =
          meta.pipedrive_key ||
          (f as any).pipedrive_key ||
          rawName;

        const selectKindForSvg = pdSelectKinds[pdKeyForSvg];
        const multiOptions =
          selectKindForSvg === "multi" && pdSelectOptions[pdKeyForSvg]
            ? pdSelectOptions[pdKeyForSvg]!
            : undefined;

        const valueStr = String(computedValue(f) ?? "");

        // ─────────────────────────────────────────────
        // GAŁĄŹ: MULTI-SELECT powiązany z XXX_...
        //  - bierzemy kolejność opcji z Pipedrive (multiOptions)
        //  - bierzemy zaznaczenia z valueStr (jak w overlayu)
        //  - po indeksie kolorujemy linie
        //  - krótkie teksty z SVG zostają (ale wstawiamy je ponownie)
        // ─────────────────────────────────────────────
        if (multiOptions && multiOptions.length && node.tagName.toLowerCase() === "g") {
          // 1) z obecnej zawartości <g> zbierz linie (pozycje + tekst)
          const oldTspans = Array.from(node.querySelectorAll<SVGTSpanElement>("tspan"));
          if (!oldTspans.length) {
            // nic sensownego do oparcia układu – odpuść i zostaw jak jest
            continue;
          }

          type LineInfo = { x: number; y: number; label: string };
          let templateText: SVGTextElement | null = null;

          const rawLines: LineInfo[] = oldTspans.map((ts) => {
            const parentText = ts.parentNode as SVGTextElement | null;
            if (!templateText && parentText && parentText.tagName.toLowerCase() === "text") {
              templateText = parentText;
            }

            const xAttr = ts.getAttribute("x") || parentText?.getAttribute("x") || "0";
            const yAttr = ts.getAttribute("y") || parentText?.getAttribute("y") || "0";

            return {
              x: Number(xAttr),
              y: Number(yAttr),
              label: ts.textContent || "",
            };
          });

          // sortujemy po Y → kolejność wizualna od góry do dołu
          const linesInfo = rawLines.sort((a, b) => a.y - b.y);

          if (!templateText) {
            // brak sensownego wzorca textu – zostaw oryginał
            continue;
          }

          // 2) policz które opcje z Pipedrive są zaznaczone (jak w overlayu)
          const selectedTokens = valueStr
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean);

          const selectedFlags = multiOptions.map((opt) => selectedTokens.includes(opt));

          // 3) WYCZYŚĆ całą grupę <g>
          while (node.firstChild) {
            node.removeChild(node.firstChild);
          }

          // 4) na podstawie templateText odtwarzamy atrybuty stylu
          const baseAttrs = Array.from(templateText.attributes);

          const count = Math.min(linesInfo.length, multiOptions.length);

          for (let i = 0; i < count; i++) {
            const info = linesInfo[i];
            const isSelected = selectedFlags[i];

            const textEl = doc.createElementNS(SVG_NS, "text");

            // kopiujemy wszystkie atrybuty poza pozycją / kolorem (x,y,fill,fill-opacity)
            for (const attr of baseAttrs) {
              const name = attr.name;
              if (name === "x" || name === "y" || name === "fill" || name === "fill-opacity") continue;
              textEl.setAttribute(name, attr.value);
            }

            // ustawiamy kolor wg zaznaczenia
            if (isSelected) {
              textEl.setAttribute("fill", SELECTED_COLOR);
              textEl.removeAttribute("fill-opacity");
              textEl.setAttribute("font-weight", "700");
            } else {
              textEl.setAttribute("fill", UNSELECTED_COLOR);
              textEl.setAttribute("fill-opacity", UNSELECTED_OPACITY);
              textEl.removeAttribute("font-weight");
            }


            // wstawiamy nowy tspan z oryginalną etykietą i pozycją
            const tspan = doc.createElementNS(SVG_NS, "tspan");
            tspan.setAttribute("x", String(info.x));
            tspan.setAttribute("y", String(info.y));
            const labelFromPd = multiOptions[i] ?? info.label; // PD > SVG
            tspan.textContent = labelFromPd;

            textEl.appendChild(tspan);
            node.appendChild(textEl);
          }

          // multi załatwione – lecimy do następnego pola
          continue;
        }

        // ─────────────────────────────────────────────
        // GAŁĄŹ DOMYŚLNA: zwykłe pola (single, tekst)
        //  – stare wstrzykiwanie tekstu działa jak wcześniej
        // ─────────────────────────────────────────────
        const text = valueStr;

        // ===== SVG: wyrównanie wg właściwości pola (text_align) =====
        const metaForSvg = getMeta(f);
        const align =
          ((metaForSvg as any)?.text_align as "left" | "center" | "right") ??
          ((f as any)?.text_align as "left" | "center" | "right") ??
          "left";

        // node bywa <text>, ale czasem trafisz w <g> – wtedy bierzemy najbliższy <text>
        const textEl =
          node.tagName.toLowerCase() === "text"
            ? (node as any as SVGTextElement)
            : (node.closest("text") as any as SVGTextElement | null);

        if (textEl) {
          if (align === "right") textEl.setAttribute("text-anchor", "end");
          else if (align === "center") textEl.setAttribute("text-anchor", "middle");
          else textEl.setAttribute("text-anchor", "start");
        }


        const tspan = node.querySelector("tspan");
        if (tspan) {
          tspan.textContent = text;
        } else {
          node.textContent = text;
        }
      }


      // 🔧 tutaj odpalamy wszystkie „reguły SVG” (banki, EV, itd.)
      applySvgDynamicLayers({
        rootSvg,
        fields,
        pdValues,
        computedValue,
      });

      // ===== VVV: ukrywanie/pokazywanie elementów SVG na podstawie kliknięć =====
      // 1) zbierz wszystkie cele VVV z pól (żeby domyślnie je ukryć)
      const vvvTargets = new Set<string>();
      for (const f of fields) {
        const t = getVvvTarget(f);
        if (t) vvvTargets.add(t);
      }

      const ownerMap: Record<number, string | null> = {};
      for (const f of fields) {
        const fid = Number((f as any).id);
        const svgId = getFieldSvgId(f as any);
        if (!svgId) { ownerMap[fid] = null; continue; }

        const el = doc.getElementById(svgId);
        ownerMap[fid] = findOwnerVvvId(el);
      }
      setFieldOwnerVvv(ownerMap);


      // ===== (1) w trybie treści/druk: chowamy WSZYSTKIE elementy VVV_ domyślnie,
      // a pokazujemy tylko ten, który jest w vvvVisible
      const vvvNodes = Array.from(rootSvg.querySelectorAll<SVGElement>("[id^='VVV_']"));

      for (const el of vvvNodes) {
        const id = el.getAttribute("id") || "";

        // layout: pokaż ukryte jeśli user kliknął przycisk
        if (mode === "layout") {
          el.setAttribute("visibility", showHiddenVvvInLayout ? "visible" : "hidden");
          continue;
        }

        // content/print: domyślnie wszystko VVV ukryte, pokazuj tylko aktywne
        const isOn = !!activeVvvId && id === activeVvvId;
        el.setAttribute("visibility", isOn ? "visible" : "hidden");
      }


      // ===== (2) ukrywanie pól overlay, jeśli ich element SVG (albo rodzic) jest niewidoczny
      const nextHidden = new Set<number>();
      if (mode === "content" || mode === "print") {
        for (const f of fields) {
          const fid = Number((f as any).id);
          const svgId = getFieldSvgId(f as any);
          if (!svgId) continue;

          const el = doc.getElementById(svgId);
          if (!el) continue; // bezpiecznie: literówka w svg_id nie chowa pola

          if (!isSvgNodeVisible(el)) nextHidden.add(fid);
        }
      }
      setHiddenOverlayFieldIds(nextHidden);


      // Nie chcemy zagnieżdżać <svg> w <svg>, więc bierzemy tylko wnętrze
      const inner = rootSvg.innerHTML;
      setSvgMarkup(inner);
    } catch (e) {
      console.error("[ReportSvgPage] Błąd wstrzykiwania do SVG:", e);
      // awaryjnie pokaż oryginał
      setSvgMarkup(svgTemplate);
    }
    // 🔴 ważne: dodajemy pdSelectOptions i pdSelectKinds, bo z nich liczymy zaznaczenia

  }, [svgTemplate, fields, pdValues, editing, pdSelectOptions, pdSelectKinds, activeVvvId, mode, showHiddenVvvInLayout]);


  // % -> ekr. px
  const toPx = (percent: number, axis: "x" | "y") =>
    (Number(percent) / 100) * (axis === "x" ? box.w : box.h);

  // ekr. px -> %
  const toPercent = (px: number, axis: "x" | "y") => {
    const full = axis === "x" ? box.w : box.h;
    return full ? (px / full) * 100 : 0;
  };

  // % -> jednostki viewBox (natural px)
  const toUnit = (percent: number, axis: "x" | "y") => {
    const full = axis === "x" ? page.natural_width : page.natural_height;
    return (Number(percent) / 100) * full;
  };

  // rozmiar fontu (jak w ReportResponsivePage): raw * (current / baseline)
  const fontSizePx = (f: ReportField) => {
    // @ts-ignore
    const raw = Number((f as any).font_size) || 14;
    // @ts-ignore
    const meta = getMeta(f);
    const baseline =
      Number(meta.font_baseline_w) ||
      Number((page as any).font_baseline_w) ||
      1000;
    const current = box.w > 0 ? box.w : baseline;
    return raw * (current / baseline);
  };

  // px ekranu -> px viewBox
  const fontSizeToSVG = (f: ReportField) => {
    const px = fontSizePx(f);
    return box.w > 0 ? px * (page.natural_width / box.w) : px;
  };

  const [, force] = useState(0);

useEffect(() => {
  const h = () => force((x) => x + 1);
  window.addEventListener("recalc-ui", h as any);
  return () => window.removeEventListener("recalc-ui", h as any);
}, [force]);


  useEffect(() => {
    // interesuje nas tylko tryb UKŁAD
    if (mode !== "layout") return;
    if (!box.w || !box.h) return;
    if (!svgBoxes || svgBoxes.length === 0) return;

    const alreadySynced = syncedSvgPositionsRef.current;

    fields.forEach((f) => {
      const id = (f as any).id as number;

      if (hiddenOverlayFieldIds.has(id)) return null;

      // jeśli już zapisaliśmy pozycję z SVG dla tego pola w tej sesji – pomijamy
      if (alreadySynced.has(id)) return;

      const meta = getMeta(f as any);
      const svgId = meta?.svg_id as string | undefined;
      if (!svgId) return;

      const boxSvg = svgBoxes.find((b) => b.id === svgId);
      if (!boxSvg) return;

      // liczymy docelowe px na ekranie na podstawie bbox z SVG
      const targetXpx = (boxSvg.x / page.natural_width) * box.w;
      const targetYpx = (boxSvg.y / page.natural_height) * box.h;

      // przeliczamy na %
      const targetXPercent = toPercent(targetXpx, "x");
      const targetYPercent = toPercent(targetYpx, "y");

      const oldXPercent = Number((f as any).x_percent) || 0;
      const oldYPercent = Number((f as any).y_percent) || 0;

      // jeśli różnica jest mała – nic nie robimy (już zapisane)
      const diffX = Math.abs(targetXPercent - oldXPercent);
      const diffY = Math.abs(targetYPercent - oldYPercent);
      if (diffX < 0.1 && diffY < 0.1) {
        alreadySynced.add(id);
        return;
      }

      // ZAPISUJEMY NOWĄ POZYCJĘ DO BAZY – jak przy drag&drop
      fetch(`/api/report-fields/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x_percent: targetXPercent,
          y_percent: targetYPercent,
        }),
      })
        .then(() => {
          // oznaczamy jako zsynchronizowane, odświeżamy dane pól
          alreadySynced.add(id);
          onRefresh();
        })
        .catch((e) => {
          console.error("[ReportSvgPage] PATCH x/y z SVG nie powiódł się", e);
        });
    });
  }, [mode, box.w, box.h, svgBoxes, fields, page.natural_width, page.natural_height, toPercent, onRefresh]);


  // ===== Warstwa SVG (druk + podgląd) =====
  const renderSVG = () => (
    <svg
      ref={svgRef}
      width="100%"
      height={box.h || 1}
      viewBox={`0 0 ${page.natural_width} ${page.natural_height}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      textRendering="geometricPrecision"
      style={{ display: "block", borderRadius: 50, background: "transparent" }}
    >
      {/* tło: jeśli mamy svgMarkup (czyli szablon SVG), użyj go; w przeciwnym razie bitmapa */}
      {svgMarkup ? (
        <g
          style={{ pointerEvents: "none" as React.CSSProperties["pointerEvents"] }}
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      ) : (
        <image
          href={page.image_url}
          x="0"
          y="0"
          width={page.natural_width}
          height={page.natural_height}
          preserveAspectRatio="none"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* pola (overlaya) */}
      {fields.map((f) => {
        const id = (f as any).id as number;

        const meta = getMeta(f);

        // 1) pola ukryte w trybie print – jak wcześniej
        if (mode === "print" && meta && meta.hide_in_print) {
          return null;
        }

        // 2) jeśli pole jest powiązane z elementem SVG (svg_id z prefiksem "XXX_")
        //    i mamy szablon SVG – NIE rysujemy overlaya, bo tekst jest już wstrzyknięty do SVG

        const uiType = meta?.ui_type ?? "text";
        const isCheckboxUI = uiType === "checkbox";
        const isStepperUI = uiType === "stepper";

        const svgBoundId = meta?.svg_id as string | undefined;
        if (svgMarkup && svgBoundId && svgBoundId.startsWith("XXX_") && !isCheckboxUI) {
          return null;
        }

        const sx = page.natural_width / (box.w || 1);
        const sy = page.natural_height / (box.h || 1);

        const t = temp[id];
        let x = t ? Math.round(t.x * sx) : toUnit((f as any).x_percent, "x");
        let y = t ? Math.round(t.y * sy) : toUnit((f as any).y_percent, "y");
        let w = t ? Math.round(t.w * sx) : toUnit((f as any).w_percent, "x");
        let h = t ? Math.round(t.h * sy) : toUnit((f as any).h_percent, "y");

        if (isCheckboxUI) {
            x=x-w/3;
            y=y-h/4;         
        }
        if (isStepperUI) {
          x=x-w/2;
          h=h*2;
          y=y-h/4;
        }


        const ov = liveStyle[id] ?? {};
        const rawFontSize =
          (ov as any).font_size != null
            ? Number((ov as any).font_size)
            : Number((f as any).font_size) || 14;

        const metaLive = (ov as any).meta_json || {};
        const metaOrig = getMeta(f);
        const baseline =
          Number(metaLive.font_baseline_w) ||
          Number(metaOrig.font_baseline_w) ||
          Number((page as any).font_baseline_w) ||
          1000;

        const current = box.w > 0 ? box.w : baseline;
        const fontSizePxLive = rawFontSize * (current / baseline);
        const fontSize = Math.max(
          1,
          Math.round(
            box.w > 0 ? fontSizePxLive * (page.natural_width / box.w) : fontSizePxLive
          )
        );

        const fontFamily =
          (ov as any).font_family ??
          (f as any).font_family ??
          "DM Sans, system-ui, sans-serif";

        const fontWeight =
          (ov as any).font_weight ??
          (f as any).font_weight ??
          "500";

        const fill =
          (ov as any).color ??
          (f as any).color ??
          "#2B3674";

        const align =
          ((ov as any).text_align as "left" | "center" | "right") ??
          ((f as any).text_align as "left" | "center" | "right") ??
          "left";

        // --- SPECJALNE POLE: ROSE ---
        const nameRaw = String((f as any).name || "");
        const isRose = nameRaw.trim().toLowerCase() === "rose";
        if (isRose) {
          const vals16 = buildRoseArray16(pdValues);
          return (
            <g key={id} style={{ pointerEvents: "none" }}>
              <RosePlotlySvg x={x} y={y} w={w} h={h} values16={vals16} strokewidth={1} />
            </g>
          );
        }// --- /ROSE ---

        // specjalne pole yelds
        const rawName = String((f as any).name || "").trim().toLowerCase();

        if (rawName === "yelds") {
          const { hist, histpv } = buildYeldsPair(pdValues);
          console.debug("yelds:", { hist, histpv });
          return (
            <g key={id} style={{ pointerEvents: "none" }}>
              <YeldsSvg x={x} y={y} w={w} h={h} hist={hist} histpv={histpv} />
            </g>
          );
        }

        // --- SPECJALNE POLE: MAP (druk w SVG)
        // MAPA w SVG (druk / print-scope)
        if (rawName === "map") {
          const idNum = Number((f as any).id);
          const fromCache = (typeof window !== "undefined" && window.__map_snapshots)
            ? window.__map_snapshots[idNum]
            : undefined;
          const mi: string | undefined = fromCache || (f as any)?.meta_json?.map_image;

          const clipId = `clip-map-${idNum}`;

          if (mi && /^data:image\//.test(mi)) {
            return (
              <g key={idNum} style={{ pointerEvents: "none" }}>
                <defs>
                  <clipPath id={clipId}>
                    <rect x={x} y={y} width={w} height={h} rx={48} ry={48} />
                  </clipPath>
                </defs>

                <image
                  href={mi}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${clipId})`}
                />
                {/* opcjonalnie delikatna ramka 
        <rect x={x} y={y} width={w} height={h} rx={48} ry={48}
              fill="none" stroke="#E2E8F0" strokeWidth={1} />*/}

                {/* znacznik miejsca (środek pola mapy) */}
                <PinMarker cx={x + w / 2} cy={y + h / 2} size={88} color="#F59E0B" />

              </g>
            );
          }

          // fallback placeholder
          return (
            <g key={idNum} style={{ pointerEvents: "none" }}>
              <rect x={x} y={y} width={w} height={h} rx={48} ry={48} fill="#F8FAFC" stroke="#E2E8F0" />
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle"
                fill="#94A3B8" fontSize={Math.max(12, h * 0.12)}>Mapa</text>
            </g>
          );
        }


        //const fontSize = Math.max(1, Math.round(fontSizeToSVG(f)));
        //const fontSize = Math.max(1, Math.round(fontSizeToSVG(f)));
        const text = computedValue(f);

        // meta + rodzaj UI (checkbox / stepper)
        const metaForSvg = getMeta(f);
        const uiTypeSvg = metaForSvg?.ui_type ?? "text";
        const isCheckboxSvg = uiTypeSvg === "checkbox";
        const isStepperSvg = uiTypeSvg === "stepper";

        // specjalne pole: CHECKBOX – rysujemy graficzny kwadrat z ptaszkiem
        if (isCheckboxSvg) {
          const raw = String(text ?? "").trim().toLowerCase();
          const checked =
            raw === "1" ||
            raw === "true" ||
            raw === "tak" ||
            raw === "yes";

          const size = Math.min(w, h) * 0.4;
          const cx = x + w / 2;
          const cy = y + h / 2;
          const rxBox = cx - size / 2;
          const ryBox = cy - size / 2;

          const fillBox = checked ? "#7C3AED" : "#E5E7EB";
          const strokeBox = checked ? "#7C3AED" : "#CBD5E1";

          return (
            <g key={id}>
              <rect
                x={rxBox}
                y={ryBox}
                width={size}
                height={size}
                rx={size * 0.25}
                ry={size * 0.25}
                fill={fillBox}
                stroke={strokeBox}
                strokeWidth={size * 0.08}
              />
              {checked && (
                <path
                  d={`
            M ${rxBox + size * 0.25} ${cy}
            L ${cx} ${cy + size * 0.2}
            L ${rxBox + size * 0.75} ${cy - size * 0.2}
          `}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={size * 0.14}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          );
        }

        // specjalne pole: STEPPER – sama liczba na środku pola (jak w wydruku)
        if (isStepperSvg) {
          const valStr = String(text ?? "");
          const cxCenter = x + w / 2 - 30;
          const cyCenter = y + h / 2 - 6;

          return (
            <g key={id}>
              <text
                x={cxCenter}
                y={cyCenter}
                fontFamily={fontFamily}
                fontWeight={fontWeight}
                fontSize={fontSize}
                fill={fill}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontKerning: "none",
                  fontVariantLigatures: "none",
                  letterSpacing: 0,
                }}
              >
                {valStr}
              </text>
            </g>
          );
        }

        // czy to pole multi-select z Pipedrive?
        const pdKeyForSvg =
          metaForSvg.pipedrive_key ||
          (f as any).pipedrive_key ||
          rawName;


        const selectKindForSvg = pdSelectKinds[pdKeyForSvg];
        const multiOptions =
          selectKindForSvg === "multi" && pdSelectOptions[pdKeyForSvg]
            ? pdSelectOptions[pdKeyForSvg]!
            : undefined;

        // padding + anchor
        const contentW = Math.max(0, w - 2 * PAD);
        let textAnchor: "start" | "middle" | "end" = "start";
        let x0 = x + PAD;
        if (align === "center") {
          textAnchor = "middle";
          x0 = x + PAD + contentW / 2;
        } else if (align === "right") {
          textAnchor = "end";
          x0 = x + w - PAD;
        }
        const y0 = y + PAD;
        const baseLineH = fontSize * LINE_H;
        const lineH = multiOptions ? baseLineH * 1.1 : baseLineH;

        // przygotuj linie + informację które są zaznaczone
        let lines: string[] = [];
        let selectedFlags: boolean[] = [];

        if (multiOptions && multiOptions.length) {
          const current = String(text ?? "");
          const selectedTokens = current
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean);

          lines = multiOptions;
          selectedFlags = multiOptions.map((opt) => selectedTokens.includes(opt));
        } else {
          lines = String(text).split(/\r?\n/);
          selectedFlags = lines.map(() => false);
        }

        const maxLines = Math.max(1, Math.floor((h - 2 * PAD) / lineH));

        // jeśli to pole jest przeciągane lub w temp → ukryj SVG (zostaje overlay)
        const isDragging = draggingId === id || !!temp[id];


        return (
          <g key={id} style={{ pointerEvents: "none" }}>
            <text
              x={x0}
              y={y0}
              fontFamily={fontFamily}
              fontWeight={fontWeight as any}
              fontSize={fontSize}
              fill={fill}
              textAnchor={textAnchor}
              dominantBaseline="text-before-edge"
              style={{ fontKerning: "none", fontVariantLigatures: "none", letterSpacing: 0 }}
            >
              {lines.slice(0, maxLines).map((ln, idx) => (
                <tspan
                  key={idx}
                  x={x0}
                  dy={idx === 0 ? 0 : lineH}
                  style={
                    multiOptions
                      ? {
                        fontWeight: selectedFlags[idx] ? 700 : 400,
                        fill: selectedFlags[idx] ? fill : "#94A3B8",
                      }
                      : undefined
                  }
                >
                  {ln}
                </tspan>
              ))}

            </text>
          </g>
        );
      })}
    </svg>
  );

  const findField = (id: number) => fields.find(f => (f as any).id === id);

  // Po wyrenderowaniu SVG policz bbox dla elementów z id zaczynającym się od "XXX_"
  useEffect(() => {
    if (!svgRef.current || !svgMarkup) {
      setSvgBoxes([]);
      return;
    }
    try {
      const svgEl = svgRef.current;
      const elements = svgEl.querySelectorAll<SVGGraphicsElement>("[id^='XXX_']");
      const boxes: { id: string; x: number; y: number; width: number; height: number }[] = [];

      elements.forEach((el) => {
        if (typeof el.getBBox === "function") {
          const bb = el.getBBox();
          if (bb.width > 0 && bb.height > 0) {
            boxes.push({
              id: el.id,
              x: bb.x,
              y: bb.y,
              width: bb.width,
              height: bb.height,
            });
          }
        }
      });

      setSvgBoxes(boxes);
    } catch (e) {
      console.error("[ReportSvgPage] Błąd getBBox dla SVG:", e);
    }
  }, [svgMarkup, page.natural_width, page.natural_height]);


  // ===== Overlay: LAYOUT (RND + label; treść pokazujemy tylko podczas drag/resize) =====
  const renderLayoutOverlay = () => (
    <div className="no-print" style={{ position: "absolute", inset: 0 }}>
      {/* licznik pól */}
      <div
        style={{
          position: "absolute",
          right: 8,
          top: 8,
          zIndex: 9999,
          fontSize: 12,
          background: "rgba(0,0,0,0.7)",
          color: "white",
          padding: "2px 8px",
          borderRadius: 6,
        }}
        title="Liczba pól na tej stronie"
      >
        {fields.length} pól
      </div>

      {fields.map((f) => {
        const id = (f as any).id as number;

        const meta = getMeta(f);
        const svgId = meta?.svg_id as string | undefined;

        let base: { x: number; y: number; w: number; h: number };

        // jeśli jest powiązanie z elementem SVG i mamy jego bbox -> użyj go
        if (svgId) {
          const boxSvg = svgBoxes.find((b) => b.id === svgId);
          if (boxSvg && box.w > 0 && box.h > 0) {
            base = {
              x: (boxSvg.x / page.natural_width) * box.w,
              y: (boxSvg.y / page.natural_height) * box.h,
              //w: (boxSvg.width / page.natural_width) * box.w,
              w: toPx(Number((f as any).w_percent), "x"),
              h: (boxSvg.height / page.natural_height) * box.h,
              //h: toPx(Number((f as any).h_percent), "y"),
            };
          }
        }

        // fallback: stare współrzędne z procentów
        if (!base) {
          base = {
            x: toPx(Number((f as any).x_percent), "x"),
            y: toPx(Number((f as any).y_percent), "y"),
            w: toPx(Number((f as any).w_percent), "x"),
            h: toPx(Number((f as any).h_percent), "y"),
          };
        }

        const cur = temp[id] ?? base;


        const isSelected = selectedFieldId === id;
        const isActive = draggingId === id || !!temp[id];

        // współrzędne dla podglądu
        const showCoords = draggingId === id;
        const xPx = Math.round(cur.x);
        const yPx = Math.round(cur.y);
        const wPx = Math.round(cur.w);
        const hPx = Math.round(cur.h);

        const xPct = Number(toPercent(cur.x, "x").toFixed(1));
        const yPct = Number(toPercent(cur.y, "y").toFixed(1));

        // style tekstu w overlayu (dla precyzyjnego dopasowania podczas drag)
        // @ts-ignore
        const fontFamily = (f as any).font_family || "DM Sans, system-ui, sans-serif";
        const fontSize = fontSizePx(f);
        // @ts-ignore
        const fontWeight = ((f as any).font_weight as any) || 500;
        // @ts-ignore
        const color = (f as any).color || "#2B3674";
        // @ts-ignore
        const align = ((f as any).text_align as any) || "left";
        const { displayName } = computeField(f, fields, pdValues);

        return (
          <Rnd
            key={id}
            bounds="parent"
            position={{ x: cur.x, y: cur.y }}
            size={{ width: cur.w, height: cur.h }}
            enableResizing
            disableDragging={false}
            style={{
              border: isSelected ? "1px solid rgba(56,189,248,0.9)" : "1px solid rgba(148,163,184,0.6)",
              background: "rgba(56,189,248,0.10)",
              borderRadius: 4,
            }}
            onMouseDown={() => onSelectField(id)}
            onDoubleClick={() => onOpenInspector(id)}
            onDragStart={() => { onSelectField(id); setDraggingId(id); }}
            onResizeStart={() => { onSelectField(id); setDraggingId(id); }}
            onDrag={(_e, d) => setTemp((prev) => ({ ...prev, [id]: { ...cur, x: d.x, y: d.y } }))}
            onResize={(_e, _dir, refEl, _delta, pos) =>
              setTemp((prev) => ({ ...prev, [id]: { x: pos.x, y: pos.y, w: refEl.offsetWidth, h: refEl.offsetHeight } }))
            }
            onDragStop={(_e, d) => {
              const nx = toPercent(d.x, "x");
              const ny = toPercent(d.y, "y");
              fetch(`/api/report-fields/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ x_percent: nx, y_percent: ny }),
              })
                .then(() => {
                  onRefresh();
                  setTimeout(() => {
                    setTemp((prev) => { const cp = { ...prev }; delete cp[id]; return cp; });
                    setDraggingId(null);
                  }, 200);
                })
                .catch((e) => { console.error(e); setDraggingId(null); });
            }}
            onResizeStop={(_e, _dir, refEl, _delta, pos) => {
              const nw = toPercent(refEl.offsetWidth, "x");
              const nh = toPercent(refEl.offsetHeight, "y");
              const nx = toPercent(pos.x, "x");
              const ny = toPercent(pos.y, "y");
              fetch(`/api/report-fields/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ w_percent: nw, h_percent: nh, x_percent: nx, y_percent: ny }),
              })
                .then(() => {
                  onRefresh();
                  setTimeout(() => {
                    setTemp((prev) => { const cp = { ...prev }; delete cp[id]; return cp; });
                    setDraggingId(null);
                  }, 200);
                })
                .catch((e) => { console.error(e); setDraggingId(null); });
            }}
          >
            {/* label nad polem */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: -18,
                display: "inline-flex",
                fontSize: 10,
                lineHeight: "12px",
                whiteSpace: "nowrap",
                width: "fit-content",
                color: "#334155",
                background: "rgba(255,255,255,0.85)",
                padding: "1px 4px",
                borderRadius: 4,
                border: "1px solid rgba(148,163,184,0.6)",
                pointerEvents: "none",
              }}
              title={displayName}
            >
              <div
                /* label */
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <div>{displayName}</div>

                {showCoords && (
                  <div style={{ fontSize: 9, color: "#0f172a", opacity: 0.8 }}>
                    x: {xPx}px • y: {yPx}px / w: {wPx}px • h: {hPx}px
                  </div>
                )}
              </div>

            </div>

            {/* podgląd treści w overlayu: widoczny tylko podczas drag/resize */}
            <div
              style={{
                width: "100%",
                height: "100%",
                fontFamily,
                fontSize,
                fontWeight,
                color,
                textAlign: align,
                lineHeight: LINE_H as any,
                overflow: "hidden",
                padding: PAD,
                borderRadius: 6,
                userSelect: "none",
                cursor: "move",
                visibility: "hidden",
              }}
            >
              {computedValue(f)}
            </div>
          </Rnd>
        );
      })}
    </div>
  );


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

    // ✅ poprawka literówki: było ...gaz_zmiemny
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

  // ✅ helper: czy pole podrzędne ma być aktywne (widoczne + wstrzykujące)
  const isActiveHeatDetailField = (logicalName: string, activeKey: string | null) => {
    if (!HEAT_DETAIL_KEYS.has(logicalName)) return true; // nie dotyczy
    if (!activeKey) return false;                        // nic nie wybrane -> chowamy wszystkie detale
    return logicalName === activeKey;
  };



  // ===== Overlay: CONTENT (niewidoczny tekst, widoczny caret; live update SVG) =====
  const renderContentOverlay = (onlyMap = false) => (
    (() => {

      const heatSourceField = fields.find(
        (ff) => getLogicalFieldName((ff as any).name || "") === HEAT_SOURCE_PDKEY
      );

      const heatSourceValue =
        heatSourceField != null
          ? computedValue(heatSourceField as any) // live w "treść"
          : (pdValues as any)?.[HEAT_SOURCE_PDKEY];

      const activeHeatDetailKey = pickActiveHeatPdKey_UI(heatSourceValue);

      return (
        <div className="no-print" style={{ position: "absolute", inset: 0 }}>
          {fields.map((f) => {
            const id = (f as any).id as number;

            if ((mode === "content" || mode === "print") && hiddenOverlayFieldIds.has(id)) {
              return null; // nie renderuj HTML overlay dla pól schowanych w SVG
            }

            const meta = getMeta(f);
            const svgId = meta?.svg_id as string | undefined;

            let x: number;
            let y: number;
            let w: number;
            let h: number;

            // jeśli pole jest powiązane z elementem w SVG – bierzemy jego bbox
            if (svgId) {
              const boxSvg = svgBoxes.find((b) => b.id === svgId);
              if (boxSvg && box.w > 0 && box.h > 0) {
                x = (boxSvg.x / page.natural_width) * box.w;
                y = (boxSvg.y / page.natural_height) * box.h;
                // szerokość zostawiasz z percentów, tak jak pisałeś
                w = toPx(Number((f as any).w_percent), "x");
                h = (boxSvg.height / page.natural_height) * box.h;
              }
            }

            // fallback: jeśli brak powiązania z SVG albo nie udało się policzyć bbox
            if (x === undefined) {
              x = toPx(Number((f as any).x_percent), "x");
              y = toPx(Number((f as any).y_percent), "y");
              w = toPx(Number((f as any).w_percent), "x");
              h = toPx(Number((f as any).h_percent), "y");
            }
            const options = getSelectOptionsForField(f);

            const uiType = meta?.ui_type ?? "text";
            const isCheckboxUI = uiType === "checkbox";
            const isStepperUI = uiType === "stepper";

            if (isCheckboxUI) {
              x=x-w/3;
              y=y-h/4;
            }
            if (isStepperUI) {
              x=x-w/2;
              h=h*2;
              y=y-h/4;              
            }


            const fieldName = (f as any).name || "";
            const name = getLogicalFieldName(fieldName);

            if (mode === "content" || mode === "print") {
              if (!isActiveHeatDetailField(name, activeHeatDetailKey)) {
                return null;
              }
            }

            const source: "pipedrive" | "manual" =
              (f as any).source === "pipedrive" ? "pipedrive" : "manual";


            const pdKey =
              (f as any).meta_json?.pipedrive_key ||
              (f as any).pipedrive_key ||
              String((f as any).name || "").trim().toLowerCase();

            const selectKind = pdSelectKinds[pdKey]; // "single" | "multi" | undefined

            const isSingleSelect = !!options && selectKind !== "multi";
            const isMultiSelect = !!options && selectKind === "multi";

            const fieldKind: "text" | "single" | "multi" = isMultiSelect ? "multi" : isSingleSelect ? "single" : "text";

            // @ts-ignore
            const fontFamily = (f as any).font_family || "DM Sans, system-ui, sans-serif";
            const fontSize = fontSizePx(f);
            // @ts-ignore
            const fontWeight = ((f as any).font_weight as any) || 500;
            // @ts-ignore
            const align = ((f as any).text_align as any) || "left";
            const isSelected = selectedFieldId === id;
            // @ts-ignore
            //const editable = true;//(f as any).source !== "pipedrive";
            // @ts-ignore

            // aktualna wartość (z DB lub live)
            const val = computedValue(f);
            const isComputed = isFormulaName(String((f as any).name || ""));
            const vvvTarget = getVvvTarget(f);

            const isTriggerOfActive = !!vvvTarget && !!activeVvvId && vvvTarget === activeVvvId;

            if ((mode === "content" || mode === "print") && isTriggerOfActive) {
              return null; // chowamy overlay wyzwalacza, gdy panel VVV jest widoczny
            }

            const bypassVvvHiding = (mode === "layout" && showHiddenVvvInLayout);

            if (!bypassVvvHiding) {
              if ((mode === "content" || mode === "print") && hiddenOverlayFieldIds.has(id)) return null;

              const ownerVvv = fieldOwnerVvv[id] ?? null;
              if ((mode === "content" || mode === "print") && ownerVvv) {
                if (!activeVvvId) return null;
                if (ownerVvv !== activeVvvId) return null;
              }
            }

            // ✅ 0) jeśli SVG mówi, że element niewidoczny (np. bo rodzic VVV_ jest hidden) → nie rysuj HTML overlay
            if ((mode === "content" || mode === "print") && hiddenOverlayFieldIds.has(id)) {
              return null;
            }

            // ✅ 1) pola będące "dziećmi" jakiegoś VVV_ mają zniknąć, gdy ich panel nie jest aktywny
            // (to jest dokładnie Twój przypadek: "dzieci niewidocznego elementu")
            const ownerVvv = fieldOwnerVvv[id] ?? null;

            // jeśli pole jest w panelu VVV_ i NIE jest to aktualnie aktywny panel → chowamy overlay
            if ((mode === "content" || mode === "print") && ownerVvv) {
              if (!activeVvvId) return null;              // gdy żaden panel nieaktywny → wszystkie dzieci VVV_ ukryte
              if (ownerVvv !== activeVvvId) return null;  // gdy inny panel aktywny → ukryte
            }



            const isRose = name === "rose";
            const isYelds = name === "yelds";
            // computed normalnie nieedytowalne, ALE jeśli ma VVV_target – traktujemy jako interaktywne (edytowalne)
            const isSpecial = (name === "prad_rok" || name === "ogrzewanie_rok")
            const editable = (!isComputed || !!vvvTarget || isSpecial) && !isRose && !isYelds;


            const isMap = name === "map";

            if (onlyMap && !isMap) {
              return null;
            }

            if (isMap) {
              const { lat, lon } = getLatLon(pdValues);
              const title = getMarkerTitle(pdValues);
              const id = (f as any).id as number;

              // jeśli mamy lokalne nadpisanie – użyj jego
              const override = localMapPos[id];
              const effLat = override?.lat ?? lat;
              const effLon = override?.lon ?? lon;
              const pdZoomRaw = Number((pdValues as any)?.raport_map_zoom);
              const effZoom = Number.isFinite(pdZoomRaw) ? pdZoomRaw : 19;

              const dealIdFromPd =
                (pdValues as any)?.deal_id ??
                (pdValues as any)?.id ??
                null;

              const canUpdateGeo = !!dealIdFromPd && mode === "content";

              const handlePolygonAreaChange = (payload: {
                areaM2: number | null;
                geojson: GeoJSON.FeatureCollection | null;
              }) => {
                if (!onFieldContentChange) return;

                const id = (f as any).id as number;
                const area = payload.areaM2;

                if (area == null) {
                  // np. wyczyszczenie pola
                  onFieldContentChange({
                    reportFieldId: id,
                    pdKey: "powierzchnia_dachu_m2",
                    kind: "text",
                    displayValue: "",
                    pdValue: "",
                    source: "pipedrive",
                    fieldName: "powierzchnia_dachu_m2",
                  });
                  return;
                }

                const rounded = Math.round(area); // albo: Math.round(area * 10) / 10

                onFieldContentChange({
                  reportFieldId: id,
                  pdKey: "powierzchnia_dachu_m2",
                  kind: "text",
                  displayValue: String(rounded),
                  pdValue: String(rounded),
                  source: "pipedrive",
                  fieldName: "powierzchnia_dachu_m2",
                });
              };

const handleZoomChange = (z: number) => {
  // zapisujemy z sensowną dokładnością (mapbox często daje float)
  const zz = Math.round(z * 100) / 100;
console.log("save zoom:", zz);
  const current = Number((pdValues as any)?.raport_map_zoom);
  if (Number.isFinite(current) && Math.abs(current - zz) < 0.01) return;

  onFieldContentChange?.({
    reportFieldId: id,
    pdKey: "raport_map_zoom",
    kind: "text",
    displayValue: String(zz),
    pdValue: String(zz),
    source: "pipedrive",
    fieldName: "raport_map_zoom",
  });
};


              const handleMarkerChange = (pos: { lat: number; lon: number }) => {
                const { lat: newLat, lon: newLon } = pos;

                // 1) lokalnie nadpisujemy, żeby marker NIE wracał po zapisie
                setLocalMapPos((prev) => ({
                  ...prev,
                  [id]: { lat: newLat, lon: newLon },
                }));

                // 2) normalnie zgłaszamy zmiany do Pipedrive (u Ciebie: lat/lon albo raport_lat/raport_lon)
                if (!onFieldContentChange) return;

                const latStr = String(newLat);
                const lonStr = String(newLon);

                onFieldContentChange({
                  reportFieldId: id,
                  pdKey: "raport_lat",   // albo "lat" – tak jak masz aktualnie
                  kind: "text",
                  displayValue: latStr,
                  pdValue: latStr,
                  source: "pipedrive",
                  fieldName: "raport_lat",
                });

                onFieldContentChange({
                  reportFieldId: id,
                  pdKey: "raport_lon",
                  kind: "text",
                  displayValue: lonStr,
                  pdValue: lonStr,
                  source: "pipedrive",
                  fieldName: "raport_lon",
                });
              };


              return (
                <div
                  data-field-overlay="1"
                  data-field-id={id}

                  key={`map-${id}`}
                  data-map-field-id={id}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    width: w,
                    height: h,
                    borderRadius: 14,
                    overflow: "hidden",
                    // WAŻNE: w trybie treści włączamy pointerEvents, żeby dało się kliknąć
                    pointerEvents: mode === "content" ? "auto" : "none",
                  }}
                  title={title}
                  className="no-print"
    onDoubleClick={() => {
    // pole otwierające panel z dużą mapą
    if (vvvTarget && mode === "content") {
      showVvv(vvvTarget);
      return;
    }
  }
                }

                >
                  {lat != null && lon != null ? (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        pointerEvents: "auto",
                      }}
                    >

                      <MapAny
                        lat={effLat}
                        lon={effLon}
                        zoom={effZoom}
                        markerTitle={title}
                        forPrint={true}
                        interactive={mode === "content"}
                        draggableMarker={mode === "content"}
                        onMarkerChange={handleMarkerChange}
                        onZoomChange={handleZoomChange}
                        enableDrawPolygon={mode === "content"}          // ⬅️ włączamy rysowanie w Treści
                        onPolygonAreaChange={handlePolygonAreaChange}   // ⬅️ zapisujemy powierzchnię
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        background: "#F8FAFC",
                        border: "1px solid #E2E8F0",
                      }}
                    >
                      <div
                        style={{
                          textAlign: "center",
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: "#64748B",
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ marginBottom: 6 }}>
                          <strong>Brak współrzędnych</strong>
                        </div>
                        <button
                          type="button"
                          disabled={!canUpdateGeo || geoUpdating}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canUpdateGeo) {
                              handleGeoUpdate(dealIdFromPd);
                            }
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: "none",
                            background:
                              "linear-gradient(135deg, #4F46E5, #6366F1)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#FFFFFF",
                            cursor: canUpdateGeo ? "pointer" : "default",
                            boxShadow: "0 6px 18px rgba(79,70,229,0.35)",
                            opacity: !canUpdateGeo || geoUpdating ? 0.7 : 1,
                          }}
                        >
                          {geoUpdating ? "Aktualizuję…" : "Aktualizuj dane"}
                        </button>
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            color: "#9CA3AF",
                          }}
                        >
                          System spróbuje wyznaczyć adres<br />
                          i współrzędne na podstawie deala.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={id}
                data-field-overlay="1"
                data-field-id={id}
                style={{ position: "absolute", left: x, top: y, width: w, height: h }}


                onMouseDownCapture={() => {
                  // pole otwierające panel
                  if (vvvTarget) {
                    showVvv(vvvTarget);
                    return;
                  }

                  console.log("[name]=", name);
                  if (name === "prad_rok") {
                    setBillsModal({ type: "electric", fieldId: id });
                  } else if (name === "ogrzewanie_rok") {
                    setBillsModal({ type: "heat", fieldId: id });
                  }


                  // klik w polu należącym do aktualnego panelu -> nie chowamy
                  if (ownerVvv && ownerVvv === activeVvvId) return;

                  // klik w inne pole -> chowamy
                  hideAllVvvSafely();
                }}



                onMouseDown={() => {
                  onSelectField(id);
                }}

                title={(f as any).name || ""}
              >
                {/* outline / highlight */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 4,
                    outline: isSelected && !isStepperUI ? "1px solid rgba(56,189,248,0.9)" : "1px solid rgba(0,0,0,0.08)",
                  }}
                />

                {isMultiSelect && editable ? (
                  // MULTI: lista checkboxów
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      padding: PAD,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-start",
                      alignItems: "flex-start",
                      gap: 4,
                      fontFamily,
                      fontSize,
                      fontWeight,
                      lineHeight: LINE_H as any,
                      background: "rgba(255,255,255,1.0)",
                      borderRadius: 6,
                      overflowY: "auto",
                    }}
                  >
                    {options!.map((opt) => {
                      const liveVal = editing[id] ?? val ?? "";
                      const current = String(liveVal);
                      const selectedTokens = current
                        .split(/[,;\n]/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const checked = selectedTokens.includes(opt);

                      return (
                        <label
                          key={opt}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                            opacity: checked ? 1 : 0.4,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}

                            onChange={(e) => {
                              const isNowChecked = e.currentTarget.checked;
                              const base = new Set(selectedTokens);
                              if (isNowChecked) base.add(opt);
                              else base.delete(opt);

                              const nextSelected = Array.from(base);
                              const nextText = nextSelected.join(", ");

                              // live preview na stronie
                              setEditing((prev) => ({ ...prev, [id]: nextText }));

                              // tylko bufor zmian dla danego deala
                              onFieldContentChange?.({
                                reportFieldId: id,
                                pdKey,
                                kind: "multi",
                                displayValue: nextText,
                                pdValue: nextSelected, // multi w Pipedrive = tablica stringów
                                source,
                                fieldName,
                              });
                            }}


                            style={{ transform: "scale(1.0)" }}
                          />
                          <span>{opt}</span>
                        </label>
                      );
                    })}

                  </div>
                ) : isSingleSelect && editable ? (
                  <select
                    value={String(val ?? "")}

                    onChange={(e) => {
                      const newVal = e.target.value;

                      // live preview w formularzu
                      setEditing((prev) => ({ ...prev, [id]: newVal }));

                      // tylko do bufora zmian
                      onFieldContentChange?.({
                        reportFieldId: id,
                        pdKey,
                        kind: "single",
                        displayValue: newVal,
                        pdValue: newVal, // single enum w Pipedrive – string
                        source,
                        fieldName,
                      });
                    }}


                    style={{
                      position: "absolute",
                      inset: 0,
                      padding: PAD,
                      fontFamily,
                      fontSize,
                      fontWeight,
                      lineHeight: LINE_H as any,
                      // border i tło możesz zostawić albo wyłączyć – SVG ma swój outline
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      outline: "none",

                      // trik: przesuwamy tekst daleko w bok, żeby go nie było widać,
                      // ale strzałka natywna zostaje
                      textIndent: "9999px",
                      overflow: "hidden",
                    }}
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : isCheckboxUI ? (
                  // NOWE: prosty checkbox 0/1 bez opisu
                  (() => {
                    const liveVal = editing[id] ?? val ?? "";
                    const raw = String(liveVal).trim().toLowerCase();
                    const checked =
                      raw === "1" ||
                      raw === "true" ||
                      raw === "tak" ||
                      raw === "yes";

                    const size = Math.min(w, h) * 0.4;

                    const toggle = () => {
                      if (!editable) return;
                      const nextChecked = !checked;
                      const nextVal = nextChecked ? "1" : "0";

                      // cache w UI
                      setEditing((prev) => ({ ...prev, [id]: nextVal }));

                      // bufor zmian do zapisu / Pipedrive
                      onFieldContentChange?.({
                        reportFieldId: id,
                        pdKey,
                        kind: "text",
                        displayValue: nextVal,
                        pdValue: nextVal,
                        source,
                        fieldName,
                      });
                    };

                    return (
                      <button
                        type="button"
                        onClick={toggle}
                        disabled={!editable}
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "none",
                          padding: 0,
                          margin: 0,
                          background: "transparent",
                          cursor: editable ? "pointer" : "default",
                        }}
                      >
                        <div
                          style={{
                            width: size,
                            height: size,
                            borderRadius: 1,
                            background: checked ? "#7C3AED" : "#E5E7EB",
                            boxShadow: checked
                              ? "0 6px 14px rgba(124,58,237,0.45)"
                              : "inset 0 0 0 1px #CBD5E1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "all 0.12s ease-out",
                          }}
                        >
                          {checked && (
                            <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 20 20">
                              <path
                                d="M4 10.5 8.2 15 16 5"
                                fill="none"
                                stroke="#FFFFFF"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })()
                ) : isStepperUI ? (
                  // Liczba z - i + przy krawędziach pola
                  (() => {
                    const liveVal = editing[id] ?? val ?? "";
                    const parsed = Number(
                      String(liveVal).replace(/\s/g, "").replace(",", ".")
                    );
                    const num = Number.isFinite(parsed) ? parsed : 0;
                    const step = 1; // na razie stały

                    const commit = (next: number) => {
                      if (!editable) return;
                      const nextStr = String(next);
                      setEditing((prev) => ({ ...prev, [id]: nextStr }));
                      onFieldContentChange?.({
                        reportFieldId: id,
                        pdKey,
                        kind: "text",
                        displayValue: nextStr,
                        pdValue: nextStr,
                        source,
                        fieldName,
                      });
                    };

                    return (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "grid",
                            gridTemplateColumns: "30% 40% 30%",
                            borderRadius: 3,
                            border: "1px solid #CBD5E1",
                            background: "rgba(255,255,255,0.92)",
                            boxShadow: "0 6px 18px rgba(15,23,42,0.08)",
                            fontFamily,
                            fontSize,
                            fontWeight,
                            lineHeight: LINE_H as any,
                            overflow: "hidden",
                          }}
                        >
                          {/* minus – przy lewej krawędzi */}
                          <button
                            type="button"
                            onClick={() => commit(num - step)}
                            disabled={!editable}
                            style={{
                              border: "none",
                              borderRight: "1px solid #CBD5E1",
                              background: "transparent",
                              cursor: editable ? "pointer" : "default",
                              fontSize,
                              lineHeight: 1,
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            –
                          </button>

                          {/* środkowa wartość */}
                          <input
                            value={Number.isFinite(num) ? String(num) : ""}
                            onChange={(e) => {
                              setEditing((prev) => ({
                                ...prev,
                                [id]: e.target.value,
                              }));
                            }}
                            onBlur={(e) => {
                              const t = e.target.value;
                              const p = Number(
                                t.replace(/\s/g, "").replace(",", ".")
                              );
                              const next = Number.isFinite(p) ? p : num;
                              commit(next);
                            }}
                            inputMode="decimal"
                            style={{
                              width: "100%",
                              border: "none",
                              outline: "none",
                              textAlign: "center",
                              background: "transparent",
                            }}
                          />

                          {/* plus – przy prawej krawędzi */}
                          <button
                            type="button"
                            onClick={() => commit(num + step)}
                            disabled={!editable}
                            style={{
                              border: "none",
                              borderLeft: "1px solid #CBD5E1",
                              background: "transparent",
                              cursor: editable ? "pointer" : "default",
                              fontSize,
                              lineHeight: 1,
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })()
                ) : (

                  // textarea do inputu — tekst niewidoczny, caret widoczny; SVG aktualizuje się live
                  <textarea
                    defaultValue={val}
                    onChange={(e) => {
                      if (!editable) return;          // NIE trzeba tu sprawdzać isSingleSelect
                      const t = e.currentTarget.value;
                      setEditing((prev) => ({ ...prev, [id]: t }));
                    }}
                    onFocus={(e) => {
                      const el = e.currentTarget;
                      const len = el.value.length;
                      el.setSelectionRange(len, len);
                    }}

                    onBlur={(e) => {
                      if (!editable) return;
                      const text = e.currentTarget.value;

                      // zostawiamy w editing, żeby po blur nadal było widać nową treść
                      setEditing((prev) => ({ ...prev, [id]: text }));

                      onFieldContentChange?.({
                        reportFieldId: id,
                        pdKey,
                        kind: "text",
                        displayValue: text,
                        pdValue: text,
                        source,
                        fieldName,
                      });
                    }}


                    spellCheck={false}
                    style={{
                      position: "absolute",
                      inset: 0,
                      padding: PAD,
                      fontFamily,
                      fontSize,
                      fontWeight,
                      lineHeight: LINE_H as any,
                      textAlign: align as any,
                      border: "none",
                      outline: "none",
                      resize: "none",
                      background: "transparent",
                      color: "transparent",
                      caretColor: "#1f2937",
                      whiteSpace: "pre-wrap",
                      overflow: "hidden",
                      cursor: "text",
                    }}
                    disabled={!editable}
                  />
                )}


              </div>
            );
          })}
        </div>
      );
    })()
  );


  const renderInspector = () => {
    if (!inspectorFieldId) return null;
    const f = findField(inspectorFieldId);
    if (!f) return null;

    // Pozycja kotwicy w PX (użyj temp gdy trwa drag/resize)
    const t = temp[inspectorFieldId];

    let x: number;
    let y: number;
    let w: number;
    let h: number;

    if (t) {
      // podczas drag/resize trzymamy się temp
      x = t.x; y = t.y; w = t.w; h = t.h;
    } else {
      const meta = getMeta(f);
      const svgId = meta?.svg_id as string | undefined;

      const vvvTarget = String(meta?.vvv_target ?? meta?.vvv_id ?? "").trim() || null; // jeśli używasz tego klucza
      const ownerVvv = getOwnerVvvForSvgId(svgId);

      // 1) jeśli pole jest wewnątrz jakiegoś VVV_, a ten panel NIE jest aktywny -> ukryj overlay (czyli zniknie ramka+caret)
      if ((mode === "content" || mode === "print") && ownerVvv && ownerVvv !== activeVvvId) {
        return null;
      }

      // 2) jeśli to pole jest "wyzwalaczem" (ma vvvTarget) i akurat ten panel jest aktywny -> też ukryj to pole (żeby nie było dublowania)
      if ((mode === "content" || mode === "print") && vvvTarget && vvvTarget === activeVvvId) {
        return null;
      }


      // jeśli jest powiązanie z SVG i bbox -> użyj go
      if (svgId) {
        const boxSvg = svgBoxes.find((b) => b.id === svgId);
        if (boxSvg && box.w > 0 && box.h > 0) {
          x = (boxSvg.x / page.natural_width) * box.w;
          y = (boxSvg.y / page.natural_height) * box.h;
          //w = (boxSvg.width / page.natural_width) * box.w;
          w = toPx(Number((f as any).w_percent), "x");
          h = (boxSvg.height / page.natural_height) * box.h;
        }
      }

      // fallback jeśli brak bbox lub svg_id
      if (x === undefined) {
        x = toPx(Number((f as any).x_percent), "x");
        y = toPx(Number((f as any).y_percent), "y");
        w = toPx(Number((f as any).w_percent), "x");
        h = toPx(Number((f as any).h_percent), "y");
      }
    }



    return (
      <div style={{ position: "absolute", left: x, top: y, zIndex: 100000 }}>
        <Inspector
          field={f}
          anchor={{ x, y, w, h }}
          baselineForFont={box.w || 1000}  // tak jak wcześniej – baseline = aktualna szerokość renderu
          onClose={() => onCloseInspector?.()}
          onLivePatch={(patch) => {
            setLiveStyle(prev => ({ ...prev, [inspectorFieldId]: { ...(prev[inspectorFieldId] || {}), ...patch } as any }));
          }}
          onPatch={async (id, patch) => {
            // preferuj callback z props jeśli podałeś go wyżej
            if (onPatchField) {
              await onPatchField(id, patch);
            } else {
              await fetch(`/api/report-fields/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
            }
            // po zapisie — odśwież i wyczyść lokalny override
            onRefresh();
            setLiveStyle(prev => {
              const cp = { ...prev };
              delete cp[id];
              return cp;
            });
          }}
          onDelete={async () => {
            if (onDeleteField) {
              await onDeleteField((f as any).id);
            } else {
              await fetch(`/api/report-fields/${(f as any).id}`, { method: "DELETE" });
            }
            onCloseInspector?.();
            onRefresh();
          }}
        />
      </div>
    );
  };


  return (
    <div
      ref={wrapRef}
      className="report-print-page"
      style={{ position: "relative", width: "100%", maxWidth: "100%" }}
      onMouseDownCapture={(e) => {
        if (!(mode === "content" || mode === "print")) return;

        const t = e.target as HTMLElement | null;

        // klik w overlay pola -> nie chowamy tutaj (pole ma własną logikę)
        if (t?.closest?.("[data-field-overlay='1']")) return;

        // klik w "tło" -> chowamy panel
        hideAllVvvSafely();
      }}
    >
      {renderSVG()}
      {mode === "layout" && renderLayoutOverlay()}
      {mode === "content" && renderContentOverlay(false)}
      {mode === "print" && renderContentOverlay(true)}
      {renderInspector()}

      {billsModal && (
        <BillsModal
          kind={billsModal.type}
          fieldId={billsModal.fieldId}
          pdValues={pdValues}
          pdSelectOptions={pdSelectOptions}
          onClose={() => setBillsModal(null)}
          onFieldContentChange={onFieldContentChange}
          onLocalAmountChange={(fieldId, amount) => {
            setEditing(prev => ({ ...prev, [fieldId]: amount }));
          }}
        />
      )}
    </div>
  );
}

function Inspector({
  field,
  anchor,
  baselineForFont,
  onClose,
  onPatch,
  onDelete,
  onLivePatch,
}: {
  field: ReportField;
  anchor: { x: number; y: number; w: number; h: number };
  baselineForFont: number; // szerokość overlaya; nadal zapisujemy ją do meta, jeśli chcesz
  onClose: () => void;
  onPatch: (id: number, patch: Partial<ReportField>) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onLivePatch: (patch: Partial<ReportField>) => void;
}) {
  const GAP = 8;
  const left = 0;
  const top = anchor.h + GAP;


  const rawMeta = (field as any).meta_json;
  let metaObj: any;
  if (typeof rawMeta === "string") {
    try {
      metaObj = JSON.parse(rawMeta);
    } catch {
      metaObj = {};
    }
  } else {
    metaObj = rawMeta || {};
  }
  const [form, setForm] = useState({
    name: (field as any).name || "",
    font_family: (field as any).font_family || "DM Sans, system-ui, sans-serif",
    font_size: String((field as any).font_size ?? 14),
    font_weight: String((field as any).font_weight ?? "500"),
    color: (field as any).color || "#2B3674",
    text_align: ((field as any).text_align as any) || "left",
  });

  // lokalny stan meta + flaga ukrywania w druku
  const [metaState, setMetaState] = useState<any>(metaObj || {});
  const [hideInPrint, setHideInPrint] = useState<boolean>(
    !!(metaObj && metaObj.hide_in_print)
  );
  const [numberFormat, setNumberFormat] = useState<string>(
    metaObj?.number_format ?? ""
  );
  const [uiType, setUiType] = useState<string>(
    metaObj?.ui_type ?? "text"
  );

  // Powiązanie z konkretnym elementem w SVG
  const [svgId, setSvgId] = useState<string>(
    metaObj?.svg_id ?? ""
  );


  const FONT_PRESETS: { label: string; value: string }[] = [
    { label: "DM Sans", value: '"DM Sans", system-ui, sans-serif' },
    { label: "Inter", value: 'Inter, system-ui, sans-serif' },
    { label: "Roboto", value: 'Roboto, system-ui, sans-serif' },
    { label: "Open Sans", value: '"Open Sans", system-ui, sans-serif' },
    { label: "Lato", value: 'Lato, system-ui, sans-serif' },
    { label: "Montserrat", value: 'Montserrat, system-ui, sans-serif' },
    { label: "Source Sans 3", value: '"Source Sans 3", system-ui, sans-serif' },
    { label: "Poppins", value: 'Poppins, system-ui, sans-serif' },
    { label: "System UI", value: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  ];
  const CUSTOM_FONT_VALUE = "__custom__";
  const isPreset = FONT_PRESETS.some(p => p.value === form.font_family);
  const [vvvTarget, setVvvTarget] = useState<string>(
    metaObj?.vvv_target ?? ""
  );


  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        zIndex: 99999,
        minWidth: 260,
        background: "#0F172A",
        color: "white",
        borderRadius: 10,
        boxShadow: "0 12px 24px rgba(0,0,0,0.35)",
        padding: 12,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Właściwości pola</div>

      {/* NAZWA */}
      <label style={{ display: "block", fontSize: 12, marginTop: 6, marginBottom: 4, color: "#CBD5E1" }}>Nazwa pola</label>
      <input
        value={form.name}
        onChange={(e) => {
          const v = e.target.value;
          setForm((s) => ({ ...s, name: v }));
          onLivePatch({ name: v });
        }}
        placeholder="Etykieta (np. Imię i nazwisko)"
        style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #334155", background: "white", color: "#0F172A" }}
      />

      {/* CZCIONKA / ROZMIAR / WAGA / KOLOR / WYRÓWNANIE */}
      <label style={{ display: "block", fontSize: 12, marginTop: 10, marginBottom: 4, color: "#CBD5E1" }}>
        Rodzina czcionki
      </label>

      <select
        value={isPreset ? form.font_family : CUSTOM_FONT_VALUE}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_FONT_VALUE) {
            // zostaw bieżącą wartość w form.font_family (custom)
            // nic nie zmieniamy – pokażemy pole niżej
            return;
          }
          setForm((s) => ({ ...s, font_family: v }));
          onLivePatch({ font_family: v });
        }}
        style={{
          width: "100%", padding: "6px 8px", borderRadius: 8,
          border: "1px solid #334155", background: "white", color: "#0F172A"
        }}
      >
        {FONT_PRESETS.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
        <option value={CUSTOM_FONT_VALUE}>
          Własna (poniżej)
        </option>
      </select>

      {!isPreset && (
        <input
          value={form.font_family}
          onChange={(e) => {
            const v = e.target.value;
            setForm((s) => ({ ...s, font_family: v }));
            onLivePatch({ font_family: v });
          }}
          placeholder='np. "DM Sans", system-ui, sans-serif'
          style={{
            width: "100%", marginTop: 6, padding: "6px 8px",
            borderRadius: 8, border: "1px solid #334155",
            background: "white", color: "#0F172A"
          }}
        />
      )}


      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#CBD5E1" }}>Rozmiar</label>
          <input
            type="number"
            value={form.font_size}
            onChange={(e) => {
              const v = e.target.value;
              setForm((s) => ({ ...s, font_size: v }));
              const num = Number(v) || 0;
              const metaToSend = {
                ...metaObj,
                font_baseline_w: baselineForFont,
              };
              onLivePatch({
                font_size: num,
                meta_json: metaToSend,
              });
            }}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #334155", background: "white", color: "#0F172A" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#CBD5E1" }}>Waga</label>
          <select
            value={form.font_weight}
            onChange={(e) => {
              const v = e.target.value;
              setForm((s) => ({ ...s, font_weight: v }));
              onLivePatch({ font_weight: v });
            }}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #334155", background: "white", color: "#0F172A" }}
          >
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="600">Semibold</option>
            <option value="700">Bold</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#CBD5E1" }}>Kolor</label>
          <input
            type="color"
            value={form.color}
            onChange={(e) => {
              const v = e.target.value;
              setForm((s) => ({ ...s, color: v }));
              onLivePatch({ color: v });
            }}
            style={{ width: "100%", height: 36, padding: 0, borderRadius: 8, border: "1px solid #334155", background: "white" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "#CBD5E1" }}>Wyrównanie</label>
          <select
            value={form.text_align}
            onChange={(e) => {
              const v = e.target.value as "left" | "center" | "right";
              setForm((s) => ({ ...s, text_align: v }));
              onLivePatch({ text_align: v });
            }}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #334155", background: "white", color: "#0F172A" }}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      {/* Widoczność w druku */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 8,
          borderTop: "1px solid #1E293B",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#CBD5E1",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={hideInPrint}
            onChange={(e) => {
              const v = e.target.checked;
              setHideInPrint(v);
              const nextMeta = {
                ...metaState,
                hide_in_print: v || undefined, // jak odznaczysz, wyrzucamy flagę
              };
              setMetaState(nextMeta);
              // live podgląd – np. do późniejszych użyć
              onLivePatch({ meta_json: nextMeta });
            }}
            style={{ width: 14, height: 14 }}
          />
          <span>Ukryj to pole w trybie druku / na wydruku</span>
        </label>
      </div>

      {/* Format liczb */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <label
          style={{
            fontSize: 12,
            color: "#CBD5E1",
          }}
        >
          Format liczb
        </label>
        <select
          value={numberFormat}
          onChange={(e) => {
            const v = e.target.value;
            setNumberFormat(v);
            const nextMeta = {
              ...metaState,
              number_format: v || undefined, // puste = brak formatu
            };
            setMetaState(nextMeta);
            onLivePatch({ meta_json: nextMeta });
          }}
          style={{
            borderRadius: 6,
            border: "1px solid #1E293B",
            color: "#0F172A",
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          <option value="">(domyślny – bez zmian)</option>
          <option value="int">Liczba całkowita</option>
          <option value="2dec">2 miejsca po przecinku</option>
        </select>
      </div>

      {/* Powiązanie z elementem SVG */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <label
          style={{
            fontSize: 12,
            color: "#CBD5E1",
          }}
        >
          Powiązane ID w SVG
        </label>
        <input
          value={svgId}
          onChange={(e) => {
            const v = e.target.value.trim();
            setSvgId(v);
            const nextMeta = {
              ...metaState,
              svg_id: v || undefined, // puste = kasuje powiązanie
            };
            setMetaState(nextMeta);
            onLivePatch({ meta_json: nextMeta });
          }}
          placeholder="np. customer_name"
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "white",
            color: "#0F172A",
            fontSize: 12,
          }}
        />
        <div style={{ fontSize: 10, color: "#64748B" }}>
          Wpisz wartość <code>id</code> z pliku SVG, z którym ma być wyrównane to pole.
        </div>
      </div>

      {/* Kliknięcie pola pokazuje element SVG (VVV_...) */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <label style={{ fontSize: 12, color: "#CBD5E1" }}>
          Kliknięcie pokazuje element SVG (VVV_...)
        </label>

        <input
          value={vvvTarget}
          onChange={(e) => {
            const v = e.target.value.trim();
            setVvvTarget(v);

            const nextMeta = {
              ...metaState,
              vvv_target: v || undefined,
            };
            setMetaState(nextMeta);
            onLivePatch({ meta_json: nextMeta });
          }}
          placeholder="np. VVV_pompa_ciepla albo dowolne id z SVG"
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "white",
            color: "#0F172A",
            fontSize: 12,
          }}
        />

        <div style={{ fontSize: 10, color: "#64748B" }}>
          Jeśli wpiszesz tu np. <code>VVV_cos</code>, to kliknięcie w pole w trybie Treści
          ustawi widoczność elementu SVG o <code>id="VVV_cos"</code>.
        </div>
      </div>


      {/* Rodzaj pola (UI) */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <label
          style={{
            fontSize: 12,
            color: "#CBD5E1",
          }}
        >
          Rodzaj pola (UI)
        </label>
        <select
          value={uiType}
          onChange={(e) => {
            const v = e.target.value as "text" | "checkbox" | "stepper";
            setUiType(v);
            const nextMeta = {
              ...metaState,
              ui_type: v === "text" ? undefined : v, // "text" = brak wpisu w meta
            };
            setMetaState(nextMeta);
            onLivePatch({ meta_json: nextMeta });
          }}
          style={{
            borderRadius: 6,
            border: "1px solid #1E293B",
            color: "#0F172A",
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          <option value="text">(domyślne pole tekstowe)</option>
          <option value="checkbox">Checkbox (0 / 1)</option>
          <option value="stepper">Liczba z przyciskami - / +</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button
          onClick={onClose}
          style={{ border: "1px solid #334155", padding: "6px 10px", borderRadius: 8, background: "transparent", color: "white" }}
        >
          Zamknij
        </button>
        <button
          onClick={() => {
            const metaToSend = {
              ...metaState,
              hide_in_print: hideInPrint || undefined,
              number_format: numberFormat || undefined,
              font_baseline_w: baselineForFont,
              ui_type: uiType === "text" ? undefined : uiType,
            };

            // puść zapis w tle
            onPatch((field as any).id, {
              name: form.name,
              font_family: form.font_family,
              font_size: Number(form.font_size),
              font_weight: form.font_weight,
              color: form.color,
              text_align: form.text_align as any,
              meta_json: metaToSend,      // <=== już CZYSTY obiekt, nie string
            });
            // zamknij od razu
            onClose();
          }}
          style={{ border: "1px solid transparent", padding: "6px 10px", borderRadius: 8, background: "#22c55e", color: "white" }}
        >
          Zapisz
        </button>
        <button
          onClick={onDelete}
          style={{ border: "1px solid transparent", padding: "6px 10px", borderRadius: 8, background: "#dc2626", color: "white" }}
        >
          Usuń
        </button>
      </div>
    </div>
  );
}


type BillsModalProps = {
  kind: "electric" | "heat";
  fieldId: number;
  pdValues: Record<string, any>;
  pdSelectOptions: Record<string, string[]>;
  onClose: () => void;
  onFieldContentChange?: (info: {
    reportFieldId: number;
    pdKey: string;
    kind: "text" | "single" | "multi";
    displayValue: string;
    pdValue: string | string[];
    source: "pipedrive" | "manual";
    fieldName: string;
  }) => void;
  onLocalAmountChange?: (fieldId: number, amount: string) => void;
};

function BillsModal({
  kind,
  fieldId,
  pdValues,
  pdSelectOptions,
  onClose,
  onFieldContentChange,
  onLocalAmountChange,
}: BillsModalProps) {

  const dealId = String(
    (pdValues && (pdValues.id ?? pdValues.deal_id)) || ""
  );

  // konfiguracja pod Pipedrive (prąd)
  const cfg =
    kind === "electric"
      ? {
        title: "Rachunki za prąd",
        periodLabel: "Okres rozliczeniowy za prąd",
        periodKey: "raport_jaki_okres_obejmuje_twoj_rachunek_za_prad",
        pdfLabel: "Rachunek za prąd (PDF)",
        pdfKey: "raport_za_acz_fakture_za_prad",
        amountLabel: "Rachunek za prąd [PLN]",
        // główne pole z okienka
        amountKey: "raport_ostatni_rachunek_za_prad_pln",
        // mirror – wiemy z debug, że pole na planszy używa tego samego pdKey
        amountMirrorKey: "raport_ostatni_rachunek_za_prad_pln",
        OSDLabel: "Operatro OSD",
        OSDKey: "dystrybutor_osd",
      }
      : kind === "heat"
        ? {
          title: "Rachunki za ogrzewanie",
          periodLabel: "Okres rozliczeniowy za ogrzewanie",
          periodKey: "raport_jaki_okres_obejmuje_twoj_rachunek_za_ogrzewanie",
          pdfLabel: "Rachunek za ogrzewanie (PDF)",
          pdfKey: "raport_ostatni_rachunek_za_ogrzewanie",
          amountLabel: "Rachunek za ogrzewanie [PLN]",
          // główne pole z okienka
          amountKey: "raport_ostatni_rachunek_za_ogrzewanie_pln",
          // mirror – zakładamy, że pole na planszy używa tego samego klucza
          // (analogicznie jak przy prądzie; jakby się różniło, podmienimy tu)
          amountMirrorKey: "raport_ostatni_rachunek_za_ogrzewanie_pln",
        }
        : (() => {
          throw new Error("Unsupported bills kind");
        })();


  const osdKey = (cfg as any).OSDKey as string | undefined;
  const osdLabel = (cfg as any).OSDLabel as string | undefined;

  const osdOptions = osdKey ? (pdSelectOptions[osdKey] || []) : [];

  const [osd, setOsd] = React.useState<string>(
    osdKey && pdValues[osdKey] != null ? String(pdValues[osdKey]) : ""
  );

  const periodOptions = pdSelectOptions[cfg.periodKey] || [];

  const [period, setPeriod] = React.useState<string>(
    pdValues[cfg.periodKey] != null ? String(pdValues[cfg.periodKey]) : ""
  );

  const initialAmount =
    (cfg as any).amountMirrorKey &&
      pdValues[(cfg as any).amountMirrorKey] != null
      ? String(pdValues[(cfg as any).amountMirrorKey])
      : pdValues[cfg.amountKey] != null
        ? String(pdValues[cfg.amountKey])
        : "";

  const [amount, setAmount] = React.useState<string>(initialAmount);


  const [pdfValue, setPdfValue] = React.useState<string>(
    pdValues[cfg.pdfKey] != null ? String(pdValues[cfg.pdfKey]) : ""
  );
  const [uploadName, setUploadName] = React.useState<string>("");


  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadName(file.name);

    if (!dealId) {
      console.warn("[BillsModal] Brak dealId – nie mogę wrzucić pliku.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("dealId", dealId);
    formData.append("kind", kind); // "electric" / inny typ

    try {
      const res = await fetch("/api/report-upload-bill", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        console.error("Upload error", res.status);
        return;
      }

      const data = await res.json();
      if (data?.url) {
        // tu trafia prawdziwy URL do PDFa
        setPdfValue(data.url);
      }
    } catch (err) {
      console.error("Upload failed", err);
    }
  };

  const handleSave = () => {
    if (!onFieldContentChange) {
      onClose();
      return;
    }

    // 1) okres rozliczeniowy – enum / single select
    if (period) {
      onFieldContentChange({
        reportFieldId: fieldId,
        pdKey: cfg.periodKey,
        kind: "single",
        displayValue: period,
        pdValue: period,
        source: "pipedrive",
        fieldName: cfg.periodLabel,
      });
    }

    // 2) PDF – zapisujemy string (np. nazwa pliku albo URL)
    if (pdfValue) {
      onFieldContentChange({
        reportFieldId: fieldId,
        pdKey: cfg.pdfKey,
        kind: "text",
        displayValue: pdfValue,
        pdValue: pdfValue,
        source: "pipedrive",
        fieldName: cfg.pdfLabel,
      });
    }


    // 3) kwota rachunku [PLN]
    if (amount) {
      // główne pole Pipedrive
      onFieldContentChange({
        reportFieldId: fieldId,
        pdKey: cfg.amountKey,
        kind: "text",
        displayValue: amount,
        pdValue: amount,
        source: "pipedrive",
        fieldName: cfg.amountLabel,
      });

      // lustrzane pole – to, które jest na planszy
      // if ((cfg as any).amountMirrorKey) {
      //   onFieldContentChange({
      //     reportFieldId: fieldId,
      //     pdKey: (cfg as any).amountMirrorKey,
      //     kind: "text",
      //     displayValue: amount,
      //     pdValue: amount,
      //     source: "pipedrive",
      //     fieldName: cfg.amountLabel,
      //   });
      // }
      if (onLocalAmountChange) {
        onLocalAmountChange(fieldId, amount);
      }
    }

    // 4) Operator OSD – single select (enum)
    if (osdKey && osd) {
      onFieldContentChange({
        reportFieldId: fieldId,
        pdKey: osdKey,
        kind: "single",
        displayValue: osd,
        pdValue: osd,
        source: "pipedrive",
        fieldName: osdLabel || "Operator OSD",
      });
    }


    // UWAGA:
    // To tylko wrzuca zmiany do bufora `dealChanges` w CreateForm.
    // Żeby faktycznie zapisać w Pipedrive, użytkownik nadal musi kliknąć
    // globalny przycisk "Zapisz" w prawym górnym rogu (ten od Treści).

    onClose();
  };

  const hasPdf = !!pdfValue;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          background: "white",
          borderRadius: 20,
          boxShadow: "0 18px 45px rgba(15,23,42,0.35)",
          padding: 20,
          color: "#0F172A",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            {cfg.title}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#6B7280",
            }}
          >
            Uzupełnij dane z rachunku.
            Zapis nastąpi po kliknięciu globalnego przycisku „Zapisz” w trybie Treści.
          </div>
        </div>

        {/* Okres rozliczeniowy */}
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 6,
              color: "#4B5563",
            }}
          >
            {cfg.periodLabel}
          </label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #E5E7EB",
              background: "#F9FAFB",
              fontSize: 14,
              outline: "none",
            }}
          >
            <option value="">— wybierz —</option>
            {periodOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Upload PDF */}
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 6,
              color: "#4B5563",
            }}
          >
            {cfg.pdfLabel}
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: 14,
              border: "1px dashed #C4B5FD",
              background: "#F5F3FF",
              padding: "14px 10px",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "999px",
                background:
                  "linear-gradient(135deg, rgba(129,140,248,0.12), rgba(192,132,252,0.2))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* chmurka upload */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M7 18h10a4 4 0 0 0 .2-7.998A5 5 0 0 0 7.3 6.1 4.5 4.5 0 0 0 7 15.5"
                  fill="none"
                  stroke="#7C3AED"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 11v7m0 0-3-3m3 3 3-3"
                  fill="none"
                  stroke="#7C3AED"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div style={{ fontSize: 13, color: "#4B5563", fontWeight: 500 }}>
              Upuść lub wybierz plik PDF
            </div>
            <input
              type="file"
              accept="application/pdf"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
              Maks. kilka MB, format PDF
            </div>
          </label>
        </div>

        {/* Podgląd/link PDF */}
        {hasPdf && (
          <div
            style={{
              marginBottom: 16,
              padding: "8px 10px",
              borderRadius: 10,
              background: "#F9FAFB",
              border: "1px dashed #E5E7EB",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "#E5E7EB",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
              }}
            >
              📎
            </span>

            {(() => {
              const isLink =
                pdfValue.startsWith("http://") ||
                pdfValue.startsWith("https://") ||
                pdfValue.startsWith("/");

              if (isLink) {
                return (
                  <a
                    href={pdfValue}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      textDecoration: "underline",
                      color: "#4F46E5",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      overflow: "hidden",
                    }}
                  >
                    Zobacz rachunek w PDF
                  </a>
                );
              }

              return (
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={pdfValue}
                >
                  Zobacz rachunek: {uploadName || pdfValue}
                </span>
              );
            })()}
          </div>
        )}

        {/* Kwota rachunku */}
        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 6,
              color: "#4B5563",
            }}
          >
            {cfg.amountLabel}
          </label>
          <input
            type="number"
            step="0.01"
            placeholder="np. 2000,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #E5E7EB",
              background: "#F9FAFB",
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>

        {/* Operator OSD */}
        {osdKey && (
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: "#4B5563",
              }}
            >
              {osdLabel || "Operator OSD"}
            </label>

            <select
              value={osd}
              onChange={(e) => setOsd(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #E5E7EB",
                background: "#F9FAFB",
                fontSize: 14,
                outline: "none",
              }}
            >
              <option value="">— wybierz —</option>
              {osdOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}


        {/* Przyciski */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid #E5E7EB",
              background: "white",
              fontSize: 13,
              color: "#4B5563",
              cursor: "pointer",
            }}
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "none",
              background:
                "linear-gradient(135deg, #7C3AED, #6366F1)",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(79,70,229,0.45)",
            }}
          >
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
