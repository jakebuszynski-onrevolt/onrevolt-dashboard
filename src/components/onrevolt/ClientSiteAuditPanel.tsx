'use client';

import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  IconButton,
  Input,
  Link,
  Progress,
  Select,
  SimpleGrid,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdCameraAlt,
  MdCheck,
  MdChevronLeft,
  MdChevronRight,
  MdDeleteOutline,
  MdInsertDriveFile,
  MdOpenInNew,
  MdPrint,
  MdRefresh,
  MdSave,
  MdUploadFile,
} from 'react-icons/md';
import DocumentImagePreviewModal from './DocumentImagePreviewModal';

type Props = {
  clientId: string;
  client: any;
  project: any;
  staffUsers: Array<{ id: string; name: string; email: string }>;
  currentUser?: { id?: string | null; systemRole?: string | null } | null;
  onDocumentsChanged?: () => Promise<void> | void;
};

type AuditData = Record<string, any>;
type AuditDocument = {
  id: string;
  title: string;
  fileName: string;
  mimeType?: string | null;
  siteAuditId?: string | null;
  auditFieldKey?: string | null;
};

const steps = [
  ['Dane wizyty', 'Klient i zakres inwestycji'],
  ['Dokumenty klienta', 'Dokumentacja wejściowa'],
  ['Instalacja elektryczna', 'Przyłącze i obecne urządzenia'],
  ['Ogrzewanie i odbiorniki', 'Profil istotnych obciążeń'],
  ['Obiekt', 'Budynek, dach i otoczenie'],
  ['Inwestycja', 'Warunki montażowe'],
  ['Podsumowanie', 'Wynik, zalecenia i raport'],
] as const;

const documentItems = [
  ['doc.single-line', 'Schemat jednokreskowy', 'Dokument podstawowy.'],
  ['doc.site-sketch', 'Szkic sytuacyjny', 'Dokument podstawowy do lokalizacji urządzeń.'],
  ['doc.roof-project', 'Projekt budowlany dachu', 'Jeśli dotyczy nietypowej konstrukcji lub wymaganej nośności.'],
  ['doc.pv-project', 'Projekt instalacji PV', 'Jeśli instalacja istnieje albo jest modernizowana.'],
  ['doc.electrical-project', 'Projekt instalacji elektrycznej', 'Przydatny przy rozbudowie lub przebudowie rozdzielnicy.'],
  ['doc.inverter-data', 'Dane z falownika', 'Raport, eksport, zrzut ekranu albo zdjęcie parametrów.'],
] as const;

const electricalItems = [
  ['electrical.main-board', 'Główna rozdzielnica', 'main_board_desc', 'Opis i lokalizacja'],
  ['electrical.pre-meter', 'Zabezpieczenie przedlicznikowe', 'pre_meter_protection', 'Wartość i opis'],
  ['electrical.osd-box', 'Skrzynka operatora OSD', 'osd_box_desc', 'Opis i lokalizacja'],
  ['electrical.grounding', 'Uziemienie', 'grounding_desc', 'Opis uziemienia / GSU'],
] as const;

const buildingPhotoItems = [
  ['building.front', 'Front budynku', 'front_desc'],
  ['building.left', 'Lewa elewacja', 'left_desc'],
  ['building.right', 'Prawa elewacja', 'right_desc'],
  ['building.rear', 'Tył budynku / dach', 'rear_desc'],
] as const;

const pvItems = [
  ['pv.access', 'Dostęp serwisowy / monterski', 'pv_service_note', 'Opisz sposób dostępu'],
  ['pv.ac-route', 'Sposób przeprowadzenia kabli AC', 'ac_route', 'Opis trasy AC'],
  ['pv.dc-route', 'Sposób prowadzenia kabli DC', 'dc_route', 'Opis trasy DC'],
  ['pv.inverter-place', 'Miejsce montażu falownika', 'inverter_place', 'Opis lokalizacji'],
] as const;

const batteryItems = [
  ['battery.place', 'Miejsce montażu magazynu', 'battery_place', 'Opis lokalizacji'],
  ['battery.environment', 'Warunki środowiskowe', 'battery_env', 'Temperatura, wilgoć i wentylacja'],
  ['battery.route', 'Trasa kablowa magazynu', 'battery_route', 'Opis i przybliżona długość trasy'],
] as const;

