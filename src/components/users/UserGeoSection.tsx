'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Box,
  Button,
  Code,
  HStack,
  Text,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  useToast,
  Spinner,
} from "@chakra-ui/react";
import { apiPath } from "../../lib/basePath";

const MapAny: any = dynamic(() => import("../../components/map/MapComponent"), { ssr: false });

type PersonGeo = {
  id: number;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  lat?: number | null;
  lon?: number | null;
};

type WindrosePointV1 = { sector: number; cnt?: number; sum_speed?: number; avg_speed?: number };
type WindrosePointV2 = { dir: string; count?: number; percent?: number };
type WindrosePoint = WindrosePointV1 | WindrosePointV2;

type HistPoint = { month: number; label?: string; avg_kWh: number };

function norm(x: any): string {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (Array.isArray(x)) return x.filter(Boolean).join(", ").trim();
  return String(x ?? "").trim();
}
function firstNonEmpty(...vals: any[]) {
  for (const v of vals) {
    const s = norm(v);
    if (s) return s;
  }
  return "";
}
function getByFuzzy(cbn: Record<string, any>, patterns: string[]): { key?: string; value?: any } {
  if (!cbn) return {};
  for (const [k, v] of Object.entries(cbn)) {
    const lk = k.toLowerCase();
    if (patterns.some((p) => lk.includes(p))) {
      const val = v;
      if (val != null && String(val).toString().trim() !== "") return { key: k, value: val };
    }
  }
  return {};
}
function parseMaybeJSON<T>(val: any): T | null {
  if (val == null) return null;
  if (typeof val === "object") return val as T;
  if (typeof val !== "string") return null;
  try { return JSON.parse(val) as T; } catch { return null; }
}

const ROSE_LABELS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const monthLabel = (m: number) => ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][m - 1] ?? String(m);

