export type TariffPriceOverride = { net: number; vatRate: number };
export type ClientTariffSchedule = {
  zone_model: 'all' | 'daynight' | 'peakoffpeak' | 'highmidlow';
  use_monthly: true;
  monthly: Record<string, number[]>;
  cheap_saturday: boolean;
  cheap_sunday: boolean;
};
export type ClientTariffPeriod = {
  id: string;
  validFrom: string | null;
  validUntil: string | null;
  osdId: number;
  tariffId: number;
  source: 'MANUAL' | 'ENEA';
  overrides: Record<string, TariffPriceOverride>;
  schedule: ClientTariffSchedule | null;
  note: string;
};
export type ClientTariffProfile = {
  id: string; project_id: string; client_id: string; ppe: string | null; station: string | null;
  revision: number; periods: ClientTariffPeriod[];
};
export type TariffCatalogRow = {
  component_key: string; label: string; net: number; gross: number; vatRate: number;
  window_code?: string; amount_mode?: string; billing_cycle_months?: number | null;
  annual_usage_min_kwh?: number | null; annual_usage_max_kwh?: number | null;
};
export type ClientTariffPayload = {
  osd_id: number; osd_name?: string; tariff_id: number; code: string; name: string; segment: string;
  zone_model: ClientTariffSchedule['zone_model']; use_monthly: boolean;
  monthly?: Record<string, number[]>; dn_night?: number[]; po_off?: number[];
  cheap_saturday?: boolean; cheap_sunday?: boolean;
  fixed: Array<Record<string, any>>; variable: Array<Record<string, any>>;
  pricing: { tariffStorage: { priceBasis: 'net'; vatRate: number; validFrom: string; fixed: TariffCatalogRow[]; variable: TariffCatalogRow[] } };
  catalogRevision?: number;
};
export type ClientTariffHistory = {
  strict: true; revision: number; byDate: Record<string, ClientTariffPayload | string | null>;
  format?: string; tariffs?: Record<string, ClientTariffPayload>;
  issues: Array<{ date: string; message: string }>;
};
export type GeneralTariffSelection = { operator: string; code: string; osdId?: number; tariffId?: number };
export type ClientTariffData = {
  profile: ClientTariffProfile | null;
  generalTariff?: GeneralTariffSelection | null;
  generalTariffSource?: 'RE' | 'CRM';
  targetTariff?: GeneralTariffSelection | null;
  assignedStation: string | null;
  evidence: Array<{ id: string; valid_from: string; valid_until: string; tariff_code: string | null; evidence: { message?: string; reason?: string } }>;
  resolved: Record<string, { ok: boolean; tariff?: ClientTariffPayload; error?: string }>;
  catalog: Array<{ id: number; name: string; slug: string; tariffs: Array<{ id: number; code: string; name: string }> }>;
  canEdit: boolean;
};

export const tariffToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());

export function projectGeneralTariff(accounts: Array<{ operator?: string | null; tariff?: string | null }>) {
  const account = accounts.find(item => item.operator === 'ENEA') || accounts[0];
  if (!account) return null;
  const operator = account.operator?.trim() || '';
  const code = account.tariff?.trim() || '';
  return operator || code ? { operator, code } : null;
}

export function generalTariffSummary(selection: ClientTariffData['generalTariff']) {
  if (!selection?.code) return selection?.operator
    ? `${selection.operator} · Nie wybrano taryfy`
    : 'Nie wybrano operatora ani taryfy';
  return `${selection.operator || 'Nie wybrano operatora'} · ${selection.code}`;
}

export function clientTariffAt(history: ClientTariffHistory | null | undefined, date: string) {
  const entry = history?.byDate[date];
  return typeof entry === 'string' ? history?.tariffs?.[entry] : entry;
}

export function tariffScenarioCalendar(profile?: { months: Array<{ year: number; month: number }> } | null) {
  const currentYear = Number(tariffToday().slice(0, 4));
  const calendarYearsByMonth = Array.from({ length: 12 }, (_, index) => {
    const years = Array.from(new Set((profile?.months || []).filter(m => m.month === index + 1).map(m => m.year)));
    if (years.length > 1) throw new Error('Profil zawiera kilka lat dla tego samego miesiąca. Wybierz jeden rok rozliczenia.');
    return years[0] || currentYear;
  });
  return { scenarioYear: currentYear, calendarYearsByMonth,
    from: `${Math.min(currentYear, ...calendarYearsByMonth)}-01-01`, until: `${Math.max(currentYear, ...calendarYearsByMonth) + 1}-01-01` };
}

export function tariffScenarioIssue(history: ClientTariffHistory, years: number[]) {
  return history.issues.find(issue => years[Number(issue.date.slice(5, 7)) - 1] === Number(issue.date.slice(0, 4)));
}

export function tariffPeriodLabel(period: Pick<ClientTariffPeriod, 'validFrom' | 'validUntil'>) {
  const until = period.validUntil ? new Date(`${period.validUntil}T00:00:00Z`) : null;
  until?.setUTCDate(until.getUTCDate() - 1);
  return `${period.validFrom || 'Od początku danych'} – ${until?.toISOString().slice(0, 10) || 'bez daty końcowej'}`;
}

export function tariffSchedule(tariff: ClientTariffPayload): ClientTariffSchedule {
  const model = tariff.zone_model;
  return { zone_model: model, use_monthly: true,
    cheap_saturday: Boolean(tariff.cheap_saturday), cheap_sunday: Boolean(tariff.cheap_sunday),
    monthly: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), Array.from({ length: 24 }, (_, h) => {
      if (model === 'all') return 1;
      if (tariff.use_monthly && tariff.monthly?.[String(i + 1)]) return tariff.monthly[String(i + 1)][h];
      if (model === 'daynight') return tariff.dn_night?.includes(h) ? 1 : 2;
      if (model === 'peakoffpeak') return tariff.po_off?.includes(h) ? 1 : 2;
      throw new Error('Brak kompletnego harmonogramu trzystrefowego.');
    })])) };
}