const defaultFindings = [
  { id: 'main-board', title: 'Rozdzielnica główna', description: '' },
  { id: 'cable-routes', title: 'Trasy kablowe', description: '' },
  { id: 'equipment-place', title: 'Miejsce montażu urządzeń', description: '' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function contactAddress(client: any, project: any) {
  const contact = client?.contacts?.[0] || {};
  const site = project?.investmentSite || client?.investmentSites?.[0] || {};
  return site.fullAddress
    || site.addressLine
    || contact.investmentAddress
    || project?.locationAddress
    || '';
}

function initialData(client: any, project: any, currentUser?: Props['currentUser']): AuditData {
  const contact = client?.contacts?.[0] || {};
  const existingAssets = Array.isArray(project?.existingAssets) ? project.existingAssets : [];
  const existingPvAssets = existingAssets.filter((item: any) => (
    ['PV_MODULES', 'PV_INVERTER', 'HYBRID_INVERTER'].includes(item.kind)
  ));
  const existingInverter = existingPvAssets.find((item: any) => (
    ['PV_INVERTER', 'HYBRID_INVERTER'].includes(item.kind)
  ));
  const existingPv = existingInverter || existingPvAssets[0];
  const existingBattery = existingAssets.find((item: any) => item.kind === 'BATTERY');
  const existingPvDevices = existingPvAssets
    .map((item: any) => [item.producer, item.model || item.name].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ');
  return {
    visit_date: today(),
    auditor_id: currentUser?.id || project?.ownerId || '',
    client_type: project?.clientType || client?.clientType || 'UNKNOWN',
    client_name: client?.displayName || '',
    client_phone: contact.phone || '',
    client_address: contactAddress(client, project),
    visit_scope: '',
    inv_mag: false,
    inv_pv: false,
    mag_config_id: '',
    pv_config_id: '',
    documents_notes: '',
    connection_power_kw: '',
    phase_count: existingInverter?.phaseCount ? String(existingInverter.phaseCount) : '3',
    main_fuse_a: '',
    main_board_desc: '',
    pre_meter_protection: '',
    osd_box_desc: '',
    grounding_desc: '',
    has_pv_now: existingPv ? 'yes' : 'no',
    existing_pv_device: existingPvDevices,
    existing_pv_params: '',
    existing_pv_kw: existingPv?.powerKw ? String(existingPv.powerKw) : '',
    existing_battery_kwh: existingBattery?.capacityKwh ? String(existingBattery.capacityKwh) : '',
    heating_source: '',
    heating_params: '',
    heating_notes: '',
    loads: [{ id: 'load-1', device: '', params: '' }],
    building_type: '',
    usable_area_m2: '',
    energy_standard: '',
    building_floors: '',
    roof_type: 'UNKNOWN',
    roof_area_m2: '',
    roof_angle_deg: '',
    roof_cover: '',
    roof_structure: '',
    front_desc: '',
    left_desc: '',
    right_desc: '',
    rear_desc: '',
    building_notes: '',
    shading_notes: '',
    pv_place: 'ROOF',
    roof_orientation: 'S',
    pv_service_note: '',
    ac_route: '',
    ac_length_m: '',
    dc_route: '',
    dc_length_m: '',
    inverter_place: '',
    pv_preferences: '',
    battery_place: '',
    battery_env: '',
    battery_route: '',
    battery_preferences: '',
    audit_result: '',
    audit_next_action: '',
    final_summary_notes: '',
    findings: defaultFindings.map((item) => ({ ...item })),
  };
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pl-PL').format(date)
    : value;
}

function readResponse(payload: any, response: Response) {
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload.data;
}

export default function ClientSiteAuditPanel({
  clientId,
  client,
  project,
  staffUsers,
  currentUser,
  onDocumentsChanged,
}: Props) {
  const [audits, setAudits] = useState<any[]>([]);
  const [selectedAuditId, setSelectedAuditId] = useState('');
  const [data, setData] = useState<AuditData>(() => initialData(client, project, currentUser));
  const [status, setStatus] = useState('DRAFT');
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const panelBg = useColorModeValue('white', 'navy.800');
  const softBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.50');

  const configurations = useMemo(
    () => (Array.isArray(project?.configurations) ? project.configurations : []),
    [project?.configurations],
  );
  const pvConfigurations = configurations.filter((item: any) => (
    ['PV_DACH_PLASKI', 'PV_DACH_SKOSNY', 'MIXED'].includes(item.kind)
  ));
  const batteryConfigurations = configurations.filter((item: any) => (
    ['MAGAZYN', 'MIXED'].includes(item.kind)
  ));
  const selectedAudit = audits.find((item) => item.id === selectedAuditId);
  const documents: AuditDocument[] = useMemo(
    () => selectedAudit?.documents || [],
    [selectedAudit?.documents],
  );
  const progress = status === 'COMPLETED'
    ? 100
    : Math.round(new Set(completedSteps).size / steps.length * 100);

  const applyAudit = useCallback((audit: any) => {
    setSelectedAuditId(audit?.id || '');
    setData(audit?.formData && typeof audit.formData === 'object'
      ? { ...initialData(client, project, currentUser), ...audit.formData }
      : initialData(client, project, currentUser));
    setStatus(audit?.status || 'DRAFT');
    setCurrentStep(Number(audit?.currentStep) || 1);
    setCompletedSteps(Array.isArray(audit?.completedSteps) ? audit.completedSteps.map(Number) : []);
  }, [client, currentUser, project]);

  const loadAudits = useCallback(async (preferredId?: string) => {
    if (!project?.id) {
      setAudits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/site-audits?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' });
      const payload = await response.json();
      const records = readResponse(payload, response) || [];
      setAudits(records);
      const selected = records.find((item: any) => item.id === (preferredId || selectedAuditId))
        || records[0];
      applyAudit(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyAudit, project?.id, selectedAuditId]);

  useEffect(() => {
    setSelectedAuditId('');
    setData(initialData(client, project, currentUser));
    setStatus('DRAFT');
    setCurrentStep(1);
    setCompletedSteps([]);
    loadAudits();
  // selectedAuditId is intentionally reset when the project changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!selectedAuditId || !Array.isArray(client?.documents)) return;
    const currentAuditDocuments = client.documents.filter(
      (document: AuditDocument) => document.siteAuditId === selectedAuditId,
    );
    setAudits((current) => current.map((item) => (
      item.id === selectedAuditId
        ? { ...item, documents: currentAuditDocuments }
        : item
    )));
  }, [client?.documents, selectedAuditId]);

  function update(key: string, value: any) {
    setData((current) => ({ ...current, [key]: value }));
    setMessage('');
  }

  function newAudit() {
    setSelectedAuditId('');
    setData(initialData(client, project, currentUser));
    setStatus('DRAFT');
    setCurrentStep(1);
    setCompletedSteps([]);
    setError('');
    setMessage('Rozpoczęto nową wizję lokalną. Zapisz wersję roboczą, aby utworzyć rekord.');
  }

  function selectAudit(id: string) {
    const audit = audits.find((item) => item.id === id);
    if (audit) applyAudit(audit);
  }

  async function saveAudit(
    nextStatus = status,
    stepsOverride = completedSteps,
    currentStepOverride = currentStep,
  ) {
    if (!project?.id) throw new Error('Brak projektu dla audytu');
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/site-audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedAuditId || undefined,
          projectId: project.id,
          title: selectedAudit?.title,
          status: nextStatus,
          visitDate: data.visit_date,
          auditorId: data.auditor_id || undefined,
          currentStep: currentStepOverride,
          completedSteps: stepsOverride,
          formData: data,
        }),
      });
      const payload = await response.json();
      const saved = readResponse(payload, response);
      setAudits((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      applyAudit(saved);
      setMessage(nextStatus === 'COMPLETED' ? 'Audyt został zakończony.' : 'Zapisano wersję roboczą audytu.');
      return saved;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(text);
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function finishAudit() {
    try {
      const requiredSteps = steps.slice(0, -1).map((_, index) => index + 1);
      const missingSteps = requiredSteps.filter((step) => !completedSteps.includes(step));
      if (missingSteps.length) {
        setMessage('');
        setError(`Najpierw oznacz jako gotowe kroki: ${missingSteps.join(', ')}`);
        return;
      }
      const allSteps = [...requiredSteps, steps.length];
      await saveAudit('COMPLETED', allSteps, steps.length);
    } catch {
      // saveAudit already exposes the validation or API message in the panel.
    }
  }

  async function saveDraft() {
    try {
      await saveAudit('DRAFT');
    } catch {
      // saveAudit already exposes the validation or API message in the panel.
    }
  }

  function goToStep(step: number) {
    setError('');
    setMessage('');
    setCurrentStep(step);
    window.setTimeout(() => document.getElementById('site-audit-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function markCurrentStepReady() {
    const nextCompletedSteps = [...new Set([...completedSteps, currentStep])].sort((a, b) => a - b);
    const nextStep = Math.min(currentStep + 1, steps.length);
    try {
      await saveAudit('DRAFT', nextCompletedSteps, nextStep);
      setMessage(`Krok ${currentStep} oznaczono jako gotowy.`);
      window.setTimeout(() => document.getElementById('site-audit-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch {
      // saveAudit already exposes the validation or API message in the panel.
    }
  }

  async function markCurrentStepForCorrection() {
    const nextCompletedSteps = completedSteps.filter((step) => step !== currentStep);
    try {
      await saveAudit('DRAFT', nextCompletedSteps, currentStep);
      setMessage(`Krok ${currentStep} oznaczono jako wymagający uzupełnienia.`);
    } catch {
      // saveAudit already exposes the validation or API message in the panel.
    }
  }

  async function uploadFiles(fieldKey: string, label: string, files: File[]) {
    if (!files.length) return;
    setUploadingField(fieldKey);
    setError('');
    try {
      const audit = selectedAudit || await saveAudit('DRAFT');
      for (const file of files) {
        const image = file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name);
        const form = new FormData();
        form.set('file', file);
        form.set('type', image ? 'ZDJECIE_MONTAZU' : 'INNE');
        form.set('title', label);
        form.set('clientId', clientId);
        form.set('projectId', project.id);
        form.set('siteAuditId', audit.id);
        form.set('auditFieldKey', fieldKey);
        form.set('documentDate', data.visit_date || today());
        form.set('tags', `audyt,wizja lokalna,${fieldKey}`);
        form.set('notes', `Załącznik do wizji lokalnej: ${label}`);
        const response = await fetch('/api/documents/upload', { method: 'POST', body: form });
        const payload = await response.json();
        const uploadedDocument = readResponse(payload, response);
        setAudits((current) => current.map((item) => (
          item.id === audit.id
            ? {
              ...item,
              documents: [
                uploadedDocument,
                ...(item.documents || []).filter((document: AuditDocument) => document.id !== uploadedDocument.id),
              ],
            }
            : item
        )));
      }
      await onDocumentsChanged?.();
      setMessage(`Dodano ${files.length} ${files.length === 1 ? 'plik' : 'pliki'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingField('');
    }
  }

  async function deleteDocument(id: string) {
    if (!window.confirm('Usunąć ten załącznik z audytu?')) return;
    setError('');
    try {
      const response = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();
      readResponse(payload, response);
      setAudits((current) => current.map((item) => (
        item.id === selectedAuditId
          ? {
            ...item,
            documents: (item.documents || []).filter((document: AuditDocument) => document.id !== id),
          }
          : item
      )));
      await onDocumentsChanged?.();
      setMessage('Usunięto załącznik.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteAudit() {
    if (!selectedAuditId || !window.confirm('Usunąć całą wizję lokalną? Załączniki pozostaną w dokumentach klienta.')) return;
    setSaving(true);
    try {
      const response = await fetch('/api/site-audits', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedAuditId }),
      });
      const payload = await response.json();
      readResponse(payload, response);
      setSelectedAuditId('');
      await loadAudits();
      setMessage('Usunięto audyt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const attachments = useCallback((fieldKey: string) => (
    documents.filter((document) => document.auditFieldKey === fieldKey)
  ), [documents]);

  const configName = useCallback((id: string, fallback: string) => (
    configurations.find((item: any) => item.id === id)?.name || fallback
  ), [configurations]);

  const summary = useMemo(() => {
    const loads = Array.isArray(data.loads)
      ? data.loads.filter((item: any) => item.device || item.params)
        .map((item: any) => [item.device, item.params].filter(Boolean).join(' - '))
      : [];
    return {
      pvConfig: data.inv_pv ? configName(data.pv_config_id, 'Nie wybrano konfiguracji PV') : 'Poza zakresem',
      batteryConfig: data.inv_mag ? configName(data.mag_config_id, 'Nie wybrano konfiguracji magazynu') : 'Poza zakresem',
      building: [data.building_type, data.usable_area_m2 ? `${data.usable_area_m2} m²` : '', data.building_floors ? `${data.building_floors} kond.` : ''].filter(Boolean).join(' · ') || 'Brak danych',
      roof: [roofLabel(data.roof_type), data.roof_angle_deg ? `${data.roof_angle_deg}°` : '', data.roof_cover, data.roof_structure].filter(Boolean).join(' · ') || 'Brak danych',
      electrical: [data.phase_count ? `${data.phase_count} fazy` : '', data.main_fuse_a ? `${data.main_fuse_a} A` : '', data.osd_box_desc].filter(Boolean).join(' · ') || 'Brak danych',
      pvMounting: data.inv_pv
        ? [data.pv_place === 'GROUND' ? 'Grunt' : 'Dach', orientationLabel(data.roof_orientation), data.ac_length_m ? `AC ${data.ac_length_m} m` : '', data.dc_length_m ? `DC ${data.dc_length_m} m` : '', data.inverter_place].filter(Boolean).join(' · ')
        : 'Poza zakresem',
      batteryMounting: data.inv_mag
        ? [data.battery_place, data.battery_env, data.battery_route].filter(Boolean).join(' · ') || 'Brak danych'
        : 'Poza zakresem',
      loads: loads.join('; ') || 'Brak wskazanych odbiorników',
    };
  }, [configName, data]);
  const auditorName = staffUsers.find((user) => user.id === data.auditor_id)?.name
    || selectedAudit?.auditor?.name
    || '';

  if (!project?.id) {
    return <Alert status="warning" borderRadius="8px"><AlertIcon />Najpierw utwórz projekt klienta.</Alert>;
  }

  if (loading && !audits.length) {
    return <Flex justify="center" py="70px"><Spinner /></Flex>;
  }

  return (
    <Flex direction="column" gap="16px">
      <Box bg={panelBg} border="1px solid" borderColor={borderColor} borderRadius="8px" p="18px">
        <Flex direction={{ base: 'column', xl: 'row' }} justify="space-between" align={{ xl: 'end' }} gap="14px">
          <Box flex="1">
            <Flex align="center" gap="10px" wrap="wrap">
              <Text color={textColor} fontSize="xl" fontWeight="800">Audyt / wizja lokalna</Text>
              <Badge colorScheme={status === 'COMPLETED' ? 'green' : 'purple'}>
                {status === 'COMPLETED' ? 'Zakończony' : 'Wersja robocza'}
              </Badge>
            </Flex>
            <Text color={mutedColor}>{client.displayName} · {project.title}</Text>
          </Box>
          <FormControl maxW={{ xl: '410px' }}>
            <FormLabel>Wizja lokalna</FormLabel>
            <Select value={selectedAuditId} onChange={(event) => selectAudit(event.target.value)}>
              <option value="">Nowa wizja lokalna</option>
              {audits.map((audit) => (
                <option key={audit.id} value={audit.id}>
                  {formatDate(audit.visitDate || audit.createdAt)} · {audit.status === 'COMPLETED' ? 'zakończona' : `${audit.progressPercent}%`}
                </option>
              ))}
            </Select>
          </FormControl>
          <Flex gap="8px" wrap="wrap">
            <Tooltip label="Odśwież dane audytów">
              <IconButton aria-label="Odśwież dane audytów" icon={<MdRefresh />} variant="outline" onClick={() => loadAudits(selectedAuditId)} />
            </Tooltip>
            <Button leftIcon={<MdAdd />} variant="outline" onClick={newAudit}>Nowa wizja</Button>
            <Button leftIcon={<MdSave />} colorScheme="purple" onClick={saveDraft} isLoading={saving}>Zapisz</Button>
            {currentStep === 7 ? (
              <Button leftIcon={<MdCheck />} colorScheme="green" onClick={finishAudit} isLoading={saving}>Zakończ audyt</Button>
            ) : null}
            {selectedAuditId && currentUser?.systemRole === 'ADMIN' ? (
              <Tooltip label="Usuń audyt">
                <IconButton aria-label="Usuń audyt" icon={<MdDeleteOutline />} colorScheme="red" variant="outline" onClick={deleteAudit} />
              </Tooltip>
            ) : null}
          </Flex>
        </Flex>
      </Box>

      {error ? <Alert status="error" borderRadius="8px"><AlertIcon />{error}</Alert> : null}
      {message ? <Alert status="success" borderRadius="8px"><AlertIcon />{message}</Alert> : null}

      <Grid templateColumns={{ base: 'minmax(0, 1fr)', xl: '250px minmax(0, 1fr)' }} gap="16px" alignItems="start">
        <Box bg={panelBg} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px" position={{ xl: 'sticky' }} top={{ xl: '90px' }}>
          <Text color={textColor} fontWeight="800" px="8px" py="6px">Etapy audytu</Text>
          <Flex direction={{ base: 'row', xl: 'column' }} overflowX={{ base: 'auto', xl: 'visible' }} gap="4px" pb={{ base: '6px', xl: 0 }}>
            {steps.map(([name, description], index) => {
              const step = index + 1;
              const active = currentStep === step;
              const done = status === 'COMPLETED' || completedSteps.includes(step);
              return (
                <Button
                  key={name}
                  variant="ghost"
                  justifyContent="flex-start"
                  textAlign="left"
                  minW={{ base: '210px', xl: '100%' }}
                  h="58px"
                  px="8px"
                  bg={active ? softBg : 'transparent'}
                  borderLeft="3px solid"
                  borderLeftColor={active ? 'brand.500' : 'transparent'}
                  onClick={() => goToStep(step)}
                >
                  <Flex align="center" gap="9px" w="100%">
                    <Flex flex="0 0 28px" h="28px" borderRadius="50%" align="center" justify="center" bg={done ? 'green.400' : active ? 'brand.500' : softBg} color={done || active ? 'white' : mutedColor} fontSize="sm">
                      {done ? <MdCheck /> : step}
                    </Flex>
                    <Box minW="0" flex="1">
                      <Text color={textColor} fontSize="sm" fontWeight="800" noOfLines={1}>{name}</Text>
                      <Text color={mutedColor} fontSize="xs" noOfLines={1}>{description}</Text>
                    </Box>
                  </Flex>
                </Button>
              );
            })}
          </Flex>
          <Box mt="12px" p="8px">
            <Flex justify="space-between" mb="6px">
              <Text color={mutedColor} fontSize="sm">Postęp</Text>
              <Text color={textColor} fontSize="sm" fontWeight="800">{progress}%</Text>
            </Flex>
            <Progress value={progress} colorScheme="purple" borderRadius="4px" size="sm" />
          </Box>
        </Box>

        <Box id="site-audit-content" minW="0">
          {currentStep === 1 ? (
            <StepOne
              data={data}
              update={update}
              staffUsers={staffUsers}
              pvConfigurations={pvConfigurations}
              batteryConfigurations={batteryConfigurations}
              textColor={textColor}
              mutedColor={mutedColor}
              borderColor={borderColor}
              panelBg={panelBg}
              softBg={softBg}
            />
          ) : null}
          {currentStep === 2 ? (
            <StepTwo
              data={data}
              update={update}
              attachments={attachments}
              uploadFiles={uploadFiles}
              deleteDocument={deleteDocument}
              uploadingField={uploadingField}
              colors={{ textColor, mutedColor, borderColor, panelBg, softBg }}
            />
          ) : null}
          {currentStep === 3 ? (
            <StepThree
              data={data}
              update={update}
              attachments={attachments}
              uploadFiles={uploadFiles}
              deleteDocument={deleteDocument}
              uploadingField={uploadingField}
              colors={{ textColor, mutedColor, borderColor, panelBg, softBg }}
            />
          ) : null}
          {currentStep === 4 ? (
            <StepFour
              data={data}
              update={update}
              attachments={attachments}
              uploadFiles={uploadFiles}
              deleteDocument={deleteDocument}
              uploadingField={uploadingField}
              colors={{ textColor, mutedColor, borderColor, panelBg, softBg }}
            />
          ) : null}
          {currentStep === 5 ? (
            <StepFive
              data={data}
              update={update}
              attachments={attachments}
              uploadFiles={uploadFiles}
              deleteDocument={deleteDocument}
              uploadingField={uploadingField}
              colors={{ textColor, mutedColor, borderColor, panelBg, softBg }}
            />
          ) : null}
          {currentStep === 6 ? (
            <StepSix
              data={data}
              update={update}
              attachments={attachments}
              uploadFiles={uploadFiles}
              deleteDocument={deleteDocument}
              uploadingField={uploadingField}
              colors={{ textColor, mutedColor, borderColor, panelBg, softBg }}
            />
          ) : null}
          {currentStep === 7 ? (
            <StepSeven
              data={data}
              update={update}
              documents={documents}
              summary={summary}
              pvConfig={summary.pvConfig}
              batteryConfig={summary.batteryConfig}
              auditorName={auditorName}
              colors={{ textColor, mutedColor, borderColor, panelBg, softBg }}
            />
          ) : null}

          <Flex mt="14px" justify="space-between" gap="10px" wrap="wrap">
            <Button
              leftIcon={<MdChevronLeft />}
              variant="outline"
              isDisabled={currentStep === 1}
              onClick={() => goToStep(currentStep - 1)}
            >
              Wstecz
            </Button>
            <Flex gap="8px" wrap="wrap" justify={{ base: 'flex-end', md: 'initial' }}>
              <Button leftIcon={<MdSave />} variant="outline" onClick={saveDraft} isLoading={saving}>
                Zapisz wersję roboczą
              </Button>
              {currentStep < 7 ? (
                <>
                  {completedSteps.includes(currentStep) ? (
                    <Button variant="outline" colorScheme="orange" onClick={markCurrentStepForCorrection} isLoading={saving}>
                      Cofnij gotowość
                    </Button>
                  ) : null}
                  <Button rightIcon={<MdChevronRight />} variant="outline" onClick={() => goToStep(currentStep + 1)}>
                    Dalej
                  </Button>
                  {!completedSteps.includes(currentStep) ? (
                    <Button leftIcon={<MdCheck />} colorScheme="green" onClick={markCurrentStepReady} isLoading={saving}>
                      Gotowe i dalej
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button leftIcon={<MdCheck />} colorScheme="green" onClick={finishAudit} isLoading={saving}>
                  Zakończ audyt
                </Button>
              )}
            </Flex>
          </Flex>
        </Box>
      </Grid>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          #site-audit-report, #site-audit-report * { visibility: visible !important; }
          #site-audit-report {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            background: #fff !important;
            color: #111 !important;
            border: 0 !important;
          }
          #site-audit-report .audit-report-page {
            min-height: 270mm !important;
            break-after: page;
            box-shadow: none !important;
            border: 0 !important;
          }
          #site-audit-report .audit-report-page:last-child { break-after: auto; }
        }
      `}</style>
    </Flex>
  );
}

type Colors = {
  textColor: string;
  mutedColor: string;
  borderColor: string;
  panelBg: string;
  softBg: string;
};

function Section({
  title,
  description,
  step,
  children,
  colors,
}: {
  title: string;
  description?: string;
  step?: number;
  children: ReactNode;
  colors: Colors;
}) {
  return (
    <Box bg={colors.panelBg} border="1px solid" borderColor={colors.borderColor} borderRadius="8px" p={{ base: '16px', md: '20px' }} mb="14px">
      <Flex justify="space-between" gap="12px" mb="16px">
        <Box>
          <Text color={colors.textColor} fontSize="lg" fontWeight="800">{title}</Text>
          {description ? <Text color={colors.mutedColor} fontSize="sm">{description}</Text> : null}
        </Box>
        {step ? <Badge colorScheme="purple" alignSelf="start">Krok {step} z 7</Badge> : null}
      </Flex>
      {children}
    </Box>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: any;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      <Input type={type} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </FormControl>
  );
}

function StepOne({ data, update, staffUsers, pvConfigurations, batteryConfigurations, textColor, mutedColor, borderColor, panelBg, softBg }: any) {
  const colors = { textColor, mutedColor, borderColor, panelBg, softBg };
  return (
    <>
      <Section title="Dane wizyty" description="Podstawowe dane są pobierane z karty klienta, ale można je skorygować dla tej konkretnej wizji." step={1} colors={colors}>
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="12px">
          <TextField label="Data wizyty" type="date" value={data.visit_date} onChange={(value) => update('visit_date', value)} />
          <FormControl>
            <FormLabel>Audytor</FormLabel>
            <Select value={data.auditor_id || ''} onChange={(event) => update('auditor_id', event.target.value)}>
              <option value="">Wybierz audytora</option>
              {staffUsers.map((user: any) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel>Typ klienta</FormLabel>
            <Select value={data.client_type || 'UNKNOWN'} onChange={(event) => update('client_type', event.target.value)}>
              <option value="UNKNOWN">Nie określono</option>
              <option value="B2C">B2C</option>
              <option value="B2B">B2B</option>
              <option value="B2C_B2B">B2C/B2B</option>
            </Select>
          </FormControl>
          <TextField label="Nazwa / imię i nazwisko klienta" value={data.client_name} onChange={(value) => update('client_name', value)} />
          <TextField label="Telefon klienta" value={data.client_phone} onChange={(value) => update('client_phone', value)} />
          <TextField label="Adres inwestycji" value={data.client_address} onChange={(value) => update('client_address', value)} />
        </SimpleGrid>
        <FormControl mt="12px">
          <FormLabel>Cel i zakres wizji</FormLabel>
          <Textarea value={data.visit_scope || ''} onChange={(event) => update('visit_scope', event.target.value)} rows={3} />
        </FormControl>
      </Section>
      <Section title="Rodzaj inwestycji" description="Wybór steruje dalszymi sekcjami audytu i podsumowaniem." colors={colors}>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px">
          <Box border="1px solid" borderColor={data.inv_mag ? 'brand.400' : borderColor} bg={data.inv_mag ? softBg : 'transparent'} borderRadius="8px" p="14px">
            <Checkbox isChecked={Boolean(data.inv_mag)} onChange={(event) => update('inv_mag', event.target.checked)}>
              <Text color={textColor} fontWeight="800">Magazyn energii</Text>
            </Checkbox>
            <Text color={mutedColor} fontSize="sm" mt="5px">Warunki montażu magazynu, falownika i trasy kablowej.</Text>
          </Box>
          <Box border="1px solid" borderColor={data.inv_pv ? 'brand.400' : borderColor} bg={data.inv_pv ? softBg : 'transparent'} borderRadius="8px" p="14px">
            <Checkbox isChecked={Boolean(data.inv_pv)} onChange={(event) => update('inv_pv', event.target.checked)}>
              <Text color={textColor} fontWeight="800">Instalacja PV</Text>
            </Checkbox>
            <Text color={mutedColor} fontSize="sm" mt="5px">Dach lub grunt, orientacja, falownik oraz przewody AC/DC.</Text>
          </Box>
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px" mt="14px">
          {data.inv_mag ? (
            <FormControl>
              <FormLabel>Konfiguracja magazynu energii</FormLabel>
              <Select value={data.mag_config_id || ''} onChange={(event) => update('mag_config_id', event.target.value)}>
                <option value="">Nie wybrano</option>
                {batteryConfigurations.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              {!batteryConfigurations.length ? <Text color={mutedColor} fontSize="xs" mt="5px">Projekt nie ma jeszcze konfiguracji magazynu.</Text> : null}
            </FormControl>
          ) : <Box />}
          {data.inv_pv ? (
            <FormControl>
              <FormLabel>Konfiguracja instalacji PV</FormLabel>
              <Select value={data.pv_config_id || ''} onChange={(event) => update('pv_config_id', event.target.value)}>
                <option value="">Nie wybrano</option>
                {pvConfigurations.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              {!pvConfigurations.length ? <Text color={mutedColor} fontSize="xs" mt="5px">Projekt nie ma jeszcze konfiguracji PV.</Text> : null}
            </FormControl>
          ) : null}
        </SimpleGrid>
      </Section>
    </>
  );
}

function StepTwo({ data, update, attachments, uploadFiles, deleteDocument, uploadingField, colors }: any) {
  return (
    <>
      <Section title="Dokumenty od klienta" description="Zdjęcia i pliki są zapisywane w dokumentach CRM i przypisane do konkretnego punktu audytu." step={2} colors={colors}>
        <Flex direction="column" gap="10px">
          {documentItems.map(([key, title, description]) => (
            <AttachmentItem key={key} fieldKey={key} title={title} description={description} documents={attachments(key)} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === key} colors={colors} />
          ))}
        </Flex>
      </Section>
      <Section title="Notatki do dokumentów" colors={colors}>
        <FormControl>
          <FormLabel>Braki, jakość dokumentów i ustalenia z klientem</FormLabel>
          <Textarea value={data.documents_notes || ''} onChange={(event) => update('documents_notes', event.target.value)} rows={4} />
        </FormControl>
      </Section>
    </>
  );
}

function StepThree({ data, update, attachments, uploadFiles, deleteDocument, uploadingField, colors }: any) {
  return (
    <>
      <Section title="Instalacja elektryczna" description="Parametry z tej sekcji zostaną także przekazane do audytu energetycznego projektu." step={3} colors={colors}>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap="12px" mb="14px">
          <TextField label="Moc przyłączeniowa [kW]" type="number" value={data.connection_power_kw} onChange={(value) => update('connection_power_kw', value)} />
          <FormControl>
            <FormLabel>Liczba faz</FormLabel>
            <Select value={data.phase_count || ''} onChange={(event) => update('phase_count', event.target.value)}>
              <option value="">Nie określono</option>
              <option value="1">1 faza</option>
              <option value="3">3 fazy</option>
            </Select>
          </FormControl>
          <TextField label="Zabezpieczenie główne [A]" type="number" value={data.main_fuse_a} onChange={(value) => update('main_fuse_a', value)} />
        </SimpleGrid>
        <Flex direction="column" gap="10px">
          {electricalItems.map(([key, title, field, label]) => (
            <AttachmentItem key={key} fieldKey={key} title={title} documents={attachments(key)} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === key} colors={colors}>
              <TextField label={label} value={data[field] || ''} onChange={(value) => update(field, value)} />
            </AttachmentItem>
          ))}
        </Flex>
      </Section>
      <Section title="Istniejąca instalacja" description="Uwzględniamy sprzęt klienta, który ma pozostać w projektowanym systemie." colors={colors}>
        <FormControl maxW="360px" mb="12px">
          <FormLabel>Czy klient posiada instalację PV?</FormLabel>
          <Select value={data.has_pv_now || 'no'} onChange={(event) => update('has_pv_now', event.target.value)}>
            <option value="yes">Tak</option>
            <option value="no">Nie</option>
          </Select>
        </FormControl>
        {data.has_pv_now === 'yes' ? (
          <AttachmentItem fieldKey="electrical.existing-pv" title="Istniejąca instalacja PV / falownik" documents={attachments('electrical.existing-pv')} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === 'electrical.existing-pv'} colors={colors}>
            <SimpleGrid columns={{ base: 1, md: 3 }} gap="10px">
              <TextField label="Urządzenie / model" value={data.existing_pv_device} onChange={(value) => update('existing_pv_device', value)} />
              <TextField label="Parametry" value={data.existing_pv_params} onChange={(value) => update('existing_pv_params', value)} />
              <TextField label="Moc istniejącej PV [kWp]" type="number" value={data.existing_pv_kw} onChange={(value) => update('existing_pv_kw', value)} />
            </SimpleGrid>
          </AttachmentItem>
        ) : null}
        <TextField label="Istniejący magazyn energii [kWh]" type="number" value={data.existing_battery_kwh} onChange={(value) => update('existing_battery_kwh', value)} />
      </Section>
    </>
  );
}

function StepFour({ data, update, attachments, uploadFiles, deleteDocument, uploadingField, colors }: any) {
  const loads = Array.isArray(data.loads) ? data.loads : [];
  function updateLoad(id: string, key: string, value: string) {
    update('loads', loads.map((item: any) => item.id === id ? { ...item, [key]: value } : item));
  }
  function addLoad() {
    update('loads', [...loads, { id: `load-${Date.now()}`, device: '', params: '' }]);
  }
  function removeLoad(id: string) {
    update('loads', loads.filter((item: any) => item.id !== id));
  }
  return (
    <>
      <Section title="Ogrzewanie" description="Źródło ogrzewania często decyduje o profilu zużycia i doborze magazynu." step={4} colors={colors}>
        <AttachmentItem fieldKey="loads.heating" title="Źródło ogrzewania C.O." documents={attachments('loads.heating')} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === 'loads.heating'} colors={colors}>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="10px">
            <FormControl>
              <FormLabel>Źródło ogrzewania</FormLabel>
              <Select value={data.heating_source || ''} onChange={(event) => update('heating_source', event.target.value)}>
                <option value="">Nie określono</option>
                <option value="HEAT_PUMP">Pompa ciepła</option>
                <option value="GAS">Kocioł gazowy</option>
                <option value="ELECTRIC">Ogrzewanie elektryczne</option>
                <option value="PELLET">Kocioł na pellet</option>
                <option value="OTHER">Inne</option>
              </Select>
            </FormControl>
            <TextField label="Parametry urządzenia" value={data.heating_params} onChange={(value) => update('heating_params', value)} />
          </SimpleGrid>
        </AttachmentItem>
      </Section>
      <Section title="Odbiorniki energii o dużym poborze" description="Dodaj wszystkie istotne urządzenia; lista nie jest ograniczona do dwóch pozycji." colors={colors}>
        <Flex direction="column" gap="10px">
          {loads.map((load: any, index: number) => (
            <AttachmentItem key={load.id} fieldKey={`loads.device.${load.id}`} title={`Odbiornik ${index + 1}`} documents={attachments(`loads.device.${load.id}`)} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === `loads.device.${load.id}`} colors={colors}>
              <Grid templateColumns={{ base: '1fr', md: '1fr 2fr auto' }} gap="10px" alignItems="end">
                <FormControl>
                  <FormLabel>Urządzenie</FormLabel>
                  <Select value={load.device || ''} onChange={(event) => updateLoad(load.id, 'device', event.target.value)}>
                    <option value="">Wybierz</option>
                    <option value="Klimatyzacja">Klimatyzacja</option>
                    <option value="Ładowarka EV">Ładowarka EV</option>
                    <option value="Płyta indukcyjna">Płyta indukcyjna</option>
                    <option value="Sauna">Sauna</option>
                    <option value="Maszyna / linia produkcyjna">Maszyna / linia produkcyjna</option>
                    <option value="Inne">Inne</option>
                  </Select>
                </FormControl>
                <TextField label="Parametry i sposób użytkowania" value={load.params} onChange={(value) => updateLoad(load.id, 'params', value)} />
                <Tooltip label="Usuń odbiornik">
                  <IconButton aria-label="Usuń odbiornik" icon={<MdDeleteOutline />} variant="outline" colorScheme="red" onClick={() => removeLoad(load.id)} />
                </Tooltip>
              </Grid>
            </AttachmentItem>
          ))}
        </Flex>
        <Button mt="12px" leftIcon={<MdAdd />} variant="outline" onClick={addLoad}>Dodaj odbiornik</Button>
        <FormControl mt="14px">
          <FormLabel>Notatki do ogrzewania i odbiorników</FormLabel>
          <Textarea value={data.heating_notes || ''} onChange={(event) => update('heating_notes', event.target.value)} />
        </FormControl>
      </Section>
    </>
  );
}

function StepFive({ data, update, attachments, uploadFiles, deleteDocument, uploadingField, colors }: any) {
  return (
    <>
      <Section title="Obiekt" description="Parametry budynku i dachu potrzebne do projektu technicznego." step={5} colors={colors}>
        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="12px">
          <FormControl>
            <FormLabel>Rodzaj budynku</FormLabel>
            <Select value={data.building_type || ''} onChange={(event) => update('building_type', event.target.value)}>
              <option value="">Nie określono</option>
              <option>Dom jednorodzinny</option>
              <option>Bliźniak</option>
              <option>Szeregowiec</option>
              <option>Budynek wielorodzinny</option>
              <option>Obiekt usługowy</option>
              <option>Hala / obiekt przemysłowy</option>
              <option>Inny</option>
            </Select>
          </FormControl>
          <TextField label="Powierzchnia użytkowa [m²]" type="number" value={data.usable_area_m2} onChange={(value) => update('usable_area_m2', value)} />
          <FormControl>
            <FormLabel>Standard energetyczny</FormLabel>
            <Select value={data.energy_standard || ''} onChange={(event) => update('energy_standard', event.target.value)}>
              <option value="">Nie określono</option>
              <option>Standardowy</option>
              <option>Po termomodernizacji</option>
              <option>Energooszczędny</option>
              <option>Pasywny</option>
            </Select>
          </FormControl>
          <TextField label="Liczba kondygnacji" type="number" value={data.building_floors} onChange={(value) => update('building_floors', value)} />
          <FormControl>
            <FormLabel>Rodzaj dachu</FormLabel>
            <Select value={data.roof_type || 'UNKNOWN'} onChange={(event) => update('roof_type', event.target.value)}>
              <option value="UNKNOWN">Nie określono</option>
              <option value="SLOPED">Skośny</option>
              <option value="FLAT">Płaski</option>
              <option value="GROUND">Konstrukcja gruntowa</option>
              <option value="OTHER">Inny</option>
            </Select>
          </FormControl>
          <TextField label="Powierzchnia dostępna [m²]" type="number" value={data.roof_area_m2} onChange={(value) => update('roof_area_m2', value)} />
          <TextField label="Nachylenie [°]" type="number" value={data.roof_angle_deg} onChange={(value) => update('roof_angle_deg', value)} />
          <FormControl>
            <FormLabel>Pokrycie dachowe</FormLabel>
            <Select value={data.roof_cover || ''} onChange={(event) => update('roof_cover', event.target.value)}>
              <option value="">Nie określono</option>
              <option>Dachówka ceramiczna</option>
              <option>Dachówka betonowa</option>
              <option>Blachodachówka</option>
              <option>Blacha trapezowa</option>
              <option>Papa / membrana</option>
              <option>Inne</option>
            </Select>
          </FormControl>
        </SimpleGrid>
        <FormControl mt="12px">
          <FormLabel>Typ i materiał konstrukcji dachu</FormLabel>
          <Input value={data.roof_structure || ''} onChange={(event) => update('roof_structure', event.target.value)} />
        </FormControl>
      </Section>
      <Section title="Zdjęcia budynku" colors={colors}>
        <SimpleGrid columns={{ base: 1, xl: 2 }} gap="10px">
          {buildingPhotoItems.map(([key, title, field]) => (
            <AttachmentItem key={key} fieldKey={key} title={title} documents={attachments(key)} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === key} colors={colors}>
              <TextField label="Opis" value={data[field] || ''} onChange={(value) => update(field, value)} />
            </AttachmentItem>
          ))}
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px" mt="14px">
          <FormControl>
            <FormLabel>Opis obiektu</FormLabel>
            <Textarea value={data.building_notes || ''} onChange={(event) => update('building_notes', event.target.value)} />
          </FormControl>
          <FormControl>
            <FormLabel>Zacienienie i przeszkody</FormLabel>
            <Textarea value={data.shading_notes || ''} onChange={(event) => update('shading_notes', event.target.value)} />
          </FormControl>
        </SimpleGrid>
      </Section>
    </>
  );
}

function StepSix({ data, update, attachments, uploadFiles, deleteDocument, uploadingField, colors }: any) {
  return (
    <>
      <Section title="Inwestycja" description="Szczegółowe warunki prowadzenia prac i montażu urządzeń." step={6} colors={colors}>
        {!data.inv_pv && !data.inv_mag ? (
          <Alert status="info" borderRadius="8px"><AlertIcon />W kroku 1 zaznacz instalację PV, magazyn energii albo oba zakresy.</Alert>
        ) : null}
        {data.inv_pv ? (
          <Box mb={data.inv_mag ? '18px' : 0}>
            <Text color={colors.textColor} fontSize="md" fontWeight="800" mb="10px">Instalacja PV</Text>
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px" mb="12px">
              <FormControl>
                <FormLabel>Miejsce montażu</FormLabel>
                <Select value={data.pv_place || 'ROOF'} onChange={(event) => update('pv_place', event.target.value)}>
                  <option value="ROOF">Dach</option>
                  <option value="GROUND">Grunt</option>
                  <option value="FACADE">Elewacja</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Orientacja</FormLabel>
                <Select value={data.roof_orientation || 'S'} onChange={(event) => update('roof_orientation', event.target.value)}>
                  <option value="S">Południe</option>
                  <option value="SE">Południowy wschód</option>
                  <option value="SW">Południowy zachód</option>
                  <option value="E_W">Wschód-zachód</option>
                  <option value="E">Wschód</option>
                  <option value="W">Zachód</option>
                  <option value="N">Północ</option>
                </Select>
              </FormControl>
            </SimpleGrid>
            <Flex direction="column" gap="10px">
              {pvItems.map(([key, title, field, label]) => (
                <AttachmentItem key={key} fieldKey={key} title={title} documents={attachments(key)} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === key} colors={colors}>
                  <SimpleGrid columns={{ base: 1, md: title.includes('kabli') ? 2 : 1 }} gap="10px">
                    <TextField label={label} value={data[field] || ''} onChange={(value) => update(field, value)} />
                    {key === 'pv.ac-route' ? <TextField label="Długość [m]" type="number" value={data.ac_length_m} onChange={(value) => update('ac_length_m', value)} /> : null}
                    {key === 'pv.dc-route' ? <TextField label="Długość [m]" type="number" value={data.dc_length_m} onChange={(value) => update('dc_length_m', value)} /> : null}
                  </SimpleGrid>
                </AttachmentItem>
              ))}
            </Flex>
            <FormControl mt="12px">
              <FormLabel>Preferencje klienta dotyczące PV</FormLabel>
              <Textarea value={data.pv_preferences || ''} onChange={(event) => update('pv_preferences', event.target.value)} />
            </FormControl>
          </Box>
        ) : null}
        {data.inv_mag ? (
          <Box>
            <Text color={colors.textColor} fontSize="md" fontWeight="800" mb="10px">Magazyn energii</Text>
            <Flex direction="column" gap="10px">
              {batteryItems.map(([key, title, field, label]) => (
                <AttachmentItem key={key} fieldKey={key} title={title} documents={attachments(key)} uploadFiles={uploadFiles} deleteDocument={deleteDocument} busy={uploadingField === key} colors={colors}>
                  <TextField label={label} value={data[field] || ''} onChange={(value) => update(field, value)} />
                </AttachmentItem>
              ))}
            </Flex>
            <FormControl mt="12px">
              <FormLabel>Preferencje klienta dotyczące magazynu</FormLabel>
              <Textarea value={data.battery_preferences || ''} onChange={(event) => update('battery_preferences', event.target.value)} />
            </FormControl>
          </Box>
        ) : null}
      </Section>
    </>
  );
}

function StepSeven({ data, update, documents, summary, pvConfig, batteryConfig, auditorName, colors }: any) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  function updateFinding(id: string, key: string, value: string) {
    update('findings', findings.map((item: any) => item.id === id ? { ...item, [key]: value } : item));
  }
  function addFinding() {
    update('findings', [...findings, { id: `finding-${Date.now()}`, title: '', description: '' }]);
  }
  function removeFinding(id: string) {
    update('findings', findings.filter((item: any) => item.id !== id));
  }
  const auditImages = documents.filter((document: AuditDocument) => document.mimeType?.startsWith('image/')).slice(0, 8);
  return (
    <>
      <Section title="Podsumowanie wizji lokalnej" description="Uzupełnij wynik, następny krok i zalecenia przed zakończeniem audytu." step={7} colors={colors}>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px">
          <FormControl>
            <FormLabel>Możliwość realizacji</FormLabel>
            <Select value={data.audit_result || ''} onChange={(event) => update('audit_result', event.target.value)}>
              <option value="">Wybierz wynik</option>
              <option>Możliwa do realizacji</option>
              <option>Możliwa warunkowo</option>
              <option>Wymaga dodatkowej weryfikacji</option>
              <option>Niemożliwa w obecnym zakresie</option>
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel>Następny krok</FormLabel>
            <Select value={data.audit_next_action || ''} onChange={(event) => update('audit_next_action', event.target.value)}>
              <option value="">Wybierz następny krok</option>
              <option>Przekazać do przygotowania projektu</option>
              <option>Uzupełnić dokumentację</option>
              <option>Wykonać dodatkowe pomiary</option>
              <option>Przygotować korektę zakresu</option>
              <option>Wstrzymać realizację</option>
            </Select>
          </FormControl>
        </SimpleGrid>
        <FormControl mt="12px">
          <FormLabel>Wniosek końcowy</FormLabel>
          <Textarea value={data.final_summary_notes || ''} onChange={(event) => update('final_summary_notes', event.target.value)} rows={4} />
        </FormControl>
        <Flex mt="16px" justify="space-between" align="center">
          <Text color={colors.textColor} fontWeight="800">Ustalenia i zalecenia</Text>
          <Button leftIcon={<MdAdd />} size="sm" variant="outline" onClick={addFinding}>Dodaj ustalenie</Button>
        </Flex>
        <Flex direction="column" gap="8px" mt="10px">
          {findings.map((finding: any) => (
            <Grid key={finding.id} templateColumns={{ base: '1fr', md: '220px minmax(0, 1fr) auto' }} gap="8px">
              <Input placeholder="Tytuł ustalenia" value={finding.title || ''} onChange={(event) => updateFinding(finding.id, 'title', event.target.value)} />
              <Textarea placeholder="Opis ustalenia lub zalecenia" value={finding.description || ''} onChange={(event) => updateFinding(finding.id, 'description', event.target.value)} rows={2} />
              <Tooltip label="Usuń ustalenie">
                <IconButton aria-label="Usuń ustalenie" icon={<MdDeleteOutline />} variant="outline" colorScheme="red" onClick={() => removeFinding(finding.id)} />
              </Tooltip>
            </Grid>
          ))}
        </Flex>
      </Section>

      <Box bg={colors.panelBg} border="1px solid" borderColor={colors.borderColor} borderRadius="8px" p={{ base: '12px', md: '18px' }}>
        <Flex justify="space-between" align="center" gap="12px" mb="14px">
          <Box>
            <Text color={colors.textColor} fontWeight="800">Podgląd raportu</Text>
            <Text color={colors.mutedColor} fontSize="sm">Wydruk można zapisać jako PDF z poziomu przeglądarki.</Text>
          </Box>
          <Button leftIcon={<MdPrint />} colorScheme="purple" onClick={() => window.print()}>Drukuj / zapisz PDF</Button>
        </Flex>
        <Box id="site-audit-report" bg="#eef2f8" p={{ base: '8px', md: '18px' }} borderRadius="8px" color="#1B2559">
          <ReportPage title="Raport z wizji lokalnej" subtitle="Dokumentacja techniczna przygotowana na podstawie danych zebranych podczas audytu.">
            <SimpleGrid columns={2} gap="8px">
              <ReportMeta label="Inwestor" value={data.client_name || '-'} />
              <ReportMeta label="Audytor" value={auditorName || '-'} />
              <ReportMeta label="Adres inwestycji" value={data.client_address || '-'} />
              <ReportMeta label="Data wizyty" value={formatDate(data.visit_date)} />
            </SimpleGrid>
            <ReportHeading>Wynik audytu</ReportHeading>
            <ReportRow label="Możliwość realizacji" value={data.audit_result || 'Nie określono'} />
            <ReportRow label="Następny krok" value={data.audit_next_action || 'Nie określono'} />
            <ReportHeading>Rekomendowana konfiguracja</ReportHeading>
            <ReportRow label="Instalacja PV" value={pvConfig} />
            <ReportRow label="Magazyn energii" value={batteryConfig} />
            <ReportHeading>Obiekt i instalacja elektryczna</ReportHeading>
            <ReportRow label="Obiekt" value={summary.building} />
            <ReportRow label="Dach" value={summary.roof} />
            <ReportRow label="Instalacja elektryczna" value={summary.electrical} />
            <ReportRow label="Istotne odbiorniki" value={summary.loads} />
            <ReportHeading>Warunki montażowe</ReportHeading>
            <ReportRow label="Instalacja PV" value={summary.pvMounting} />
            <ReportRow label="Magazyn energii" value={summary.batteryMounting} />
          </ReportPage>
          <ReportPage title="Ustalenia i zalecenia" subtitle="Podstawa do opracowania projektu technicznego i dalszych działań realizacyjnych.">
            <Flex direction="column" gap="8px">
              {findings.filter((item: any) => item.title || item.description).map((item: any) => (
                <Box key={item.id} border="1px solid #d9e1ee" borderRadius="6px" p="10px">
                  <Text fontWeight="800">{item.title || 'Ustalenie'}</Text>
                  <Text fontSize="sm">{item.description || 'Brak opisu'}</Text>
                </Box>
              ))}
              {!findings.some((item: any) => item.title || item.description) ? <Text>Brak wpisanych ustaleń.</Text> : null}
            </Flex>
            <ReportHeading>Wniosek końcowy</ReportHeading>
            <Text fontSize="sm" whiteSpace="pre-wrap">{data.final_summary_notes || 'Nie uzupełniono wniosku końcowego.'}</Text>
            <ReportHeading>Dokumentacja zdjęciowa</ReportHeading>
            {auditImages.length ? (
              <SimpleGrid columns={2} gap="8px">
                {auditImages.map((document: AuditDocument) => (
                  <Box key={document.id} border="1px solid #d9e1ee" borderRadius="6px" overflow="hidden">
                    <Box as="img" src={`/api/documents/${document.id}/file`} alt={document.title} w="100%" h="150px" objectFit="cover" />
                    <Text p="7px" fontSize="xs" fontWeight="700">{document.title}</Text>
                  </Box>
                ))}
              </SimpleGrid>
            ) : <Text fontSize="sm">Brak zdjęć przypisanych do audytu.</Text>}
          </ReportPage>
        </Box>
      </Box>
    </>
  );
}

function AttachmentItem({
  fieldKey,
  title,
  description,
  documents,
  uploadFiles,
  deleteDocument,
  busy,
  colors,
  children,
}: {
  fieldKey: string;
  title: string;
  description?: string;
  documents: AuditDocument[];
  uploadFiles: (fieldKey: string, label: string, files: File[]) => void;
  deleteDocument: (id: string) => void;
  busy: boolean;
  colors: Colors;
  children?: ReactNode;
}) {
  const [previewDocument, setPreviewDocument] = useState<AuditDocument | null>(null);

  function selected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    uploadFiles(fieldKey, title, files);
  }
  return (
    <Box border="1px solid" borderColor={colors.borderColor} borderRadius="8px" p="12px">
      <Flex direction={{ base: 'column', md: 'row' }} justify="space-between" gap="10px">
        <Box flex="1">
          <Text color={colors.textColor} fontWeight="800">{title}</Text>
          {description ? <Text color={colors.mutedColor} fontSize="sm">{description}</Text> : null}
        </Box>
        <Flex gap="7px" align="center" wrap="wrap">
          <Button as="label" size="sm" leftIcon={<MdCameraAlt />} colorScheme="blue" variant="outline" cursor="pointer" isLoading={busy}>
            Zrób zdjęcie
            <Input data-testid={`audit-camera-${fieldKey}`} display="none" type="file" accept="image/*,.heic,.heif" capture="environment" onChange={selected} />
          </Button>
          <Button data-testid={`audit-upload-button-${fieldKey}`} as="label" size="sm" leftIcon={<MdUploadFile />} variant="outline" cursor="pointer" isLoading={busy}>
            Wgraj
            <Input data-testid={`audit-upload-${fieldKey}`} display="none" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.xlsx,.xls,.ods,.docx,.doc,.csv,.txt,image/heic,image/heif" onChange={selected} />
          </Button>
        </Flex>
      </Flex>
      {children ? <Box mt="10px">{children}</Box> : null}
      {documents.length ? (
        <Flex gap="7px" mt="10px" wrap="wrap">
          {documents.map((document) => {
            const image = Boolean(document.mimeType?.startsWith('image/'));
            return (
              <Flex key={document.id} align="center" gap="5px" bg={colors.softBg} borderRadius="6px" p="5px 7px">
                {image ? (
                  <Tooltip label="Podejrzyj zdjęcie">
                    <Box
                      as="button"
                      type="button"
                      aria-label={`Podejrzyj zdjęcie ${document.fileName}`}
                      w="42px"
                      h="34px"
                      borderRadius="4px"
                      overflow="hidden"
                      flexShrink="0"
                      onClick={() => setPreviewDocument(document)}
                    >
                      <Box
                        as="img"
                        src={`/api/documents/${document.id}/file`}
                        alt={document.title}
                        w="100%"
                        h="100%"
                        objectFit="cover"
                      />
                    </Box>
                  </Tooltip>
                ) : <MdInsertDriveFile />}
                {image ? (
                  <Button
                    variant="link"
                    color={colors.textColor}
                    fontSize="xs"
                    fontWeight="700"
                    maxW="180px"
                    h="auto"
                    whiteSpace="normal"
                    textAlign="left"
                    noOfLines={1}
                    onClick={() => setPreviewDocument(document)}
                  >
                    {document.fileName}
                  </Button>
                ) : (
                  <Link href={`/api/documents/${document.id}/file`} isExternal color={colors.textColor} fontSize="xs" fontWeight="700" maxW="180px" noOfLines={1}>
                    {document.fileName} <MdOpenInNew style={{ display: 'inline' }} />
                  </Link>
                )}
                <Tooltip label="Usuń załącznik">
                  <IconButton aria-label="Usuń załącznik" icon={<MdDeleteOutline />} size="xs" variant="ghost" colorScheme="red" onClick={() => deleteDocument(document.id)} />
                </Tooltip>
              </Flex>
            );
          })}
        </Flex>
      ) : null}
      <DocumentImagePreviewModal
        document={previewDocument}
        isOpen={Boolean(previewDocument)}
        onClose={() => setPreviewDocument(null)}
      />
    </Box>
  );
}

function roofLabel(value: string) {
  return ({
    SLOPED: 'Dach skośny',
    FLAT: 'Dach płaski',
    GROUND: 'Konstrukcja gruntowa',
    OTHER: 'Inny',
    UNKNOWN: '',
  } as Record<string, string>)[value] || value || '';
}

function orientationLabel(value: string) {
  return ({
    S: 'Południe',
    SE: 'Południowy wschód',
    SW: 'Południowy zachód',
    E_W: 'Wschód-zachód',
    E: 'Wschód',
    W: 'Zachód',
    N: 'Północ',
  } as Record<string, string>)[value] || value || '';
}

function ReportPage({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Box className="audit-report-page" bg="#fff" maxW="820px" mx="auto" mb="16px" p={{ base: '18px', md: '34px' }} boxShadow="0 8px 24px rgba(60,80,120,.12)">
      <Flex justify="space-between" align="start" gap="12px" mb="24px">
        <Box>
          <Text fontSize="2xl" fontWeight="800">{title}</Text>
          <Text color="#66749a" fontSize="sm">{subtitle}</Text>
        </Box>
        <Text color="#7551ff" fontWeight="800">onRevolt</Text>
      </Flex>
      {children}
      <Flex mt="28px" pt="10px" borderTop="1px solid #e4e9f2" justify="space-between">
        <Text fontSize="xs" color="#7b88a8">onRevolt · raport z wizji lokalnej</Text>
        <Text fontSize="xs" color="#7b88a8">{formatDate(today())}</Text>
      </Flex>
    </Box>
  );
}

function ReportMeta({ label, value }: { label: string; value: string }) {
  return <Box bg="#f5f7fb" borderRadius="6px" p="9px"><Text color="#7b88a8" fontSize="xs">{label}</Text><Text fontSize="sm" fontWeight="800">{value}</Text></Box>;
}

function ReportHeading({ children }: { children: ReactNode }) {
  return <Text mt="20px" mb="7px" fontSize="md" fontWeight="800">{children}</Text>;
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return <Flex py="7px" borderBottom="1px solid #e4e9f2" justify="space-between" gap="16px"><Text color="#66749a" fontSize="sm">{label}</Text><Text textAlign="right" fontSize="sm" fontWeight="800">{value}</Text></Flex>;
}
