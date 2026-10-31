'use client';

import { Box, Badge, Flex, Tooltip } from '@chakra-ui/react';
import OfferWorkspacePanel from 'components/onrevolt/OfferWorkspacePanel';
import { emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { useLayoutEffect, useState } from 'react';
import dayProfiles from './day-profiles.json';

const revision = 'a'.repeat(64);
const previewPeriodsByMonth = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const importValues = [1260.919, 1474.595, 1875.929, 2408.831, 1667.391, 968.881, 722.487, 601.707, 659.597, 407.397, 398.234, 1084.769];
const exportValues = [180.436, 49.101, 27.892, 51.543, 191.118, 708.296, 822.579, 931.969, 903.693, 964.236, 930.410, 74.478];
const previewMonths = importValues.map((importKwh, index) => ({
  period: previewPeriodsByMonth[index],
  importKwh,
  exportKwh: exportValues[index],
}));
const monthlyImportTotal = importValues.reduce((sum, value) => sum + value, 0);
const monthlyExportTotal = exportValues.reduce((sum, value) => sum + value, 0);

const valuesQaEnergyMonths = previewPeriodsByMonth.map((period, index) => ({
  period,
  loadKwh: 120 + index * 7,
  pvKwh: 40 + index * 3,
  directKwh: 24 + index * 2,
}));
const valuesQaEnergyDays = dayProfiles.map((day) => ({
  date: day.date,
  hours: day.hours.map(({ hour }) => {
    const pvKwh = hour >= 8 && hour <= 16 ? Math.max(0, 3 - Math.abs(12 - hour) * 0.45) : 0;
    const loadKwh = 0.8 + (hour % 5) * 0.17;
    return { hour, loadKwh, pvKwh, directKwh: Math.min(loadKwh, pvKwh) };
  }),
}));
const valuesQaEnergyTotals = valuesQaEnergyMonths.reduce((totals, month) => ({
  loadKwh: totals.loadKwh + month.loadKwh,
  pvKwh: totals.pvKwh + month.pvKwh,
  directKwh: totals.directKwh + month.directKwh,
}), { loadKwh: 0, pvKwh: 0, directKwh: 0 });

function valuesQaValuationValues(importKwh: number, exportKwh: number, buy: number, sell: number) {
  return {
    importKwh,
    exportKwh,
    importValuePln: Math.round(importKwh * buy * 100) / 100,
    exportValuePln: Math.round(exportKwh * sell * 100) / 100,
    averageBuyPlnPerKwh: buy,
    averageSellPlnPerKwh: sell,
  };
}

function valuesQaValuationScenario(buy: number, sell: number, settlement: 'NET_METERING' | 'NET_BILLING', source: 'PROJECT_HISTORY' | 'CURRENT_CATALOG') {
  const months = previewMonths.map((month) => ({ period: month.period, ...valuesQaValuationValues(month.importKwh, month.exportKwh, buy, sell) }));
  const days = dayProfiles.map((day) => {
    const hours = day.hours.map((reading) => ({ hour: reading.hour, ...valuesQaValuationValues(reading.importKwh, reading.exportKwh, buy, sell) }));
    const sum = (key: 'importKwh' | 'exportKwh' | 'importValuePln' | 'exportValuePln') => hours.reduce((total, row) => total + row[key], 0);
    return {
      date: day.date,
      period: day.period,
      dayType: day.dayType,
      totals: { ...valuesQaValuationValues(sum('importKwh'), sum('exportKwh'), buy, sell), importValuePln: sum('importValuePln'), exportValuePln: sum('exportValuePln') },
      hours,
    };
  });
  return {
    settlement,
    source,
    totals: valuesQaValuationValues(monthlyImportTotal, monthlyExportTotal, buy, sell),
    months,
    days,
    issues: [],
  };
}

const valuesQaEnergy = {
  quality: 'MODELLED',
  source: 'Syntetyczne dane QA',
  model: 'VALUES_QA_FIXTURE_V1',
  months: valuesQaEnergyMonths,
  dayProfiles: valuesQaEnergyDays,
  totals: valuesQaEnergyTotals,
  issues: [],
  modelBelowExportKwh: 0,
};
const valuesQaValuation = {
  vatBasis: 'GROSS',
  current: valuesQaValuationScenario(0.8123, 0.2345, 'NET_BILLING', 'PROJECT_HISTORY'),
  target: valuesQaValuationScenario(0.7654, 0.1987, 'NET_METERING', 'CURRENT_CATALOG'),
};

function valuesQaTariff(tariffId: number, code: string) {
  const variable = [{ component_key: 'energy', label: 'Energia czynna · QA', net: 0.5, gross: 0.615, vatRate: 0.23, window_code: 'all' }];
  const fixed = [{ component_key: 'subscription', label: 'Opłata abonamentowa · QA', net: 12, gross: 14.76, vatRate: 0.23, amount_mode: 'per_month', billing_cycle_months: 1 }];
  return {
    osd_id: 1,
    osd_name: 'ENEA Operator',
    tariff_id: tariffId,
    code,
    name: `Taryfa ${code} · QA`,
    segment: 'B2C',
    zone_model: 'all',
    use_monthly: true,
    fixed: fixed.map((row) => ({ ...row, amount: row.net })),
    variable: variable.map((row) => ({ ...row, price: row.net })),
    pricing: { tariffStorage: { priceBasis: 'net', vatRate: 0.23, validFrom: '2026-01-01', fixed, variable } },
    catalogRevision: 1,
  };
}

const valuesQaCurrentTariff = valuesQaTariff(11, 'G11');
const valuesQaTargetTariff = valuesQaTariff(12, 'G12');

const initialDraft = {
  ...emptyOfferWorkspaceDraft(),
  existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170, lossPercent: null },
  pvStrategy: 'ADD_TEMPLATE' as const,
  currentSettlement: 'NET_METERING' as const,
  targetSettlement: 'NET_METERING' as const,
  selectedTemplateIds: ['preview-storage-16', 'preview-pv-10'],
  targetOperatorId: 1,
  targetTariffId: 12,
  saleVatMode: 'MIXED' as const,
  financing: { considerGrant: true, considerTaxRelief: true },
  description: {
    before: 'Opis testowy z dłuższą treścią, przygotowany wyłącznie do sprawdzenia zawijania tekstu na różnych szerokościach. Nie opisuje żadnego klienta ani rzeczywistej oferty. '.repeat(2),
    after: 'Przykładowy zakres obejmuje dobór magazynu energii oraz analizę istniejącej instalacji fotowoltaicznej. Tekst jest syntetyczny, dłuższy celowo i służy wyłącznie do kontroli układu interfejsu na desktopie i telefonie.',
  },
};

