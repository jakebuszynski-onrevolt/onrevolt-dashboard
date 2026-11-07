'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import styles from './ReferenceProfileComparison.module.css';

type DayType = 'all' | 'workday' | 'weekend';

type ProfileSummary = {
  key: string;
  name: string;
  sourceKey: string;
  category: string;
  kind: string;
  quantity: string;
  unit: string;
  eligible: boolean;
  reason: string | null;
  calculationEligible?: boolean;
  calculationReason?: string | null;
  yearLabel: string;
  notes: string[];
};

type ProfileComparison = ProfileSummary & {
  monthlyKwh: number[];
  dailyAverageKwh: number[];
  totalKwh: number;
};

type CatalogState = {
  profiles: ProfileSummary[];
  comparisonYear: number;
};

type ComparisonState = {
  baseSignature: string;
  dailySignature: string;
  profiles: ProfileComparison[];
};

export type ReferenceProfileSelectionData = {
  selection: { key: string | null; revision: number; contentHash: string | null; profileName: string | null };
  annualConsumptionKwh: number | null;
  auditUpdatedAt: string | null;
  auditId?: string | null;
  profileSource?: string | null;
};
type SelectionData = ReferenceProfileSelectionData;

type SelectionSnapshot = { projectId: string; data: SelectionData };
type ReSync = { status: 'synced' | 'skipped' | 'failed'; message: string };
type Props = { annualKwh: number; projectId?: string; onReferenceProfileSaved?: (data: SelectionData) => void;
  onAnnualConsumptionReload?: (data: SelectionData) => void };

const MAX_PROFILES = 6;
const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
const COLORS = ['#7846d8', '#e07936', '#258d70', '#3978c8', '#c34f78', '#8b7b24'];

const CATEGORY_LABELS: Record<string, string> = {
  household: 'Gospodarstwa domowe',
  business: 'Przedsiębiorstwa',
  agriculture: 'Rolnictwo',
  prosumer_pv: 'Prosument z instalacją PV',
  prosumer_storage_pv: 'Prosument z magazynem i PV',
  household_grid_import: 'Pobór z sieci · dom',
  heat_pump_consumption: 'Zużycie pompy ciepła',
  business_grid_import: 'Pobór z sieci · firma',
  HEAT_PUMP_EFFICIENCY: 'Sprawność pompy ciepła',
  HEAT_DEMAND: 'Zapotrzebowanie na ciepło',
  HEAT_PUMP_ELECTRICITY: 'Szacowany pobór pompy ciepła',
};
const KIND_LABELS: Record<string, string> = {
  STANDARD_PATTERN: 'Standardowy profil obciążenia',
  MEASURED: 'Profil pomiarowy',
  MEASURED_WITH_SOURCE_IMPUTATION: 'Pomiar z oznaczonymi imputacjami',
  SIMULATED: 'Symulacja',
  DERIVED_SIMULATION: 'Profil pochodny z symulacji',
};
const QUANTITY_LABELS: Record<string, string> = {
  relative_load: 'Udział obciążenia',
  grid_import_with_pv: 'Pobór z sieci przy instalacji PV',
  grid_import_with_pv_storage: 'Pobór z sieci przy PV i magazynie',
  load: 'Obciążenie',
  energy_import: 'Energia pobrana z sieci',
  device_energy_consumption: 'Zużycie urządzenia',
  coefficient_of_performance: 'Współczynnik wydajności (COP)',
  normalized_thermal_power: 'Znormalizowana moc cieplna',
  annual_electricity_fraction: 'Udział rocznego zużycia energii',
};
const SOURCE_LABELS: Record<string, string> = {
  'bdew-standard-load-profiles-2025': 'BDEW · standardowe profile obciążenia 2025',
  'vdew-standard-load-profiles-1999-2000': 'VDEW · standardowe profile obciążenia 1999/2000',
  'opsd_household_data_2020_04_15': 'Open Power System Data · profile godzinowe 2020',
  'when2heat-20230727': 'When2Heat · profile modelowe 2023',
};

function humanizeCode(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toLocaleUpperCase('pl-PL'));
}

function categoryLabel(value: string) {
  return CATEGORY_LABELS[value] || humanizeCode(value);
}

function kindLabel(value: string) {
  return KIND_LABELS[value] || humanizeCode(value);
}

function quantityLabel(value: string) {
  return QUANTITY_LABELS[value] || humanizeCode(value);
}

function sourceLabel(value: string) {
  return SOURCE_LABELS[value] || humanizeCode(value);
}

