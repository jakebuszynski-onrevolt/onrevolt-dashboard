'use client';

import * as React from 'react';
import { LightMode } from '@chakra-ui/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MdArrowForward, MdCheck, MdSave, MdShowChart, MdReceiptLong } from 'react-icons/md';
import {
  buildingTypeOptions, connectionTypeOptions, energySupplierOptions,
  getHeatSourceDetailOptions, heatSourceOptions, roofShapeOptions,
  settlementSystemOptions, terrainTypeOptions, type EnergyIntakeOption,
} from 'lib/onrevolt/energy-intake';
import styles from './ClientEnergyWorkspace.module.css';
import ReferenceProfileComparison, { type ReferenceProfileSelectionData } from './ReferenceProfileComparison';

export type EnergyWorkspaceSettings = {
  hasOperatorData: boolean; hasEnergyInvoices: boolean; annualConsumptionKwh: string;
  terrainType: string; buildingType: string; roofShape: string; settlementSystem: string;
  energySupplier: string; connectionType: string; heatingSource: string;
  heatingSourceDetail: string; connectionPowerKw: string; existingPvKw: string;
  existingBatteryKwh: string; phaseCount: string;
};

type Props = {
  projectId?: string;
  onReferenceProfileSaved?: (data: ReferenceProfileSelectionData) => void;
  onAnnualConsumptionReload?: (data: ReferenceProfileSelectionData) => void;
  settings: EnergyWorkspaceSettings;
  onChange: (key: keyof EnergyWorkspaceSettings, value: string | boolean) => void;
  operator: string; tariff: string;
  onAccountChange: (key: 'operator' | 'tariff', value: string) => void;
  catalog: Array<{ code: string; label: string; tariffs: Array<{ code: string; label: string }> }>;
  catalogLoading: boolean; hasTariffHistory: boolean; tariffSummary: ReactNode;
  range: string; measurementMonths: number; invoiceCount: number;
  analysisPeriod?: ReactNode; periodBusy?: boolean;
  annualKwh: number; annualSource: string; manualAnnualVisible: boolean;
  measurements: ReactNode; invoices: ReactNode; summary: ReactNode;
  measurementUpload?: ReactNode;
  alerts?: ReactNode; sourceAlerts?: ReactNode; sourceActions?: ReactNode;
  pvFields?: ReactNode;
  pvDisabled?: boolean;
  saving: boolean; onSave: () => void; onPrepareOffer?: () => void;
};

const sections = [
  ['object', 'Obiekt', 'Budynek, ogrzewanie i PV'],
  ['electricity', 'Rozliczenia', 'Taryfa i przyłącze'],
  ['sources', 'Źródła danych', 'Pomiary, faktury i portal'],
  ['summary', 'Podsumowanie', 'Energia i roczny rachunek'],
] as const;

