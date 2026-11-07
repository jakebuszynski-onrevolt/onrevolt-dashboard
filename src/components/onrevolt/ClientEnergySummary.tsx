'use client';

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './ClientEnergySummary.module.css';
import {
  clientEnergyProfileSourceLabel,
  summarizeClientEnergyInvoices,
  type ClientEnergyInvoice,
} from 'lib/onrevolt/client-energy-summary';

export type ClientEnergyProfileMonth = {
  key: string;
  year: number;
  month: number;
  label: string;
  totalKwh: number;
  sharePercent: number;
  hourly: number[];
  sourceFiles: number;
  hasData?: boolean;
  importSource?: string;
  exportSource?: string;
};

export type ClientEnergyProfile = {
  annualKwh: number;
  months: ClientEnergyProfileMonth[];
  source?: 'RE';
  warnings: string[];
} | null;

export type ClientEnergySummaryMonth = {
  period: string;
  importKwh: number | null;
  exportKwh: number | null;
  importAvailable: boolean;
  exportAvailable: boolean;
};

export type ClientEnergySummaryDay = {
  date: string;
  period: string;
  hours: Array<{ hour: number; importKwh: number | null; exportKwh: number | null; loadKwh?: number | null }>;
};

export type ClientEnergyAnnualModel = {
  source: 'MODELLED';
  provenance?: { kind: 'annual-consumption'; source: string; annualConsumptionKwh: number };
  profileSource?: string;
  annualConsumptionKwh: number;
  flowAvailable: boolean;
  months: Array<{ period: string; loadKwh: number | null; importKwh: number | null; exportKwh: number | null }>;
  days: ClientEnergySummaryDay[];
  issues: string[];
};

export type ClientEnergyMeasurements = {
  months: ClientEnergySummaryMonth[];
  days: ClientEnergySummaryDay[];
  issues: string[];
  cost?: {
    source?: 'MODELLED';
    status: 'ready' | 'partial' | 'blocked';
    vatBasis: 'NET' | 'GROSS';
    totalPln: number | null;
    energyPln: number | null;
    distributionPln: number | null;
    fixedPln: number | null;
    exportValuePln: number | null;
    settlementBenefitPln: number | null;
    settled: boolean;
    pricedHours: number;
    totalHours: number;
    tariffLabels: string[];
    issues: string[];
    assumptions: string[];
  };
  pv?: {
    productionKwh: number | null;
    selfConsumptionKwh: number | null;
    coveredMonths: number;
    totalMonths: number;
    coveredHours?: number;
    totalHours?: number;
    modelUrl: string | null;
    note: string;
    issues: string[];
  };
  annualModel?: ClientEnergyAnnualModel;
};

export type ClientEnergySummaryLoadState = {
  requestKey: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  warnings?: string[];
};

export function getClientEnergySummaryRequestKey(projectId: string, refreshKey?: string) {
  return JSON.stringify([projectId, refreshKey ?? '']);
}

export function isCurrentClientEnergySummaryLoadState(state: ClientEnergySummaryLoadState | null, requestKey: string) {
  return state?.requestKey === requestKey;
}

export function areClientEnergySummaryLoadStatesEqual(
  left: ClientEnergySummaryLoadState | null,
  right: ClientEnergySummaryLoadState,
) {
  return left?.requestKey === right.requestKey
    && left.status === right.status
    && left.error === right.error
    && (left.warnings || []).length === (right.warnings || []).length
    && (left.warnings || []).every((warning, index) => warning === right.warnings?.[index]);
}

export function resolveClientAnnualConsumption(input: {
  hasOperatorData: boolean;
  hasEnergyInvoices: boolean;
  profileStatus: 'loading' | 'ready' | 'error';
  profileAnnualKwh?: number | null;
  invoiceAnnualKwh?: number | null;
  manualSourceSelected: boolean;
  manualAnnualKwh?: number | null;
}) {
  const positive = (value?: number | null) => value != null && Number.isFinite(value) && value > 0 ? value : null;
  if (input.hasOperatorData) return input.profileStatus === 'ready' ? positive(input.profileAnnualKwh) : null;
  if (input.hasEnergyInvoices) return positive(input.invoiceAnnualKwh);
  return input.manualSourceSelected ? positive(input.manualAnnualKwh) : null;
}

