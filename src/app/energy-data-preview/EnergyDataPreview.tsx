'use client';

import { useState } from 'react';
import { Box, Button, Input, SimpleGrid, FormControl, FormLabel, useColorMode } from '@chakra-ui/react';
import ClientEnergyWorkspace, { type EnergyWorkspaceSettings } from 'components/onrevolt/ClientEnergyWorkspace';
import ClientEnergySummary, { type ClientEnergyMeasurements } from 'components/onrevolt/ClientEnergySummary';
import ClientDocumentsPanel from 'components/onrevolt/ClientDocumentsPanel';
import ClientEnergyPv from 'components/onrevolt/ClientEnergyPv';
import ClientAnalysisPeriod from 'components/onrevolt/ClientAnalysisPeriod';
import { resolveProjectAnalysisPeriod } from 'lib/onrevolt/project-analysis-period';

const imports = [580, 520, 550, 810, 1110, 1320, 1510, 1630, 1380, 1100, 890, 690];
const exports = [740, 750, 600, 480, 300, 130, 90, 90, 140, 360, 510, 720];
const months = imports.map((value, index) => {
  const date = new Date(Date.UTC(2025, 9 + index, 1));
  const period = date.toISOString().slice(0, 7);
  return { period, importKwh: value, exportKwh: exports[index], importAvailable: true, exportAvailable: true };
});
const data: ClientEnergyMeasurements = {
  months, issues: [],
  days: months.map(month => ({ date: `${month.period}-15`, period: month.period,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour,
      importKwh: hour < 7 || hour > 17 ? 1.2 + hour % 3 * 0.2 : 0.2,
      exportKwh: hour > 7 && hour < 17 ? Math.max(0, 4 - Math.abs(12 - hour)) : 0,
    })),
  })),
};
const initial: EnergyWorkspaceSettings = {
  hasOperatorData: true, hasEnergyInvoices: true, annualConsumptionKwh: '16000',
  terrainType: 'SUBURBAN', buildingType: 'SINGLE_FAMILY', roofShape: 'GABLE_BARN',
  settlementSystem: 'net-metering', energySupplier: 'ENEA', connectionType: 'LOW_VOLTAGE',
  heatingSource: 'ELECTRICITY', heatingSourceDetail: '', connectionPowerKw: '16',
  existingPvKw: '9.9', existingBatteryKwh: '0', phaseCount: '3',
};