const initialSavedDraft = {
  revision: 1,
  sourceRevision: revision,
  updatedAt: '2026-10-29T12:00:00.000Z',
  input: initialDraft,
};

const templates = [
  {
    id: 'preview-storage-16', familyKey: 'preview-storage', name: 'Pakiet magazynu · 16,00 kWh', version: 1,
    kind: 'MAGAZYN', clientType: 'B2C', roofType: null, goal: 'STORAGE_RETROFIT', powerKw: 10, capacityKwh: 16,
    sortOrder: 1, requiresExistingPv: true, requiresExistingInverter: false, notes: null,
    items: [{ id: 'preview-item-battery', position: 1, description: null, quantity: 1, role: 'MAIN_EQUIPMENT', supplyMode: 'ONREVOLT_SUPPLIED', unitPurchaseNet: 5000, purchaseVatRate: 0.23, operatingCostNet: 0, marginRate: 0.3, saleVatRate: 0.23, isOptional: false, requiresReview: false, product: null }],
  },
  {
    id: 'preview-pv-10', familyKey: 'preview-pv', name: 'Rozbudowa PV · 1,900 kWp', version: 2,
    kind: 'PV_DACH_SKOSNY', clientType: 'B2C', roofType: 'SLOPED', goal: 'NEW_PV', powerKw: 1.9, capacityKwh: null,
    sortOrder: 2, requiresExistingPv: false, requiresExistingInverter: false, notes: null,
    items: [{ id: 'preview-item-pv', position: 1, description: null, quantity: 1, role: 'MAIN_EQUIPMENT', supplyMode: 'ONREVOLT_SUPPLIED', unitPurchaseNet: 7000, purchaseVatRate: 0.23, operatingCostNet: 0, marginRate: 0.3, saleVatRate: 0.23, isOptional: false, requiresReview: true, product: null }],
  },
];

