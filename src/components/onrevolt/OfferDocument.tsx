'use client';

import { buildOfferReport, monthNames } from 'lib/onrevolt/offer-report';

type OfferDocumentProps = {
  offer: any;
  compact?: boolean;
  showActions?: boolean;
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, digits = 0) {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numberValue(value));
}

function quantity(value: unknown) {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(numberValue(value));
}

function dateLabel(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pl-PL').format(date) : '-';
}

function valueOrMissing(value: unknown, suffix = '') {
  return value == null || value === '' ? 'Brak danych' : `${value}${suffix}`;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + numberValue(value), 0);
}

function Brand({ mode = 'Reform' }: { mode?: 'Report' | 'Reform' | 'Review' }) {
  return (
    <div className="re-brand" aria-label={`${mode} dostarczone przez onRevolt`}>
      <strong><span>Re:</span>{mode.slice(2)}</strong>
      <small>dostarczone przez on<span>Re:</span>volt</small>
    </div>
  );
}

function TitleStrip({ children, number }: { children: React.ReactNode; number: string }) {
  return (
    <div className="re-title-strip">
      <strong>{children}</strong>
      <strong>NR {number}</strong>
    </div>
  );
}

function DataField({ label, value, suffix = '' }: { label: string; value?: unknown; suffix?: string }) {
  return (
    <div className="re-field">
      <span>{label}</span>
      <strong>{valueOrMissing(value, suffix)}</strong>
    </div>
  );
}