export default function EnergyDataPreview() {
  const [settings, setSettings] = useState(initial);
  const [account, setAccount] = useState({ operator: 'ENEA', tariff: 'G11' });
  const [saved, setSaved] = useState('');
  const [startMonth, setStartMonth] = useState('2025-06');
  const period = resolveProjectAnalysisPeriod(startMonth);
  const selectedData: ClientEnergyMeasurements = {
    months: period.periodKeys.map(key => data.months.find(month => month.period === key) || {
      period: key, importKwh: null, exportKwh: null, importAvailable: false, exportAvailable: false,
    }),
    days: data.days.filter(day => period.periodKeys.includes(day.period)), issues: [],
    cost: {
      status: 'partial', vatBasis: 'GROSS', totalPln: 4321.56,
      energyPln: 4800, distributionPln: 2100, fixedPln: 600,
      exportValuePln: null, settlementBenefitPln: 3178.44, settled: true,
      pricedHours: 8759, totalHours: 8760, tariffLabels: ['ENEA G11'], issues: [],
      assumptions: ['Początkowe saldo opustu: 0 kWh.', 'Dla 245 dni bez historycznych cen przyjęto aktualny cennik tej samej taryfy G11.'],
    },
    pv: {
      productionKwh: 10250,
      selfConsumptionKwh: 3820,
      coveredMonths: period.periodKeys.filter(key => data.months.some(month => month.period === key)).length,
      totalMonths: 12,
      modelUrl: 'https://my.onrevolt.com/pv/?mode=manual&lat=52.314718&lon=16.952871&capacityKwp=9.9&tilt=40&azimuth=170&lossPercent=12',
      note: 'Przykładowy szacunek do kontroli układu.', issues: [],
    },
  };
  const [pvGeometry, setPvGeometry] = useState({ tiltDegrees: '40', azimuthDegrees: '170', lossPercent: '12' });
  const { toggleColorMode } = useColorMode();
  return <Box bg="#f4f7fe" minH="100vh" p={{ base: '10px', md: '24px' }}>
    <Box mb="16px" fontSize="12px" color="#2b3674">Lokalny podgląd testowy. Przykładowe dane, bez zapisu do bazy. <Button size="xs" onClick={toggleColorMode}>Zmień motyw</Button></Box>
    <ClientEnergyWorkspace settings={settings} onChange={(key, value) => setSettings(current => ({ ...current, [key]: value }))}
      analysisPeriod={<ClientAnalysisPeriod state={{ period,
        source: { projectId: 'preview', storedStartMonth: startMonth, period }, loading: false, saving: false, error: '',
        reload() {}, async change(value) { setStartMonth(value); } }} />}
      pvFields={<ClientEnergyPv power={settings.existingPvKw} onPowerChange={value => setSettings(current => ({ ...current, existingPvKw: value }))}
        state={{ source: { projectId: 'preview', revision: 1, latitude: 52.314718, longitude: 16.952871,
          existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170, lossPercent: 12 } },
          geometry: pvGeometry, setGeometry: setPvGeometry, loading: false, error: '', reload: () => {}, discardChanges: () => {},
          saveSettings: () => undefined, saved: () => {}, estimate: null, calculating: false, complete: true, dirty: false }} />}
      {...account} onAccountChange={(key, value) => setAccount(current => ({ ...current, [key]: value }))}
      catalog={[{ code: 'ENEA', label: 'Enea Operator', tariffs: [{ code: 'G11', label: 'G11' }, { code: 'G12', label: 'G12' }] }]}
      catalogLoading={false} hasTariffHistory={false} tariffSummary={<p>Enea Operator · {account.tariff} · cennik ogólny</p>}
      range={`${startMonth} – ${period.endMonth}`} measurementMonths={selectedData.months.filter(month => month.importAvailable).length} invoiceCount={0}
      annualKwh={16000} annualSource="Deklaracja klienta" manualAnnualVisible={!settings.hasOperatorData && !settings.hasEnergyInvoices}
      saving={false} onSave={() => setSaved('Zapisano w podglądzie lokalnym')} alerts={saved && <p role="status">{saved}</p>}
      onPrepareOffer={() => setSaved('Przejście do oferty sprawdzone w podglądzie')}
      measurements={<div className="energy-operator-panel">
        <Box className="energy-upload-zone" p="19px" textAlign="center"><strong>Upuść XLSX tutaj</strong><p>Godzinowe dane poboru i oddania energii</p><input aria-label="Pliki pomiarowe XLSX" type="file" accept=".xlsx" multiple /></Box>
        <div className="energy-coverage">{selectedData.months.map(month => <div className="energy-coverage-item" data-ready={month.importAvailable} key={month.period}>{month.period}<strong>{month.importAvailable ? 'Pobór zapisany' : 'Brak poboru'}</strong><strong>{month.exportAvailable ? 'Oddanie zapisane' : 'Brak oddania'}</strong></div>)}</div>
        <details className="energy-portal"><summary>Dostęp do portalu operatora</summary><SimpleGrid columns={{ base: 1, md: 2 }} spacing="18px">
          {['Numer PPE', 'Numer licznika', 'Login ENEA', 'Hasło ENEA'].map(label => <FormControl key={label}><FormLabel>{label}</FormLabel><Input type={label === 'Hasło ENEA' ? 'password' : 'text'} /></FormControl>)}
        </SimpleGrid><Button mt="12px" onClick={() => setSaved('Test lokalny: dane portalu nie są wysyłane')}>Zapisz dane portalu</Button></details>
        <details className="energy-files"><summary>Pliki miesięczne i synchronizacja ENEA</summary><p>24 pliki pomiarowe w podglądzie</p></details>
      </div>}
      invoices={<ClientDocumentsPanel mode="invoices" variant="energy" clientId="preview" projectId="preview" documents={[]} onChanged={() => {}} />}
      summary={<ClientEnergySummary projectId="preview" profile={null} annualConsumptionKwh={16000} consumptionSource="Deklaracja klienta" hasPv={Number(settings.existingPvKw) > 0} invoices={[]} initialData={selectedData} />}
    />
  </Box>;
}
