'use client';

import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Input, Link, Select, SimpleGrid, Spinner, Switch, Text, Textarea, useColorModeValue } from '@chakra-ui/react';
import Card from 'components/card/Card';
import { defaultHourlyLoadProfile, polishPvHourlyProfiles, polishPvMonthlyDistribution } from 'lib/onrevolt/energy-scenario';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdCalculate, MdOpenInNew, MdRefresh, MdSave } from 'react-icons/md';

const consumptionDistribution = [0.11, 0.1, 0.09, 0.08, 0.07, 0.065, 0.065, 0.065, 0.075, 0.085, 0.095, 0.105];
const consumptionDistributionTotal = consumptionDistribution.reduce((sum, share) => sum + share, 0);
const monthLabels = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

const emptyAudit = {
  id: '', status: 'DRAFT', profileSource: 'ANNUAL_DECLARATION', annualConsumptionKwh: '6000',
  connectionPowerKw: '', phaseCount: '3', mainFuseA: '', roofType: 'UNKNOWN', roofAreaM2: '',
  roofOrientation: 'S', roofTiltDeg: '30', shadingNotes: '', existingPvKw: '0', existingInverter: '',
  existingBatteryKwh: '0', notes: '',
};

const emptyScenario = {
  name: 'Scenariusz bazowy', pvPowerKw: '6', pvSpecificYieldKwhPerKw: '950', batteryCapacityKwh: '15',
  batteryMaxChargeKw: '5', batteryMaxDischargeKw: '5', batteryRoundTripEfficiency: '0.90',
  initialBatterySocPercent: '0.20', energyBuyGrossPerKwh: '0.62', distributionGrossPerKwh: '0.48',
  exportGrossPerKwh: '0.45', fixedMonthlyGross: '30', depositPayoutRate: '0.20', investmentGross: '45000',
  recommended: true,
};

function auditForm(record: any) {
  if (!record) return { ...emptyAudit };
  return Object.fromEntries(Object.entries(emptyAudit).map(([key, value]) => [key, record[key] == null ? value : String(record[key])])) as typeof emptyAudit;
}

function scenarioResult(record: any) {
  return record?.resultSnapshot && typeof record.resultSnapshot === 'object' ? record.resultSnapshot : null;
}

function money(value: unknown) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number(value || 0));
}