function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`re-panel ${className}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

function MoneyValue({ value, label }: { value: number; label: string }) {
  return <span>{money(value, Math.abs(value) < 100 ? 2 : 0)} <em>{label}</em></span>;
}

function SavingsPanel({ report, extended = false }: { report: ReturnType<typeof buildOfferReport>; extended?: boolean }) {
  const priceLabel = `PLN ${report.costs.priceLabel}`;
  const current = report.savings.currentBill;
  const projected = report.savings.projectedBill;
  const max = Math.max(current, projected, 1);
  return (
    <Panel title="Twoja prognozowana oszczędność" className="re-savings-panel">
      <div className="re-savings-currency">{priceLabel}</div>
      <div className="re-savings-layout">
        <div className="re-savings-chart" aria-label="Porównanie obecnego i prognozowanego rachunku">
          <div className="re-saving-bar old" style={{ height: `${Math.max(4, current / max * 100)}%` }}><span>{money(current)}</span></div>
          <div className="re-saving-bar new" style={{ height: `${Math.max(4, projected / max * 100)}%` }}><span>{money(projected)}</span></div>
        </div>
        <div className="re-savings-summary">
          <div className="re-summary-row old"><span>Twój aktualny rachunek roczny</span><strong>{money(current)}</strong></div>
          <div className="re-summary-row new"><span>Twój nowy rachunek z systemem</span><strong>{money(projected)}</strong></div>
          <div className="re-summary-row accent"><span>Oszczędność {money(report.savings.percent, 1)}%</span><strong>{money(report.savings.annual)}</strong></div>
          <div className="re-summary-row"><span>Prognozowany czas zwrotu z inwestycji</span><strong>{report.savings.paybackYears ? `${money(report.savings.paybackYears, 1)} lat` : 'Brak danych'}</strong></div>
          {extended ? (
            <div className="re-deposit-details">
              <div><span>Łączna zgromadzona wartość depozytu</span><strong>{money(report.deposit.generated)}</strong></div>
              <div><span>Wykorzystane na pokrycie energii pobranej</span><strong>{money(report.deposit.used)}</strong></div>
              <div><span>Niewykorzystana wartość depozytu</span><strong>{money(report.deposit.remaining)}</strong></div>
              <div><span>Zwrot części depozytu</span><strong>{money(report.deposit.payout)}</strong></div>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function CostTable({ report }: { report: ReturnType<typeof buildOfferReport> }) {
  return (
    <Panel title="Kosztorys" className="re-cost-panel">
      <table className="re-table">
        <thead>
          <tr><th>Nr</th><th>Pozycja</th><th>Model</th><th className="num">Ilość</th><th className="num">Cena jednostkowa {report.costs.priceLabel}</th><th className="num">Wartość {report.costs.priceLabel}</th></tr>
        </thead>
        <tbody>
          {report.costs.rows.length ? report.costs.rows.map((row, index) => (
            <tr key={`${row.description}-${index}`}>
              <td>{index + 1}</td>
              <td>{row.description}{row.source ? <small>{row.source}</small> : null}</td>
              <td><em>{row.model || '-'}</em></td>
              <td className="num">{quantity(row.quantity)}</td>
              <td className="num">{money(row.unitValue, 2)} PLN</td>
              <td className="num">{money(row.value, 2)} PLN</td>
            </tr>
          )) : <tr><td colSpan={6}>Brak pozycji kosztorysu w zapisanym snapshotcie oferty.</td></tr>}
          <tr className="total"><td colSpan={5}>Koszt systemu</td><td className="num">{money(report.costs.systemValue, 2)} PLN</td></tr>
          {!report.variant.includes('B2B') && report.costs.subsidy > 0 ? <tr className="total"><td colSpan={5}>Prognozowana kwota dotacji</td><td className="num">{money(report.costs.subsidy, 2)} PLN</td></tr> : null}
          {!report.variant.includes('B2B') && report.costs.thermoRelief > 0 ? <tr className="total"><td colSpan={5}>Prognozowana ulga termomodernizacyjna</td><td className="num">{money(report.costs.thermoRelief, 2)} PLN</td></tr> : null}
          {!report.variant.includes('B2B') && (report.costs.subsidy > 0 || report.costs.thermoRelief > 0) ? <tr className="total green"><td colSpan={5}>Prognozowany koszt systemu po dofinansowaniach</td><td className="num">{money(report.costs.afterSupport, 2)} PLN</td></tr> : null}
        </tbody>
      </table>
    </Panel>
  );
}

function DescriptionPanel({ report }: { report: ReturnType<typeof buildOfferReport> }) {
  return (
    <Panel title="Opis oferty" className="re-description">
      <p><strong className="before">PRZED:</strong> {report.description.before || 'Opis stanu obecnego nie został jeszcze uzupełniony.'}</p>
      <p><strong className="after">PO:</strong> {report.description.after || 'Opis proponowanego rozwiązania nie został jeszcze uzupełniony.'}</p>
    </Panel>
  );
}

function ReportPage({ report }: { report: ReturnType<typeof buildOfferReport> }) {
  const b2b = report.variant === 'B2B';
  const fullAddress = [report.client.address, [report.client.postalCode, report.client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const currentVariable = report.bills.current.energy + report.bills.current.distribution;
  return (
    <section className="offer-page report-page">
      <Brand mode="Report" />
      <TitleStrip number={report.number}>{report.client.name}</TitleStrip>
      <div className="re-report-top">
        <div className="re-report-person">
          <Panel title={b2b ? 'Dane firmy' : 'Dane osobowe'}>
            <DataField label={b2b ? 'Nazwa firmy' : 'Imię i nazwisko'} value={report.client.name} />
            {report.client.taxId ? <DataField label="NIP" value={report.client.taxId} /> : null}
            <DataField label="Adres" value={fullAddress || report.client.investmentAddress} />
          </Panel>
          <Panel title="Dane kontaktowe">
            <DataField label="Mail" value={report.client.email} />
            <DataField label="Telefon" value={report.client.phone} />
          </Panel>
        </div>
        <div className="re-cover-image">
          {report.client.coverImageDocumentId ? (
            // The print document needs the original file dimensions without Next.js image transformations.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/documents/${report.client.coverImageDocumentId}/file`} alt={report.client.coverImageTitle || 'Obiekt inwestycji'} />
          ) : (
            <div><strong>Obiekt inwestycji</strong><span>{report.client.investmentAddress || 'Zdjęcie obiektu nie zostało dodane w wizji lokalnej.'}</span></div>
          )}
        </div>
      </div>

      <Panel title="Dane środowiskowe" className="re-grid-panel">
        <div className="re-data-grid three">
          <DataField label="Rodzaj terenu" value={report.report.terrain} />
          <DataField label={b2b ? 'Rodzaj obiektu' : 'Rodzaj dachu'} value={b2b ? report.report.buildingType : report.report.roofType} />
          <DataField label={b2b ? 'Rodzaj dachu' : 'Typ budynku'} value={b2b ? report.report.roofType : report.report.buildingType} />
          {b2b ? <DataField label="Profil działalności" value={report.report.activityProfile} /> : null}
          {b2b ? <DataField label="Cykl pracy - liczba zmian" value={report.report.workCycle} /> : null}
          {b2b ? <DataField label="Własny transformator" value={report.report.transformer} /> : null}
        </div>
      </Panel>

      <Panel title="Dane rozliczeniowe" className="re-grid-panel">
        <div className="re-data-grid three">
          <DataField label="Moc przyłączeniowa" value={report.report.connectionPowerKw} suffix=" kW" />
          <DataField label="System rozliczeniowy" value={report.report.settlement} />
          <DataField label="Taryfa" value={report.report.tariff} />
          <DataField label="Operator systemu dystrybucyjnego" value={report.report.operator} />
          <DataField label="Dostawca energii elektrycznej" value={report.report.supplier} />
          <DataField label="Rodzaj przyłącza" value={report.report.phaseCount ? `${report.report.phaseCount}-fazowe` : ''} />
        </div>
      </Panel>

      <div className="re-report-bottom">
        <div>
          {!b2b ? (
            <Panel title="Energia cieplna" className="re-grid-panel">
              <div className="re-data-grid two"><DataField label="Źródło ciepła" value={report.report.heatingSource} /><DataField label="Rodzaj źródła ciepła" value={report.report.heatingDetails} /></div>
            </Panel>
          ) : null}
          <Panel title="Urządzenia posiadane/planowane o dużym poborze energii" className="re-grid-panel re-loads">
            <div className="re-data-grid two"><DataField label="Posiadane urządzenia" value={report.report.currentLoads} /><DataField label="Planowane urządzenia" value={report.report.plannedLoads} /></div>
          </Panel>
        </div>
        <Panel title="Roczny rachunek za energię" className="re-bill-box">
          <div><small>Opłaty stałe</small><MoneyValue value={report.bills.current.fixed} label={`PLN ${report.costs.priceLabel}`} /></div>
          <div><small>Zakup i dystrybucja energii</small><MoneyValue value={currentVariable} label={`PLN ${report.costs.priceLabel}`} /></div>
          <div className="re-current-bill"><small>Twój rachunek</small><MoneyValue value={report.bills.current.total} label={`PLN ${report.costs.priceLabel}`} /></div>
        </Panel>
      </div>

      <Panel title="Instalacja fotowoltaiczna" className="re-grid-panel">
        <div className="re-data-grid three"><DataField label="Instalacja fotowoltaiczna" value={report.report.hasPv ? 'Tak' : 'Nie'} /><DataField label="Moc istniejącej instalacji" value={report.report.existingPvKw} suffix=" kWp" /><DataField label="Miejsce instalacji" value={report.report.pvPlace} /></div>
      </Panel>
    </section>
  );
}

