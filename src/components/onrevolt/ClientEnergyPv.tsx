'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdRefresh } from 'react-icons/md';
import styles from './ClientEnergyWorkspace.module.css';

type Geometry = { tiltDegrees: string; azimuthDegrees: string; lossPercent: string };
type PvSource = {
  existingPv: { powerKw: number | null; tiltDegrees: number | null; azimuthDegrees: number | null; lossPercent: number | null };
  latitude: number | null; longitude: number | null; revision: number;
};
type Estimate = { annualKwh: number; source: string; model: string; fromUtc: string; untilUtc: string; latitude: number; longitude: number };
const blank: Geometry = { tiltDegrees: '', azimuthDegrees: '', lossPercent: '' };
const string = (value: number | null) => value == null ? '' : String(value);
const number = (value: string) => value.trim() === '' ? null : Number(value);

export function useClientEnergyPv(projectId: string, power: string, onPowerLoaded: (value: string) => void, enabled: boolean, analysisStartMonth?: string) {
  const [source, setSource] = useState<(PvSource & { projectId: string }) | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(blank);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [estimate, setEstimate] = useState<{ key: string; data?: Estimate; error?: string } | null>(null);
  const [calculating, setCalculating] = useState(false);
  const loadedCallback = useRef(onPowerLoaded);
  loadedCallback.current = onPowerLoaded;
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const activeSource = source?.projectId === projectId ? source : null;
  const values = { powerKw: number(power), tiltDegrees: number(geometry.tiltDegrees), azimuthDegrees: number(geometry.azimuthDegrees), lossPercent: number(geometry.lossPercent) };
  const dirty = !!activeSource && JSON.stringify(values) !== JSON.stringify(activeSource.existingPv);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  const discardChanges = useCallback(() => {
    if (!window.confirm('Odrzucić niezapisane zmiany PV i wczytać parametry zapisane w ofercie?')) return;
    dirtyRef.current = false;
    setSource(null);
    setRefresh(value => value + 1);
  }, []);

  useEffect(() => {
    if (!projectId || !enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetch(`/api/projects/${projectId}/pv-profile`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się odczytać parametrów PV.');
        if (controller.signal.aborted) return;
        const data: PvSource = payload.data;
        if (dirtyRef.current) {
          setSource(previous => previous?.projectId === projectId
            ? { ...previous, latitude: data.latitude, longitude: data.longitude } : previous);
          return;
        }
        setSource({ ...data, projectId });
        setGeometry({ tiltDegrees: string(data.existingPv.tiltDegrees), azimuthDegrees: string(data.existingPv.azimuthDegrees), lossPercent: string(data.existingPv.lossPercent) });
        loadedCallback.current(string(data.existingPv.powerKw));
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, enabled, refresh]);

  const key = JSON.stringify([projectId, analysisStartMonth, activeSource?.latitude, activeSource?.longitude, values]);
  const complete = !!activeSource && activeSource.latitude != null && activeSource.longitude != null
    && Object.values(values).every(value => value != null && Number.isFinite(value));
  useEffect(() => {
    setCalculating(false);
    if (!enabled || !complete || loading || error || !values.powerKw || values.powerKw < 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCalculating(true);
      void fetch(`/api/projects/${projectId}/pv-profile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ existingPv: values }),
      }).then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się obliczyć produkcji PV.');
        if (analysisStartMonth && payload.data.period?.startMonth !== analysisStartMonth) {
          throw new Error('Okres zmienił się w innej karcie. Odśwież okres analizy.');
        }
        if (payload.data.latitude !== activeSource?.latitude || payload.data.longitude !== activeSource?.longitude) {
          throw new Error('Lokalizacja inwestycji zmieniła się. Odśwież współrzędne przed obliczeniami.');
        }
        if (!controller.signal.aborted) setEstimate({ key, data: payload.data });
      }).catch(reason => {
        if (!controller.signal.aborted) setEstimate({ key, error: reason instanceof Error ? reason.message : String(reason) });
      }).finally(() => { if (!controller.signal.aborted) setCalculating(false); });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
    // The key includes all model inputs; edits invalidate the previous displayed estimate immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, complete, enabled, loading, error]);

  function saveSettings() {
    if (!enabled) return undefined;
    if (loading || !activeSource || error) throw new Error(error || 'Poczekaj na odczyt parametrów PV.');
    return dirty ? { ...geometry, tiltDegrees: values.tiltDegrees, azimuthDegrees: values.azimuthDegrees,
      lossPercent: values.lossPercent, expectedRevision: activeSource.revision } : undefined;
  }
  function saved(revision: number | undefined) {
    if (revision == null || currentProject.current !== projectId) return;
    setSource(previous => previous?.projectId === projectId ? { ...previous, revision, existingPv: values } : previous);
  }
  return { source: activeSource, geometry, setGeometry, loading, error, reload, discardChanges, saveSettings, saved,
    estimate: estimate?.key === key ? estimate : null, calculating, complete, dirty };
}

export default function ClientEnergyPv({ state, power, onPowerChange, disabled = false }: {
  state: ReturnType<typeof useClientEnergyPv>; power: string; onPowerChange: (value: string) => void; disabled?: boolean;
}) {
  const geometryField = (label: string, name: keyof Geometry, max: number) => <label className={styles.field}>
    <span>{label}</span><input type="number" min="0" max={max} step="0.1" value={state.geometry[name]}
      disabled={disabled || state.loading || !!state.error || !state.source} onChange={event => state.setGeometry(current => ({ ...current, [name]: event.target.value }))} />
  </label>;
  const missing = [state.source?.latitude == null || state.source?.longitude == null ? 'współrzędne w Danych klienta' : '',
    !power ? 'moc PV' : '', !state.geometry.tiltDegrees ? 'nachylenie' : '', !state.geometry.azimuthDegrees ? 'azymut' : '',
    !state.geometry.lossPercent ? 'straty PV' : ''].filter(Boolean);
  const modelParams = { lat: state.source?.latitude, lon: state.source?.longitude,
    capacityKwp: number(power), tilt: number(state.geometry.tiltDegrees),
    azimuth: number(state.geometry.azimuthDegrees), lossPercent: number(state.geometry.lossPercent) };
  const modelUrl = Object.values(modelParams).every(value => value != null && Number.isFinite(value))
    ? `https://my.onrevolt.com/pv/?${new URLSearchParams({ mode: 'manual', layout: 'single',
      ...Object.fromEntries(Object.entries(modelParams).map(([key, value]) => [key, String(value)])) })}`
    : null;
  return <div aria-label="Parametry produkcji PV">
    <div className={styles.pvGrid}>
      <label className={styles.field}><span>Moc istniejącej instalacji PV [kWp]</span>
        <input type="number" min="0" step="0.001" value={power} disabled={disabled || state.loading || !!state.error || !state.source} onChange={event => onPowerChange(event.target.value)} /></label>
      {geometryField('Nachylenie paneli [°]', 'tiltDegrees', 90)}
      {geometryField('Azymut paneli [°]', 'azimuthDegrees', 360)}
      {geometryField('Założone straty PV [%]', 'lossPercent', 99)}
    </div>
    <div className={styles.grid3}>
      <label className={styles.field}><span>Lat · szerokość geograficzna</span><input readOnly value={state.source?.latitude ?? ''} placeholder="Brak współrzędnych" /></label>
      <label className={styles.field}><span>Lon · długość geograficzna</span><input readOnly value={state.source?.longitude ?? ''} placeholder="Brak współrzędnych" /></label>
      <div className={styles.field}><span>Roczna produkcja PV [kWh]</span><output className={styles.readOnlyValue} aria-live="polite">
        {state.loading ? 'Odczytywanie parametrów…' : state.calculating ? 'Obliczanie…' : state.estimate?.data
          ? state.estimate.data.annualKwh.toLocaleString('pl-PL', { maximumFractionDigits: 0 }) : '—'}
      </output><small>{modelUrl
        ? <a href={modelUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Szacunek modelu PV</a>
        : 'Szacunek modelu PV'}, nie pomiar z falownika.</small></div>
    </div>
    {state.error && <p role="alert" className={styles.pvMessage}>{state.error} <button type="button" onClick={state.reload} aria-label="Ponów odczyt parametrów PV" title="Ponów odczyt"><MdRefresh /></button></p>}
    {!state.loading && !state.error && missing.length > 0 && <p className={styles.pvMessage}>Uzupełnij: {missing.join(', ')}.</p>}
    {state.estimate?.error && <p role="alert" className={styles.pvMessage}>{state.estimate.error} <button type="button" onClick={state.reload} aria-label="Odśwież parametry i oblicz PV" title="Odśwież parametry i oblicz PV"><MdRefresh /></button></p>}
    {state.dirty && <button type="button" className={styles.pvMessage} disabled={disabled || state.loading} onClick={state.discardChanges}>Odrzuć zmiany PV i wczytaj zapisane</button>}
  </div>;
}