export default function AuditsWorkspace() {
  const params = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(params.get('projectId') || '');
  const [projectSearch, setProjectSearch] = useState('');
  const [audit, setAudit] = useState<any>({ ...emptyAudit });
  const [scenario, setScenario] = useState<any>({ ...emptyScenario });
  const [energyProfile, setEnergyProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedAudit = audits.find((item) => item.projectId === selectedProjectId);
  const scenarios = selectedAudit?.scenarios || [];
  const latestResult = scenarioResult(scenarios[0]);
  const latestMonths = Array.isArray(latestResult?.months) ? latestResult.months : [];
  const latestMonthMax = Math.max(1, ...latestMonths.map((month: any) => Math.max(
    Number(month?.consumptionKwh || 0),
    Number(month?.pvGenerationKwh || 0),
  )));
  const baselineAnnualCost = latestResult?.baselineAnnualCostGross ?? latestResult?.currentAnnualBillGross;
  const scenarioAnnualCost = latestResult?.scenarioAnnualCostGross ?? latestResult?.projectedAnnualBillGross;
  const energyAutonomy = latestResult?.energyAutonomyPercent ?? latestResult?.energyIndependencePercent;
  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => `${project.client.displayName} ${project.title} ${project.client.contacts?.[0]?.phone || ''}`.toLowerCase().includes(q));
  }, [projectSearch, projects]);
  const visibleProjects = useMemo(() => {
    const limited = filteredProjects.slice(0, 80);
    if (!selectedProject || limited.some((project) => project.id === selectedProject.id)) return limited;
    return [selectedProject, ...limited.slice(0, 79)];
  }, [filteredProjects, selectedProject]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/energy-audits', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setProjects(payload.data.projects || []);
      setAudits(payload.data.audits || []);
      const projectId = selectedProjectId || payload.data.projects?.[0]?.id || '';
      setSelectedProjectId(projectId);
      const record = payload.data.audits?.find((item: any) => item.projectId === projectId);
      setAudit(auditForm(record));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  const loadEnergyProfile = useCallback(async (project: any) => {
    setEnergyProfile(null);
    if (!project?.clientId) return;
    const response = await fetch(`/api/integrations/enea/profile?clientId=${encodeURIComponent(project.clientId)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.ok) setEnergyProfile(payload.data);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedProject) loadEnergyProfile(selectedProject); }, [loadEnergyProfile, selectedProject]);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setAudit(auditForm(audits.find((item) => item.projectId === projectId)));
    setMessage('');
    setError('');
  }

  function updateAudit(key: string, value: any) { setAudit((current: any) => ({ ...current, [key]: value })); }
  function updateScenario(key: string, value: any) { setScenario((current: any) => ({ ...current, [key]: value })); }

  async function saveAudit() {
    if (!selectedProjectId) throw new Error('Wybierz projekt');
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/energy-audits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...audit, id: audit.id || undefined, projectId: selectedProjectId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setAudit(auditForm(payload.data));
      setAudits((current) => [payload.data, ...current.filter((item) => item.id !== payload.data.id)]);
      setMessage('Zapisano audyt.');
      return payload.data;
    } finally {
      setSaving(false);
    }
  }

  function energyInputs() {
    const annual = Number(audit.annualConsumptionKwh || 0);
    if (!(annual > 0)) throw new Error('Podaj roczne zużycie energii');
    let monthly = consumptionDistribution.map((share) => annual * share / consumptionDistributionTotal);
    let hourly = defaultHourlyLoadProfile;
    if (audit.profileSource === 'OPERATOR_HOURLY') {
      if (!energyProfile?.months?.length) throw new Error('Brak wczytanego profilu godzinowego operatora');
      monthly = Array.from({ length: 12 }, (_, index) => energyProfile.months.filter((month: any) => month.month === index + 1).reduce((sum: number, month: any) => sum + Number(month.totalKwh || 0), 0));
      const hourlyTotals = Array.from({ length: 24 }, (_, hour) => energyProfile.months.reduce((sum: number, month: any) => sum + Number(month.hourly?.[hour] || 0), 0));
      hourly = hourlyTotals.some((value) => value > 0) ? hourlyTotals : defaultHourlyLoadProfile;
    }
    return { monthly, hourly };
  }

  async function calculate() {
    setCalculating(true);
    setError('');
    setMessage('');
    try {
      const savedAudit = audit.id ? { id: audit.id } : await saveAudit();
      const profile = energyInputs();
      const response = await fetch('/api/energy-scenarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auditId: savedAudit.id,
          name: scenario.name,
          recommended: scenario.recommended,
          input: {
            monthlyConsumptionKwh: profile.monthly,
            hourlyLoadProfile: profile.hourly,
            pvMonthlyDistribution: polishPvMonthlyDistribution,
            pvHourlyProfiles: polishPvHourlyProfiles,
            ...Object.fromEntries(Object.entries(scenario).filter(([key]) => !['name', 'recommended'].includes(key)).map(([key, value]) => [key, Number(value)])),
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setMessage(`Obliczono scenariusz w silniku ${payload.data.engineVersion}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalculating(false);
    }
  }

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px' }} gap="20px">
      <Flex direction={{ base: 'column', xl: 'row' }} align={{ xl: 'end' }} gap="12px">
        <Box flex="1"><Text color={textColor} fontSize="2xl" fontWeight="800">Audyty i energia</Text><Text color={mutedColor}>Dane techniczne i scenariusze do ofert</Text></Box>
        <FormControl maxW="320px"><FormLabel>Szukaj projektu</FormLabel><Input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} /></FormControl>
        <FormControl maxW="420px"><FormLabel>Projekt</FormLabel><Select value={selectedProjectId} onChange={(event) => selectProject(event.target.value)}><option value="">Wybierz projekt</option>{visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.client.displayName} · {project.title}</option>)}</Select></FormControl>
        <Button leftIcon={<MdRefresh />} variant="outline" onClick={load} isLoading={loading}>Odśwież</Button>
      </Flex>
      {error ? <Alert status="error" borderRadius="8px"><AlertIcon />{error}</Alert> : null}
      {message ? <Alert status="success" borderRadius="8px"><AlertIcon />{message}</Alert> : null}
      {loading && !projects.length ? <Flex justify="center" py="80px"><Spinner /></Flex> : selectedProject ? <>
        <Card p="20px"><Flex justify="space-between" align="center" gap="12px"><Box><Text color={textColor} fontWeight="800">{selectedProject.client.displayName}</Text><Text color={mutedColor}>{selectedProject.title} · {selectedProject.stage?.name || 'Brak etapu'}</Text></Box>{selectedProject.dashboardStation ? <Link href={`https://my.onrevolt.com/?station=${encodeURIComponent(selectedProject.dashboardStation)}&re`} isExternal color="brand.400" fontWeight="700">RE <MdOpenInNew style={{ display: 'inline' }} /></Link> : null}</Flex></Card>
        <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
          <Card p="20px"><Text color={textColor} fontWeight="800" mb="16px">Audyt techniczny</Text><SimpleGrid columns={{ base: 1, md: 2 }} gap="12px">
            <Field label="Roczne zużycie [kWh]" value={audit.annualConsumptionKwh} onChange={(value) => updateAudit('annualConsumptionKwh', value)} />
            <FormControl><FormLabel>Źródło profilu</FormLabel><Select value={audit.profileSource} onChange={(event) => updateAudit('profileSource', event.target.value)}><option value="ANNUAL_DECLARATION">Zużycie roczne</option><option value="OPERATOR_HOURLY">Dane godzinowe OSD</option></Select></FormControl>
            <Field label="Moc przyłączeniowa [kW]" value={audit.connectionPowerKw} onChange={(value) => updateAudit('connectionPowerKw', value)} />
            <Field label="Zabezpieczenie główne [A]" value={audit.mainFuseA} onChange={(value) => updateAudit('mainFuseA', value)} />
            <FormControl><FormLabel>Liczba faz</FormLabel><Select value={audit.phaseCount} onChange={(event) => updateAudit('phaseCount', event.target.value)}><option value="1">1</option><option value="3">3</option></Select></FormControl>
            <FormControl><FormLabel>Rodzaj dachu</FormLabel><Select value={audit.roofType} onChange={(event) => updateAudit('roofType', event.target.value)}><option value="UNKNOWN">Nie określono</option><option value="FLAT">Płaski</option><option value="SLOPED">Skośny</option><option value="GROUND">Grunt</option><option value="OTHER">Inny</option></Select></FormControl>
            <Field label="Powierzchnia [m²]" value={audit.roofAreaM2} onChange={(value) => updateAudit('roofAreaM2', value)} />
            <Field label="Nachylenie [°]" value={audit.roofTiltDeg} onChange={(value) => updateAudit('roofTiltDeg', value)} />
            <FormControl><FormLabel>Orientacja</FormLabel><Select value={audit.roofOrientation} onChange={(event) => updateAudit('roofOrientation', event.target.value)}><option value="S">Południe</option><option value="SE">Południowy wschód</option><option value="SW">Południowy zachód</option><option value="E_W">Wschód-zachód</option><option value="N">Północ</option></Select></FormControl>
            <Field label="Istniejąca PV [kWp]" value={audit.existingPvKw} onChange={(value) => updateAudit('existingPvKw', value)} />
            <FormControl><FormLabel>Istniejący falownik</FormLabel><Input value={audit.existingInverter} onChange={(event) => updateAudit('existingInverter', event.target.value)} /></FormControl>
            <Field label="Istniejący magazyn [kWh]" value={audit.existingBatteryKwh} onChange={(value) => updateAudit('existingBatteryKwh', value)} />
          </SimpleGrid><FormControl mt="12px"><FormLabel>Zacienienie i uwagi</FormLabel><Textarea value={audit.shadingNotes} onChange={(event) => updateAudit('shadingNotes', event.target.value)} /></FormControl><Button mt="14px" leftIcon={<MdSave />} onClick={() => saveAudit().catch((e) => setError(e.message))} isLoading={saving}>Zapisz audyt</Button></Card>
          <Card p="20px"><Text color={textColor} fontWeight="800" mb="16px">Scenariusz energetyczny</Text><SimpleGrid columns={{ base: 1, md: 2 }} gap="12px">
            <FormControl><FormLabel>Nazwa</FormLabel><Input value={scenario.name} onChange={(event) => updateScenario('name', event.target.value)} /></FormControl>
            <Field label="PV [kWp]" value={scenario.pvPowerKw} onChange={(value) => updateScenario('pvPowerKw', value)} />
            <Field label="Uzysk [kWh/kWp]" value={scenario.pvSpecificYieldKwhPerKw} onChange={(value) => updateScenario('pvSpecificYieldKwhPerKw', value)} />
            <Field label="Magazyn [kWh]" value={scenario.batteryCapacityKwh} onChange={(value) => updateScenario('batteryCapacityKwh', value)} />
            <Field label="Moc ładowania [kW]" value={scenario.batteryMaxChargeKw} onChange={(value) => updateScenario('batteryMaxChargeKw', value)} />
            <Field label="Moc rozładowania [kW]" value={scenario.batteryMaxDischargeKw} onChange={(value) => updateScenario('batteryMaxDischargeKw', value)} />
            <Field label="Sprawność round-trip" value={scenario.batteryRoundTripEfficiency} onChange={(value) => updateScenario('batteryRoundTripEfficiency', value)} step="0.01" />
            <Field label="Energia zakup [zł/kWh]" value={scenario.energyBuyGrossPerKwh} onChange={(value) => updateScenario('energyBuyGrossPerKwh', value)} step="0.01" />
            <Field label="Dystrybucja [zł/kWh]" value={scenario.distributionGrossPerKwh} onChange={(value) => updateScenario('distributionGrossPerKwh', value)} step="0.01" />
            <Field label="Sprzedaż RCE [zł/kWh]" value={scenario.exportGrossPerKwh} onChange={(value) => updateScenario('exportGrossPerKwh', value)} step="0.01" />
            <Field label="Opłaty stałe [zł/mies.]" value={scenario.fixedMonthlyGross} onChange={(value) => updateScenario('fixedMonthlyGross', value)} />
            <Field label="Wartość inwestycji brutto" value={scenario.investmentGross} onChange={(value) => updateScenario('investmentGross', value)} />
            <FormControl><FormLabel>Rekomendowany</FormLabel><Switch isChecked={scenario.recommended} onChange={(event) => updateScenario('recommended', event.target.checked)} /></FormControl>
          </SimpleGrid><Button mt="14px" colorScheme="purple" leftIcon={<MdCalculate />} onClick={calculate} isLoading={calculating}>Oblicz i zapisz</Button></Card>
        </SimpleGrid>
        {latestResult ? <><SimpleGrid columns={{ base: 2, xl: 5 }} gap="14px">{[
          ['Koszt przed', money(baselineAnnualCost)], ['Koszt po', money(scenarioAnnualCost)], ['Oszczędność', money(latestResult.annualSavingsGross)], ['Autonomia', energyAutonomy == null ? '-' : `${energyAutonomy}%`], ['Zwrot', latestResult.simplePaybackYears ? `${latestResult.simplePaybackYears} lat` : '-'],
        ].map(([label, value]) => <Card key={label} p="16px"><Text color={mutedColor} fontSize="sm">{label}</Text><Text color={textColor} fontSize="xl" fontWeight="800">{value}</Text></Card>)}</SimpleGrid>
        <Card p="20px"><Text color={textColor} fontWeight="800" mb="14px">Bilans miesięczny</Text>{latestMonths.length ? <Grid templateColumns="repeat(12, minmax(54px, 1fr))" gap="8px" overflowX="auto">{latestMonths.map((month: any, index: number) => <Box key={month.month || index} minW="54px"><Flex h="150px" align="end" gap="3px"><Box bg="gray.400" w="50%" h={`${Number(month.consumptionKwh || 0) / latestMonthMax * 100}%`} minH="2px" /><Box bg="green.400" w="50%" h={`${Number(month.pvGenerationKwh || 0) / latestMonthMax * 100}%`} minH="2px" /></Flex><Text textAlign="center" color={mutedColor} fontSize="xs" mt="6px">{monthLabels[index] || month.month}</Text></Box>)}</Grid> : <Text color={mutedColor}>Ten scenariusz nie zawiera bilansu miesięcznego. Przelicz go ponownie, aby uzupełnić wykres.</Text>}</Card></> : null}
        <Card p="20px"><Flex justify="space-between" mb="12px"><Text color={textColor} fontWeight="800">Warianty</Text><Badge>{scenarios.length}</Badge></Flex><SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="10px">{scenarios.map((item: any) => { const result = scenarioResult(item); return <Box key={item.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px"><Flex justify="space-between"><Text color={textColor} fontWeight="700">{item.name}</Text>{item.recommended ? <Badge colorScheme="green">Rekomendowany</Badge> : null}</Flex><Text color={mutedColor} fontSize="sm">PV {Number(item.pvPowerKw)} kWp · magazyn {Number(item.batteryCapacityKwh)} kWh</Text><Text color={textColor} mt="8px" fontWeight="800">{money(result?.annualSavingsGross)} / rok</Text><Text color={mutedColor} fontSize="xs">{item.engineVersion}</Text></Box>; })}</SimpleGrid></Card>
      </> : <Card p="30px"><Text color={mutedColor}>Wybierz projekt.</Text></Card>}
    </Flex>
  );
}

function Field({ label, value, onChange, step = '0.1' }: { label: string; value: any; onChange: (value: string) => void; step?: string }) {
  return <FormControl><FormLabel>{label}</FormLabel><Input type="number" step={step} value={value} onChange={(event) => onChange(event.target.value)} /></FormControl>;
}