function unitLabel(value: string) {
  if (value === 'fraction_of_annual_electricity') return 'udział roczny';
  if (value === '1') return 'bezwymiarowy';
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function apiError(payload: unknown, status: number) {
  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  return 'Żądanie nie powiodło się (HTTP ' + status + ').';
}

function parseCatalog(payload: unknown): CatalogState {
  if (!isRecord(payload) || !isRecord(payload.data)) throw new Error('Odpowiedź katalogu profili ma nieprawidłowy format.');
  const data = payload.data;
  if (!Array.isArray(data.profiles) || typeof data.comparisonYear !== 'number' || !Number.isFinite(data.comparisonYear)) {
    throw new Error('Odpowiedź katalogu profili jest niekompletna.');
  }
  const profiles = data.profiles as unknown[];
  for (const profile of profiles) {
    if (!isRecord(profile)
      || typeof profile.key !== 'string'
      || typeof profile.name !== 'string'
      || typeof profile.sourceKey !== 'string'
      || typeof profile.category !== 'string'
      || typeof profile.kind !== 'string'
      || typeof profile.quantity !== 'string'
      || typeof profile.unit !== 'string'
      || typeof profile.eligible !== 'boolean'
      || !(typeof profile.reason === 'string' || profile.reason === null)
      || typeof profile.calculationEligible !== 'boolean'
      || !(typeof profile.calculationReason === 'string' || profile.calculationReason === null)
      || typeof profile.yearLabel !== 'string'
      || !Array.isArray(profile.notes)
      || !profile.notes.every((note) => typeof note === 'string')) {
      throw new Error('Katalog zawiera profil z niekompletnymi danymi.');
    }
  }
  return { profiles: profiles as ProfileSummary[], comparisonYear: data.comparisonYear };
}

function parseSelectionData(value: unknown): SelectionData {
  if (!isRecord(value) || !isRecord(value.selection)
    || !(typeof value.selection.key === 'string' || value.selection.key === null)
    || typeof value.selection.revision !== 'number' || !Number.isInteger(value.selection.revision) || value.selection.revision < 0
    || !(typeof value.selection.contentHash === 'string' || value.selection.contentHash === null)
    || !(typeof value.selection.profileName === 'string' || value.selection.profileName === null)
    || !(typeof value.annualConsumptionKwh === 'number' && Number.isFinite(value.annualConsumptionKwh) && value.annualConsumptionKwh >= 0 || value.annualConsumptionKwh === null)
    || !(typeof value.auditUpdatedAt === 'string' || value.auditUpdatedAt === null)) {
    throw new Error('Odpowiedź zapisanego profilu ma nieprawidłowy format.');
  }
  return value as SelectionData;
}

function parseSelectionResponse(payload: unknown): SelectionData {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.data)) {
    throw new Error('Odpowiedź zapisanego profilu ma nieprawidłowy format.');
  }
  return parseSelectionData(payload.data);
}

function parseReSync(value: unknown): ReSync | null {
  if (!isRecord(value) || !['synced', 'skipped', 'failed'].includes(String(value.status)) || typeof value.message !== 'string') return null;
  return { status: value.status as ReSync['status'], message: value.message };
}

function parseComparisons(payload: unknown, selectedKeys: string[]): ProfileComparison[] {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.profiles)) {
    throw new Error('Odpowiedź porównania profili ma nieprawidłowy format.');
  }
  const returned = payload.data.profiles as unknown[];
  const profiles = new Map<string, ProfileComparison>();
  for (const value of returned) {
    if (!isRecord(value)
      || typeof value.key !== 'string'
      || typeof value.name !== 'string'
      || typeof value.sourceKey !== 'string'
      || typeof value.category !== 'string'
      || typeof value.kind !== 'string'
      || typeof value.quantity !== 'string'
      || typeof value.unit !== 'string'
      || typeof value.eligible !== 'boolean'
      || !(typeof value.reason === 'string' || value.reason === null)
      || typeof value.yearLabel !== 'string'
      || !Array.isArray(value.notes)
      || !value.notes.every((note) => typeof note === 'string')
      || !Array.isArray(value.monthlyKwh)
      || value.monthlyKwh.length !== 12
      || !value.monthlyKwh.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)
      || !Array.isArray(value.dailyAverageKwh)
      || value.dailyAverageKwh.length !== 24
      || !value.dailyAverageKwh.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)
      || typeof value.totalKwh !== 'number'
      || !Number.isFinite(value.totalKwh)
      || value.totalKwh < 0) {
      throw new Error('Porównanie zawiera profil z niekompletnymi danymi.');
    }
    profiles.set(value.key, value as ProfileComparison);
  }
  const ordered = selectedKeys.map((key) => profiles.get(key));
  if (ordered.some((profile) => !profile) || profiles.size !== selectedKeys.length) {
    throw new Error('Porównanie nie zawiera wszystkich wybranych profili.');
  }
  return ordered as ProfileComparison[];
}

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString('pl-PL', { maximumFractionDigits: digits });
}

function axisCeiling(maximum: number) {
  if (maximum <= 0) return 1;
  const rawStep = maximum / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return Math.ceil(maximum / step) * step;
}

function chartLabel(index: number, kind: 'monthly' | 'hourly') {
  return kind === 'monthly' ? MONTHS[index] : String(index).padStart(2, '0') + ':00';
}