export type ClientEnergySummaryProps = {
  projectId: string;
  profile: ClientEnergyProfile;
  annualConsumptionKwh: number;
  consumptionSource: string;
  hasPv: boolean;
  invoices: ClientEnergyInvoice[];
  refreshKey?: string;
  analysisStartMonth?: string;
  profileLoading?: boolean;
  initialData?: ClientEnergyMeasurements;
  maskValues?: boolean;
  onLoadStateChange?: (state: ClientEnergySummaryLoadState) => void;
};

type ChartRow = {
  label: string;
  title: string;
  importKwh: number | null;
  exportKwh: number | null;
  loadKwh: number | null;
};

const monthShort = (month: number) => new Intl.DateTimeFormat('pl-PL', { month: 'short', timeZone: 'UTC' })
  .format(new Date(Date.UTC(2024, month - 1, 1))).replace('.', '');
const monthLong = (period: string) => new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${period}-01T12:00:00.000Z`));
const number = (value: number, digits = 0) => new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(value);
const kwh = (value: number | null, digits = 0) => value == null ? '—' : `${number(value, digits)} kWh`;
const money = (value: number | null) => value == null ? '—' : `${number(value, 2)} zł`;
const hasProfileMonth = (month: ClientEnergyProfileMonth) => month.hasData ?? month.sourceFiles > 0;

type MeasurementRequest = {
  requestKey: string;
  status: 'loading' | 'ready' | 'error';
  data?: ClientEnergyMeasurements;
  error?: string;
};

function useEnergyMeasurements(projectId: string, refreshKey?: string, initialData?: ClientEnergyMeasurements, analysisStartMonth?: string) {
  const requestKey = getClientEnergySummaryRequestKey(projectId, refreshKey);
  const generation = useRef(0);
  const [request, setRequest] = useState<MeasurementRequest | null>(null);
  const hasInitialData = initialData != null;

  useEffect(() => {
    const requestGeneration = ++generation.current;
    if (hasInitialData) {
      setRequest({ requestKey, status: 'ready', data: initialData });
      return () => {
        if (generation.current === requestGeneration) generation.current += 1;
      };
    }
    const controller = new AbortController();
    setRequest({ requestKey, status: 'loading' });
    if (!projectId) {
      setRequest({ requestKey, status: 'error', error: 'Brak identyfikatora projektu do odczytu pomiarów.' });
      return () => controller.abort();
    }

    void fetch(`/api/projects/${encodeURIComponent(projectId)}/energy-summary`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (analysisStartMonth && payload.data.period?.startMonth !== analysisStartMonth) {
        throw new Error('Okres zmienił się w innej karcie. Odśwież okres analizy.');
      }
      if (!controller.signal.aborted && generation.current === requestGeneration) {
        setRequest({ requestKey, status: 'ready', data: payload.data as ClientEnergyMeasurements });
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setRequest({ requestKey, status: 'error', error: reason instanceof Error ? reason.message : String(reason) });
    });

    return () => {
      controller.abort();
      if (generation.current === requestGeneration) generation.current += 1;
    };
  }, [projectId, refreshKey, requestKey, hasInitialData, initialData, analysisStartMonth]);

  const currentRequest = request?.requestKey === requestKey
    ? request
    : hasInitialData
      ? { requestKey, status: 'ready' as const, data: initialData }
      : { requestKey, status: 'loading' as const };

  return {
    data: currentRequest.data ?? null,
    error: currentRequest.status === 'error' ? currentRequest.error || 'Nie udało się odczytać pomiarów.' : '',
    loading: currentRequest.status === 'loading',
    status: currentRequest.status,
    requestKey,
  };
}

function profileLoadForPeriod(profile: ClientEnergyProfile, period: string) {
  const [year, month] = period.split('-').map(Number);
  const item = profile?.months.find((entry) => entry.year === year && entry.month === month);
  if (!item || !hasProfileMonth(item) || !Number.isFinite(item.totalKwh) || item.totalKwh < 0) return null;
  return item.totalKwh;
}

function niceCeil(value: number) {
  if (value <= 0) return 1;
  const step = value > 100 ? 500 : 5;
  return Math.ceil(value / step) * step;
}

function EnergyChart({ rows, annual, label }: { rows: ChartRow[]; annual: boolean; label: string }) {
  const height = 258, left = 55, right = 18, topPad = 25, bottomPad = 37;
  const width = 950, plotWidth = width - left - right, plotHeight = height - topPad - bottomPad;
  const maxImport = Math.max(0, ...rows.map((row) => row.importKwh ?? 0));
  const maxLoad = Math.max(0, ...rows.map((row) => row.loadKwh ?? 0));
  const maxExport = Math.max(0, ...rows.map((row) => row.exportKwh ?? 0));
  const top = niceCeil(Math.max(1, maxImport, maxLoad));
  const bottom = maxExport ? niceCeil(maxExport) : 0;
  const range = top + bottom;
  const y = (value: number) => topPad + (top - value) / range * plotHeight;
  const zero = y(0);
  const band = plotWidth / Math.max(rows.length, 1);
  const barWidth = band * .7;
  let path = '';
  let connected = false;
  rows.forEach((row, index) => {
    if (row.loadKwh == null) {
      connected = false;
      return;
    }
    const x = left + (index + .5) * band;
    path += `${connected ? 'L' : 'M'}${x} ${y(row.loadKwh)}`;
    connected = true;
  });

  return <div className={styles.chartScroll}>
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <text x={left} y="13" className={styles.axisTitle}>kWh / {annual ? 'miesiąc' : 'godzinę'}</text>
      {Array.from({ length: 5 }, (_, index) => {
        const value = top * index / 4;
        const yPos = y(value);
        return <g key={index}>
          <line x1={left} x2={width - right} y1={yPos} y2={yPos} className={styles.gridLine} />
          <text x={left - 9} y={yPos + 4} textAnchor="end" className={styles.axisLabel}>{number(value)}</text>
        </g>;
      })}
      <line x1={left} x2={width - right} y1={zero} y2={zero} className={styles.zeroLine} />
      {rows.map((row, index) => {
        const x = left + index * band + (band - barWidth) / 2;
        const importValue = row.importKwh;
        const exportValue = row.exportKwh;
        return <g key={`${row.title}-${index}`}>
          <title>{`${row.title} · pobór ${kwh(importValue, 2)} · oddanie ${kwh(exportValue, 2)}${row.loadKwh == null ? '' : ` · zużycie z profilu ${kwh(row.loadKwh, 2)}`}`}</title>
          {importValue == null ? null : <rect data-series="import" x={x} y={y(importValue)} width={barWidth} height={Math.max(0, zero - y(importValue))} rx="2" className={styles.importBar} />}
          {exportValue == null || exportValue <= 0 ? null : <rect data-series="export" x={x} y={zero + 1} width={barWidth} height={Math.max(0, y(-exportValue) - zero)} rx="1" className={styles.exportBar} />}
          {importValue == null ? <text x={x + barWidth / 2} y={zero - 7} textAnchor="middle" className={styles.axisLabel}>—</text> : null}
          <text x={x + barWidth / 2} y={height - 12} textAnchor="middle" className={styles.xLabel}>{row.label}</text>
        </g>;
      })}
      {path ? <>
        <path d={path} fill="none" className={styles.loadUnderlay} />
        <path data-series="load" d={path} fill="none" className={styles.loadLine} />
      </> : null}
    </svg>
  </div>;
}

function AverageDay({ profile }: { profile: ClientEnergyProfile }) {
  const months = (profile?.months || []).filter((month) => hasProfileMonth(month)
    && month.hourly.length === 24 && month.hourly.every((value) => Number.isFinite(value) && value >= 0));
  const [monthKey, setMonthKey] = useState('');
  const selected = months.find((month) => month.key === monthKey) || months.at(-1);
  if (!selected) return null;
  const maximum = Math.max(1, ...selected.hourly);

  return <section className={styles.averageDay} aria-label="Średnia doba z profilu">
    <div className={styles.averageHeading}>
      <div>
        <h3>Średnia doba · profil RE</h3>
        <p>Profil godzinowy, nie rzeczywisty dzień pomiarowy.</p>
      </div>
      {months.length > 1 ? <label className={styles.selectLabel}>
        <span className={styles.visuallyHidden}>Miesiąc średniej doby</span>
        <select value={selected.key} onChange={(event) => setMonthKey(event.target.value)}>
          {months.map((month) => <option key={month.key} value={month.key}>{month.label} {month.year}</option>)}
        </select>
      </label> : <span className={styles.averageMonth}>{selected.label} {selected.year}</span>}
    </div>
    <div className={styles.chartScroll}>
    <div className={styles.hourlyChart} role="img" aria-label={`Średnie zużycie godzinowe, ${selected.label} ${selected.year}`}>
      {selected.hourly.map((value, hour) => <div className={styles.hourColumn} key={hour}>
        <span className={styles.hourValue}>{number(value, 1)}</span>
        <div className={styles.hourTrack}><i style={{ height: `${value === 0 ? 0 : Math.max(3, value / maximum * 100)}%` }} /></div>
        <span className={styles.hourLabel}>{String(hour).padStart(2, '0')}</span>
      </div>)}
    </div>
    </div>
  </section>;
}

export default function ClientEnergySummary({
  projectId,
  profile,
  annualConsumptionKwh,
  consumptionSource,
  hasPv,
  invoices,
  refreshKey,
  analysisStartMonth,
  profileLoading = false,
  initialData,
  maskValues = false,
  onLoadStateChange,
}: ClientEnergySummaryProps) {
  const { data, error, loading, status, requestKey } = useEnergyMeasurements(projectId, refreshKey, initialData, analysisStartMonth);
  const [mode, setMode] = useState<'year' | 'day'>('year');
  const [daySelection, setDaySelection] = useState('');
  const [monthSelection, setMonthSelection] = useState('');
  const invoiceSummary = useMemo(() => summarizeClientEnergyInvoices(invoices), [invoices]);
  const measurementMonths = data?.months || [];
  const annualModel = data?.annualModel;
  const displayedAnnualConsumptionKwh = annualModel
    ? annualModel.provenance?.annualConsumptionKwh ?? annualModel.annualConsumptionKwh
    : annualConsumptionKwh;
  const displayedConsumptionSource = annualModel
    ? `MODELLED · ${annualModel.provenance?.source || annualModel.profileSource || 'profil roczny RE'}`
    : consumptionSource || 'Brak potwierdzonego źródła';
  const displayMonths = annualModel ? annualModel.months.map(month => ({
    ...month,
    loadKwh: month.loadKwh,
    importAvailable: annualModel.flowAvailable && month.importKwh != null,
    exportAvailable: annualModel.flowAvailable && month.exportKwh != null,
  })) : measurementMonths.map(month => ({ ...month, loadKwh: null as number | null }));
  const spansCalendarYears = new Set(displayMonths.map((month) => month.period.slice(0, 4))).size > 1;
  const periodMonths = displayMonths.map((monthData) => {
    const measured = annualModel ? null : monthData;
    const [year, month] = monthData.period.split('-').map(Number);
    const profileMonth = profile?.months.find((item) => item.year === year && item.month === month) || null;
    return {
      period: monthData.period,
      label: `${monthShort(month)}${spansCalendarYears ? ` ${String(year).slice(-2)}` : ''}`,
      title: monthLong(monthData.period),
      importKwh: monthData.importKwh,
      exportKwh: monthData.exportKwh,
      loadKwh: annualModel ? monthData.loadKwh : profileLoadForPeriod(profile, monthData.period),
      measured,
      profile: profileMonth,
    };
  });
  const availableDays = annualModel?.days || data?.days || [];
  const dayMonths = [...new Set(availableDays.map(day => day.period))].sort();
  const selectedMonth = dayMonths.includes(monthSelection) ? monthSelection : dayMonths.at(-1) || '';
  const monthDays = availableDays.filter(day => day.period === selectedMonth);
  const selectedDay = monthDays.find((day) => day.date === daySelection) || monthDays.at(-1) || null;
  const annualRows: ChartRow[] = periodMonths.map((month) => ({
    label: month.label,
    title: month.title,
    importKwh: month.importKwh,
    exportKwh: month.exportKwh,
    loadKwh: month.loadKwh,
  }));
  const dayRows: ChartRow[] = (selectedDay?.hours || []).map((hour) => ({
    label: String(hour.hour).padStart(2, '0'),
    title: `${String(hour.hour).padStart(2, '0')}:00–${String(hour.hour + 1).padStart(2, '0')}:00`,
    importKwh: hour.importKwh,
    exportKwh: hour.exportKwh,
    loadKwh: hour.loadKwh ?? null,
  }));
  const kpiImport = displayMonths.some((month) => month.importKwh != null)
    ? displayMonths.reduce((sum, month) => sum + (month.importKwh ?? 0), 0)
    : null;
  const kpiExport = displayMonths.some((month) => month.exportKwh != null)
    ? displayMonths.reduce((sum, month) => sum + (month.exportKwh ?? 0), 0)
    : null;
  const measuredImportMonths = measurementMonths.filter((month) => month.importAvailable).length;
  const measuredExportMonths = measurementMonths.filter((month) => month.exportAvailable).length;
  const hasMeasurements = measurementMonths.some((month) => month.importKwh != null || month.exportKwh != null);
  const hasModelledFlows = annualModel?.flowAvailable === true
    && displayMonths.some((month) => month.importKwh != null || month.exportKwh != null);
  const hasProfileLoad = periodMonths.some((month) => month.loadKwh != null);
  const showAnnualChart = hasMeasurements || hasModelledFlows || hasProfileLoad;
  const periodLabel = displayMonths.length
    ? `${monthLong(displayMonths[0].period)} – ${monthLong(displayMonths[displayMonths.length - 1].period)}`
    : '';
  const averageProfile = profile?.source === 'RE' ? profile : null;
  const issues = useMemo(() => [...new Set([...(data?.issues || []), ...(data?.annualModel?.issues || []), ...(data?.pv?.issues || []), ...(data?.cost?.issues || []), ...(profile?.warnings || [])])], [data?.issues, data?.annualModel?.issues, data?.pv?.issues, data?.cost?.issues, profile?.warnings]);
  const missingMeasurementMonths = measurementMonths.filter((month) => !month.importAvailable || !month.exportAvailable).length;
  const loadWarnings = useMemo(() => {
    if (status !== 'ready') return [];
    const warnings = [...new Set(issues)];
    if (!data?.annualModel && missingMeasurementMonths > 0) warnings.push(`Pomiary poboru lub oddania są niepełne w ${missingMeasurementMonths} z 12 miesięcy.`);
    if (invoiceSummary.overlappingIds.length) warnings.push(`Pominięto ${invoiceSummary.overlappingIds.length} faktur z nakładającymi się okresami.`);
    if (invoiceSummary.invalidPeriodIds.length) warnings.push(`Pominięto ${invoiceSummary.invalidPeriodIds.length} faktur bez prawidłowego okresu.`);
    if (invoiceSummary.missingAmountIds.length) warnings.push(`Pominięto ${invoiceSummary.missingAmountIds.length} faktur bez kwoty brutto.`);
    return warnings;
  }, [status, issues, data?.annualModel, missingMeasurementMonths, invoiceSummary]);
  const loadState = useMemo<ClientEnergySummaryLoadState>(() => ({
    requestKey,
    status,
    ...(status === 'error' ? { error } : {}),
    ...(status === 'ready' ? { warnings: loadWarnings } : {}),
  }), [requestKey, status, error, loadWarnings]);
  const valuesMasked = maskValues || loading || profileLoading;

  useEffect(() => {
    onLoadStateChange?.(loadState);
  }, [onLoadStateChange, loadState]);

  return <section className={styles.summary} aria-busy={valuesMasked}>
    {data && !valuesMasked ? <div className={styles.periodHeader}>
      <span>{annualModel ? 'Okres profilu MODELLED' : 'Okres pomiarów'}</span>
      <strong>{periodLabel || (annualModel ? 'Brak profilu rocznego' : 'Brak danych pomiarowych')}</strong>
    </div> : null}
    <div className={styles.kpis}>
      <article className={styles.kpi}>
        <span>Zużycie energii w obiekcie</span>
        <strong>{valuesMasked ? '—' : Number.isFinite(displayedAnnualConsumptionKwh) && displayedAnnualConsumptionKwh > 0 ? kwh(displayedAnnualConsumptionKwh) : '—'}</strong>
        <small>{valuesMasked ? 'Przeliczanie danych…' : displayedConsumptionSource}</small>
      </article>
      <article className={`${styles.kpi} ${styles.importKpi}`}>
        <span>{annualModel ? 'Modelowany pobór z sieci ↓' : 'Pobrano z sieci ↓'}</span>
        <strong>{valuesMasked ? '—' : kwh(kpiImport)}</strong>
        <small>{valuesMasked ? 'Przeliczanie danych…' : annualModel
          ? annualModel.flowAvailable ? `MODELLED · ${annualModel.provenance?.source || annualModel.profileSource || 'profil roczny RE'}` : annualModel.issues[0] || 'Nie obliczono przepływu sieciowego.'
          : measurementMonths.length ? `${measuredImportMonths}/12 mies. z plikami · bez ekstrapolacji` : 'Brak danych pomiarowych'}</small>
      </article>
      <article className={`${styles.kpi} ${styles.exportKpi}`}>
        <span>{annualModel ? 'Modelowane oddanie do sieci ↑' : 'Oddano do sieci ↑'}</span>
        <strong>{valuesMasked ? '—' : kwh(kpiExport)}</strong>
        <small>{valuesMasked ? 'Przeliczanie danych…' : annualModel
          ? annualModel.flowAvailable ? `MODELLED · ${annualModel.provenance?.source || annualModel.profileSource || 'profil roczny RE'}` : annualModel.issues[0] || 'Nie obliczono przepływu sieciowego.'
          : measurementMonths.length ? `${measuredExportMonths}/12 mies. z plikami · bez ekstrapolacji` : 'Brak danych pomiarowych'}</small>
      </article>
      <article className={`${styles.kpi} ${styles.costKpi}`}>
        <span>Szacowany koszt wg taryfy</span>
        <strong>{valuesMasked ? '—' : money(data?.cost?.totalPln ?? null)}</strong>
        <small>{valuesMasked ? 'Przeliczanie danych…' : data?.cost?.totalPln != null
          ? `${data.cost.source === 'MODELLED' ? 'MODELLED · ' : ''}${data.cost.vatBasis === 'NET' ? 'Netto' : 'Brutto'} · ${data.cost.settled ? 'po rozliczeniu oddania' : hasPv ? 'przed rozliczeniem oddania' : 'energia, dystrybucja i opłaty'}${data.cost.pricedHours < data.cost.totalHours ? ' · niepełny okres' : ''}`
          : data?.cost?.issues[0] || 'Brak danych do wyceny taryfowej'}</small>
      </article>
    </div>

    {!valuesMasked && data?.cost ? <details className={styles.disclosure}>
      <summary><span>Wyliczenie kosztu</span><small>{data.cost.tariffLabels.join(' · ') || 'Taryfa klienta'}</small></summary>
      <div className={styles.tableScroll}>
        <table className={`${styles.invoiceTable} ${styles.costTable}`}>
          <thead><tr><th>Składnik</th><th>{data.cost.vatBasis === 'NET' ? 'Netto' : 'Brutto'}</th></tr></thead>
          <tbody>
            <tr><td>Zakup energii</td><td>{money(data.cost.energyPln)}</td></tr>
            <tr><td>Dystrybucja energii</td><td>{money(data.cost.distributionPln)}</td></tr>
            <tr><td>Opłaty stałe</td><td>{money(data.cost.fixedPln)}</td></tr>
            {data.cost.exportValuePln != null ? <tr><td>Wartość energii oddanej</td><td>{money(data.cost.exportValuePln)}</td></tr> : null}
            {data.cost.settlementBenefitPln != null ? <tr><td>Pokrycie kosztów z opustu / depozytu</td><td>{money(data.cost.settlementBenefitPln)}</td></tr> : null}
            <tr><th>{data.cost.settled ? 'Koszt po rozliczeniu oddania' : hasPv ? 'Koszt poboru przed rozliczeniem oddania' : 'Koszt razem'}</th><th>{money(data.cost.totalPln)}</th></tr>
          </tbody>
        </table>
      </div>
      <p className={styles.emptyInline}>{data.cost.source === 'MODELLED' ? 'MODELLED · profil godzinowy RE. ' : ''}Wyceniono {data.cost.pricedHours}/{data.cost.totalHours} godzin. Szacunek, nie odtworzenie faktury.</p>
      {data.cost.assumptions.length > 0 ? <ul className={styles.issues} aria-label="Założenia wyliczenia kosztu">
        {data.cost.assumptions.map((assumption, index) => <li key={`${index}-${assumption}`}>{assumption}</li>)}
      </ul> : null}
    </details> : null}

    {hasPv ? <div className={styles.pvSummary}>
      <div><span>Instalacja fotowoltaiczna</span><strong>Istniejąca</strong></div>
      <div><span>Produkcja PV</span><strong>{valuesMasked ? '—' : kwh(data?.pv?.productionKwh ?? null)}</strong>
        <small>{valuesMasked ? 'Przeliczanie danych…' : data?.pv?.productionKwh != null
          ? <>{data.pv.modelUrl ? <a href={data.pv.modelUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Szacunek modelu PV</a> : 'Szacunek modelu PV'}, nie pomiar z falownika.</>
          : data?.pv?.note || 'Uzupełnij parametry PV do obliczenia produkcji.'}</small></div>
      <div><span>Autokonsumpcja PV</span><strong>{valuesMasked ? '—' : kwh(data?.pv?.selfConsumptionKwh ?? null)}</strong>
        <small>{valuesMasked ? 'Przeliczanie danych…' : data?.pv?.selfConsumptionKwh != null
          ? annualModel?.flowAvailable
            ? `MODELLED · profil rocznego zużycia RE i model PV${data.pv.coveredHours != null && data.pv.totalHours != null
              ? data.pv.coveredHours < data.pv.totalHours ? ` · ${data.pv.coveredHours}/${data.pv.totalHours} godz.` : ''
              : data.pv.coveredMonths < data.pv.totalMonths ? ` · ${data.pv.coveredMonths}/${data.pv.totalMonths} mies.` : ''}`
            : `Szacunek godzinowy · model PV i pomiary OSD${data.pv.coveredHours != null && data.pv.totalHours != null
            ? data.pv.coveredHours < data.pv.totalHours ? ` · ${data.pv.coveredHours}/${data.pv.totalHours} godz., bez ekstrapolacji` : ''
            : data.pv.coveredMonths < data.pv.totalMonths ? ` · ${data.pv.coveredMonths}/${data.pv.totalMonths} mies., bez ekstrapolacji` : ''}`
          : data?.pv?.note || 'Brak danych do oszacowania autokonsumpcji.'}</small></div>
    </div> : null}

    <div className={styles.chartHeading}>
      <div>
        <h3>Profil energii</h3>
        <p>{mode === 'year'
          ? annualModel ? 'Profil MODELLED · miesięczne wartości wynikające z jawnego zużycia rocznego.' : 'Miesięczne sumy w dostępnym okresie 12 miesięcy.'
          : annualModel ? 'Doba MODELLED · reprezentatywny rozkład godzinowy RE.' : 'Rzeczywiste interwały pomiarowe dla wybranego dnia.'}</p>
      </div>
      <div className={styles.chartControls}>
        <div className={styles.segment} role="group" aria-label="Zakres profilu energii">
          <button type="button" aria-pressed={mode === 'year'} className={mode === 'year' ? styles.active : ''} onClick={() => setMode('year')}>Rok</button>
          <button type="button" aria-pressed={mode === 'day'} className={mode === 'day' ? styles.active : ''} disabled={!availableDays.length} onClick={() => setMode('day')}>{annualModel ? 'Doba modelowa' : 'Dzień'}</button>
        </div>
      </div>
    </div>

    {mode === 'day' && availableDays.length > 0 ? <div className={styles.dayControls}>
      <label className={styles.selectLabel}>
        <span className={styles.visuallyHidden}>{annualModel ? 'Miesiąc profilu modelowego' : 'Miesiąc pomiaru'}</span>
        <select aria-label={annualModel ? 'Miesiąc profilu modelowego' : 'Miesiąc pomiaru'} value={selectedMonth} onChange={event => { setMonthSelection(event.target.value); setDaySelection(''); }}>
          {dayMonths.map(period => <option key={period} value={period}>{monthLong(period)}</option>)}
        </select>
      </label>
      <label className={styles.selectLabel}>
        <span className={styles.visuallyHidden}>{annualModel ? 'Dzień profilu modelowego' : 'Dzień pomiaru'}</span>
        <select aria-label={annualModel ? 'Dzień profilu modelowego' : 'Dzień pomiaru'} value={selectedDay?.date || ''} onChange={(event) => setDaySelection(event.target.value)}>
          {monthDays.map((day) => <option key={day.date} value={day.date}>{day.date}</option>)}
        </select>
      </label>
    </div> : null}

    {error ? <p className={styles.error} role="alert">Nie udało się odczytać pomiarów: {error}</p> : null}
    {valuesMasked ? <p className={styles.empty}>Proszę czekać – przeliczam dane.</p> : mode === 'day'
      ? selectedDay ? <EnergyChart rows={dayRows} annual={false} label={`${annualModel ? 'MODELLED · profil godzinowy RE' : 'Rzeczywiste pomiary energii'}, ${selectedDay.date}`} />
        : <p className={styles.empty}>{annualModel ? 'Brak reprezentatywnej doby modelowej w tym okresie.' : 'Brak pełnego dnia pomiarowego w tym okresie.'}</p>
      : showAnnualChart ? <EnergyChart
        rows={annualRows}
        annual
        label={annualModel ? `MODELLED · profil roczny RE: ${periodLabel}` : hasMeasurements ? `Pobór i oddanie energii: ${periodLabel}` : `Zużycie z profilu: ${periodLabel}`}
      />
        : <p className={styles.empty}>{annualModel ? 'Brak rocznego profilu MODELLED do wyświetlenia.' : 'Brak pomiarów poboru i oddania w tym okresie. Profil zużycia nie zastępuje pomiarów sieciowych.'}</p>}

    {!valuesMasked ? <div className={styles.legend}>
      {hasMeasurements || hasModelledFlows ? <>
        <span><i className={styles.importDot} />{annualModel ? 'MODELLED · pobór z sieci ↓' : 'Pobór z sieci ↓'}</span>
        <span><i className={styles.exportDot} />{annualModel ? 'MODELLED · oddanie do sieci ↑' : 'Oddanie do sieci ↑'}</span>
      </> : null}
      {annualRows.some((row) => row.loadKwh != null) ? <span><i className={styles.loadMark} />{annualModel ? 'MODELLED · zużycie roczne · profil RE' : profile?.source === 'RE' ? 'Szacowane zużycie budynku · profil RE' : 'Zużycie z profilu'}</span> : null}
    </div> : null}

    {!valuesMasked && averageProfile ? <AverageDay profile={averageProfile} /> : null}

    {!valuesMasked && issues.length > 0 ? <ul className={styles.issues} aria-label="Uwagi do danych">
      {issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
    </ul> : null}

    {!valuesMasked ? <details className={styles.disclosure}>
      <summary><span>Szczegóły miesięczne</span><small>{annualModel ? 'MODELLED · profil godzinowy RE' : 'Źródło, pomiary i faktury'}</small></summary>
      <div className={styles.tableScroll}>
        <table className={styles.monthTable}>
          <thead><tr><th>Miesiąc</th><th>{annualModel ? 'Modelowany pobór ↓' : 'Pobrano ↓'}</th><th>{annualModel ? 'Modelowane oddanie ↑' : 'Oddano ↑'}</th><th>{annualModel ? 'Zużycie MODELLED' : 'Zużycie z profilu'}</th><th>Źródło</th></tr></thead>
          <tbody>{periodMonths.map((month) => {
            const profileSource = month.profile ? `${clientEnergyProfileSourceLabel(month.profile.importSource, 'import')} · ${clientEnergyProfileSourceLabel(month.profile.exportSource, 'export')}` : '—';
            const measurementSource = annualModel
              ? `MODELLED · ${annualModel.provenance?.source || annualModel.profileSource || 'profil godzinowy RE'}`
              : month.measured && (month.measured.importAvailable || month.measured.exportAvailable)
              ? `ENEA${month.measured.importAvailable ? ' · ↓' : ''}${month.measured.exportAvailable ? ' · ↑' : ''}`
              : '—';
            return <tr key={month.period}>
              <td>{monthLong(month.period)}</td>
              <td>{kwh(month.importKwh, 1)}</td>
              <td>{kwh(month.exportKwh, 1)}</td>
              <td>{kwh(month.loadKwh, 1)}</td>
              <td><span>{measurementSource}</span>{month.profile ? <small>Profil: {profileSource}</small> : null}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <h4>Faktury za dokładny okres</h4>
      {invoiceSummary.included.length ? <div className={styles.tableScroll}>
        <table className={styles.invoiceTable}>
          <thead><tr><th>Numer</th><th>Okres</th><th>Brutto</th></tr></thead>
          <tbody>{invoiceSummary.included.map((invoice) => <tr key={invoice.id}>
            <td>{invoice.invoiceNumber}</td><td>{invoice.periodFrom}–{invoice.periodTo}</td><td>{money(invoice.amountGross)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className={styles.emptyInline}>Brak faktur z niepokrywającym się okresem i kwotą brutto.</p>}
      {invoiceSummary.overlappingIds.length ? <p className={styles.warning}>Pominięto {invoiceSummary.overlappingIds.length} faktur z nakładającymi się okresami. Kwot tych dokumentów nie zsumowano.</p> : null}
      {invoiceSummary.invalidPeriodIds.length ? <p className={styles.warning}>Pominięto {invoiceSummary.invalidPeriodIds.length} faktur bez prawidłowego okresu rozliczeniowego.</p> : null}
      {invoiceSummary.missingAmountIds.length ? <p className={styles.warning}>Pominięto {invoiceSummary.missingAmountIds.length} faktur bez kwoty brutto.</p> : null}
    </details> : null}
  </section>;
}
