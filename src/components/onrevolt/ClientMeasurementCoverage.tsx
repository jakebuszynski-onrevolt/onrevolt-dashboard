import * as React from 'react';

export type MeasurementCoverageFile = {
  kind: string;
  status: string;
  periodYear: number;
  periodMonth: number;
  targetPeriod: string;
  dataSource?: string | null;
};

export function measurementCoverageRows(files: readonly MeasurementCoverageFile[], periods: readonly string[]) {
  return periods.map(period => {
    const source = (kind: string) => files.find(file => file.targetPeriod === period
      && file.kind === kind && file.status === 'DOWNLOADED');
    return { period, importFile: source('ACTIVE_IMPORT'), exportFile: source('ACTIVE_EXPORT') };
  });
}

function provenance(file: MeasurementCoverageFile | undefined, period: string) {
  if (!file) return null;
  const reused = file.periodYear !== Number(period.slice(0, 4));
  const modelled = Boolean(file.dataSource?.includes('Model CRM'));
  if (!reused && !modelled) return null;
  return {
    label: [reused ? `dane ${file.periodYear}` : '', modelled ? 'uzupełniono szacunkiem' : ''].filter(Boolean).join(' · '),
    title: [reused ? `Dostępny plik z ${file.periodYear}-${String(file.periodMonth).padStart(2, '0')} dla miesiąca ${period}. Przy wykorzystaniu dane są dopasowywane do kalendarza; nie są pomiarem z roku analizy.` : '',
      modelled ? file.dataSource : ''].filter(Boolean).join(' '),
  };
}

export default function ClientMeasurementCoverage({ rows }: { rows: ReturnType<typeof measurementCoverageRows> }) {
  return <div className="energy-coverage">{rows.map(row => {
    const importNote = provenance(row.importFile, row.period);
    const exportNote = provenance(row.exportFile, row.period);
    const sharedNote = importNote && exportNote && importNote.label === exportNote.label;
    return <div className="energy-coverage-item" data-ready={Boolean(row.importFile)}
      data-estimated={Boolean(importNote || exportNote)} key={row.period}>
      <span>{row.period.slice(5)}.{row.period.slice(0, 4)}</span>
      <strong>{row.importFile ? 'Pobór dostępny' : 'Brak poboru'}</strong>
      <small>{row.exportFile ? 'Oddanie dostępne' : 'Brak oddania'}</small>
      {sharedNote ? <span className="energy-coverage-note" title={importNote.title}>{importNote.label}</span> : <>
        {importNote && <span className="energy-coverage-note" title={importNote.title}>Pobór: {importNote.label}</span>}
        {exportNote && <span className="energy-coverage-note" title={exportNote.title}>Oddanie: {exportNote.label}</span>}
      </>}
    </div>;
  })}</div>;
}