export default function UserGeoSection() {
  const sp = useSearchParams();
  const dealId = useMemo(() => sp.get("deal_id") ?? undefined, [sp]);
  const toast = useToast();

  const [data, setData] = useState<PersonGeo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // zapisane w Pipedrive
  const [yieldWind, setYieldWind] = useState<number | null>(null);
  const [yieldPV, setYieldPV] = useState<number | null>(null);
  const [windrose, setWindrose] = useState<WindrosePoint[] | null>(null);
  const [hist, setHist] = useState<HistPoint[] | null>(null);
  const [histPV, setHistPV] = useState<HistPoint[] | null>(null);

  // Plotly lazy-load
  const plotlyRef = useRef<any>(null);
  async function ensurePlotly() {
    if (!plotlyRef.current) {
      const mod = await import('plotly.js-dist-min');
      plotlyRef.current = mod;
    }
    return plotlyRef.current;
  }

  const hasCoords = !!(data?.lat != null && data?.lon != null);

  async function loadFromDeal(did: string) {
    setLoading(true);
    try {
      const r = await fetch(apiPath(`/api/pipedrive/deals/${did}`), { cache: "no-store" });
      const j = await r.json();

      const p = j?.person || {};
      const cbn: Record<string, any> = j?.custom_by_name || {};

      const addr = getByFuzzy(cbn, ["lokalizacja_instalacji", "adres_instalacji", "adres", "address", "ulica"]);
      const city = getByFuzzy(cbn, ["miasto_miejscow", "miejscow", "miasto", "city"]);
      const post = getByFuzzy(cbn, ["kod_poczt", "kod", "postal"]);

      const address = firstNonEmpty(addr.value, p.address);
      const cityVal = firstNonEmpty(city.value, p.city);
      const postal  = firstNonEmpty(post.value,  p.postal_code);

      // współrzędne
      const latF = getByFuzzy(cbn, ["lat", "latitude"]);
      const lonF = getByFuzzy(cbn, ["lon", "lng", "long", "longitude"]);
      const lat = latF.value ? Number(latF.value) : (p?.lat != null ? Number(p.lat) : null);
      const lon = lonF.value ? Number(lonF.value) : (p?.lon != null ? Number(p.lon) : null);

      setData({
        id: Number(p?.id ?? 0),
        name: p?.name ?? j?.title ?? null,
        address: address || null,
        city: cityVal || null,
        postal_code: postal || null,
        lat, lon,
      });

      // zapisane statystyki
      const yW = getByFuzzy(cbn, ["yield"]).value;
      const yPV = getByFuzzy(cbn, ["yieldpv"]).value;
      setYieldWind(Number.isFinite(Number(yW)) ? Number(yW) : null);
      setYieldPV(Number.isFinite(Number(yPV)) ? Number(yPV) : null);

      const roseRaw = getByFuzzy(cbn, ["windrose"]).value;
      const rose = parseMaybeJSON<WindrosePoint[]>(roseRaw) ?? (Array.isArray(roseRaw) ? (roseRaw as any) : null);
      setWindrose(rose);

      const histRaw = getByFuzzy(cbn, ["hist"]).value;
      const histParsed = parseMaybeJSON<HistPoint[]>(histRaw) ?? (Array.isArray(histRaw) ? (histRaw as any) : null);
      setHist(histParsed);

      const histPVRaw = getByFuzzy(cbn, ["histpv"]).value;
      const histPVParsed = parseMaybeJSON<HistPoint[]>(histPVRaw) ?? (Array.isArray(histPVRaw) ? (histPVRaw as any) : null);
      setHistPV(histPVParsed);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (dealId) void loadFromDeal(dealId); }, [dealId]);

  // ——— RENDERING: róża + histogramy ———

  // Róża (wycentrowana), wspiera sector° i/ lub dir
  useEffect(() => {
    (async () => {
      if (!windrose || windrose.length === 0) return;
      const Plotly = await ensurePlotly();

      const theta: string[] = [];
      const rVals: number[] = [];
      for (let i = 0; i < 16; i++) {
        const deg = i * 22.5;
        const label = ROSE_LABELS[i];
        theta.push(label);

        let item: any = windrose.find((x: any) => typeof x.sector === "number" && Math.round(x.sector) === Math.round(deg));
        if (!item) item = windrose.find((x: any) => x.dir && String(x.dir).toUpperCase() === label);

        let val = 0;
        if (item) {
          if (Number.isFinite(Number(item.sum_speed))) val = Number(item.sum_speed);
          else if (Number.isFinite(Number(item.cnt))) val = Number(item.cnt);
          else if (Number.isFinite(Number(item.percent))) val = Number(item.percent);
        }
        rVals.push(val);
      }

      const data = [{
        type: 'barpolar',
        r: rVals,
        theta,
        marker: { color: 'rgba(33,120,255,0.7)', line: { color: 'rgba(33,120,255,1)', width: 2 } }
      }];
      const layout: any = {
        polar: {
          angularaxis: { direction: "clockwise", period: 16, tickmode: 'array', tickvals: theta, ticktext: theta },
          radialaxis: { visible: false, showticklabels: false }
        },
        showlegend: false,
        margin: { t: 20, b: 20, l: 20, r: 20 },
        paper_bgcolor: 'rgba(255,255,255,0.0)',
        plot_bgcolor: 'rgba(255,255,255,0.0)',
      };
      (Plotly as any).newPlot('windrosePlotly', data, layout, { displayModeBar: false, staticPlot: true });
    })();
  }, [windrose]);

  // Histogram wiatru
  useEffect(() => {
    (async () => {
      if (!hist || hist.length === 0) return;
      const Plotly = await ensurePlotly();
      const sorted = [...hist].sort((a, b) => a.month - b.month);
      const x = sorted.map((p) => p.label ?? monthLabel(p.month));
      const y = sorted.map((p) => Number(p.avg_kWh) || 0);
      const data = [{ type: 'bar', x, y }];
      const layout: any = {
        margin: { t: 10, b: 40, l: 40, r: 10 },
        xaxis: { fixedrange: true },
        yaxis: { title: 'kWh', fixedrange: true },
        showlegend: false,
        height: 280,
        paper_bgcolor: 'rgba(255,255,255,0.0)',
        plot_bgcolor: 'rgba(255,255,255,0.0)',
      };
      (Plotly as any).newPlot('histWindPlotly', data, layout, { displayModeBar: false, staticPlot: true });
    })();
  }, [hist]);

  // Histogram PV
  useEffect(() => {
    (async () => {
      if (!histPV || histPV.length === 0) return;
      const Plotly = await ensurePlotly();
      const sorted = [...histPV].sort((a, b) => a.month - b.month);
      const x = sorted.map((p) => p.label ?? monthLabel(p.month));
      const y = sorted.map((p) => Number(p.avg_kWh) || 0);
      const data = [{ type: 'bar', x, y }];
      const layout: any = {
        margin: { t: 10, b: 40, l: 40, r: 10 },
        xaxis: { fixedrange: true },
        yaxis: { title: 'kWh', fixedrange: true },
        showlegend: false,
        height: 280,
        paper_bgcolor: 'rgba(255,255,255,0.0)',
        plot_bgcolor: 'rgba(255,255,255,0.0)',
      };
      (Plotly as any).newPlot('histPvPlotly', data, layout, { displayModeBar: false, staticPlot: true });
    })();
  }, [histPV]);

  // ——— AKTUALIZUJ DANE (przycisk) ———
  async function runUpdate() {
    if (!dealId) {
      toast({ status: 'error', title: 'Brak deal_id', description: 'Dodaj ?deal_id=... do adresu.' });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(apiPath(`/api/pipedrive/deals/${dealId}/geocode?save=1`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const j = await r.json();
      if (!r.ok || j?.error) {
        throw new Error(j?.error || `${r.status} ${r.statusText}`);
      }

      // współrzędne
      const lat = Number(j?.lat);
      const lon = Number(j?.lon);
      setData((prev) => ({
        ...(prev || { id: 0 }),
        lat: Number.isFinite(lat) ? lat : prev?.lat ?? null,
        lon: Number.isFinite(lon) ? lon : prev?.lon ?? null,
      }));

      // zapisane staty
      const saved = j?.saved ?? {};
      setYieldWind(Number.isFinite(Number(saved?.yield)) ? Number(saved.yield) : yieldWind);
      setYieldPV(Number.isFinite(Number(saved?.yieldPV)) ? Number(saved.yieldPV) : yieldPV);

      const rose = parseMaybeJSON<WindrosePoint[]>(saved?.windrose) ?? (Array.isArray(saved?.windrose) ? saved.windrose : null);
      const h = parseMaybeJSON<HistPoint[]>(saved?.hist) ?? (Array.isArray(saved?.hist) ? saved.hist : null);
      const hpv = parseMaybeJSON<HistPoint[]>(saved?.histPV) ?? (Array.isArray(saved?.histPV) ? saved.histPV : null);
      if (rose) setWindrose(rose);
      if (h) setHist(h);
      if (hpv) setHistPV(hpv);

      toast({
        status: 'success',
        title: 'Dane zaktualizowane',
        description: 'Zapisano współrzędne i statystyki (yield, yieldPV, windrose, hist, histPV).',
        duration: 2500,
        isClosable: true,
      });
    } catch (e: any) {
      toast({ status: 'error', title: 'Aktualizacja nie powiodła się', description: String(e?.message || e) });
    } finally {
      setSaving(false);
    }
  }

  if (!dealId) return null;

  return (
    <Box mt={6}>
      {/* GÓRNY RZĄD: lewa (dane + róża), prawa (mapa) */}
      <Box display="grid" gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={6}>
        {/* LEWA */}
        <Box borderWidth="1px" borderRadius="2xl" p={4}>
          <HStack justify="space-between" align="center">
            <Text fontSize="lg" fontWeight="semibold">Lokalizacja (Deal)</Text>
            <Button onClick={runUpdate} isLoading={saving} loadingText="Aktualizuję…">
              Aktualizuj dane
            </Button>
          </HStack>

          {loading ? (
            <HStack mt={3}><Spinner /><Text>Ładowanie…</Text></HStack>
          ) : data ? (
            <>
              <Box mt={3} fontSize="sm">
                <div><b>Osoba/Deal:</b> {data.name || "—"}</div>
                <div><b>Adres:</b> {data.address || "—"}</div>
                <div><b>Miasto:</b> {data.city || "—"}</div>
                <div><b>Kod:</b> {data.postal_code || "—"}</div>
                <div style={{ marginTop: 8 }}>
                  <b>Współrzędne (deal):</b> {hasCoords ? `${data.lat}, ${data.lon}` : "brak"}
                </div>
              </Box>

              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mt={5}>
                <Stat>
                  <StatLabel>Średni uzysk wiatru (2015–2024)</StatLabel>
                  <StatNumber>{yieldWind ?? '—'} kWh/rok</StatNumber>
                </Stat>
                <Stat>
                  <StatLabel>Średni uzysk PV (2015–2024)</StatLabel>
                  <StatNumber>{yieldPV ?? '—'} kWh/rok</StatNumber>
                </Stat>
              </SimpleGrid>

              <Box mt={5}>
                <Text fontWeight="semibold" mb={2}>Róża wiatrów</Text>
                <Box display="flex" justifyContent="center">
                  <Box id="windrosePlotly" w="360px" h="360px" />
                </Box>
              </Box>
            </>
          ) : (
            <Text mt={2} color="red.500" fontSize="sm">Brak danych.</Text>
          )}
        </Box>

        {/* PRAWA – mapa */}
        <Box borderWidth="1px" borderRadius="2xl" overflow="hidden" minH="420px">
          {hasCoords ? (
            <MapAny
              lat={data!.lat!}
              lon={data!.lon!}
              zoom={18}
              markerTitle={data?.name || ""}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <Box h="100%" w="100%" display="grid" placeItems="center" color="gray.500" fontSize="sm">
              Brak współrzędnych — użyj „Aktualizuj dane”.
            </Box>
          )}
        </Box>
      </Box>

      {/* DOLNY RZĄD: lewy histogram wiatru, prawy histogram PV */}
      <Box mt={6} display="grid" gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={6}>
        <Box borderWidth="1px" borderRadius="2xl" p={4}>
          <Text fontWeight="semibold" mb={2}>Histogram (wiatr) — średnia miesięczna 2015–2024</Text>
          <Box id="histWindPlotly" />
          {!hist && <Text color="gray.500" fontSize="sm">Brak danych.</Text>}
        </Box>
        <Box borderWidth="1px" borderRadius="2xl" p={4}>
          <Text fontWeight="semibold" mb={2}>Histogram (PV) — średnia miesięczna 2015–2024</Text>
          <Box id="histPvPlotly" />
          {!histPV && <Text color="gray.500" fontSize="sm">Brak danych.</Text>}
        </Box>
      </Box>
    </Box>
  );
}