function LineChart({ profiles, selectedKeys, kind, label }: {
  profiles: ProfileComparison[];
  selectedKeys: string[];
  kind: 'monthly' | 'hourly';
  label: string;
}) {
  const values = profiles.map((profile) => kind === 'monthly' ? profile.monthlyKwh : profile.dailyAverageKwh);
  const count = kind === 'monthly' ? 12 : 24;
  const width = 940;
  const height = 292;
  const left = 62;
  const right = 20;
  const top = 22;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = axisCeiling(Math.max(0, ...values.flat()));
  const x = (index: number) => left + index * plotWidth / (count - 1);
  const y = (value: number) => top + (max - value) / max * plotHeight;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const selectedValues = hoveredIndex === null ? null : values.map((series) => series[hoveredIndex]);
  const hoveredLabel = hoveredIndex === null ? null : chartLabel(hoveredIndex, kind);

  return <div className={styles.chartFrame}>
    <ul className={styles.legend} aria-label="Serie na wykresie">
      {profiles.map((profile) => <li key={profile.key}>
        <span style={{ backgroundColor: COLORS[Math.max(0, selectedKeys.indexOf(profile.key)) % COLORS.length] }} aria-hidden="true" />
        {profile.name}
      </li>)}
    </ul>
    <div className={styles.chartTooltip} aria-live="polite">
      {hoveredLabel ? <><strong>{hoveredLabel}</strong>
        <span>{profiles.map((profile, index) => <i key={profile.key}>
          <b style={{ backgroundColor: COLORS[Math.max(0, selectedKeys.indexOf(profile.key)) % COLORS.length] }} />
          {profile.name}: {formatNumber(selectedValues![index], 2)} kWh{kind === 'hourly' ? '/h' : ''}
        </i>)}</span></> : <span>Najedź na punkt wykresu lub przejdź do niego klawiaturą, aby zobaczyć wartości.</span>}
    </div>
    <div className={styles.chartScroll}>
      <svg className={styles.chart} viewBox={'0 0 ' + width + ' ' + height} role="group" aria-label={label}>
        <text x={left} y="13" className={styles.axisTitle}>{kind === 'monthly' ? 'kWh / miesiąc' : 'kWh / godzinę'}</text>
        {Array.from({ length: 5 }, (_, tick) => {
          const value = max * tick / 4;
          const yPos = y(value);
          return <g key={tick} aria-hidden="true">
            <line x1={left} x2={width - right} y1={yPos} y2={yPos} className={styles.gridLine} />
            <text x={left - 10} y={yPos + 4} textAnchor="end" className={styles.axisLabel}>{formatNumber(value, value < 10 ? 1 : 0)}</text>
          </g>;
        })}
        <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className={styles.axisLine} aria-hidden="true" />
        {Array.from({ length: count }, (_, index) => {
          const labelText = chartLabel(index, kind);
          const bandWidth = plotWidth / (count - 1);
          const bandLeft = Math.max(left, x(index) - bandWidth / 2);
          const bandRight = Math.min(width - right, x(index) + bandWidth / 2);
          const pointLabel = profiles.map((profile, profileIndex) => profile.name + ': ' + formatNumber(values[profileIndex][index], 2) + ' kWh').join('; ');
          return <g key={index}>
            {index % (kind === 'monthly' ? 1 : 3) === 0 ? <text x={x(index)} y={height - 16} textAnchor="middle" className={styles.xLabel} aria-hidden="true">{labelText}</text> : null}
            {hoveredIndex === index ? <line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} className={styles.hoverLine} aria-hidden="true" /> : null}
            <rect x={bandLeft} y={top} width={Math.max(1, bandRight - bandLeft)} height={plotHeight} className={styles.hoverTarget}
              tabIndex={0} role="button" aria-label={labelText + ': ' + pointLabel}
              onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} />
          </g>;
        })}
        {profiles.map((profile) => {
          const color = COLORS[Math.max(0, selectedKeys.indexOf(profile.key)) % COLORS.length];
          const series = kind === 'monthly' ? profile.monthlyKwh : profile.dailyAverageKwh;
          const path = series.map((value, index) => (index === 0 ? 'M' : 'L') + x(index) + ' ' + y(value)).join(' ');
          return <g key={profile.key} aria-label={profile.name}>
            <path d={path} fill="none" stroke={color} className={styles.seriesLine} />
            {series.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r={hoveredIndex === index ? 5 : 3.5}
              fill={color} className={styles.seriesPoint} aria-hidden="true"><title>{profile.name} · {chartLabel(index, kind)} · {formatNumber(value, 2)} kWh</title></circle>)}
          </g>;
        })}
      </svg>
    </div>
  </div>;
}

