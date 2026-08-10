'use client';

import { vatBreakdown } from 'lib/onrevolt/configuration-vat';
import Image from 'next/image';

type OfferDocumentProps = {
  offer: any;
  compact?: boolean;
  showActions?: boolean;
};

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue(value));
}

function percent(value: unknown) {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(numberValue(value));
}

function dateLabel(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pl-PL').format(new Date(value));
}

function snapshot<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    DRAFT: 'Robocza',
    SENT: 'Wysłana',
    ACCEPTED: 'Zaakceptowana',
    REJECTED: 'Odrzucona',
    EXPIRED: 'Wygasła',
  };
  return labels[value || ''] || value || 'Robocza';
}

function clientTypeLabel(value?: string | null) {
  const labels: Record<string, string> = {
    UNKNOWN: 'Nie określono',
    B2C: 'B2C',
    B2B: 'B2B',
    B2C_B2B: 'B2C/B2B',
  };
  return labels[value || ''] || value || 'Nie określono';
}

function offerLines(offer: any) {
  const lines = snapshot<any[]>(offer.lineItemsSnapshot, []);
  if (lines.length) return lines;
  return (offer.configuration?.items || []).map((item: any, index: number) => ({
    position: item.position || index + 1,
    description: item.description || item.product?.name || `Pozycja ${index + 1}`,
    model: item.product?.sku || item.product?.supplierSku || '',
    quantity: item.quantity || 0,
    saleNet: item.saleNet || 0,
    saleGross: item.saleGross || 0,
    saleVatRate: item.saleVatRate || 0,
  }));
}

function calculation(offer: any) {
  const saved = snapshot<Record<string, any>>(offer.calculationSnapshot, {});
  const lines = offerLines(offer);
  const currentAnnualBillGross = numberValue(saved.currentAnnualBillGross ?? offer.currentAnnualBillGross);
  const projectedAnnualBillGross = numberValue(saved.projectedAnnualBillGross ?? offer.projectedAnnualBillGross);
  const annualSavingsGross = numberValue(saved.annualSavingsGross ?? offer.annualSavingsGross);
  const savingsPercent = currentAnnualBillGross > 0 ? (annualSavingsGross / currentAnnualBillGross) * 100 : numberValue(saved.savingsPercent);

  return {
    totalNet: numberValue(saved.totalNet ?? offer.totalNet),
    totalGross: numberValue(saved.totalGross ?? offer.totalGross),
    totalVat: numberValue(saved.totalVat ?? numberValue(offer.totalGross) - numberValue(offer.totalNet)),
    vatBreakdown: Array.isArray(saved.vatBreakdown)
      ? saved.vatBreakdown
      : vatBreakdown(lines.map((line) => ({
        saleNet: numberValue(line.saleNet),
        saleGross: numberValue(line.saleGross),
        saleVatRate: numberValue(line.saleVatRate),
      }))),
    subsidyGross: numberValue(saved.subsidyGross ?? offer.subsidyGross),
    thermoReliefGross: numberValue(saved.thermoReliefGross ?? offer.thermoReliefGross),
    totalAfterSupportGross: numberValue(saved.totalAfterSupportGross ?? offer.totalAfterSupportGross ?? offer.totalGross),
    currentAnnualBillGross,
    projectedAnnualBillGross,
    annualSavingsGross,
    paybackYears: saved.paybackYears ?? offer.paybackYears,
    savingsPercent,
  };
}

function clientSnapshot(offer: any) {
  const saved = snapshot<Record<string, any>>(offer.clientSnapshot, {});
  return {
    clientName: saved.clientName || offer.project?.client?.displayName || '',
    clientType: saved.clientType || offer.project?.clientType || offer.project?.client?.clientType || 'UNKNOWN',
    projectTitle: saved.projectTitle || offer.project?.title || '',
    investmentAddress: saved.investmentAddress || offer.project?.investmentSite?.fullAddress || offer.project?.locationAddress || '',
    email: saved.email || '',
    phone: saved.phone || '',
  };
}

function energySnapshot(offer: any) {
  return snapshot<Record<string, any>>(offer.energySnapshot, {
    measurementMonths: [],
    measurementFiles: 0,
    operatorAccounts: [],
  });
}

function monthBars(energy: Record<string, any>, field: 'consumptionKwh' | 'gridImportKwh') {
  const labels = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
  const months = energy.scenario?.result?.months || [];
  const values = months.length === 12
    ? months.map((month: any) => numberValue(month[field]))
    : [76, 78, 88, 77, 72, 63, 61, 80, 79, 86, 72, 84];
  const maximum = Math.max(...values, 1);
  return values.map((raw: number, index: number) => ({ value: Math.max(4, raw / maximum * 100), raw, label: labels[index] }));
}

