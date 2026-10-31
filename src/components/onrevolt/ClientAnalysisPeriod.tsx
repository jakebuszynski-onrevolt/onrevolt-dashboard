'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdRefresh } from 'react-icons/md';
import { resolveProjectAnalysisPeriod, type ProjectAnalysisPeriod } from 'lib/onrevolt/project-analysis-period';
import styles from './ClientEnergyWorkspace.module.css';

type PeriodSource = { projectId: string; storedStartMonth: string | null; period: ProjectAnalysisPeriod };

export function useClientAnalysisPeriod(projectId: string) {
  const [source, setSource] = useState<PeriodSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const saveRequest = useRef(0);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const activeSource = source?.projectId === projectId ? source : null;
  const reload = useCallback(() => setRefresh(value => value + 1), []);

  useEffect(() => {
    const request = ++generation.current;
    const controller = new AbortController();
    setSource(null);
    setError('');
    setSaving(false);
    saveRequest.current = 0;
    setLoading(!!projectId);
    if (!projectId) return;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/analysis-period`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się odczytać okresu analizy.');
      if (!controller.signal.aborted && request === generation.current) setSource({ ...payload.data, projectId });
    }).catch(reason => {
      if (!controller.signal.aborted && request === generation.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!controller.signal.aborted && request === generation.current) setLoading(false);
    });
    return () => controller.abort();
  }, [projectId, refresh]);

  async function change(startMonth: string) {
    if (!activeSource || saveRequest.current || saving || loading || startMonth === activeSource.storedStartMonth) return;
    try { resolveProjectAnalysisPeriod(startMonth); } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const request = ++generation.current;
    saveRequest.current = request;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/analysis-period`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startMonth, expectedStartMonth: activeSource.storedStartMonth }),
      });
      const payload = await response.json();
      if (request !== generation.current || currentProject.current !== projectId) return;
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się zapisać okresu analizy.');
      setSource({ ...payload.data, projectId });
    } catch (reason) {
      if (request === generation.current && currentProject.current === projectId) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (saveRequest.current === request) saveRequest.current = 0;
      if (request === generation.current && currentProject.current === projectId) setSaving(false);
    }
  }
  return { source: activeSource, period: activeSource?.period, loading, saving, error, reload, change };
}

export default function ClientAnalysisPeriod({ state, disabled = false, onPendingChange }: {
  state: ReturnType<typeof useClientAnalysisPeriod>; disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const startMonth = state.period?.startMonth || '';
  const [input, setInput] = useState(startMonth);
  const changeRef = useRef(state.change);
  changeRef.current = state.change;
  let validInput = false;
  try { resolveProjectAnalysisPeriod(input); validInput = true; } catch { /* A month field can be incomplete while typing the year. */ }
  const pending = validInput && input !== startMonth;
  useEffect(() => setInput(startMonth), [startMonth]);
  useEffect(() => { if (!state.saving && state.error) setInput(startMonth); }, [state.error, state.saving, startMonth]);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => {
    if (!pending || disabled || state.loading || state.saving || !state.source) return;
    const timer = setTimeout(() => { void changeRef.current(input); }, 450);
    return () => clearTimeout(timer);
  }, [input, pending, disabled, state.loading, state.saving, state.source]);
  return <div className={styles.analysisPeriod}>
    <div className={styles.toolbar}>
      <label className={styles.field}><span>Początek analizowanego okresu</span>
        <input type="month" min="2000-01" max={resolveProjectAnalysisPeriod().startMonth}
          value={input} disabled={disabled || state.loading || state.saving || !state.source}
          onChange={event => { setInput(event.target.value); }}
          onBlur={() => {
            if (!input) { setInput(startMonth); return; }
            if (input !== startMonth || state.source?.storedStartMonth === null) void state.change(input);
          }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
      </label>
      <span aria-live="polite">{state.loading ? 'Odczytywanie okresu…' : state.saving || pending ? 'Zmieniam okres analizy…'
        : state.period ? `12 miesięcy · do ${state.period.endDate}` : 'Brak okresu analizy'}</span>
    </div>
    {state.error && <p role="alert" className={styles.periodError}>{state.error}
      <button type="button" onClick={state.reload} disabled={state.saving} aria-label="Odśwież okres analizy" title="Odśwież okres analizy"><MdRefresh /></button>
    </p>}
  </div>;
}