export function EnergySectionHeading({ number, title, subtitle }: { number: number; title: string; subtitle: string }) {
  return <header className={styles.sectionHeading}><span>{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}

export default function ClientEnergyWorkspace(props: Props) {
  const id = useId().replace(/:/g, '');
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState('object');
  const [pvExpanded, setPvExpanded] = useState(Number(props.settings.existingPvKw) > 0);
  const [profilesExpanded, setProfilesExpanded] = useState(false);
  const s = props.settings;
  useEffect(() => { if (Number(s.existingPvKw) > 0) setPvExpanded(true); }, [s.existingPvKw]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.getAttribute('data-energy-section') || 'object');
    }, { rootMargin: '-10% 0px -65% 0px' });
    root.current?.querySelectorAll('[data-energy-section]').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const select = (label: string, key: keyof EnergyWorkspaceSettings, options: EnergyIntakeOption[]) => (
    <label className={styles.field} htmlFor={`${id}-${key}`}><span>{label}</span>
      <select id={`${id}-${key}`} value={String(s[key])} onChange={event => props.onChange(key, event.target.value)}>
        <option value="">Nie określono</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
  const numeric = (label: string, key: keyof EnergyWorkspaceSettings, step = '0.1') => (
    <label className={styles.field} htmlFor={`${id}-${key}`}><span>{label}</span>
      <input id={`${id}-${key}`} type="number" min="0" step={step} value={String(s[key])}
        onChange={event => props.onChange(key, event.target.value)} />
    </label>
  );
  const annualField = <><div className={styles.manualFields}>
    {numeric('Roczne zużycie przyjęte do obliczeń [kWh]', 'annualConsumptionKwh', '1')}
    <div className={styles.accepted}><small>Źródło przyjęte do obliczeń</small><strong>{props.annualKwh > 0 ? `${props.annualKwh.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} kWh/rok` : 'Do uzupełnienia'}</strong><small>{props.annualSource}</small></div>
  </div>
    <label className={styles.check}><input type="checkbox" checked={profilesExpanded}
      onChange={event => setProfilesExpanded(event.target.checked)} aria-expanded={profilesExpanded}
      aria-controls={`${id}-reference-profiles`} />Porównaj profile zużycia</label>
    {profilesExpanded && <div id={`${id}-reference-profiles`}><ReferenceProfileComparison
      annualKwh={Number(s.annualConsumptionKwh)} projectId={props.projectId}
      onReferenceProfileSaved={props.onReferenceProfileSaved} onAnnualConsumptionReload={props.onAnnualConsumptionReload} /></div>}
  </>;
  const tariffs = props.catalog.find(item => item.code === props.operator)?.tariffs || [];
  return <LightMode><div className={styles.workspace} ref={root}>
    <div className={styles.heading}><div><h2>Dane energetyczne</h2><p>Obiekt, dokumenty i profil zużycia</p></div>
      <button type="button" className={styles.primary} onClick={props.onSave} disabled={props.saving}><MdSave />{props.saving ? 'Zapisywanie…' : 'Zapisz dane'}</button>
    </div>
    {props.alerts}
    {props.analysisPeriod || <div className={styles.toolbar}><div><small>Analizowany okres pomiarów</small><strong>{props.range || 'Brak pomiarów'}</strong></div><span>12 zamkniętych miesięcy</span></div>}
    <fieldset className={styles.flow} disabled={props.periodBusy}>
      <aside className={styles.navigation} aria-label="Sekcje danych energetycznych">
        <h3>Dane do oferty</h3><p>Obiekt i profil zużycia</p>
        <nav>{sections.map(([key, title, subtitle], index) => <a key={key} href={`#${id}-${key}`} aria-current={active === key ? 'location' : undefined}
          onClick={event => { event.preventDefault(); setActive(key); document.getElementById(`${id}-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <span className={styles.number}>{index + 1}</span><span>{title}<small>{subtitle}</small></span>
        </a>)}</nav>
        <div className={styles.readiness}><small>Dostępność danych</small><strong>{props.measurementMonths}/12 <span>miesięcy z danymi poboru</span></strong><strong>{props.invoiceCount} <span>faktur z rozpoznanym zużyciem</span></strong></div>
      </aside>
      <div className={styles.content}>
        <section className={styles.section} id={`${id}-object`} data-energy-section="object">
          <EnergySectionHeading number={1} title="Dane obiektu" subtitle="Informacje potrzebne do doboru rozwiązania." />
          <div className={styles.grid3}>
            {select('Typ budynku', 'buildingType', buildingTypeOptions)}
            {select('Rodzaj terenu', 'terrainType', terrainTypeOptions)}
            {select('Rodzaj dachu', 'roofShape', roofShapeOptions)}
          </div>
          <div className={styles.grid2}>
            {select('Źródło ciepła', 'heatingSource', heatSourceOptions)}
            {select('Rodzaj źródła ciepła', 'heatingSourceDetail', getHeatSourceDetailOptions(s.heatingSource))}
          </div>
          <div className={styles.pv}>
            <label className={styles.check}><input type="checkbox" checked={pvExpanded} disabled={props.pvDisabled} onChange={event => { setPvExpanded(event.target.checked); if (!event.target.checked) props.onChange('existingPvKw', '0'); }} />Obiekt ma instalację fotowoltaiczną</label>
            {pvExpanded && (props.pvFields || <div className={styles.grid2}>
              {numeric('Moc istniejącej instalacji PV [kWp]', 'existingPvKw', '0.001')}
              <div className={styles.field}><span>Roczna produkcja PV [kWh]</span><output className={styles.readOnlyValue}>Brak pomiarów produkcji</output></div>
            </div>)}
            {!pvExpanded && s.existingPvKw === '' && <div className={styles.unknownPv}><span>Nie potwierdzono, czy obiekt ma PV.</span><button type="button" disabled={props.pvDisabled} onClick={() => props.onChange('existingPvKw', '0')}>Potwierdź brak PV</button></div>}
            <details className={styles.disclosure}><summary>Istniejący magazyn energii</summary><div className={styles.grid2}>
              {numeric('Pojemność istniejącego magazynu [kWh]', 'existingBatteryKwh', '0.1')}
              <div className={styles.field}><span>Puste pole lub 0 kWh oznacza brak istniejącego magazynu energii.</span></div>
            </div></details>
          </div>
        </section>
        <section className={styles.section} id={`${id}-electricity`} data-energy-section="electricity">
          <EnergySectionHeading number={2} title="Energia elektryczna" subtitle="Obecne warunki rozliczenia i przyłączenia." />
          {!props.hasTariffHistory && <>
            <div className={styles.grid3}>
              <label className={styles.field}><span>Operator sieci (OSD)</span><select aria-label="Operator sieci (OSD)" value={props.operator} disabled={props.catalogLoading || !props.catalog.length} onChange={event => props.onAccountChange('operator', event.target.value)}>
                {!props.catalog.some(item => item.code === props.operator) && <option value={props.operator}>{props.operator || 'Nie określono'}</option>}
                {props.catalog.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
              {select('Sprzedawca energii', 'energySupplier', energySupplierOptions)}
              <label className={styles.field}><span>Aktualna taryfa</span><select aria-label="Aktualna taryfa" value={props.tariff} disabled={props.catalogLoading || !tariffs.length} onChange={event => props.onAccountChange('tariff', event.target.value)}>
                {!tariffs.some(item => item.code === props.tariff) && <option value={props.tariff}>{props.tariff || 'Nie określono'}</option>}
                {tariffs.map(item => <option key={item.code} value={item.code}>{item.label || item.code}</option>)}</select></label>
            </div>
          </>}
          <details className={styles.disclosure} open={props.hasTariffHistory || undefined}><summary>Historia i indywidualne warunki taryfy</summary>{props.tariffSummary}</details>
          <div className={styles.grid3}>
            {select('System rozliczeniowy', 'settlementSystem', settlementSystemOptions)}
            {select('Rodzaj przyłącza', 'connectionType', connectionTypeOptions)}
            {numeric('Moc przyłączeniowa [kW]', 'connectionPowerKw')}
          </div>
          <details className={styles.disclosure}><summary>Dodatkowe parametry przyłącza</summary><div className={styles.grid2}>
            {select('Liczba faz', 'phaseCount', [{ value: '1', label: 'Jednofazowe' }, { value: '3', label: 'Trójfazowe' }])}
            {props.hasTariffHistory && select('Sprzedawca energii', 'energySupplier', energySupplierOptions)}
          </div></details>
        </section>
        <section className={styles.section} id={`${id}-sources`} data-energy-section="sources">
          <EnergySectionHeading number={3} title="Źródła danych" subtitle="Pomiary operatora i faktury za energię." />
          <div className={styles.sourceChoices}>
            <label className={s.hasOperatorData ? styles.selectedChoice : styles.sourceChoice}><input type="checkbox" checked={s.hasOperatorData} onChange={event => props.onChange('hasOperatorData', event.target.checked)} /><span><b>Mam dane pomiarowe</b><small>Profil poboru i oddania z licznika lub portalu OSD.</small></span><MdShowChart /></label>
            <label className={s.hasEnergyInvoices ? styles.selectedChoice : styles.sourceChoice}><input type="checkbox" checked={s.hasEnergyInvoices} onChange={event => props.onChange('hasEnergyInvoices', event.target.checked)} /><span><b>Mam faktury za energię</b><small>Zużycie i koszty z okresów rozliczeniowych.</small></span><MdReceiptLong /></label>
          </div>
          {props.sourceAlerts}
          {props.measurementUpload}
          {s.hasOperatorData && <div className={styles.sourcePanel}>{props.measurements}</div>}
          {s.hasEnergyInvoices && <div className={styles.sourcePanel}>{props.invoices}</div>}
          {props.manualAnnualVisible ? <div className={styles.sourcePanel}><h3>Deklaracja klienta</h3>{annualField}</div>
            : <details className={styles.disclosure}><summary>Deklarowane zużycie roczne</summary>{annualField}</details>}
          {props.sourceActions}
        </section>
        <section className={styles.section} id={`${id}-summary`} data-energy-section="summary">
          <EnergySectionHeading number={4} title="Podsumowanie danych" subtitle="Wartości przyjęte do przygotowania oferty." />
          {props.summary}
        </section>
        <footer className={styles.footer}><span><MdCheck />{props.annualSource}</span><div>
          <button type="button" onClick={props.onSave} disabled={props.saving}><MdSave />Zapisz dane</button>
          {props.onPrepareOffer && <button type="button" className={styles.primary} disabled={props.saving} onClick={props.onPrepareOffer}>Przygotuj ofertę <MdArrowForward /></button>}
        </div></footer>
      </div>
    </fieldset>
  </div></LightMode>;
}