export default function OfferWorkspacePreviewClient() {
  const [nullCase, setNullCase] = useState(false);
  const [valuesQa, setValuesQa] = useState(false);
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let draftRevision = initialSavedDraft.revision;
    const query = new URLSearchParams(window.location.search);
    const isValuesQa = query.get('valuesQa') === '1';
    const qaWindow = window as Window & { __offerWorkspaceValuesQaCalls?: string[] };
    if (isValuesQa) qaWindow.__offerWorkspaceValuesQaCalls = [];
    const recordValuesQaCall = (name: string) => {
      if (isValuesQa) qaWindow.__offerWorkspaceValuesQaCalls?.push(name);
    };
    const valuesQaDraft = {
      ...initialDraft,
      currentSettlement: 'NET_BILLING' as const,
      selectedTemplateIds: [],
      saleVatMode: 'REVIEW' as const,
    };
    let serverDraft: { revision: number; sourceRevision: string; updatedAt: string; input: Record<string, unknown> } | null = isValuesQa
      ? { ...initialSavedDraft, input: valuesQaDraft }
      : initialSavedDraft;
    setValuesQa(isValuesQa);
    setNullCase(query.get('nullCase') === '1');
    if (query.get('clearCache') === '1') window.sessionStorage.removeItem('onrevolt:offer-workspace:fixture-user:workspace-preview');
    let conflictOnFirstSave = query.get('conflict') === '1';
    let failNextWorkspaceLoad = false;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method || 'GET';
      const payload = (data: unknown, status = 200) => new Response(JSON.stringify({ ok: status < 400, data, ...(status >= 400 ? { error: 'Fixture error' } : {}) }), { status, headers: { 'Content-Type': 'application/json' } });

      if (url.includes('/api/projects/workspace-preview/offer-workspace') && method === 'GET') {
        recordValuesQaCall('workspace');
        if (failNextWorkspaceLoad) {
          failNextWorkspaceLoad = false;
          return payload(null, 503);
        }
        const months = query.get('nullCase') === '1'
          ? previewMonths.map((month) => month.period === '2026-09' ? { ...month, exportKwh: null } : month)
          : previewMonths;
        const periods = months.map(({ period, exportKwh }) => ({ period, hasImport: true, hasExport: exportKwh !== null, missingDirections: exportKwh === null ? ['ACTIVE_EXPORT'] : [] }));
        const missing = months.flatMap(({ period, exportKwh }) => exportKwh === null ? [{ period, kind: 'ACTIVE_EXPORT' }] : []);
        const totalExport = months.reduce((sum, month) => sum + (month.exportKwh ?? 0), 0);
        const availableTemplates = query.get('choices') === '1'
          ? [...templates, { ...templates[0], id: 'preview-storage-32', name: 'Pakiet magazynu · 32,00 kWh', capacityKwh: 32 }, { ...templates[1], id: 'preview-pv-4', name: 'Rozbudowa PV · 3,800 kWp', powerKw: 3.8 }]
          : templates;
        return payload({
          projectId: 'workspace-preview', clientId: 'client-preview', projectName: 'Projekt testowy', clientName: 'Klient testowy', clientType: 'B2C', ppeNumber: null, revision,
          input: { existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170 }, location: { address: 'Adres testowy, bez lokalizacji klienta', latitude: null, longitude: null }, settlementMode: isValuesQa ? 'NET_BILLING' : 'NET_METERING', annualConsumptionKwh: null, issues: [], reportDetails: { email: 'klient@example.invalid', phone: null, terrain: 'Teren podmiejski', buildingType: 'Dom jednorodzinny', roofType: 'Dwuspadowy', connectionType: 'Niskie napięcie', connectionPowerKw: 16, heatingSource: 'Gaz ziemny', heatingDetails: 'Piec kondensacyjny', supplier: 'Enea' } },
          measurements: { periods, months, dayProfiles: query.get('nullCase') === '1' ? dayProfiles.filter(day => day.period !== '2026-09') : dayProfiles, totalsImportKwh: monthlyImportTotal, totalsExportKwh: totalExport, intervalCount: 8760, missingDirections: missing, issues: [] },
          templates: query.get('longNames') === '1' ? availableTemplates.map((template) => ({ ...template, name: `${template.name} — bardzo długa nazwa zestawu katalogowego do kontroli zawijania tekstu na małych ekranach` })) : availableTemplates, draft: serverDraft,
        });
      }
      if (isValuesQa && method === 'POST' && url.endsWith('/offer-workspace/energy')) {
        recordValuesQaCall('energy');
        return payload(valuesQaEnergy);
      }
      if (isValuesQa && method === 'POST' && url.endsWith('/offer-workspace/valuation')) {
        recordValuesQaCall('valuation');
        return payload(valuesQaValuation);
      }
      if (url.includes('/api/crm/projects/tariffs')) {
        if (new URL(url, window.location.origin).searchParams.get('action') === 'catalog') {
          if (isValuesQa) {
            recordValuesQaCall('rates:catalog');
            return payload(valuesQaTargetTariff);
          }
          return new Response(JSON.stringify({ ok: false, error: 'Podgląd testowy nie zawiera cennika taryfy.' }), {
            status: 422, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (isValuesQa) {
          recordValuesQaCall('rates:profile');
          return payload({
            profile: { periods: [{ id: 'preview-current-tariff', validFrom: '2026-01-01', validUntil: null, osdId: 1, tariffId: 11, source: 'MANUAL', overrides: {}, schedule: null, note: '' }] },
            resolved: { 'preview-current-tariff': { ok: true, tariff: valuesQaCurrentTariff } },
            generalTariff: { operator: 'ENEA', code: 'G11', osdId: 1, tariffId: 11 },
            targetTariff: { operator: 'ENEA', code: 'G12', osdId: 1, tariffId: 12 },
            catalog: [{ id: 1, name: 'ENEA Operator', slug: 'enea', tariffs: [{ id: 11, code: 'G11', name: 'Jednostrefowa' }, { id: 12, code: 'G12', name: 'Dwustrefowa' }] }],
          });
        }
        return payload({
          profile: { periods: [{ id: 'preview-current-tariff', validFrom: '2026-01-01', validUntil: null, osdId: 1, tariffId: 11, source: 'MANUAL' }] },
          resolved: { 'preview-current-tariff': { ok: false, error: 'Podgląd testowy nie zawiera cennika historycznego.' } },
          generalTariff: { operator: 'ENEA', code: 'G11', osdId: 1, tariffId: 11 },
          targetTariff: { operator: 'ENEA', code: 'G12', osdId: 1, tariffId: 12 },
          catalog: [{ id: 1, name: 'ENEA Operator', slug: 'enea', tariffs: [{ id: 11, code: 'G11', name: 'Jednostrefowa' }, { id: 12, code: 'G12', name: 'Dwustrefowa' }] }],
        });
      }
      if (url.includes('/api/projects/workspace-preview/offer-workspace') && method === 'PUT') {
        recordValuesQaCall('write-attempt');
        if (isValuesQa) return payload({ error: 'Zapis jest wyłączony w syntetycznym QA.' }, 403);
        await new Promise((resolve) => window.setTimeout(resolve, 4000));
        const body = JSON.parse(String(init?.body || '{}'));
        if (conflictOnFirstSave) {
          conflictOnFirstSave = false;
          const serverInput = {
            ...body.input,
            description: { before: 'Zapis z innej karty', after: 'Aktualny szkic z serwera' },
          };
          serverDraft = { revision: ++draftRevision, sourceRevision: revision, updatedAt: new Date().toISOString(), input: serverInput };
          failNextWorkspaceLoad = query.get('refreshFails') === '1';
          return payload({ error: 'Stale workspace revision' }, 409);
        }
        draftRevision += 1;
        serverDraft = { revision: draftRevision, sourceRevision: revision, updatedAt: new Date().toISOString(), input: body.input };
        return payload(serverDraft);
      }
      return originalFetch(input, init);
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  return <Box p={{ base: '12px', md: '28px' }} maxW="1600px" mx="auto">
    <Flex justify="end" mb="12px"><Tooltip label={valuesQa ? 'QA · wyłącznie syntetyczne odpowiedzi valuation, rates i energy. Edycja oraz zapis wyłączone.' : `Dane testowe, bez zapisu do produkcji. 24 pliki, 8760 godzin. Import 13530,737 kWh, eksport ${nullCase ? '5761,273 kWh (brak odczytu)' : '5835,751 kWh'}. PV 9,9 kWp, 40°, 170°.`}><Badge colorScheme="orange" fontSize="10px">{valuesQa ? 'QA · wartości syntetyczne · zapis wyłączony' : 'Podgląd testowy · bez zapisu na produkcji'}</Badge></Tooltip></Flex>
    <OfferWorkspacePanel projectId="workspace-preview" actorId={valuesQa ? 'values-qa-fixture' : 'fixture-user'} canEdit={!valuesQa} templatePreview={!valuesQa} />
  </Box>;
}