export default function ReferenceProfileComparison({ annualKwh, projectId, onReferenceProfileSaved, onAnnualConsumptionReload }: Props) {
  const annualReloadCallback = useRef(onAnnualConsumptionReload);
  annualReloadCallback.current = onAnnualConsumptionReload;
  const id = useId().replace(/:/g, '');
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectionSnapshot, setSelectionSnapshot] = useState<SelectionSnapshot | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionLoadError, setSelectionLoadError] = useState('');
  const [selectionReloadAttempt, setSelectionReloadAttempt] = useState(0);
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionSaveError, setSelectionSaveError] = useState('');
  const [selectionSaveConflict, setSelectionSaveConflict] = useState(false);
  const [selectionSaveRequiresDeclaration, setSelectionSaveRequiresDeclaration] = useState(false);
  const [selectionSaveNotice, setSelectionSaveNotice] = useState<{ tone: 'success' | 'info' | 'warning'; message: string } | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const saveRequestRef = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [query, setQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [month, setMonth] = useState<number | null>(null);
  const [dayType, setDayType] = useState<DayType>('all');
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const [requestError, setRequestError] = useState<{ signature: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const validAnnual = Number.isFinite(annualKwh) && annualKwh > 0;
  const selectionReady = Boolean(projectId && selectionSnapshot?.projectId === projectId);
  const persistedSelection = selectionReady ? selectionSnapshot?.data || null : null;
  const calculationCatalogReady = Boolean(catalog && !catalogBusy && !catalogError);
  const calculationProfiles = useMemo(() => catalog?.profiles.filter((profile) => profile.calculationEligible === true) || [], [catalog]);
  const pendingCalculationProfile = calculationProfiles.find((profile) => profile.key === pendingSelectionKey) || null;
  const savedKeyUnavailable = selectionReady && pendingSelectionKey !== null && calculationCatalogReady && !pendingCalculationProfile;
  const unavailableSavedProfile = savedKeyUnavailable
    ? catalog?.profiles.find((profile) => profile.key === pendingSelectionKey) || null
    : null;
  const selectionNeedsSave = selectionReady && persistedSelection?.selection.key !== pendingSelectionKey;
  const annualNeedsSave = selectionReady && persistedSelection?.annualConsumptionKwh !== annualKwh;
  const validPendingSelection = pendingSelectionKey === null || Boolean(pendingCalculationProfile);
  const canSaveSelection = Boolean(projectId && selectionReady && !selectionLoading && !selectionLoadError
    && !savingSelection && !selectionSaveConflict && validAnnual && validPendingSelection);
  const waitingForSelection = Boolean(projectId && !selectionReady && !selectionLoadError);
  const selectionValue = selectionReady ? pendingSelectionKey || '' : waitingForSelection ? '__loading__' : '';
  const selectionControlDisabled = !projectId || !selectionReady || selectionLoading || savingSelection
    || selectionSaveConflict || catalogBusy || Boolean(catalogError);
  const reloadSelection = () => {
    setSelectionLoading(true);
    setSelectionLoadError('');
    setSelectionSaveError('');
    setSelectionSaveConflict(false);
    setSelectionSaveRequiresDeclaration(false);
    setSelectionReloadAttempt((value) => value + 1);
  };
  const keySignature = JSON.stringify(selectedKeys);
  const baseSignature = JSON.stringify([selectedKeys, annualKwh]);
  const dailySignature = JSON.stringify([baseSignature, month, dayType]);
  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl-PL');
    if (!catalog || !needle) return catalog?.profiles || [];
    return catalog.profiles.filter((profile) => [
      profile.name,
      profile.sourceKey,
      sourceLabel(profile.sourceKey),
      profile.category,
      categoryLabel(profile.category),
      profile.kind,
      kindLabel(profile.kind),
      profile.yearLabel,
    ]
      .join(' ').toLocaleLowerCase('pl-PL').includes(needle));
  }, [catalog, query]);
  const visibleProfiles = comparison?.baseSignature === baseSignature ? comparison.profiles : [];
  const currentProfiles = visibleProfiles;
  const dailyProfiles = comparison?.dailySignature === dailySignature ? comparison.profiles : [];
  const currentError = requestError?.signature === dailySignature ? requestError.message : '';
  const selectedMetadata = useMemo(() => selectedKeys
    .map((key) => catalog?.profiles.find((profile) => profile.key === key))
    .filter((profile): profile is ProfileSummary => Boolean(profile)), [catalog, keySignature]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogBusy(true);
    setCatalogError('');
    fetch('/api/reference-load-profiles', { method: 'GET', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(payload, response.status));
        return parseCatalog(payload);
      })
      .then((value) => { if (!controller.signal.aborted) setCatalog(value); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCatalogError(error instanceof Error ? error.message : 'Nie udało się pobrać katalogu profili.');
      })
      .finally(() => { if (!controller.signal.aborted) setCatalogBusy(false); });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    saveRequestRef.current += 1;
    saveControllerRef.current?.abort();
    saveControllerRef.current = null;
    setSavingSelection(false);
    if (!projectId) {
      setSelectionSnapshot(null);
      setPendingSelectionKey(null);
      setSelectionLoading(false);
      setSelectionLoadError('');
      setSelectionSaveError('');
      setSelectionSaveConflict(false);
      setSelectionSaveRequiresDeclaration(false);
      setSelectionSaveNotice(null);
      return;
    }

    const controller = new AbortController();
    setSelectionLoading(true);
    setSelectionLoadError('');
    setSelectionSaveError('');
    setSelectionSaveConflict(false);
    setSelectionSaveRequiresDeclaration(false);
    setSelectionSaveNotice(null);
    fetch('/api/projects/' + encodeURIComponent(projectId) + '/reference-load-profile', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(payload, response.status));
        return parseSelectionResponse(payload);
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSelectionSnapshot({ projectId, data });
        setPendingSelectionKey(data.selection.key);
        if (selectionReloadAttempt > 0) annualReloadCallback.current?.(data);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSelectionLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać zapisanego profilu RE.');
      })
      .finally(() => { if (!controller.signal.aborted) setSelectionLoading(false); });
    return () => controller.abort();
  }, [projectId, selectionReloadAttempt]);

  useEffect(() => () => {
    saveRequestRef.current += 1;
    saveControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!catalog || !selectedKeys.length || !validAnnual || selectedMetadata.length !== selectedKeys.length
      || selectedMetadata.some((profile) => !profile.eligible)) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      setRequestError(null);
      fetch('/api/reference-load-profiles', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ keys: selectedKeys, annualKwh, month, dayType }),
      })
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error(apiError(payload, response.status));
          return parseComparisons(payload, selectedKeys);
        })
        .then((profiles) => {
          if (!controller.signal.aborted) setComparison({ baseSignature, dailySignature, profiles });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setRequestError({
            signature: dailySignature,
            message: error instanceof Error ? error.message : 'Nie udało się porównać wybranych profili.',
          });
        })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalog, keySignature, selectedKeys, selectedMetadata, annualKwh, validAnnual, month, dayType, baseSignature, dailySignature, attempt]);

  const saveReferenceProfile = async () => {
    if (!canSaveSelection || !projectId || !selectionSnapshot || selectionSnapshot.projectId !== projectId) return;
    const requestedProjectId = projectId;
    const requestedKey = pendingSelectionKey;
    const requestedAnnualKwh = annualKwh;
    const requestId = ++saveRequestRef.current;
    const controller = new AbortController();
    saveControllerRef.current = controller;
    setSavingSelection(true);
    setSelectionSaveError('');
    setSelectionSaveConflict(false);
    setSelectionSaveNotice(null);
    try {
      const response = await fetch('/api/projects/' + encodeURIComponent(requestedProjectId) + '/reference-load-profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          profileKey: requestedKey,
          annualKwh: requestedAnnualKwh,
          expectedRevision: selectionSnapshot.data.selection.revision,
          expectedAuditUpdatedAt: selectionSnapshot.data.auditUpdatedAt,
        }),
      });
      const payload: unknown = await response.json();
      if (controller.signal.aborted || requestId !== saveRequestRef.current || projectIdRef.current !== requestedProjectId) return;

      if (response.status === 409) {
        const message = apiError(payload, response.status);
        setSelectionSaveError(message);
        setSelectionSaveConflict(true);
        setSelectionSaveRequiresDeclaration(message.includes('Deklarację klienta'));
        return;
      }

      if (response.status === 502 && isRecord(payload) && payload.saved === true && isRecord(payload.data)) {
        const data = parseSelectionData(payload.data);
        const reSync = parseReSync(payload.reSync);
        setSelectionSnapshot({ projectId: requestedProjectId, data });
        setPendingSelectionKey(data.selection.key);
        setSelectionSaveNotice({
          tone: 'warning',
          message: 'Zapisano profil i roczne zużycie w CRM, ale synchronizacja RE nie została potwierdzona. '
            + (reSync?.message || apiError(payload, response.status)),
        });
        onReferenceProfileSaved?.(data);
        return;
      }

      if (!response.ok) throw new Error(apiError(payload, response.status));
      const data = parseSelectionResponse(payload);
      const reSync = isRecord(payload) ? parseReSync(payload.reSync) : null;
      setSelectionSnapshot({ projectId: requestedProjectId, data });
      setPendingSelectionKey(data.selection.key);
      if (reSync?.status === 'synced') {
        setSelectionSaveNotice({ tone: 'success', message: 'Zapisano wybór profilu i roczne zużycie. Profil RE został zsynchronizowany.' });
      } else if (reSync?.status === 'skipped') {
        setSelectionSaveNotice({ tone: 'info', message: 'Zapisano wybór profilu i roczne zużycie. Synchronizacja RE została pominięta: ' + reSync.message });
      } else if (reSync?.status === 'failed') {
        setSelectionSaveNotice({ tone: 'warning', message: 'Zapisano wybór i zużycie w CRM, ale synchronizacja RE nie powiodła się: ' + reSync.message });
      } else {
        setSelectionSaveNotice({ tone: 'warning', message: 'Zapisano wybór i zużycie w CRM, ale odpowiedź nie podała wyniku synchronizacji RE.' });
      }
      if (data.annualConsumptionKwh !== requestedAnnualKwh || data.profileSource && data.profileSource !== 'ANNUAL_DECLARATION') {
        annualReloadCallback.current?.(data);
      } else {
        onReferenceProfileSaved?.(data);
      }
    } catch (error) {
      if (controller.signal.aborted || requestId !== saveRequestRef.current || projectIdRef.current !== requestedProjectId) return;
      setSelectionSaveError(error instanceof Error ? error.message : 'Nie udało się zapisać profilu RE.');
    } finally {
      if (requestId === saveRequestRef.current && projectIdRef.current === requestedProjectId) {
        setSavingSelection(false);
        if (saveControllerRef.current === controller) saveControllerRef.current = null;
      }
    }
  };

  const toggleProfile = (profile: ProfileSummary) => {
    setSelectedKeys((current) => {
      if (current.includes(profile.key)) return current.filter((key) => key !== profile.key);
      if (!profile.eligible || current.length >= MAX_PROFILES) return current;
      return [...current, profile.key];
    });
  };

  return <section className={styles.panel} aria-labelledby={id + '-title'}>
    <header className={styles.heading}>
      <div className={styles.headingIcon} aria-hidden="true"><span>↗</span></div>
      <div className={styles.headingText}>
        <div className={styles.eyebrow}>DANE REFERENCYJNE</div>
        <h2 id={id + '-title'}>Porównanie profili zużycia</h2>
        <p>Porównaj do {MAX_PROFILES} profili i osobno wybierz jeden kształt do obliczeń RE.</p>
      </div>
      <span className={styles.readOnlyBadge}>Porównanie tylko podgląd</span>
    </header>
    <p className={styles.readOnlyNote}>
      Porównanie do 6 profili pozostaje podglądem. Osobny profil do obliczeń RE zapisuje się wyłącznie przyciskiem poniżej.
      Porównawcze wartości kWh nie są prognozą rzeczywistego poboru z sieci ani pełnego zużycia budynku — pobór sieciowy
      i sama pompa ciepła mogą opisywać tylko część bilansu.
    </p>

    {!validAnnual ? <div className={styles.annualPrompt} role="status">
      <span className={styles.promptIcon} aria-hidden="true">!</span>
      <div><strong>Uzupełnij dodatnie roczne zużycie</strong>
        <p>Wpisz poprawną wartość w polu deklaracji klienta. Porównanie nie podstawia wartości domyślnej.</p>
      </div>
    </div> : <div className={styles.annualSummary}>
      <span>Roczne zużycie przyjęte do porównania</span>
      <strong>{formatNumber(annualKwh, 2)} <small>kWh/rok</small></strong>
    </div>}

    <section className={styles.calculationSelection} aria-labelledby={id + '-calculation-title'}>
      <div className={styles.selectionHeading}>
        <div><h3 id={id + '-calculation-title'}>Profil do obliczeń RE</h3>
          <p>Wybierz jeden zapisany profil albo pozostaw dotychczasowe ustawienie domyślne.</p></div>
        <span className={styles.selectionMode}>1 profil</span>
      </div>
      <p className={styles.selectionMethod}>
        Wybrany profil określa rozkład sezonowy: miesiąc × dzień roboczy/weekend × godzina. RE skaluje ten kształt do podanej
        wartości rocznej. Dostępne pomiary rzeczywiste nadal mają pierwszeństwo.
      </p>
      <label className={styles.selectionField} htmlFor={id + '-calculation-profile'}>
        <span>Profil do obliczeń RE</span>
        <select id={id + '-calculation-profile'} value={selectionValue} disabled={selectionControlDisabled}
          onChange={(event) => {
            setPendingSelectionKey(event.target.value || null);
            setSelectionSaveNotice(null);
            setSelectionSaveError('');
          }}>
          {waitingForSelection ? <option value="__loading__" disabled>Wczytywanie zapisanego wyboru…</option>
            : <option value="">Dotychczasowy profil domyślny RE</option>}
          {savedKeyUnavailable && pendingSelectionKey ? <option value={pendingSelectionKey} disabled>
            {unavailableSavedProfile?.name || persistedSelection?.selection.profileName || 'Zapisany profil'} · obecnie niedostępny do obliczeń RE
          </option> : null}
          {calculationProfiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.name} · {profile.yearLabel}</option>)}
        </select>
      </label>
      {unavailableSavedProfile ? <p className={styles.selectionExcluded}>
        Zapisany profil nie kwalifikuje się obecnie do obliczeń RE: {unavailableSavedProfile.calculationReason || unavailableSavedProfile.reason || 'brak przyczyny w katalogu'}
      </p> : null}
      {selectionLoadError ? <div className={styles.selectionError} role="alert">
        <span>Nie udało się wczytać wyboru dla tego projektu: {selectionLoadError}</span>
        <button type="button" onClick={reloadSelection}>Wczytaj ponownie</button>
      </div> : null}
      {!projectId ? <p className={styles.selectionContext}>Aby wczytać i zapisać wybór, otwórz dane konkretnego projektu.</p>
        : waitingForSelection || selectionLoading ? <p className={styles.selectionContext} role="status">Wczytywanie zapisanego profilu i rocznego zużycia…</p>
          : selectionReady ? <div className={styles.selectionContext} role="status">
            {selectionNeedsSave
              ? <p>Nie zapisano jeszcze zmiany profilu. Do czasu zapisu obowiązuje dotychczasowy zapis dla tego projektu.</p>
              : pendingSelectionKey !== null && !calculationCatalogReady
                ? <p>Wczytywanie opisu zapisanego profilu…</p>
              : pendingCalculationProfile
                ? <p>W obliczeniach RE zapisany jest profil: <strong>{pendingCalculationProfile.name}</strong>.</p>
                : pendingSelectionKey !== null
                  ? <p>Zapisany profil jest niedostępny. Obliczenia wymagają ponownego wyboru i zapisu profilu.</p>
                : <p>Obowiązuje dotychczasowy profil domyślny RE.</p>}
            {annualNeedsSave ? <p>Roczne zużycie różni się od zapisanego i zostanie zapisane razem z wyborem profilu.</p> : null}
            {persistedSelection?.annualConsumptionKwh != null
              ? <p>Zapisane roczne zużycie: <strong>{formatNumber(persistedSelection.annualConsumptionKwh, 2)} kWh/rok</strong>.</p>
              : <p>Nie ma jeszcze zapisanego rocznego zużycia w deklaracji projektu.</p>}
          </div> : null}
      {selectionSaveNotice ? <p className={styles.selectionNotice} data-tone={selectionSaveNotice.tone}
        role={selectionSaveNotice.tone === 'warning' ? 'alert' : 'status'}>{selectionSaveNotice.message}</p> : null}
      {selectionSaveError ? <div className={styles.selectionError} role="alert">
        <span>{selectionSaveError}</span>
        {selectionSaveRequiresDeclaration ? <small>Najpierw zapisz „Deklarację klienta” w danych energetycznych. Potem wczytaj tu aktualny zapis i ponów zapis profilu.</small> : null}
        {selectionSaveConflict ? <button type="button" onClick={reloadSelection}>Wczytaj aktualny zapis</button> : null}
      </div> : null}
      {!validAnnual ? <p className={styles.selectionExcluded}>Do zapisu podaj dodatnie roczne zużycie w kWh.</p>
        : calculationCatalogReady && !validPendingSelection ? <p className={styles.selectionExcluded}>Ten zapisany profil nie jest obecnie dostępny do obliczeń RE. Wybierz profil z listy lub dotychczasowy profil domyślny.</p>
          : null}
      <div className={styles.selectionActions}>
        <button type="button" className={styles.selectionSaveButton} onClick={() => void saveReferenceProfile()} disabled={!canSaveSelection}>
          {savingSelection ? 'Zapisywanie profilu…' : 'Zapisz profil i zużycie roczne'}
        </button>
        {selectionSaveConflict ? <span>Najpierw wczytaj aktualny zapis, aby nie nadpisać nowszych zmian.</span>
          : !projectId ? <span>Zapis wymaga otwartego projektu.</span>
            : !validAnnual ? <span>Wymagana jest dodatnia wartość kWh/rok.</span>
              : null}
      </div>
    </section>

    <div className={styles.selectorHeading}>
      <div><h3>Profile referencyjne</h3><p>Możesz wybrać do {MAX_PROFILES} pozycji. Żadna nie jest zaznaczona automatycznie.</p></div>
      <span className={styles.selectionCount}>{selectedKeys.length}/{MAX_PROFILES}</span>
    </div>
    <label className={styles.search} htmlFor={id + '-search'}>
      <span aria-hidden="true">⌕</span><input id={id + '-search'} type="search" value={query} placeholder="Szukaj po nazwie, kategorii lub źródle"
        onChange={(event) => setQuery(event.target.value)} />
    </label>

    {catalogBusy ? <div className={styles.status} role="status"><span className={styles.spinner} />Pobieranie katalogu profili…</div>
      : catalogError ? <div className={styles.error} role="alert"><span>{catalogError}</span>
        <button type="button" onClick={() => setCatalogAttempt((value) => value + 1)}>Spróbuj ponownie</button></div>
        : <div className={styles.profileList} aria-label="Dostępne profile referencyjne">
          {filteredProfiles.length ? filteredProfiles.map((profile) => {
            const checked = selectedKeys.includes(profile.key);
            const atLimit = !checked && selectedKeys.length >= MAX_PROFILES;
            return <label key={profile.key} className={profile.eligible ? (checked ? styles.profileSelected : styles.profileOption) : styles.profileDisabled}>
              <input type="checkbox" checked={checked} disabled={!profile.eligible || atLimit}
                onChange={() => toggleProfile(profile)} aria-label={profile.name + (profile.eligible ? '' : ', niedostępny: ' + (profile.reason || 'brak powodu'))} />
              <span className={styles.profileMain}>
                <strong>{profile.name}</strong>
                <small>{categoryLabel(profile.category)} · {kindLabel(profile.kind)} · {profile.yearLabel}</small>
              </span>
              <span className={styles.sourcePill}>{sourceLabel(profile.sourceKey)}</span>
              {!profile.eligible ? <span className={styles.reason}>{profile.reason || 'Profil niedostępny do porównania'}</span>
                : atLimit ? <span className={styles.limitHint}>Limit wybranych profili</span> : null}
              {profile.calculationEligible === false ? <span className={styles.calculationReason}>
                Niedostępny do obliczeń RE: {profile.calculationReason || 'profil nie kwalifikuje się do zastosowania jako kształt zużycia'}
              </span> : null}
            </label>;
          }) : <p className={styles.noMatches}>{catalog?.profiles.length ? 'Nie znaleziono profilu pasującego do wyszukiwania.' : 'Katalog nie zawiera profili referencyjnych.'}</p>}
        </div>}
    {catalog && !catalogBusy && !catalogError ? <p className={styles.catalogFootnote}>Wersja odniesienia katalogu: {catalog.comparisonYear}. Rok źródła każdego profilu podano osobno.</p> : null}

    {selectedKeys.length > 0 ? <div className={styles.results}>
      <div className={styles.resultHeading}>
        <div><h3>Wyniki porównania</h3>
          <p>{selectedKeys.length} {selectedKeys.length === 1 ? 'wybrany profil' : 'wybrane profile'} · proporcjonalnie do rocznej deklaracji</p></div>
        {busy ? <span className={styles.updating}><span className={styles.spinner} />Aktualizowanie…</span> : null}
      </div>
      {!validAnnual ? <p className={styles.emptyState}>Wyniki pojawią się po uzupełnieniu rocznego zużycia.</p>
                : currentError && !currentProfiles.length ? <div className={styles.error} role="alert"><span>{currentError}</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>Spróbuj ponownie</button></div>
            : !currentProfiles.length ? <p className={styles.emptyState}>Przygotowywanie porównania…</p>
              : <>
                <section className={styles.chartSection} aria-labelledby={id + '-monthly'}>
                  <div className={styles.chartHeading}><div><h4 id={id + '-monthly'}>Zużycie w ciągu roku</h4>
                    <p>Porównanie miesięcy profili; rok źródła opisano w podsumowaniu poniżej.</p></div>
                    <span className={styles.unitBadge}>kWh / miesiąc</span></div>
                  <LineChart profiles={currentProfiles} selectedKeys={selectedKeys} kind="monthly"
                    label="Miesięczne zużycie energii dla wybranych profili" />
                </section>
                <section className={styles.chartSection} aria-labelledby={id + '-daily'}>
                  <div className={styles.chartHeading}><div><h4 id={id + '-daily'}>Średnia doba</h4>
                    <p>Profil godzinowy, nie rzeczywisty dzień pomiarowy.</p></div><span className={styles.unitBadge}>kWh / godzinę</span></div>
                  <div className={styles.filters}>
                    <label htmlFor={id + '-month'}><span>Miesiąc</span><select id={id + '-month'} value={month === null ? '' : String(month)}
                      onChange={(event) => setMonth(event.target.value ? Number(event.target.value) : null)}>
                      <option value="">Cały rok</option>{MONTHS.map((monthName, index) => <option key={monthName} value={index + 1}>{monthName}</option>)}
                    </select></label>
                    <label htmlFor={id + '-daytype'}><span>Typ dnia</span><select id={id + '-daytype'} value={dayType}
                      onChange={(event) => setDayType(event.target.value as DayType)}>
                      <option value="all">Wszystkie dni</option><option value="workday">Dni robocze</option><option value="weekend">Weekend</option>
                    </select></label>
                  </div>
                  {dailyProfiles.length ? <LineChart profiles={dailyProfiles} selectedKeys={selectedKeys} kind="hourly"
                    label="Średnie godzinowe zużycie energii dla wybranych profili" />
                    : busy ? <p className={styles.emptyState}>Pobieranie profilu dla wybranego okresu…</p>
                      : currentError ? <div className={styles.error} role="alert"><span>{currentError}</span>
                        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Spróbuj ponownie</button></div>
                        : <p className={styles.emptyState}>Aktualizowanie profilu dla wybranego zakresu…</p>}
                </section>
                {currentError && currentProfiles.length ? <div className={styles.inlineError} role="status">{currentError} Pokazano ostatnie poprawne wyniki.</div> : null}
                <section className={styles.details} aria-labelledby={id + '-details'}>
                  <div className={styles.chartHeading}><div><h4 id={id + '-details'}>Źródło i podsumowanie profili</h4>
                    <p>Wartości roczne pochodzą z wybranego profilu i podanej deklaracji.</p></div></div>
                  <div className={styles.tableWrap}><table>
                    <thead><tr><th>Profil i źródło</th><th>Kategoria</th><th>Rok danych</th><th>Wielkość roczna</th><th>Uwagi do źródła</th></tr></thead>
                    <tbody>{currentProfiles.map((profile) => <tr key={profile.key}>
                      <td><strong>{profile.name}</strong><small>Źródło: {sourceLabel(profile.sourceKey)}</small></td>
                      <td>{categoryLabel(profile.category)}<small>{kindLabel(profile.kind)}</small></td>
                      <td>{profile.yearLabel}</td>
                      <td><strong>{formatNumber(profile.totalKwh, 2)} kWh</strong><small>Dane źródłowe: {quantityLabel(profile.quantity)} [{unitLabel(profile.unit)}]</small></td>
                      <td>{profile.notes.length ? <ul>{profile.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : <span className={styles.muted}>Brak dodatkowych uwag.</span>}</td>
                    </tr>)}</tbody>
                  </table></div>
                </section>
                <p className={styles.methodNote}>To porównanie informacyjne profili referencyjnych. Nie zastępuje pomiarów ani zatwierdzonych danych klienta.</p>
              </>}
    </div> : <p className={styles.emptyState + ' ' + styles.chooseState}>Zaznacz co najmniej jeden dostępny profil, aby wyświetlić wykresy i podsumowanie.</p>}
  </section>;
}