export default function OfferDocument({ offer, compact = false, showActions = false }: OfferDocumentProps) {
  const lines = offerLines(offer);
  const calc = calculation(offer);
  const client = clientSnapshot(offer);
  const energy = energySnapshot(offer);
  const visibleLines = compact ? lines.slice(0, 7) : lines;
  const hasSavings = calc.currentAnnualBillGross > 0 || calc.projectedAnnualBillGross > 0 || calc.annualSavingsGross > 0;
  const currentBars = monthBars(energy, 'consumptionKwh');
  const projectedBars = monthBars(energy, 'gridImportKwh');

  return (
    <div className={`offer-doc-root${compact ? ' compact' : ''}`}>
      <style>{`
        .offer-doc-root {
          --ink: #17245d;
          --muted: #6f7aa5;
          --line: #dbe3f5;
          --soft: #eef3fb;
          --green: #05a85a;
          --orange: #ff8a00;
          --red: #ff8e8e;
          color: var(--ink);
          font-family: Arial, Helvetica, sans-serif;
          background: #e9eef7;
          padding: ${compact ? '12px' : '28px'};
        }
        .offer-page {
          width: ${compact ? '100%' : '210mm'};
          min-height: ${compact ? 'auto' : '297mm'};
          margin: 0 auto ${compact ? '14px' : '24px'};
          background: #f4f7fc;
          border-radius: ${compact ? '14px' : '0'};
          padding: ${compact ? '20px' : '15mm'};
          box-sizing: border-box;
          box-shadow: ${compact ? 'none' : '0 18px 45px rgba(20, 33, 82, .18)'};
          page-break-after: always;
        }
        .offer-actions {
          width: ${compact ? '100%' : '210mm'};
          margin: 0 auto 16px;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        .offer-actions button, .offer-actions a {
          border: 1px solid #cdd8ef;
          border-radius: 10px;
          background: #fff;
          color: var(--ink);
          padding: 10px 14px;
          font-weight: 800;
          text-decoration: none;
          cursor: pointer;
        }
        .brand {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 10px;
        }
        .brand-main { font-size: 30px; font-weight: 900; letter-spacing: 0; color: #111827; }
        .brand-main span { color: #04a855; }
        .brand-sub { font-size: 15px; font-weight: 800; color: #1a1f37; }
        .brand-sub span { color: #7b44ff; }
        .title-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fff;
          border-radius: 12px;
          padding: 9px 14px;
          font-weight: 900;
          margin-bottom: 10px;
        }
        .panel {
          background: #fff;
          border: 1px solid #e1e8f6;
          border-radius: 13px;
          margin-bottom: 10px;
          overflow: hidden;
        }
        .panel-inner { padding: 12px; }
        .hero {
          height: ${compact ? '180px' : '175px'};
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .hero img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          opacity: .96;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 10px;
        }
        .meta-card {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 9px 10px;
        }
        .meta-label { color: var(--muted); font-size: 9px; font-weight: 800; text-transform: uppercase; }
        .meta-value { font-size: 12px; font-weight: 900; margin-top: 3px; }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: ${compact ? '11px' : '10px'};
        }
        th, td {
          border: 1px solid var(--line);
          padding: 6px 7px;
          vertical-align: top;
        }
        th {
          background: #f8faff;
          text-align: left;
          font-weight: 900;
        }
        td.number, th.number { text-align: right; white-space: nowrap; }
        .line-source { color: var(--muted); font-size: 8px; font-weight: 700; margin-top: 2px; }
        .table-title {
          font-weight: 900;
          padding: 10px 12px 0;
        }
        .summary-row td {
          font-weight: 900;
          background: #fbfdff;
        }
        .green { color: var(--green); }
        .savings-grid {
          display: grid;
          grid-template-columns: 42% 1fr;
          gap: 20px;
          padding: 14px;
        }
        .bar-chart {
          height: 170px;
          display: flex;
          gap: 28px;
          align-items: end;
          border-left: 1px solid #6370a6;
          border-bottom: 1px solid #6370a6;
          padding-left: 38px;
        }
        .bar { width: 34px; border-radius: 5px 5px 0 0; }
        .bar.red { background: var(--red); }
        .bar.green-bg { background: #7ac99d; }
        .savings-card {
          background: #f1fbf5;
          border-radius: 11px;
          padding: 14px;
          align-self: center;
        }
        .saving-line {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 0;
          border-bottom: 1px solid #d7eadf;
          font-weight: 800;
        }
        .compare-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .compare-card {
          border: 1px solid #ffc0c0;
          border-radius: 12px;
          background: #fff;
          padding: 12px;
        }
        .compare-card.after { border-color: #55e59b; }
        .small-bars {
          display: flex;
          align-items: end;
          gap: 5px;
          height: 116px;
          border-bottom: 1px solid #d9e1ef;
          margin-top: 12px;
        }
        .small-bars div {
          flex: 1;
          background: linear-gradient(to top, #ffb13c, #ff7a00);
          border-radius: 4px 4px 0 0;
        }
        .energy-bars {
          height: 210px;
          display: flex;
          align-items: end;
          gap: 10px;
          border-left: 1px solid #d9e1ef;
          border-bottom: 1px solid #d9e1ef;
          padding: 0 10px;
        }
        .energy-month {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: end;
          height: 100%;
          gap: 5px;
        }
        .energy-bar {
          width: 100%;
          max-width: 34px;
          background: linear-gradient(to top, #ffb13c 0 45%, #ff7900 45% 84%, #00a65f 84% 100%);
          border-radius: 4px 4px 0 0;
        }
        .energy-label { font-size: 9px; color: var(--muted); }
        .text-block {
          font-size: 11px;
          line-height: 1.45;
          color: #26346d;
          white-space: pre-wrap;
        }
        @media print {
          body { margin: 0; background: #f4f7fc; }
          .offer-doc-root { padding: 0; background: #f4f7fc; }
          .offer-page {
            width: 210mm;
            min-height: 297mm;
            margin: 0;
            box-shadow: none;
            border-radius: 0;
            page-break-after: always;
          }
          .offer-actions { display: none; }
        }
      `}</style>

      {showActions ? (
        <div className="offer-actions">
          <a href="/admin/offers">Wróć do ofert</a>
          <button type="button" onClick={() => window.print()}>Drukuj / zapisz PDF</button>
        </div>
      ) : null}

      <section className="offer-page">
        <div className="brand">
          <div className="brand-main"><span>Re:</span>form</div>
          <div className="brand-sub">provided by on<span>Re:</span>volt</div>
        </div>
        <div className="title-strip">
          <span>Oferta</span>
          <span>Nr {offer.number || '-'}</span>
        </div>

        <div className="meta-grid">
          <div className="meta-card"><div className="meta-label">Klient</div><div className="meta-value">{client.clientName || '-'}</div></div>
          <div className="meta-card"><div className="meta-label">Projekt</div><div className="meta-value">{client.projectTitle || offer.title || '-'}</div></div>
          <div className="meta-card"><div className="meta-label">Typ</div><div className="meta-value">{clientTypeLabel(client.clientType)}</div></div>
          <div className="meta-card"><div className="meta-label">Ważna do</div><div className="meta-value">{dateLabel(offer.validUntil)}</div></div>
        </div>

        <div className="panel hero">
          <Image
            src="/img/onrevolt/aniamcja_warstwa_1-min.png"
            alt="onRevolt system"
            width={1200}
            height={750}
            priority
            style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.96, transform: 'scale(2.15)' }}
          />
        </div>

        <div className="panel">
          <div className="table-title">Kosztorys</div>
          <div className="panel-inner">
            <table>
              <thead>
                <tr>
                  <th>Nr</th>
                  <th>Pozycja</th>
                  <th>Model</th>
                  <th className="number">Ilość</th>
                  <th className="number">Cena jednostkowa brutto</th>
                  <th className="number">Wartość brutto</th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.map((line, index) => {
                  const quantity = numberValue(line.quantity);
                  const gross = numberValue(line.saleGross);
                  const unit = quantity > 0 ? gross / quantity : gross;
                  return (
                    <tr key={`${line.position}-${index}`}>
                      <td>{line.position || index + 1}</td>
                      <td>
                        <div>{line.description || line.name || '-'}</div>
                        {line.sourceConfigurationName ? (
                          <div className="line-source">Zakres: {line.sourceConfigurationName}</div>
                        ) : null}
                      </td>
                      <td>{line.model || line.sku || line.producer || '-'}</td>
                      <td className="number">{quantity}</td>
                      <td className="number">{money(unit)} PLN</td>
                      <td className="number">{money(gross)} PLN</td>
                    </tr>
                  );
                })}
                {lines.length > visibleLines.length ? (
                  <tr>
                    <td colSpan={6}>Pozostałe pozycje w pełnym zestawieniu: {lines.length - visibleLines.length}</td>
                  </tr>
                ) : null}
                <tr className="summary-row"><td colSpan={5}>Wartość netto</td><td className="number">{money(calc.totalNet)} PLN</td></tr>
                {calc.vatBreakdown.map((row: any) => (
                  <tr className="summary-row" key={row.rate}>
                    <td colSpan={5}>VAT {numberValue(row.rate) * 100}%</td>
                    <td className="number">{money(row.vat)} PLN</td>
                  </tr>
                ))}
                <tr className="summary-row"><td colSpan={5}>Koszt systemu brutto</td><td className="number">{money(calc.totalGross)} PLN</td></tr>
                <tr className="summary-row"><td colSpan={5}>Prognozowana kwota dotacji</td><td className="number">{money(calc.subsidyGross)} PLN</td></tr>
                <tr className="summary-row"><td colSpan={5}>Prognozowana ulga termomodernizacyjna</td><td className="number">{money(calc.thermoReliefGross)} PLN</td></tr>
                <tr className="summary-row green"><td colSpan={5}>Prognozowany koszt systemu po dofinansowaniach</td><td className="number">{money(calc.totalAfterSupportGross)} PLN</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="table-title">Twoja prognozowana oszczędność</div>
          <div className="savings-grid">
            <div className="bar-chart">
              <div className="bar red" style={{ height: hasSavings ? '82%' : '12%' }} />
              <div className="bar green-bg" style={{ height: hasSavings ? `${Math.max(8, Math.min(82, (calc.projectedAnnualBillGross / Math.max(calc.currentAnnualBillGross, 1)) * 82))}%` : '12%' }} />
            </div>
            <div className="savings-card">
              <div className="saving-line"><span>Twój aktualny rachunek roczny</span><span>{money(calc.currentAnnualBillGross)} PLN</span></div>
              <div className="saving-line"><span>Twój nowy rachunek z systemem</span><span>{money(calc.projectedAnnualBillGross)} PLN</span></div>
              <div className="saving-line green"><span>Oszczędność {percent(calc.savingsPercent)}%</span><span>{money(calc.annualSavingsGross)} PLN</span></div>
              <div className="saving-line"><span>Czas zwrotu z inwestycji</span><span>{calc.paybackYears ? `${money(calc.paybackYears)} lat` : '-'}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="offer-page">
        <div className="brand">
          <div className="brand-main"><span>Re:</span>form</div>
          <div className="brand-sub">provided by on<span>Re:</span>volt</div>
        </div>
        <div className="title-strip">
          <span>Porównanie rachunków rocznych</span>
          <span>Nr {offer.number || '-'}</span>
        </div>

        <div className="compare-grid">
          <div className="compare-card">
            <h3>Aktualna taryfa i system rozliczeniowy</h3>
            <div className="meta-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="meta-card"><div className="meta-label">Taryfa</div><div className="meta-value">{offer.tariffBefore || '-'}</div></div>
              <div className="meta-card"><div className="meta-label">System</div><div className="meta-value">{offer.settlementBefore || '-'}</div></div>
            </div>
            <div className="small-bars">
              {[35, 52, 72, 64, 45, 84, 68, 55].map((height, index) => <div key={index} style={{ height: `${height}%` }} />)}
            </div>
            <div className="saving-line"><span>Aktualny rachunek roczny</span><span>{money(calc.currentAnnualBillGross)} PLN</span></div>
          </div>
          <div className="compare-card after">
            <h3>Nowa taryfa i system rozliczeniowy</h3>
            <div className="meta-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="meta-card"><div className="meta-label">Taryfa</div><div className="meta-value">{offer.tariffAfter || '-'}</div></div>
              <div className="meta-card"><div className="meta-label">System</div><div className="meta-value">{offer.settlementAfter || '-'}</div></div>
            </div>
            <div className="small-bars">
              {[24, 36, 42, 38, 30, 46, 41, 35].map((height, index) => <div key={index} style={{ height: `${height}%`, background: 'linear-gradient(to top, #88d8a7, #20b86a)' }} />)}
            </div>
            <div className="saving-line"><span>Prognozowany rachunek roczny</span><span>{money(calc.projectedAnnualBillGross)} PLN</span></div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="table-title">Opis oferty</div>
          <div className="panel-inner text-block">
            <strong>PRZED:</strong> {offer.descriptionBefore || 'Uzupełnij opis aktualnej sytuacji klienta, taryfy, problemów z rozliczeniem i oczekiwań przed wysłaniem oferty.'}
            {'\n\n'}
            <strong>PO:</strong> {offer.descriptionAfter || 'Uzupełnij opis proponowanego rozwiązania, sposobu pracy systemu i oczekiwanej poprawy bilansu energii.'}
          </div>
        </div>

        <div className="panel">
          <div className="table-title">Status oferty</div>
          <div className="panel-inner">
            <div className="meta-grid">
              <div className="meta-card"><div className="meta-label">Status</div><div className="meta-value">{statusLabel(offer.status)}</div></div>
              <div className="meta-card"><div className="meta-label">Wersja</div><div className="meta-value">v{offer.version || 1}</div></div>
              <div className="meta-card"><div className="meta-label">Utworzono</div><div className="meta-value">{dateLabel(offer.createdAt)}</div></div>
              <div className="meta-card"><div className="meta-label">Adres inwestycji</div><div className="meta-value">{client.investmentAddress || '-'}</div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="offer-page">
        <div className="brand">
          <div className="brand-main"><span>Re:</span>form</div>
          <div className="brand-sub">provided by on<span>Re:</span>volt</div>
        </div>
        <div className="title-strip">
          <span>Roczny bilans energetyczny</span>
          <span>Nr {offer.number || '-'}</span>
        </div>

        <div className="panel">
          <div className="table-title">Aktualny stan</div>
          <div className="panel-inner">
            <div className="energy-bars">
              {currentBars.map((bar) => (
                <div className="energy-month" key={bar.label}>
                  <div className="energy-bar" title={`${money(bar.raw)} kWh`} style={{ height: `${bar.value}%` }} />
                  <div className="energy-label">{bar.label}</div>
                </div>
              ))}
            </div>
            <div className="meta-grid" style={{ marginTop: 12 }}>
              <div className="meta-card"><div className="meta-label">Pliki pomiarowe</div><div className="meta-value">{energy.measurementFiles || 0}</div></div>
              <div className="meta-card"><div className="meta-label">Miesiące</div><div className="meta-value">{energy.measurementMonths?.length || 0}</div></div>
              <div className="meta-card"><div className="meta-label">Rachunek roczny</div><div className="meta-value">{money(calc.currentAnnualBillGross)} PLN</div></div>
              <div className="meta-card"><div className="meta-label">Oferta</div><div className="meta-value">{money(calc.totalAfterSupportGross)} PLN</div></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="table-title">Prognozowany stan z systemem</div>
          <div className="panel-inner">
            <div className="energy-bars">
              {projectedBars.map((bar) => (
                <div className="energy-month" key={bar.label}>
                  <div className="energy-bar" title={`${money(bar.raw)} kWh z sieci`} style={{ height: `${bar.value}%`, background: 'linear-gradient(to top, #21b869, #00a3ff)' }} />
                  <div className="energy-label">{bar.label}</div>
                </div>
              ))}
            </div>
            <div className="meta-grid" style={{ marginTop: 12 }}>
              <div className="meta-card"><div className="meta-label">Prognozowany rachunek</div><div className="meta-value">{money(calc.projectedAnnualBillGross)} PLN</div></div>
              <div className="meta-card"><div className="meta-label">Oszczędność roczna</div><div className="meta-value green">{money(calc.annualSavingsGross)} PLN</div></div>
              <div className="meta-card"><div className="meta-label">Zwrot</div><div className="meta-value">{calc.paybackYears ? `${money(calc.paybackYears)} lat` : '-'}</div></div>
              <div className="meta-card"><div className="meta-label">Dane OSD</div><div className="meta-value">{energy.measurementMonths?.join(', ') || 'Do uzupełnienia'}</div></div>
            </div>
            {energy.scenario ? (
              <div className="meta-grid">
                <div className="meta-card"><div className="meta-label">Wariant</div><div className="meta-value">{energy.scenario.name}</div></div>
                <div className="meta-card"><div className="meta-label">PV</div><div className="meta-value">{energy.scenario.pvPowerKw} kWp</div></div>
                <div className="meta-card"><div className="meta-label">Magazyn</div><div className="meta-value">{energy.scenario.batteryCapacityKwh} kWh</div></div>
                <div className="meta-card"><div className="meta-label">Silnik</div><div className="meta-value">{energy.scenario.engineVersion}</div></div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