function SystemPage({ report }: { report: ReturnType<typeof buildOfferReport> }) {
  const b2b = report.variant === 'B2B';
  return (
    <section className="offer-page system-page">
      <Brand />
      <TitleStrip number={report.number}>{report.client.name}</TitleStrip>
      <div className="re-system-hero">
        {/* The source artwork must stay pixel-identical in the generated PDF. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b2b ? '/img/onrevolt/offers/reform-b2b-system.png' : '/img/onrevolt/offers/reform-b2c-system.png'} alt={b2b ? 'System Re:form dla obiektu przemysłowego' : 'System Re:form dla domu'} />
      </div>
      <CostTable report={report} />
      {b2b ? <DescriptionPanel report={report} /> : <SavingsPanel report={report} extended />}
    </section>
  );
}

function BillColumn({ report, after }: { report: ReturnType<typeof buildOfferReport>; after?: boolean }) {
  const tariff = after ? report.tariffs.projected : report.tariffs.current;
  const bill = after ? report.bills.projected : report.bills.current;
  const billEnergy = after ? report.bills.projected.energyCash : report.bills.current.energy;
  const zoneRates = tariff.zoneRates || [];
  const lowestZoneRate = after && zoneRates.length > 1
    ? zoneRates.reduce((lowest, rate) => rate.totalPerKwh < lowest.totalPerKwh ? rate : lowest)
    : null;
  const displayedEnergyRate = lowestZoneRate?.energyPerKwh ?? tariff.energyPerKwh;
  const displayedDistributionRate = lowestZoneRate?.distributionPerKwh ?? tariff.distributionPerKwh;
  const displayedTotalRate = lowestZoneRate?.totalPerKwh ?? tariff.totalPerKwh;
  return (
    <div className={`re-bill-column ${after ? 'after' : 'before'}`}>
      <h2>{after ? 'Nowa taryfa i system rozliczeniowy' : 'Aktualna taryfa i system rozliczeniowy'}</h2>
      <div className="re-data-grid two">
        <DataField label="Taryfa" value={after ? report.tariffs.afterName : report.tariffs.before} />
        <DataField label="System rozliczeniowy" value={after ? report.tariffs.settlementAfter : report.tariffs.settlementBefore} />
      </div>
      <h3>{lowestZoneRate ? 'Koszt zakupu 1 kWh w najtańszej strefie' : 'Koszt zakupu 1 kWh'} <em>(PLN {report.costs.priceLabel})</em></h3>
      <div className="re-rate-list">
        {lowestZoneRate ? <div><span>Strefa taryfowa</span><strong>{lowestZoneRate.label}</strong></div> : null}
        <div><span>Zakup energii</span><strong>{money(displayedEnergyRate, 4)} PLN</strong></div>
        <div><span>Dystrybucja energii</span><strong>{money(displayedDistributionRate, 4)} PLN</strong></div>
        <div><span>Opłaty stałe / miesiąc</span><strong>{money(tariff.fixedMonthly, 2)} PLN</strong></div>
        <div className="total"><span>Całkowity koszt zakupu 1 kWh</span><strong>{money(displayedTotalRate, 4)} PLN</strong></div>
      </div>
      {tariff.sourceUrl ? (
        <a className="re-tariff-source" href={tariff.sourceUrl} target="_blank" rel="noreferrer">
          Stawki RE · {dateLabel(tariff.fetchedAt)}
        </a>
      ) : null}
      <h3>{after ? 'Prognozowany' : 'Aktualny'} rachunek roczny <em>(PLN {report.costs.priceLabel})</em></h3>
      <div className="re-bill-visual">
        <div className="re-bill-stack">
          <i style={{ height: `${Math.max(5, billEnergy / Math.max(numberValue(bill.total), 1) * 100)}%` }} />
          <i style={{ height: `${Math.max(5, numberValue(bill.distribution) / Math.max(numberValue(bill.total), 1) * 100)}%` }} />
          <i style={{ height: `${Math.max(5, numberValue(bill.fixed) / Math.max(numberValue(bill.total), 1) * 100)}%` }} />
        </div>
        <div className="re-rate-list bill">
          <div><span>Zużycie energii</span><strong>{money(bill.consumptionKwh)} kWh</strong></div>
          <div><span>Autokonsumpcja z PV</span><strong>{money(bill.pvDirectKwh)} kWh</strong></div>
          {after ? <div><span>Autokonsumpcja z magazynu</span><strong>{money(report.bills.projected.batteryKwh)} kWh</strong></div> : null}
          <div><span>Zakup z sieci</span><strong>{money(bill.gridImportKwh)} kWh</strong></div>
          <div><span>Zakup energii</span><strong>{money(billEnergy)} PLN</strong></div>
          <div><span>Dystrybucja energii</span><strong>{money(bill.distribution)} PLN</strong></div>
          <div><span>Opłaty stałe</span><strong>{money(bill.fixed)} PLN</strong></div>
          <div className="total"><span>Całkowity rachunek</span><strong>{money(bill.total)} PLN</strong></div>
          {after ? <div className="green"><span>Oszczędność</span><strong>{money(report.savings.annual)} PLN</strong></div> : null}
        </div>
      </div>
      {after ? (
        <div className="re-deposit-mini">
          <strong>Wartość skumulowanego depozytu: {money(report.deposit.generated)} PLN</strong>
          <span>Energia oddana: {money(report.deposit.exportKwh)} kWh</span>
          <span>Wykorzystane: {money(report.deposit.used)} PLN / {money(report.deposit.importCoveredKwh)} kWh</span>
        </div>
      ) : null}
    </div>
  );
}

function ComparisonPage({ report }: { report: ReturnType<typeof buildOfferReport> }) {
  const b2b = report.variant === 'B2B';
  return (
    <section className="offer-page comparison-page">
      <Brand />
      <TitleStrip number={report.number}>Porównanie rachunków rocznych</TitleStrip>
      <div className="re-comparison-grid"><BillColumn report={report} /><BillColumn report={report} after /></div>
      {b2b ? <SavingsPanel report={report} extended /> : <DescriptionPanel report={report} />}
    </section>
  );
}

function AnnualChart({ months }: { months: ReturnType<typeof buildOfferReport>['energy']['currentMonths'] }) {
  const width = 760;
  const height = 270;
  const plotTop = 20;
  const plotBottom = 225;
  const maximum = Math.max(1, ...months.flatMap((month) => [month.consumptionKwh, month.pvGenerationKwh]));
  const y = (value: number) => plotBottom - value / maximum * (plotBottom - plotTop);
  const points = months.map((month, index) => `${42 + index * 61},${y(month.consumptionKwh)}`).join(' ');
  const pvPoints = months.map((month, index) => `${42 + index * 61},${y(month.pvGenerationKwh)}`).join(' ');
  return (
    <svg className="re-annual-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Roczny wykres przepływów energii">
      {Array.from({ length: 6 }, (_, index) => {
        const lineY = plotTop + index * (plotBottom - plotTop) / 5;
        return <line key={index} x1="26" x2="748" y1={lineY} y2={lineY} className="grid" />;
      })}
      {months.map((month, index) => {
        const x = 27 + index * 61;
        const gridHeight = month.gridImportKwh / maximum * (plotBottom - plotTop);
        const directHeight = month.directPvKwh / maximum * (plotBottom - plotTop);
        const batteryHeight = month.batteryKwh / maximum * (plotBottom - plotTop);
        return (
          <g key={month.month}>
            <rect x={x} y={plotBottom - gridHeight} width="30" height={gridHeight} className="grid-import" />
            <rect x={x} y={plotBottom - gridHeight - directHeight} width="30" height={directHeight} className="direct-pv" />
            <rect x={x} y={plotBottom - gridHeight - directHeight - batteryHeight} width="30" height={batteryHeight} className="battery" />
            <text x={x + 15} y="248" textAnchor="middle">{monthNames[month.month - 1]?.slice(0, 3)}</text>
          </g>
        );
      })}
      <polyline points={points} className="consumption-line" />
      <polyline points={pvPoints} className="pv-line" />
    </svg>
  );
}

function Legend({ report, projected }: { report: ReturnType<typeof buildOfferReport>; projected: boolean }) {
  const months = projected ? report.energy.projectedMonths : report.energy.currentMonths;
  return (
    <div className="re-energy-legend">
      <div><i className="line consumption" /><span>Zużycie energii</span><strong>{money(sum(months.map((month) => month.consumptionKwh)))} kWh</strong></div>
      <div><i className="line pv" /><span>Produkcja z PV</span><strong>{money(sum(months.map((month) => month.pvGenerationKwh)))} kWh</strong></div>
      <div><i className="dot direct" /><span>Autokonsumpcja z PV</span><strong>{money(sum(months.map((month) => month.directPvKwh)))} kWh</strong></div>
      <div><i className="dot battery" /><span>Autokonsumpcja z magazynu</span><strong>{money(sum(months.map((month) => month.batteryKwh)))} kWh</strong></div>
    </div>
  );
}

function MonthSummary({ months }: { months: ReturnType<typeof buildOfferReport>['energy']['currentMonths'] }) {
  const rows = [
    ['Produkcja z PV', 'pvGenerationKwh', 'pv'],
    ['Całkowite zużycie energii', 'consumptionKwh', 'consumption'],
    ['Energia oddana do sieci', 'exportKwh', 'export'],
    ['Autokonsumpcja z PV', 'directPvKwh', 'direct'],
    ['Autokonsumpcja z magazynu', 'batteryKwh', 'battery'],
    ['Energia pobrana z sieci', 'gridImportKwh', 'import'],
  ] as const;
  return (
    <Panel title="Podsumowanie roczne" className="re-month-summary">
      <div className="re-month-head"><span />{monthNames.map((name) => <strong key={name}>{name.slice(0, 3)}</strong>)}</div>
      {rows.map(([label, key, tone]) => {
        const maximum = Math.max(1, ...months.map((month) => numberValue(month[key])));
        return (
          <div className="re-month-row" key={key}>
            <span>{label} (kWh)</span>
            {months.map((month) => {
              const value = numberValue(month[key]);
              return <div key={month.month}><i className={tone} style={{ opacity: value > 0 ? 0.22 + value / maximum * 0.78 : 0.08 }} /><small>{value > 0 ? money(value) : '-'}</small></div>;
            })}
          </div>
        );
      })}
    </Panel>
  );
}

function Characteristics({ report }: { report: ReturnType<typeof buildOfferReport> }) {
  const item = (label: string, month: any) => <DataField label={label} value={month ? `${monthNames[month.month - 1]} · ~${money(month.consumptionKwh)} kWh` : ''} />;
  return (
    <Panel title="Charakterystyka zużycia" className="re-grid-panel re-characteristics">
      <div className="re-data-grid three">
        {item('Miesiąc o największym zużyciu', report.energy.characteristics.high)}
        {item('Miesiąc o średnim zużyciu', report.energy.characteristics.medium)}
        {item('Miesiąc o małym zużyciu', report.energy.characteristics.low)}
      </div>
    </Panel>
  );
}

function AnnualBalancePage({ report, projected }: { report: ReturnType<typeof buildOfferReport>; projected: boolean }) {
  const months = projected ? report.energy.projectedMonths : report.energy.currentMonths;
  const borderClass = projected ? 'projected' : 'current';
  const exportKwh = sum(months.map((month) => month.exportKwh));
  const importKwh = sum(months.map((month) => month.gridImportKwh));
  return (
    <section className="offer-page annual-page">
      <Brand />
      <TitleStrip number={report.number}>Roczny bilans energetyczny - {projected ? 'stan po bilansowaniu' : 'stan aktualny'}</TitleStrip>
      <Panel title={`Okres (${report.energy.period})`} className={`re-annual-panel ${borderClass}`}>
        {months.length ? <AnnualChart months={months} /> : <div className="re-no-data">Brak zapisanego wyniku RE dla tej oferty.</div>}
        <h3>Przepływ energii (kWh)</h3>
        <Legend report={report} projected={projected} />
        <h3>Rozliczenie energii (PLN {report.costs.priceLabel})</h3>
        <div className="re-settlement-grid">
          <DataField label="Energia oddana do sieci" value={exportKwh ? `${money(exportKwh)} kWh` : ''} />
          <DataField label="Wartość energii oddanej" value={exportKwh ? `${money(projected ? report.deposit.generated : 0)} PLN` : ''} />
          <DataField label="Średnia cena 1 kWh" value={exportKwh ? `${money(report.energy.averageExportPrice, 2)} PLN/kWh` : ''} />
          <DataField label="Energia pobrana z sieci" value={importKwh ? `${money(importKwh)} kWh` : ''} />
          <DataField label="Wartość energii pobranej" value={importKwh ? `${money(projected ? report.bills.projected.energyDue : report.bills.current.energy)} PLN` : ''} />
          <DataField label="Średnia cena 1 kWh" value={importKwh ? `${money(projected ? report.energy.averageImportPrice : report.tariffs.current.energyPerKwh, 2)} PLN/kWh` : ''} />
        </div>
      </Panel>
      <MonthSummary months={months} />
      <Characteristics report={report} />
    </section>
  );
}

function DailyChart({ data }: { data: ReturnType<typeof buildOfferReport>['energy']['summerWeekday'] }) {
  if (!data.available) return <div className="re-no-data">Brak profilu godzinowego ENEA rozdzielonego na ten rodzaj dnia.</div>;
  const width = 760;
  const plotBottom = 185;
  const maximum = Math.max(1, ...data.consumption, ...data.pvGeneration);
  const y = (value: number) => plotBottom - value / maximum * 155;
  const consumptionPoints = data.consumption.map((value, hour) => `${25 + hour * 31},${y(value)}`).join(' ');
  const pvPoints = data.pvGeneration.map((value, hour) => `${25 + hour * 31},${y(value)}`).join(' ');
  return (
    <svg className="re-daily-chart" viewBox={`0 0 ${width} 220`} role="img" aria-label="Godzinowy profil dnia">
      {Array.from({ length: 5 }, (_, index) => <line key={index} x1="18" x2="748" y1={30 + index * 39} y2={30 + index * 39} className="grid" />)}
      {data.consumption.map((_, hour) => {
        const direct = data.directPv[hour] / maximum * 155;
        const grid = data.gridImport[hour] / maximum * 155;
        return (
          <g key={hour}>
            <rect x={14 + hour * 31} y={plotBottom - grid} width="20" height={grid} className="grid-import" />
            <rect x={14 + hour * 31} y={plotBottom - grid - direct} width="20" height={direct} className="direct-pv" />
            <text x={24 + hour * 31} y="207" textAnchor="middle">{String(hour).padStart(2, '0')}</text>
          </g>
        );
      })}
      <polyline points={consumptionPoints} className="consumption-line" />
      <polyline points={pvPoints} className="pv-line" />
    </svg>
  );
}

function DailyPanel({ title, data }: { title: string; data: ReturnType<typeof buildOfferReport>['energy']['summerWeekday'] }) {
  const label = data.year ? `${monthNames[data.month - 1]} ${data.year}` : monthNames[data.month - 1];
  return (
    <Panel title={`${title} (${label}) - dane przed bilansowaniem`} className="re-daily-panel">
      <DailyChart data={data} />
      <div className="re-energy-legend daily">
        <div><i className="line consumption" /><span>Zużycie energii</span><strong>{data.available ? `${money(sum(data.consumption), 2)} kWh` : '-'}</strong></div>
        <div><i className="line pv" /><span>Produkcja z PV</span><strong>{data.available ? `${money(sum(data.pvGeneration), 2)} kWh` : '-'}</strong></div>
        <div><i className="dot direct" /><span>Autokonsumpcja z PV</span><strong>{data.available ? `${money(sum(data.directPv), 2)} kWh` : '-'}</strong></div>
        <div><i className="dot export" /><span>Energia oddana do sieci</span><strong>{data.available ? `${money(sum(data.export), 2)} kWh` : '-'}</strong></div>
        <div><i className="dot import" /><span>Energia pobrana z sieci</span><strong>{data.available ? `${money(sum(data.gridImport), 2)} kWh` : '-'}</strong></div>
      </div>
    </Panel>
  );
}

function DailyReviewPage({ report, season }: { report: ReturnType<typeof buildOfferReport>; season: 'summer' | 'winter' }) {
  const summer = season === 'summer';
  return (
    <section className="offer-page daily-page">
      <Brand mode="Review" />
      <TitleStrip number={report.number}>Analiza energetyczna - dzień {summer ? 'letni' : 'zimowy'}</TitleStrip>
      <DailyPanel title={`Dzień ${summer ? 'letni' : 'zimowy'} - roboczy`} data={summer ? report.energy.summerWeekday : report.energy.winterWeekday} />
      <DailyPanel title={`Dzień ${summer ? 'letni' : 'zimowy'} - wolny`} data={summer ? report.energy.summerWeekend : report.energy.winterWeekend} />
    </section>
  );
}

export default function OfferDocument({ offer, compact = false, showActions = false }: OfferDocumentProps) {
  const report = buildOfferReport(offer);
  const b2b = report.variant === 'B2B';
  return (
    <div className={`offer-doc-root${compact ? ' compact' : ''}`}>
      <style>{styles}</style>
      {showActions ? (
        <div className="offer-actions">
          <a href="/admin/offers">Wróć do ofert</a>
          <span>Szablon {report.templateVersion}</span>
          <button type="button" onClick={() => window.print()}>Drukuj / zapisz PDF</button>
        </div>
      ) : null}
      <ReportPage report={report} />
      <SystemPage report={report} />
      <ComparisonPage report={report} />
      <AnnualBalancePage report={report} projected={false} />
      <AnnualBalancePage report={report} projected />
      {b2b ? <DailyReviewPage report={report} season="summer" /> : null}
      {b2b ? <DailyReviewPage report={report} season="winter" /> : null}
    </div>
  );
}

const styles = `
  .offer-doc-root { --ink:#17245d; --muted:#8190b7; --line:#dbe3f1; --page:#f1f4fa; --green:#00a454; --mint:#58d79d; --orange:#ff7a00; --amber:#ffb52e; --red:#ff6f6f; color:var(--ink); font-family:Arial,Helvetica,sans-serif; background:#e8edf5; padding:24px; overflow-x:auto; }
  .offer-page { width:210mm; min-height:297mm; margin:0 auto 24px; padding:10mm; box-sizing:border-box; background:var(--page); page-break-after:always; box-shadow:0 18px 45px rgba(20,33,82,.16); overflow:hidden; }
  .offer-page:last-child { page-break-after:auto; }
  .offer-actions { width:210mm; margin:0 auto 16px; display:flex; align-items:center; justify-content:flex-end; gap:10px; }
  .offer-actions a,.offer-actions button { border:1px solid #cdd8ef; border-radius:7px; background:#fff; color:var(--ink); padding:10px 14px; font-weight:800; text-decoration:none; cursor:pointer; }
  .offer-actions span { margin-right:auto; color:#66749a; font-size:12px; }
  .re-brand { display:flex; align-items:baseline; gap:8px; margin-bottom:8px; color:#11131b; }
  .re-brand strong { font-size:30px; font-weight:900; line-height:1; letter-spacing:0; }
  .re-brand strong span { color:var(--green); }
  .re-brand small { font-size:14px; font-weight:800; }
  .re-brand small span { color:#7b44ff; }
  .re-title-strip { min-height:38px; display:flex; justify-content:space-between; align-items:center; gap:16px; background:#fff; border-radius:9px; padding:7px 14px; margin-bottom:8px; font-size:14px; }
  .re-panel { background:#fff; border-radius:10px; padding:10px 12px; margin-bottom:8px; box-sizing:border-box; }
  .re-panel h2 { margin:0 0 7px; font-size:13px; line-height:1.15; }
  .re-panel h3 { margin:8px 0 5px; font-size:11px; }
  .re-field { min-width:0; background:#fbfcff; border-radius:7px; padding:7px 9px; }
  .re-field span { display:block; color:var(--muted); font-size:8px; line-height:1.2; }
  .re-field strong { display:block; margin-top:3px; font-size:10px; line-height:1.25; overflow-wrap:anywhere; }
  .re-data-grid { display:grid; gap:6px; }
  .re-data-grid.two { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .re-data-grid.three { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .re-grid-panel { padding:9px 11px; }
  .re-report-top { display:grid; grid-template-columns:34% 1fr; gap:8px; }
  .re-report-person .re-panel { height:calc(50% - 4px); }
  .re-cover-image { height:278px; border-radius:10px; overflow:hidden; background:#e7ecf5; }
  .re-cover-image img { width:100%; height:100%; object-fit:cover; }
  .re-cover-image>div { height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:30px; text-align:center; color:#6f7aa5; }
  .re-cover-image strong { font-size:18px; margin-bottom:10px; }
  .re-cover-image span { font-size:11px; }
  .re-report-bottom { display:grid; grid-template-columns:2fr 1fr; gap:8px; }
  .re-loads { min-height:118px; }
  .re-bill-box { display:flex; flex-direction:column; gap:6px; }
  .re-bill-box>div { display:flex; flex-direction:column; gap:4px; border-bottom:1px solid #edf1f7; padding:5px 3px; }
  .re-bill-box small { color:var(--muted); font-size:8px; }
  .re-bill-box span { display:flex; justify-content:space-between; align-items:baseline; font-size:14px; }
  .re-bill-box em { font-size:9px; font-style:normal; }
  .re-current-bill { border:1px solid var(--red)!important; border-radius:7px; color:#ff3030; padding:8px!important; }
  .re-system-hero { height:245px; margin-bottom:8px; background:#fff; border-radius:10px; overflow:hidden; }
  .re-system-hero img { width:100%; height:100%; object-fit:contain; }
  .re-cost-panel { padding:8px; }
  .re-table { width:100%; border-collapse:collapse; font-size:8px; }
  .re-table th,.re-table td { border:1px solid var(--line); padding:5px 6px; vertical-align:top; }
  .re-table th { text-align:left; font-weight:900; background:#fbfcff; }
  .re-table .num { text-align:right; white-space:nowrap; }
  .re-table td small { display:block; color:#7c87a9; margin-top:3px; }
  .re-table td em { font-style:italic; }
  .re-table tr.total td { font-weight:900; }
  .re-table tr.green td { color:#049447; }
  .re-savings-panel { position:relative; }
  .re-savings-currency { position:absolute; right:14px; top:10px; font-size:8px; font-weight:800; }
  .re-savings-layout { display:grid; grid-template-columns:40% 1fr; gap:22px; min-height:190px; }
  .re-savings-chart { height:165px; margin:14px 25px 0; border-left:1px solid #7180a8; border-bottom:1px solid #7180a8; display:flex; align-items:flex-end; justify-content:center; gap:38px; }
  .re-saving-bar { position:relative; width:38px; min-height:5px; }
  .re-saving-bar.old { background:#ff9292; }
  .re-saving-bar.new { background:#7ecb9d; }
  .re-saving-bar span { position:absolute; top:-16px; left:50%; transform:translateX(-50%); font-size:8px; font-weight:900; white-space:nowrap; }
  .re-savings-summary { align-self:center; }
  .re-summary-row { display:flex; justify-content:space-between; gap:10px; padding:5px 8px; font-size:9px; }
  .re-summary-row.old { background:#fff0f0; border-radius:7px 7px 0 0; }
  .re-summary-row.new { background:#effaf4; }
  .re-summary-row.accent { color:var(--green); background:#effaf4; font-size:11px; }
  .re-deposit-details { margin-top:7px; padding:7px 8px; background:#f8f5ff; border-radius:7px; }
  .re-deposit-details div { display:flex; justify-content:space-between; gap:8px; font-size:8px; padding:2px 0; }
  .re-description { font-size:9px; line-height:1.38; }
  .re-description p { margin:0 0 8px; white-space:pre-wrap; }
  .re-description p:last-child { margin-bottom:0; }
  .re-description strong.before { color:#ff3b30; }
  .re-description strong.after { color:var(--green); }
  .re-comparison-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px; }
  .re-bill-column { background:#fff; border:1px solid #ff9d9d; border-radius:10px; padding:10px; }
  .re-bill-column.after { border-color:#4fd894; }
  .re-bill-column h2 { margin:0 0 7px; font-size:13px; }
  .re-bill-column h3 { font-size:11px; margin:8px 0 5px; }
  .re-bill-column h3 em { font-size:8px; font-weight:400; }
  .re-rate-list>div { display:flex; justify-content:space-between; gap:8px; padding:3px 0; font-size:8px; }
  .re-rate-list>div.total { border-top:1px solid #26346d; margin-top:3px; padding-top:5px; font-weight:900; font-size:9px; }
  .re-rate-list>div.green { color:var(--green); }
  .re-tariff-source { display:block; margin-top:3px; color:#52618c; font-size:6px; text-decoration:none; }
  .re-bill-visual { display:grid; grid-template-columns:54px 1fr; gap:10px; }
  .re-bill-stack { height:220px; display:flex; flex-direction:column-reverse; justify-content:flex-start; background:#f4f6fb; align-self:end; }
  .re-bill-stack i { display:block; min-height:4px; }
  .re-bill-stack i:nth-child(1) { background:var(--orange); }
  .re-bill-stack i:nth-child(2) { background:#ffb463; }
  .re-bill-stack i:nth-child(3) { background:#9ea8c2; }
  .re-rate-list.bill { align-self:center; }
  .re-deposit-mini { display:flex; flex-direction:column; gap:3px; margin-top:7px; padding:7px; border-radius:7px; background:#f8f5ff; font-size:8px; }
  .re-annual-panel { border:1px solid #ff9d9d; }
  .re-annual-panel.projected { border-color:#4fd894; }
  .re-annual-chart,.re-daily-chart { display:block; width:100%; height:auto; }
  svg .grid { stroke:#dbe2ef; stroke-width:1; }
  svg text { fill:#17245d; font-size:8px; }
  svg .grid-import { fill:var(--orange); }
  svg .direct-pv { fill:var(--amber); }
  svg .battery { fill:#54d99b; }
  svg .consumption-line { fill:none; stroke:#99a6ca; stroke-width:2; }
  svg .pv-line { fill:none; stroke:#ffad19; stroke-width:2; }
  .re-energy-legend { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--line); border-radius:7px; overflow:hidden; }
  .re-energy-legend>div { padding:6px 8px; border-right:1px solid var(--line); display:grid; grid-template-columns:10px 1fr; gap:2px 5px; align-items:center; font-size:8px; }
  .re-energy-legend>div:last-child { border-right:0; }
  .re-energy-legend strong { grid-column:2; }
  .re-energy-legend i.line { width:10px; height:2px; }
  .re-energy-legend i.line.consumption { background:#99a6ca; }
  .re-energy-legend i.line.pv { background:#ffad19; }
  .re-energy-legend i.dot { width:7px; height:7px; border-radius:50%; }
  .re-energy-legend i.direct { background:var(--amber); }
  .re-energy-legend i.battery { background:#54d99b; }
  .re-energy-legend i.export { background:var(--green); }
  .re-energy-legend i.import { background:var(--orange); }
  .re-settlement-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:2px; }
  .re-month-summary { padding:9px; }
  .re-month-head,.re-month-row { display:grid; grid-template-columns:145px repeat(12,1fr); gap:2px; align-items:end; }
  .re-month-head strong { font-size:7px; text-align:center; }
  .re-month-row { margin-bottom:5px; }
  .re-month-row>span { font-size:8px; }
  .re-month-row>div { text-align:center; min-width:0; }
  .re-month-row i { display:block; height:15px; background:#cbd3e3; }
  .re-month-row i.pv { background:#ffa000; }
  .re-month-row i.export { background:#009b4c; }
  .re-month-row i.direct { background:#ffb52e; }
  .re-month-row i.battery { background:#54d99b; }
  .re-month-row i.import { background:#f47700; }
  .re-month-row small { display:block; margin-top:2px; font-size:6px; }
  .re-characteristics { margin-bottom:0; }
  .re-no-data { min-height:170px; display:flex; align-items:center; justify-content:center; color:#7784a8; font-size:11px; text-align:center; }
  .re-daily-panel { padding:9px 12px; }
  .re-daily-page .re-daily-panel { min-height:470px; }
  .re-energy-legend.daily { grid-template-columns:repeat(3,1fr); }
  .re-energy-legend.daily>div:nth-child(3) { border-right:0; }
  .re-energy-legend.daily>div:nth-child(n+4) { border-top:1px solid var(--line); }
  .compact { padding:10px; }
  .compact .offer-page { width:100%; min-width:760px; min-height:auto; margin-bottom:14px; padding:20px; box-shadow:none; border-radius:8px; }
  @page { size:A4; margin:0; }
  @media print { body { margin:0!important; background:var(--page)!important; } .offer-doc-root { padding:0; background:var(--page); overflow:visible; } .offer-actions { display:none; } .offer-page { width:210mm; height:297mm; min-height:297mm; margin:0; padding:10mm; box-shadow:none; } }
`;
