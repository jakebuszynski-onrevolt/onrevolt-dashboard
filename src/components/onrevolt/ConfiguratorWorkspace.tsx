'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
  HStack,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Portal,
  Select,
  SimpleGrid,
  Spinner,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
  useColorModeValue,
  useDisclosure,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { calculateConfigurationLine } from 'lib/onrevolt/calculator';
import {
  ConfigurationVatMode,
  defaultSaleVatRateForMode,
  defaultVatModeForClientType,
  resolveSaleVatRate,
  vatBreakdown,
} from 'lib/onrevolt/configuration-vat';
import { percentFormValueToRate, rateToPercentFormValue } from 'lib/onrevolt/percentage';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdBatteryChargingFull,
  MdDelete,
  MdKeyboardArrowDown,
  MdLibraryAdd,
  MdRefresh,
  MdSave,
  MdSearch,
  MdSettingsInputComponent,
  MdSolarPower,
  MdSyncAlt,
  MdTune,
} from 'react-icons/md';

type PriceRow = {
  purchaseNet: string | number;
  currentPurchaseNet?: string | number | null;
  purchaseVatRate: string | number;
  operatingCostNet: string | number;
  marginRate: string | number;
  saleVatRate?: string | number | null;
};

type ProductRow = {
  id: string;
  sku?: string | null;
  name: string;
  category: string;
  producer?: string | null;
  powerCapacity?: string | null;
  voltageKind?: string | null;
  availability?: string | null;
  prices: PriceRow[];
};

type ExistingAssetRow = {
  id?: string;
  kind: string;
  name: string;
  producer?: string | null;
  model?: string | null;
  powerKw?: string | number | null;
  capacityKwh?: string | number | null;
  quantity?: string | number | null;
  voltageKind?: string | null;
  phaseCount?: string | number | null;
  verificationStatus?: string | null;
  compatibilityStatus?: string | null;
  notes?: string | null;
};

type ProjectRow = {
  id: string;
  title: string;
  clientType: string;
  status: string;
  client: {
    displayName: string;
    clientType: string;
  };
  investmentSite?: {
    fullAddress?: string | null;
    addressLine?: string | null;
    city?: string | null;
  } | null;
  existingAssets: ExistingAssetRow[];
};

type TemplateItemRow = {
  id: string;
  productId?: string | null;
  product?: ProductRow | null;
  position: number;
  description?: string | null;
  quantity: string | number;
  role: string;
  supplyMode: string;
  unitPurchaseNet?: string | number | null;
  purchaseVatRate?: string | number | null;
  operatingCostNet?: string | number | null;
  marginRate?: string | number | null;
  saleVatRate?: string | number | null;
  isOptional?: boolean;
  requiresReview?: boolean;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  notes?: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  clientType: string;
  roofType?: string | null;
  goal?: string | null;
  powerKw?: string | number | null;
  capacityKwh?: string | number | null;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  sourceSheet?: string | null;
  sourceRange?: string | null;
  items: TemplateItemRow[];
};

type ConfigItemForm = {
  productId: string;
  position: number;
  description: string;
  quantity: string;
  role: string;
  supplyMode: string;
  unitPurchaseNet: string;
  purchaseVatRate: string;
  operatingCostNet: string;
  marginRate: string;
  saleVatRate: string;
  isOptional: boolean;
  requiresReview: boolean;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  notes: string;
};

const goalLabels: Record<string, string> = {
  NEW_PV: 'Nowa PV',
  PV_WITH_STORAGE: 'PV + magazyn',
  STORAGE_RETROFIT: 'Magazyn do istniejącej PV',
  PV_EXPANSION: 'Rozbudowa PV',
  INVERTER_REPLACEMENT: 'Wymiana falownika',
  EMS_MONITORING: 'EMS / monitoring',
  SERVICE_ONLY: 'Tylko usługa',
  MIXED: 'Mieszane',
};

const roofLabels: Record<string, string> = {
  FLAT: 'Dach płaski',
  SLOPED: 'Dach skośny',
  GROUND: 'Grunt',
  OTHER: 'Inny',
  UNKNOWN: 'Nie określono',
};

const clientTypeLabels: Record<string, string> = {
  B2C: 'B2C',
  B2B: 'B2B',
  B2C_B2B: 'B2C / B2B',
  UNKNOWN: 'Nie określono',
};

const kindLabels: Record<string, string> = {
  PV_DACH_PLASKI: 'PV dach płaski',
  PV_DACH_SKOSNY: 'PV dach skośny',
  MAGAZYN: 'Magazyn',
  EMS: 'EMS',
  MIXED: 'Mieszane',
};

const roleLabels: Record<string, string> = {
  MAIN_EQUIPMENT: 'Sprzęt główny',
  ACCESSORY: 'Osprzęt',
  MOUNTING: 'Montaż konstrukcji',
  CABLING: 'Okablowanie',
  PROTECTION: 'Zabezpieczenia',
  MONITORING: 'Monitoring',
  FORMALITIES: 'Formalności',
  LOGISTICS: 'Logistyka',
  LABOR: 'Robocizna',
  DESIGN: 'Projekt',
  OTHER: 'Inne',
};

const supplyModeLabels: Record<string, string> = {
  ONREVOLT_SUPPLIED: 'OnRevolt dostarcza',
  CLIENT_OWNED_USED: 'Sprzęt klienta',
  CLIENT_SUPPLIED_NEW: 'Klient dostarcza nowy',
  SERVICE_ONLY: 'Tylko usługa',
  NOT_INCLUDED: 'Nie ujmuj',
};

const assetKindLabels: Record<string, string> = {
  PV_MODULES: 'Panele PV',
  PV_INVERTER: 'Falownik PV',
  HYBRID_INVERTER: 'Falownik hybrydowy',
  BATTERY: 'Magazyn energii',
  GRID_METER: 'Licznik Grid',
  EMS: 'EMS',
  PROTECTION: 'Zabezpieczenia',
  CABLING: 'Okablowanie',
  OTHER: 'Inne',
};

const assetVerificationLabels: Record<string, string> = {
  DECLARED: 'Deklaracja klienta',
  PHOTO_CONFIRMED: 'Potwierdzone zdjęciem',
  DOCUMENT_CONFIRMED: 'Potwierdzone dokumentem',
  AUDIT_CONFIRMED: 'Potwierdzone audytem',
  UNKNOWN: 'Nieznane',
};

const compatibilityLabels: Record<string, string> = {
  UNKNOWN: 'Do sprawdzenia',
  COMPATIBLE: 'Zgodne',
  NEEDS_AUDIT: 'Wymaga audytu',
  INCOMPATIBLE: 'Niezgodne',
};

const clientTypes = ['B2C', 'B2B', 'B2C_B2B', 'UNKNOWN'];
const goals = Object.keys(goalLabels);
const roofTypes = Object.keys(roofLabels);
const roles = Object.keys(roleLabels);
const supplyModes = Object.keys(supplyModeLabels);
const assetKinds = Object.keys(assetKindLabels);
const verificationStatuses = Object.keys(assetVerificationLabels);
const compatibilityStatuses = Object.keys(compatibilityLabels);
const nonPricedSupplyModes = new Set(['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED']);
const saleVatModeLabels: Record<ConfigurationVatMode, string> = {
  REDUCED_8: '8% - stawka obniżona',
  STANDARD_23: '23% - stawka podstawowa',
  MIXED: 'Mieszany - stawka przy pozycji',
  REVIEW: 'Do weryfikacji',
};
const vatBasisLabels: Record<string, string> = {
  RESIDENTIAL_INSTALLATION: 'Montaż w kwalifikującym się budynku mieszkalnym',
  OTHER_REDUCED: 'Inna podstawa stawki obniżonej',
  STANDARD_RATE: 'Stawka podstawowa',
  MIXED_RATES: 'Stawki mieszane',
};

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 0;
  return Number(value);
}

function formValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: string | number | null | undefined, maximumFractionDigits = 2) {
  const number = asNumber(value);
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits }).format(number);
}

function roleFromProduct(product?: ProductRow) {
  if (!product) return 'OTHER';
  if (product.category === 'FOTOWOLTAIKA' || product.category === 'FALOWNIK' || product.category === 'INWERTER' || product.category === 'MAGAZYN_ENERGII') return 'MAIN_EQUIPMENT';
  if (product.category === 'USLUGA_MONTAZOWA') return 'LABOR';
  if (product.category === 'KOSZTY_OPERACYJNE') return 'FORMALITIES';
  if (product.category === 'MONITOROWANIE' || product.category === 'SYSTEM_MONITORUJACY') return 'MONITORING';
  if (product.category === 'OSPRZET_ELEKTRONIKA') return 'ACCESSORY';
  return 'OTHER';
}

function supplyModeFromRole(role: string) {
  return ['LABOR', 'FORMALITIES', 'DESIGN', 'LOGISTICS'].includes(role) ? 'SERVICE_ONLY' : 'ONREVOLT_SUPPLIED';
}

function itemFromTemplate(item: TemplateItemRow): ConfigItemForm {
  return {
    productId: item.productId || '',
    position: item.position,
    description: item.description || item.product?.name || '',
    quantity: formValue(item.quantity || 1),
    role: item.role || roleFromProduct(item.product || undefined),
    supplyMode: item.supplyMode || 'ONREVOLT_SUPPLIED',
    unitPurchaseNet: formValue(item.unitPurchaseNet),
    purchaseVatRate: rateToPercentFormValue(item.purchaseVatRate),
    operatingCostNet: formValue(item.operatingCostNet),
    marginRate: rateToPercentFormValue(item.marginRate),
    saleVatRate: rateToPercentFormValue(item.saleVatRate),
    isOptional: Boolean(item.isOptional),
    requiresReview: Boolean(item.requiresReview),
    sourceSheet: item.sourceSheet,
    sourceRow: item.sourceRow,
    notes: item.notes || '',
  };
}

function itemFromProduct(product?: ProductRow, position = 1): ConfigItemForm {
  const price = product?.prices?.[0];
  const role = roleFromProduct(product);
  return {
    productId: product?.id || '',
    position,
    description: product?.name || '',
    quantity: '1',
    role,
    supplyMode: supplyModeFromRole(role),
    unitPurchaseNet: formValue(price?.currentPurchaseNet ?? price?.purchaseNet ?? ''),
    purchaseVatRate: rateToPercentFormValue(price?.purchaseVatRate ?? '0.23'),
    operatingCostNet: formValue(price?.operatingCostNet ?? '0'),
    marginRate: rateToPercentFormValue(price?.marginRate ?? '0.3'),
    saleVatRate: '',
    isOptional: false,
    requiresReview: false,
    notes: '',
  };
}

function pricedInput(item: ConfigItemForm, saleVatMode: ConfigurationVatMode) {
  if (nonPricedSupplyModes.has(item.supplyMode)) {
    return {
      quantity: asNumber(item.quantity),
      unitPurchaseNet: 0,
      purchaseVatRate: 0,
      operatingCostNet: 0,
      marginRate: 0,
      saleVatRate: 0,
      includeVatSurplus: false,
    };
  }

  return {
    quantity: asNumber(item.quantity),
    unitPurchaseNet: asNumber(item.unitPurchaseNet),
    purchaseVatRate: percentFormValueToRate(item.purchaseVatRate),
    operatingCostNet: asNumber(item.operatingCostNet),
    marginRate: percentFormValueToRate(item.marginRate),
    saleVatRate: resolveSaleVatRate(saleVatMode, percentFormValueToRate(item.saleVatRate)),
  };
}

function itemToPayload(item: ConfigItemForm, saleVatMode: ConfigurationVatMode) {
  return {
    ...item,
    purchaseVatRate: percentFormValueToRate(item.purchaseVatRate),
    marginRate: percentFormValueToRate(item.marginRate),
    saleVatRate: resolveSaleVatRate(saleVatMode, percentFormValueToRate(item.saleVatRate)),
  };
}

function calculateItems(items: ConfigItemForm[], saleVatMode: ConfigurationVatMode) {
  const lines = items.map((item) => calculateConfigurationLine(pricedInput(item, saleVatMode)));
  const totals = lines.reduce(
    (acc, line) => ({
      purchaseNet: acc.purchaseNet + line.purchaseNet,
      saleNet: acc.saleNet + line.saleNet,
      saleVatValue: acc.saleVatValue + line.saleVatValue,
      saleGross: acc.saleGross + line.saleGross,
      profitNet: acc.profitNet + line.profitNet,
      vatSurplus: acc.vatSurplus + line.vatSurplus,
    }),
    { purchaseNet: 0, saleNet: 0, saleVatValue: 0, saleGross: 0, profitNet: 0, vatSurplus: 0 },
  );
  return {
    ...totals,
    vatBreakdown: vatBreakdown(lines.map((line, index) => ({
      saleNet: line.saleNet,
      saleGross: line.saleGross,
      saleVatRate: pricedInput(items[index], saleVatMode).saleVatRate,
    }))),
  };
}

function cleanAsset(asset: ExistingAssetRow): ExistingAssetRow {
  return {
    kind: asset.kind || 'OTHER',
    name: asset.name || assetKindLabels[asset.kind] || 'Sprzęt klienta',
    producer: asset.producer || '',
    model: asset.model || '',
    powerKw: formValue(asset.powerKw),
    capacityKwh: formValue(asset.capacityKwh),
    quantity: formValue(asset.quantity || 1),
    voltageKind: asset.voltageKind || '',
    phaseCount: formValue(asset.phaseCount),
    verificationStatus: asset.verificationStatus || 'DECLARED',
    compatibilityStatus: asset.compatibilityStatus || 'UNKNOWN',
    notes: asset.notes || '',
  };
}

function normalizeSearch(value: unknown) {
  return String(value ?? '')
    .replace(/[Łł]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function projectSearchText(project: ProjectRow) {
  return normalizeSearch([
    project.client.displayName,
    project.title,
    project.status,
    project.clientType,
    project.investmentSite?.fullAddress,
    project.investmentSite?.addressLine,
    project.investmentSite?.city,
  ].filter(Boolean).join(' '));
}

export default function ConfiguratorWorkspace() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [projectId, setProjectId] = useState('');
  const [clientType, setClientType] = useState('B2C');
  const [saleVatMode, setSaleVatMode] = useState<ConfigurationVatMode>('REDUCED_8');
  const [vatBasis, setVatBasis] = useState('RESIDENTIAL_INSTALLATION');
  const [goal, setGoal] = useState('STORAGE_RETROFIT');
  const [roofType, setRoofType] = useState('UNKNOWN');
  const [kind, setKind] = useState('MAGAZYN');
  const [targetPowerKw, setTargetPowerKw] = useState('');
  const [targetCapacityKwh, setTargetCapacityKwh] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [items, setItems] = useState<ConfigItemForm[]>([]);
  const [assets, setAssets] = useState<ExistingAssetRow[]>([]);
  const [saveAssetsWithConfiguration, setSaveAssetsWithConfiguration] = useState(true);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateNotes, setTemplateNotes] = useState('');
  const projectPickerRef = useRef<HTMLDivElement | null>(null);

  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const panelBg = useColorModeValue('white', 'navy.800');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const inputBg = useColorModeValue('white', 'navy.900');
  const fieldColor = useColorModeValue('secondaryGray.800', 'secondaryGray.100');
  const subtleBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');
  const tableHeadBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');

  const fieldStyles = {
    bg: inputBg,
    color: fieldColor,
    borderColor,
    _placeholder: { color: useColorModeValue('secondaryGray.400', 'secondaryGray.500') },
    _focus: { borderColor: 'brand.400', boxShadow: '0 0 0 1px var(--chakra-colors-brand-400)' },
  };
  const numberFieldStyles = {
    ...fieldStyles,
    minW: '118px',
    textAlign: 'right' as const,
  };

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId),
    [templateId, templates],
  );

  const filteredProjects = useMemo(() => {
    const query = normalizeSearch(projectQuery.trim());
    if (!query) return projects;
    return projects.filter((project) => projectSearchText(project).includes(query));
  }, [projectQuery, projects]);

  const filteredTemplates = useMemo(() => templates.filter((template) => {
    const clientMatches = clientType === 'UNKNOWN'
      || template.clientType === clientType
      || template.clientType === 'B2C_B2B';
    const goalMatches = !goal || template.goal === goal || goal === 'MIXED';
    const roofMatches = !['PV_DACH_PLASKI', 'PV_DACH_SKOSNY'].includes(template.kind)
      || roofType === 'UNKNOWN'
      || template.roofType === roofType;
    return clientMatches && goalMatches && roofMatches;
  }), [clientType, goal, roofType, templates]);

  const totals = useMemo(() => calculateItems(items, saleVatMode), [items, saleVatMode]);
  const reviewCount = useMemo(() => items.filter((item) => item.requiresReview).length, [items]);

  async function loadWorkspace() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/configurations?workspace=1', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Nie udało się pobrać danych');

      setProjects(result.data.projects || []);
      setTemplates(result.data.templates || []);
      setProducts(result.data.products || []);

      const firstProject = result.data.projects?.[0];
      if (firstProject && !projectId) {
        const firstClientType = firstProject.clientType === 'UNKNOWN' ? firstProject.client?.clientType || 'B2C' : firstProject.clientType;
        setProjectId(firstProject.id);
        setClientType(firstClientType);
        applyClientTypeVat(firstClientType);
        setAssets((firstProject.existingAssets || []).map(cleanAsset));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (!projectPickerOpen) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!projectPickerRef.current?.contains(event.target as Node)) {
        setProjectPickerOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [projectPickerOpen]);

  function selectProject(nextProjectId: string) {
    const project = projects.find((entry) => entry.id === nextProjectId);
    setProjectId(nextProjectId);
    setProjectPickerOpen(false);
    setProjectQuery('');
    if (project) {
      const nextClientType = project.clientType === 'UNKNOWN' ? project.client.clientType || 'B2C' : project.clientType;
      setClientType(nextClientType);
      applyClientTypeVat(nextClientType);
      setAssets((project.existingAssets || []).map(cleanAsset));
    }
  }

  function applyClientTypeVat(nextClientType: string) {
    const nextMode = defaultVatModeForClientType(nextClientType);
    setSaleVatMode(nextMode);
    setVatBasis(nextMode === 'REDUCED_8'
      ? 'RESIDENTIAL_INSTALLATION'
      : nextMode === 'STANDARD_23'
        ? 'STANDARD_RATE'
        : '');
  }

  function changeClientType(nextClientType: string) {
    setClientType(nextClientType);
    applyClientTypeVat(nextClientType);
  }

  function changeSaleVatMode(nextMode: ConfigurationVatMode) {
    const previousRate = defaultSaleVatRateForMode(saleVatMode);
    if (nextMode === 'MIXED' && previousRate != null) {
      setItems((current) => current.map((item) => ({
        ...item,
        saleVatRate: rateToPercentFormValue(previousRate),
      })));
    }

    setSaleVatMode(nextMode);
    setVatBasis(nextMode === 'REDUCED_8'
      ? 'RESIDENTIAL_INSTALLATION'
      : nextMode === 'STANDARD_23'
        ? 'STANDARD_RATE'
        : nextMode === 'MIXED'
          ? 'MIXED_RATES'
          : '');
  }

  function toggleProjectPicker() {
    const nextOpen = !projectPickerOpen;
    setProjectPickerOpen(nextOpen);
    if (nextOpen) setProjectQuery('');
  }

  function suggestedTemplateName() {
    if (selectedTemplate) return `${selectedTemplate.name} - kopia`;

    const parts = [
      kindLabels[kind] || 'Konfiguracja',
      clientType !== 'UNKNOWN' ? clientType : '',
      roofType !== 'UNKNOWN' ? roofLabels[roofType] : '',
      targetPowerKw ? `${targetPowerKw} kW` : '',
      targetCapacityKwh ? `${targetCapacityKwh} kWh` : '',
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' · ') : 'Własny szablon';
  }

  function openSaveTemplateModal() {
    if (items.length === 0) {
      setError('Dodaj pozycje przed zapisaniem szablonu');
      return;
    }

    setTemplateName(suggestedTemplateName());
    setTemplateNotes('');
    setTemplateModalOpen(true);
  }

  async function saveCurrentAsTemplate() {
    if (!templateName.trim()) {
      setError('Podaj nazwę szablonu');
      return;
    }
    if (items.length === 0) {
      setError('Szablon wymaga przynajmniej jednej pozycji');
      return;
    }

    setTemplateSaving(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch('/api/configurations/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          kind,
          clientType,
          goal,
          roofType,
          powerKw: targetPowerKw,
          capacityKwh: targetCapacityKwh,
          requiresExistingPv: goal === 'STORAGE_RETROFIT' || assets.some((asset) => asset.kind === 'PV_MODULES'),
          requiresExistingInverter: assets.some((asset) => asset.kind === 'PV_INVERTER' || asset.kind === 'HYBRID_INVERTER'),
          notes: templateNotes,
          items: items.map((item) => ({
            ...itemToPayload(item, saleVatMode),
            saleVatRate: saleVatMode === 'MIXED'
              ? percentFormValueToRate(item.saleVatRate)
              : null,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Nie udało się zapisać szablonu');

      setTemplates((current) => [
        result.data,
        ...current.filter((template) => template.id !== result.data.id),
      ]);
      setTemplateId(result.data.id);
      setTemplateModalOpen(false);
      setNotice(`Zapisano szablon: ${result.data.name}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setTemplateSaving(false);
    }
  }

  function applyTemplate(nextTemplateId: string) {
    const template = templates.find((entry) => entry.id === nextTemplateId);
    setTemplateId(nextTemplateId);
    if (!template) return;

    setKind(template.kind);
    setGoal(template.goal || 'MIXED');
    setRoofType(template.roofType || 'UNKNOWN');
    setTargetPowerKw(formValue(template.powerKw));
    setTargetCapacityKwh(formValue(template.capacityKwh));
    setItems(template.items.map(itemFromTemplate));
    setNotice('');
  }

  function updateItem(index: number, field: keyof ConfigItemForm, value: string | boolean) {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;

      if (field === 'productId') {
        const product = products.find((entry) => entry.id === value);
        const next = itemFromProduct(product, item.position);
        return {
          ...item,
          ...next,
          productId: typeof value === 'string' ? value : '',
          position: item.position,
          requiresReview: item.requiresReview,
          notes: item.notes,
        };
      }

      return { ...item, [field]: value };
    }));
  }

  function addProductLine() {
    setItems((current) => [...current, itemFromProduct(undefined, current.length + 1)]);
  }

  function removeItem(index: number) {
    setItems((current) => current
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, position: itemIndex + 1 })));
  }

  function addAsset(kindValue: string) {
    setAssets((current) => [
      ...current,
      cleanAsset({
        kind: kindValue,
        name: assetKindLabels[kindValue] || 'Sprzęt klienta',
        quantity: '1',
        verificationStatus: 'DECLARED',
        compatibilityStatus: 'UNKNOWN',
      }),
    ]);
  }

  function updateAsset(index: number, field: keyof ExistingAssetRow, value: string) {
    setAssets((current) => current.map((asset, assetIndex) => (
      assetIndex === index ? { ...asset, [field]: value } : asset
    )));
  }

  function removeAsset(index: number) {
    setAssets((current) => current.filter((_, assetIndex) => assetIndex !== index));
  }

  function applyExistingAssetsToItems() {
    const hasPanels = assets.some((asset) => asset.kind === 'PV_MODULES');
    const hasHybridInverter = assets.some((asset) => asset.kind === 'HYBRID_INVERTER');
    const hasPvInverter = assets.some((asset) => asset.kind === 'PV_INVERTER');

    setItems((current) => current.map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      const description = `${item.description} ${product?.category || ''}`.toLowerCase();

      if (hasPanels && (product?.category === 'FOTOWOLTAIKA' || description.includes('panel') || description.includes('longi'))) {
        return {
          ...item,
          supplyMode: 'CLIENT_OWNED_USED',
          requiresReview: true,
          notes: 'Panele oznaczone jako sprzęt klienta. Zweryfikuj ilość, moc i zgodność montażu.',
        };
      }

      if (hasHybridInverter && (product?.category === 'FALOWNIK' || product?.category === 'INWERTER' || description.includes('falownik') || description.includes('inverter'))) {
        return {
          ...item,
          supplyMode: 'CLIENT_OWNED_USED',
          requiresReview: true,
          notes: 'Falownik oznaczony jako sprzęt klienta. Zweryfikuj zgodność z magazynem i zabezpieczeniami.',
        };
      }

      if (hasPvInverter && (product?.category === 'FALOWNIK' || product?.category === 'INWERTER' || description.includes('falownik') || description.includes('inverter'))) {
        return {
          ...item,
          requiresReview: true,
          notes: 'Klient ma falownik PV. Sprawdź, czy nowy falownik jest potrzebny albo czy wariant wymaga sprzętu hybrydowego.',
        };
      }

      return item;
    }));
  }

  async function saveConfiguration() {
    if (!projectId) {
      setError('Wybierz projekt przed zapisem konfiguracji');
      return;
    }
    if (items.length === 0) {
      setError('Dodaj pozycje lub wybierz wariant ODS przed zapisem');
      return;
    }
    if (saleVatMode === 'REVIEW') {
      setError('Wybierz stawkę VAT sprzedaży przed zapisem konfiguracji');
      return;
    }
    if (saleVatMode === 'REDUCED_8' && !vatBasis) {
      setError('Wskaż podstawę zastosowania stawki VAT 8%');
      return;
    }
    if (saleVatMode === 'MIXED') {
      const invalidVatItem = items.find((item) => (
        !nonPricedSupplyModes.has(item.supplyMode)
        && ![8, 23].includes(Number(item.saleVatRate.trim().replace(',', '.')))
      ));
      if (invalidVatItem) {
        setError(`Pozycja „${invalidVatItem.description || 'bez nazwy'}” wymaga stawki VAT 8% albo 23%`);
        return;
      }
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      if (saveAssetsWithConfiguration) {
        const assetsResponse = await fetch('/api/configurations/assets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, assets }),
        });
        const assetsResult = await assetsResponse.json();
        if (!assetsResponse.ok || !assetsResult.ok) {
          throw new Error(assetsResult.message || assetsResult.error || 'Nie udało się zapisać stanu obecnego');
        }
      }

      const response = await fetch('/api/configurations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          templateId: templateId || undefined,
          name: `${selectedProject?.title || 'Konfiguracja'} - ${selectedTemplate?.name || 'wariant własny'}`,
          kind,
          status: 'DRAFT',
          clientType,
          goal,
          roofType,
          targetPowerKw,
          targetCapacityKwh,
          existingAssetsSnapshot: assets,
          saleVatMode,
          defaultSaleVatRate: defaultSaleVatRateForMode(saleVatMode),
          vatBasis,
          requiresReview: reviewCount > 0,
          reviewNotes: reviewCount > 0 ? `Pozycji do weryfikacji: ${reviewCount}` : undefined,
          items: items.map((item) => itemToPayload(item, saleVatMode)),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Nie udało się zapisać konfiguracji');

      setNotice(`Zapisano konfigurację: ${result.data.name}`);
      await loadWorkspace();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box pt={{ base: '130px', md: '80px', xl: '80px' }}>
      <Flex align="center" justify="space-between" gap="16px" mb="18px" wrap="wrap">
        <Box>
          <Text color={mutedColor} fontSize="sm" fontWeight="700">
            Pages / Konfigurator
          </Text>
          <Text color={textColor} fontSize={{ base: '28px', md: '36px' }} fontWeight="800" lineHeight="1.1">
            Konfigurator zestawu
          </Text>
        </Box>
        <HStack spacing="10px" wrap="wrap">
          <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={loadWorkspace} isDisabled={loading || saving}>
            Odśwież
          </Button>
          <Button leftIcon={<Icon as={MdSave} />} colorScheme="purple" onClick={saveConfiguration} isLoading={saving}>
            Zapisz konfigurację
          </Button>
        </HStack>
      </Flex>

      {error ? (
        <Alert status="error" borderRadius="12px" mb="16px">
          <AlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert status="success" borderRadius="12px" mb="16px">
          <AlertIcon />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <Card>
          <Flex align="center" gap="12px">
            <Spinner />
            <Text color={textColor} fontWeight="700">Ładowanie konfiguratora</Text>
          </Flex>
        </Card>
      ) : (
        <Grid templateColumns={{ base: '1fr', xl: 'minmax(0, 1.45fr) minmax(360px, 0.55fr)' }} gap="20px">
          <GridItem>
            <VStack spacing="18px" align="stretch">
              <Card>
                <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} spacing="14px">
                  <FormControl>
                    <FormLabel color={textColor}>Projekt</FormLabel>
                    <Box ref={projectPickerRef} position="relative">
                      <Button
                        type="button"
                        variant="outline"
                        w="100%"
                        h="40px"
                        px="14px"
                        justifyContent="space-between"
                        bg={inputBg}
                        borderColor={borderColor}
                        color={selectedProject ? fieldColor : mutedColor}
                        fontWeight="700"
                        rightIcon={<Icon as={MdKeyboardArrowDown} />}
                        onClick={toggleProjectPicker}
                      >
                        <Text noOfLines={1} textAlign="left">
                          {selectedProject ? `${selectedProject.client.displayName} · ${selectedProject.title}` : 'Wybierz projekt'}
                        </Text>
                      </Button>

                      {projectPickerOpen ? (
                        <Box
                          position="absolute"
                          top="48px"
                          left="0"
                          right="0"
                          zIndex={30}
                          bg={panelBg}
                          border="1px solid"
                          borderColor={borderColor}
                          borderRadius="12px"
                          boxShadow="0 18px 45px rgba(11, 21, 58, 0.20)"
                          p="10px"
                        >
                          <Flex align="center" gap="8px" mb="8px">
                            <Icon as={MdSearch} color={mutedColor} />
                            <Input
                              autoFocus
                              value={projectQuery}
                              onChange={(event) => setProjectQuery(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') setProjectPickerOpen(false);
                              }}
                              placeholder="Szukaj projektu..."
                              sx={fieldStyles}
                            />
                          </Flex>
                          <VStack align="stretch" spacing="4px" maxH="280px" overflowY="auto">
                            {filteredProjects.length > 0 ? filteredProjects.map((project) => (
                              <Button
                                key={project.id}
                                type="button"
                                variant="ghost"
                                justifyContent="flex-start"
                                h="auto"
                                minH="48px"
                                px="10px"
                                py="8px"
                                whiteSpace="normal"
                                bg={project.id === projectId ? subtleBg : undefined}
                                onClick={() => selectProject(project.id)}
                              >
                                <Box textAlign="left" w="100%">
                                  <Text color={textColor} fontWeight="800" fontSize="sm" noOfLines={1}>
                                    {project.client.displayName}
                                  </Text>
                                  <Text color={mutedColor} fontSize="xs" fontWeight="700" noOfLines={1}>
                                    {project.title}
                                  </Text>
                                </Box>
                              </Button>
                            )) : (
                              <Box p="12px">
                                <Text color={mutedColor} fontSize="sm" fontWeight="700">
                                  Brak zgodnych projektów
                                </Text>
                              </Box>
                            )}
                          </VStack>
                        </Box>
                      ) : null}
                    </Box>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor}>Typ klienta</FormLabel>
                    <Select value={clientType} onChange={(event) => changeClientType(event.target.value)} sx={fieldStyles}>
                      {clientTypes.map((entry) => <option key={entry} value={entry}>{clientTypeLabels[entry] || entry}</option>)}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor}>Cel</FormLabel>
                    <Select value={goal} onChange={(event) => setGoal(event.target.value)} sx={fieldStyles}>
                      {goals.map((entry) => <option key={entry} value={entry}>{goalLabels[entry]}</option>)}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor}>Dach</FormLabel>
                    <Select value={roofType} onChange={(event) => setRoofType(event.target.value)} sx={fieldStyles}>
                      {roofTypes.map((entry) => <option key={entry} value={entry}>{roofLabels[entry]}</option>)}
                    </Select>
                  </FormControl>
                </SimpleGrid>

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing="14px" mt="16px">
                  <FormControl>
                    <FormLabel color={textColor}>VAT dla konfiguracji</FormLabel>
                    <Select
                      value={saleVatMode}
                      onChange={(event) => changeSaleVatMode(event.target.value as ConfigurationVatMode)}
                      sx={fieldStyles}
                    >
                      {Object.entries(saleVatModeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl isDisabled={saleVatMode === 'REVIEW'}>
                    <FormLabel color={textColor}>Podstawa stawki</FormLabel>
                    <Select value={vatBasis} onChange={(event) => setVatBasis(event.target.value)} sx={fieldStyles}>
                      {saleVatMode === 'REDUCED_8' ? (
                        <>
                          <option value="RESIDENTIAL_INSTALLATION">{vatBasisLabels.RESIDENTIAL_INSTALLATION}</option>
                          <option value="OTHER_REDUCED">{vatBasisLabels.OTHER_REDUCED}</option>
                        </>
                      ) : null}
                      {saleVatMode === 'STANDARD_23' ? (
                        <option value="STANDARD_RATE">{vatBasisLabels.STANDARD_RATE}</option>
                      ) : null}
                      {saleVatMode === 'MIXED' ? (
                        <option value="MIXED_RATES">{vatBasisLabels.MIXED_RATES}</option>
                      ) : null}
                      {saleVatMode === 'REVIEW' ? <option value="">Najpierw wybierz stawkę</option> : null}
                    </Select>
                  </FormControl>
                </SimpleGrid>
                {saleVatMode === 'REDUCED_8' ? (
                  <Alert status="warning" borderRadius="10px" mt="14px">
                    <AlertIcon />
                    <AlertDescription>
                      Stawka 8% wymaga potwierdzenia, że zakres i obiekt spełniają warunki stawki obniżonej.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {saleVatMode === 'REVIEW' ? (
                  <Alert status="info" borderRadius="10px" mt="14px">
                    <AlertIcon />
                    <AlertDescription>
                      Typ klienta nie rozstrzyga stawki. Wybierz 8%, 23% albo rozliczenie mieszane.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </Card>

              <Card>
                <Flex align="center" justify="space-between" gap="12px" mb="14px" wrap="wrap">
                  <HStack spacing="10px">
                    <Icon as={MdSettingsInputComponent} color="brand.400" boxSize="22px" />
                    <Text color={textColor} fontSize="lg" fontWeight="800">Stan obecny klienta</Text>
                  </HStack>
                  <HStack spacing="8px" wrap="wrap">
                    <Tooltip label="Dodaj istniejące panele PV">
                      <IconButton aria-label="Dodaj panele PV" icon={<Icon as={MdSolarPower} />} onClick={() => addAsset('PV_MODULES')} />
                    </Tooltip>
                    <Tooltip label="Dodaj istniejący falownik PV">
                      <IconButton aria-label="Dodaj falownik PV" icon={<Icon as={MdTune} />} onClick={() => addAsset('PV_INVERTER')} />
                    </Tooltip>
                    <Tooltip label="Dodaj istniejący falownik hybrydowy">
                      <IconButton aria-label="Dodaj falownik hybrydowy" icon={<Icon as={MdSyncAlt} />} onClick={() => addAsset('HYBRID_INVERTER')} />
                    </Tooltip>
                    <Tooltip label="Dodaj istniejący magazyn energii">
                      <IconButton aria-label="Dodaj magazyn energii" icon={<Icon as={MdBatteryChargingFull} />} onClick={() => addAsset('BATTERY')} />
                    </Tooltip>
                  </HStack>
                </Flex>

                {assets.length === 0 ? (
                  <Box border="1px dashed" borderColor={borderColor} borderRadius="12px" p="18px">
                    <Text color={mutedColor} fontWeight="700">Brak wpisanego sprzętu klienta.</Text>
                  </Box>
                ) : (
                  <VStack spacing="12px" align="stretch">
                    {assets.map((asset, index) => (
                      <Box key={`${asset.id || 'asset'}-${index}`} border="1px solid" borderColor={borderColor} borderRadius="12px" p="14px" bg={panelBg}>
                        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} spacing="12px">
                          <FormControl>
                            <FormLabel color={textColor}>Rodzaj</FormLabel>
                            <Select value={asset.kind} onChange={(event) => updateAsset(index, 'kind', event.target.value)} sx={fieldStyles}>
                              {assetKinds.map((entry) => <option key={entry} value={entry}>{assetKindLabels[entry]}</option>)}
                            </Select>
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>Nazwa</FormLabel>
                            <Input value={asset.name || ''} onChange={(event) => updateAsset(index, 'name', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>Producent</FormLabel>
                            <Input value={asset.producer || ''} onChange={(event) => updateAsset(index, 'producer', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>Model</FormLabel>
                            <Input value={asset.model || ''} onChange={(event) => updateAsset(index, 'model', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>kW</FormLabel>
                            <Input value={formValue(asset.powerKw)} onChange={(event) => updateAsset(index, 'powerKw', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>kWh</FormLabel>
                            <Input value={formValue(asset.capacityKwh)} onChange={(event) => updateAsset(index, 'capacityKwh', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>Ilość</FormLabel>
                            <Input value={formValue(asset.quantity)} onChange={(event) => updateAsset(index, 'quantity', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>Zgodność</FormLabel>
                            <Select value={asset.compatibilityStatus || 'UNKNOWN'} onChange={(event) => updateAsset(index, 'compatibilityStatus', event.target.value)} sx={fieldStyles}>
                              {compatibilityStatuses.map((entry) => <option key={entry} value={entry}>{compatibilityLabels[entry]}</option>)}
                            </Select>
                          </FormControl>
                          <FormControl>
                            <FormLabel color={textColor}>Weryfikacja</FormLabel>
                            <Select value={asset.verificationStatus || 'DECLARED'} onChange={(event) => updateAsset(index, 'verificationStatus', event.target.value)} sx={fieldStyles}>
                              {verificationStatuses.map((entry) => <option key={entry} value={entry}>{assetVerificationLabels[entry]}</option>)}
                            </Select>
                          </FormControl>
                          <FormControl gridColumn={{ base: 'auto', md: 'span 2' }}>
                            <FormLabel color={textColor}>Notatki</FormLabel>
                            <Input value={asset.notes || ''} onChange={(event) => updateAsset(index, 'notes', event.target.value)} sx={fieldStyles} />
                          </FormControl>
                          <Flex align="end" justify="flex-end">
                            <Tooltip label="Usuń sprzęt">
                              <IconButton aria-label="Usuń sprzęt" icon={<Icon as={MdDelete} />} colorScheme="red" variant="ghost" onClick={() => removeAsset(index)} />
                            </Tooltip>
                          </Flex>
                        </SimpleGrid>
                      </Box>
                    ))}
                  </VStack>
                )}

                <Flex justify="space-between" align="center" mt="14px" gap="12px" wrap="wrap">
                  <HStack>
                    <Switch isChecked={saveAssetsWithConfiguration} onChange={(event) => setSaveAssetsWithConfiguration(event.target.checked)} />
                    <Text color={mutedColor} fontSize="sm" fontWeight="700">Zapisuj stan obecny przy projekcie</Text>
                  </HStack>
                  <Button leftIcon={<Icon as={MdSyncAlt} />} variant="outline" onClick={applyExistingAssetsToItems} isDisabled={items.length === 0}>
                    Uwzględnij w pozycjach
                  </Button>
                </Flex>
              </Card>

              <Card>
                <Flex align="center" justify="space-between" gap="12px" mb="14px" wrap="wrap">
                  <Box>
                    <Text color={textColor} fontSize="lg" fontWeight="800">Wariant i pozycje</Text>
                    <Text color={mutedColor} fontSize="sm" fontWeight="600">
                      Szablony: {filteredTemplates.length} / {templates.length}
                    </Text>
                  </Box>
                  <HStack spacing="10px" wrap="wrap">
                    <Button
                      leftIcon={<Icon as={MdLibraryAdd} />}
                      variant="outline"
                      onClick={openSaveTemplateModal}
                      isDisabled={items.length === 0}
                    >
                      Zapisz jako szablon
                    </Button>
                    <Button leftIcon={<Icon as={MdAdd} />} variant="outline" onClick={addProductLine}>
                      Dodaj pozycję
                    </Button>
                  </HStack>
                </Flex>

                <SimpleGrid columns={{ base: 1, lg: 4 }} spacing="14px" mb="16px">
                  <FormControl>
                    <FormLabel color={textColor}>Szablon ODS</FormLabel>
                    <Select value={templateId} onChange={(event) => applyTemplate(event.target.value)} sx={fieldStyles}>
                      <option value="">Wariant własny</option>
                      {filteredTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} · {clientTypeLabels[template.clientType] || template.clientType}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor}>Typ konfiguracji</FormLabel>
                    <Select value={kind} onChange={(event) => setKind(event.target.value)} sx={fieldStyles}>
                      {Object.keys(kindLabels).map((entry) => <option key={entry} value={entry}>{kindLabels[entry]}</option>)}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor}>Moc kW</FormLabel>
                    <Input value={targetPowerKw} onChange={(event) => setTargetPowerKw(event.target.value)} sx={fieldStyles} />
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor}>Pojemność kWh</FormLabel>
                    <Input value={targetCapacityKwh} onChange={(event) => setTargetCapacityKwh(event.target.value)} sx={fieldStyles} />
                  </FormControl>
                </SimpleGrid>

                <Box overflowX="auto" border="1px solid" borderColor={borderColor} borderRadius="12px">
                  <Table variant="simple" size="sm" minW="1860px">
                    <Thead bg={tableHeadBg}>
                      <Tr>
                        <Th color={mutedColor} w="46px">#</Th>
                        <Th color={mutedColor} minW="300px">Pozycja</Th>
                        <Th color={mutedColor} minW="260px">Produkt</Th>
                        <Th color={mutedColor} minW="170px">Rola</Th>
                        <Th color={mutedColor} minW="190px">Tryb</Th>
                        <Th color={mutedColor} minW="118px">Ilość</Th>
                        <Th color={mutedColor} minW="138px">Zakup netto</Th>
                        <Th color={mutedColor} minW="128px">VAT zakup (%)</Th>
                        <Th color={mutedColor} minW="138px">Koszt firmy</Th>
                        <Th color={mutedColor} minW="128px">Marża (%)</Th>
                        <Th color={mutedColor} minW="128px">VAT sprz. (%)</Th>
                        <Th color={mutedColor} minW="140px">Brutto</Th>
                        <Th color={mutedColor} w="92px">Akcje</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {items.map((item, index) => {
                        const calculated = calculateConfigurationLine(pricedInput(item, saleVatMode));
                        return (
                          <Tr key={`${item.position}-${index}`} opacity={item.supplyMode === 'NOT_INCLUDED' ? 0.62 : 1}>
                            <Td color={textColor} fontWeight="800">{index + 1}</Td>
                            <Td>
                              <Input value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} sx={fieldStyles} />
                              <HStack mt="6px" spacing="8px">
                                <Checkbox isChecked={item.requiresReview} onChange={(event) => updateItem(index, 'requiresReview', event.target.checked)}>
                                  <Text color={mutedColor} fontSize="xs" fontWeight="700">Do sprawdzenia</Text>
                                </Checkbox>
                                {item.sourceSheet ? <Badge colorScheme="blue">{item.sourceRow ? `Wiersz ODS ${item.sourceRow}` : 'ODS'}</Badge> : null}
                              </HStack>
                            </Td>
                            <Td>
                              <SearchableProductPicker
                                value={item.productId}
                                products={products}
                                onChange={(value) => updateItem(index, 'productId', value)}
                              />
                            </Td>
                            <Td>
                              <Select value={item.role} onChange={(event) => updateItem(index, 'role', event.target.value)} sx={fieldStyles}>
                                {roles.map((entry) => <option key={entry} value={entry}>{roleLabels[entry]}</option>)}
                              </Select>
                            </Td>
                            <Td>
                              <Select value={item.supplyMode} onChange={(event) => updateItem(index, 'supplyMode', event.target.value)} sx={fieldStyles}>
                                {supplyModes.map((entry) => <option key={entry} value={entry}>{supplyModeLabels[entry]}</option>)}
                              </Select>
                            </Td>
                            <Td minW="118px"><Input value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} sx={numberFieldStyles} /></Td>
                            <Td minW="138px"><Input value={item.unitPurchaseNet} onChange={(event) => updateItem(index, 'unitPurchaseNet', event.target.value)} sx={numberFieldStyles} /></Td>
                            <Td minW="128px">
                              <InputGroup>
                                <Input value={item.purchaseVatRate} inputMode="decimal" pe="34px" onChange={(event) => updateItem(index, 'purchaseVatRate', event.target.value)} sx={numberFieldStyles} />
                                <InputRightElement pointerEvents="none" color={mutedColor}>%</InputRightElement>
                              </InputGroup>
                            </Td>
                            <Td minW="138px"><Input value={item.operatingCostNet} onChange={(event) => updateItem(index, 'operatingCostNet', event.target.value)} sx={numberFieldStyles} /></Td>
                            <Td minW="128px">
                              <InputGroup>
                                <Input value={item.marginRate} inputMode="decimal" pe="34px" onChange={(event) => updateItem(index, 'marginRate', event.target.value)} sx={numberFieldStyles} />
                                <InputRightElement pointerEvents="none" color={mutedColor}>%</InputRightElement>
                              </InputGroup>
                            </Td>
                            <Td minW="128px">
                              {saleVatMode === 'MIXED' ? (
                                <InputGroup>
                                  <Input value={item.saleVatRate} inputMode="decimal" pe="34px" onChange={(event) => updateItem(index, 'saleVatRate', event.target.value)} sx={numberFieldStyles} />
                                  <InputRightElement pointerEvents="none" color={mutedColor}>%</InputRightElement>
                                </InputGroup>
                              ) : (
                                <Badge colorScheme={saleVatMode === 'REVIEW' ? 'orange' : 'purple'}>
                                  {defaultSaleVatRateForMode(saleVatMode) == null
                                    ? 'Sprawdź'
                                    : `${rateToPercentFormValue(defaultSaleVatRateForMode(saleVatMode))}%`}
                                </Badge>
                              )}
                            </Td>
                            <Td color={textColor} fontWeight="800">{formatMoney(calculated.saleGross)}</Td>
                            <Td>
                              <Tooltip label="Usuń pozycję">
                                <IconButton aria-label="Usuń pozycję" icon={<Icon as={MdDelete} />} variant="ghost" colorScheme="red" onClick={() => removeItem(index)} />
                              </Tooltip>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                </Box>
              </Card>
            </VStack>
          </GridItem>

          <GridItem>
            <VStack spacing="18px" align="stretch" position={{ xl: 'sticky' }} top={{ xl: '92px' }}>
              <Card>
                <Text color={textColor} fontSize="lg" fontWeight="800" mb="14px">Podsumowanie</Text>
                <VStack spacing="10px" align="stretch">
                  <Flex justify="space-between" bg={subtleBg} borderRadius="10px" p="12px">
                    <Text color={mutedColor} fontWeight="700">Koszt netto</Text>
                    <Text color={textColor} fontWeight="900">{formatMoney(totals.purchaseNet)}</Text>
                  </Flex>
                  <Flex justify="space-between" bg={subtleBg} borderRadius="10px" p="12px">
                    <Text color={mutedColor} fontWeight="700">Cena sprzedaży netto</Text>
                    <Text color={textColor} fontWeight="900">{formatMoney(totals.saleNet)}</Text>
                  </Flex>
                  {saleVatMode !== 'REVIEW' ? totals.vatBreakdown.map((row) => (
                    <Flex key={row.rate} justify="space-between" bg={subtleBg} borderRadius="10px" p="12px">
                      <Text color={mutedColor} fontWeight="700">
                        VAT {rateToPercentFormValue(row.rate)}%
                      </Text>
                      <Text color={textColor} fontWeight="900">{formatMoney(row.vat)}</Text>
                    </Flex>
                  )) : null}
                  <Flex justify="space-between" bg={subtleBg} borderRadius="10px" p="12px">
                    <Text color={mutedColor} fontWeight="700">Cena brutto</Text>
                    <Text color={textColor} fontWeight="900">{formatMoney(totals.saleGross)}</Text>
                  </Flex>
                  <Flex justify="space-between" bg={subtleBg} borderRadius="10px" p="12px">
                    <Text color={mutedColor} fontWeight="700">Zysk netto</Text>
                    <Text color={textColor} fontWeight="900">{formatMoney(totals.profitNet)}</Text>
                  </Flex>
                  <Flex justify="space-between" bg={subtleBg} borderRadius="10px" p="12px">
                    <Text color={mutedColor} fontWeight="700">Nadwyżka VAT</Text>
                    <Text color={textColor} fontWeight="900">{formatMoney(totals.vatSurplus)}</Text>
                  </Flex>
                </VStack>
              </Card>

              <Card>
                <Text color={textColor} fontSize="lg" fontWeight="800" mb="14px">Kontrola</Text>
                <VStack spacing="10px" align="stretch">
                  <Flex justify="space-between">
                    <Text color={mutedColor} fontWeight="700">Pozycje</Text>
                    <Badge colorScheme="purple">{items.length}</Badge>
                  </Flex>
                  <Flex justify="space-between">
                    <Text color={mutedColor} fontWeight="700">Sprzęt klienta</Text>
                    <Badge colorScheme="blue">{assets.length}</Badge>
                  </Flex>
                  <Flex justify="space-between">
                    <Text color={mutedColor} fontWeight="700">Do weryfikacji</Text>
                    <Badge colorScheme={reviewCount > 0 ? 'orange' : 'green'}>{reviewCount}</Badge>
                  </Flex>
                  <Flex justify="space-between">
                    <Text color={mutedColor} fontWeight="700">Wariant</Text>
                    <Badge colorScheme={selectedTemplate ? 'green' : 'gray'}>{selectedTemplate ? 'ODS' : 'własny'}</Badge>
                  </Flex>
                </VStack>
              </Card>

              <Card>
                <Text color={textColor} fontSize="lg" fontWeight="800" mb="12px">Projekt</Text>
                {selectedProject ? (
                  <VStack spacing="8px" align="stretch">
                    <Text color={textColor} fontWeight="800">{selectedProject.client.displayName}</Text>
                    <Text color={mutedColor} fontWeight="700">{selectedProject.title}</Text>
                    <Text color={mutedColor} fontSize="sm">
                      {selectedProject.investmentSite?.fullAddress
                        || selectedProject.investmentSite?.addressLine
                        || selectedProject.investmentSite?.city
                        || 'Brak adresu inwestycji'}
                    </Text>
                    <HStack>
                      <Badge colorScheme="purple">{clientTypeLabels[clientType] || clientType}</Badge>
                      <Badge colorScheme="blue">{goalLabels[goal]}</Badge>
                      <Badge colorScheme="cyan">{roofLabels[roofType]}</Badge>
                    </HStack>
                  </VStack>
                ) : (
                  <Text color={mutedColor} fontWeight="700">Nie wybrano projektu</Text>
                )}
              </Card>

              <Card>
                <Text color={textColor} fontSize="lg" fontWeight="800" mb="12px">Notatka robocza</Text>
                <Textarea
                  value={items.find((item) => item.requiresReview)?.notes || ''}
                  isReadOnly
                  minH="110px"
                  resize="vertical"
                  sx={fieldStyles}
                />
                <Text color={mutedColor} fontSize="sm" fontWeight="700" mt="10px">
                  {targetPowerKw ? `${formatNumber(targetPowerKw)} kW` : 'Moc nieokreślona'}
                  {targetCapacityKwh ? ` · ${formatNumber(targetCapacityKwh)} kWh` : ''}
                </Text>
              </Card>
            </VStack>
          </GridItem>
        </Grid>
      )}

      <Modal isOpen={templateModalOpen} onClose={() => setTemplateModalOpen(false)} isCentered size="lg">
        <ModalOverlay />
        <ModalContent bg={panelBg} color={textColor} borderRadius="16px">
          <ModalHeader>Zapisz jako szablon</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="14px" align="stretch">
              <FormControl isRequired>
                <FormLabel color={textColor}>Nazwa szablonu</FormLabel>
                <Input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Np. Magazyn 16 kWh z falownikiem 10 kW"
                  sx={fieldStyles}
                />
              </FormControl>
              <FormControl>
                <FormLabel color={textColor}>Notatki</FormLabel>
                <Textarea
                  value={templateNotes}
                  onChange={(event) => setTemplateNotes(event.target.value)}
                  placeholder="Opcjonalna notatka do szablonu"
                  minH="96px"
                  sx={fieldStyles}
                />
              </FormControl>
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing="10px">
                <Box bg={subtleBg} borderRadius="10px" p="10px">
                  <Text color={mutedColor} fontSize="xs" fontWeight="800">Pozycje</Text>
                  <Text color={textColor} fontWeight="900">{items.length}</Text>
                </Box>
                <Box bg={subtleBg} borderRadius="10px" p="10px">
                  <Text color={mutedColor} fontSize="xs" fontWeight="800">Typ</Text>
                  <Text color={textColor} fontWeight="900">{clientTypeLabels[clientType] || clientType}</Text>
                </Box>
                <Box bg={subtleBg} borderRadius="10px" p="10px">
                  <Text color={mutedColor} fontSize="xs" fontWeight="800">Cel</Text>
                  <Text color={textColor} fontWeight="900" noOfLines={1}>{goalLabels[goal]}</Text>
                </Box>
              </SimpleGrid>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="10px" onClick={() => setTemplateModalOpen(false)} isDisabled={templateSaving}>
              Anuluj
            </Button>
            <Button
              leftIcon={<Icon as={MdLibraryAdd} />}
              colorScheme="purple"
              onClick={saveCurrentAsTemplate}
              isLoading={templateSaving}
            >
              Zapisz szablon
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

function SearchableProductPicker({
  value,
  products,
  onChange,
}: {
  value: string;
  products: ProductRow[];
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { isOpen, onOpen, onClose } = useDisclosure();
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const fieldBg = useColorModeValue('white', 'navy.900');
  const menuBg = useColorModeValue('white', 'navy.800');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const hoverBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');
  const selected = products.find((product) => product.id === value);
  const normalizedQuery = normalizeSearch(query);
  const visibleProducts = normalizedQuery
    ? products.filter((product) => normalizeSearch([
      product.name,
      product.producer,
      product.sku,
      product.category,
      product.powerCapacity,
    ].filter(Boolean).join(' ')).includes(normalizedQuery))
    : products;

  function openMenu() {
    setQuery('');
    onOpen();
  }

  function choose(productId: string) {
    onChange(productId);
    onClose();
  }

  return (
    <Menu isOpen={isOpen} onOpen={openMenu} onClose={onClose} closeOnSelect={false} matchWidth>
      <MenuButton
        as={Button}
        w="100%"
        h="40px"
        px="12px"
        justifyContent="space-between"
        textAlign="left"
        bg={fieldBg}
        color={selected ? textColor : mutedColor}
        border="1px solid"
        borderColor={borderColor}
        borderRadius="8px"
        fontWeight="700"
        rightIcon={<Icon as={MdKeyboardArrowDown} />}
        _hover={{ borderColor: 'brand.400' }}
        _active={{ bg: fieldBg }}
      >
        <Text as="span" noOfLines={1}>{selected?.name || 'Bez produktu'}</Text>
      </MenuButton>
      <Portal>
        <MenuList bg={menuBg} borderColor={borderColor} p="8px" maxH="360px" overflowY="auto" zIndex={2000}>
          <Box pb="8px" position="sticky" top="-8px" bg={menuBg} zIndex={1}>
            <Flex align="center" border="1px solid" borderColor={borderColor} borderRadius="8px" px="10px" bg={fieldBg}>
              <Icon as={MdSearch} color={mutedColor} me="8px" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Szukaj produktu..."
                autoFocus
                border="0"
                bg="transparent"
                color={textColor}
                _focus={{ boxShadow: 'none' }}
              />
            </Flex>
          </Box>
          <MenuItem
            onClick={() => choose('')}
            bg="transparent"
            color={!value ? textColor : mutedColor}
            borderRadius="8px"
            fontWeight={!value ? '800' : '600'}
            _hover={{ bg: hoverBg }}
            _focus={{ bg: hoverBg }}
          >
            Bez produktu
          </MenuItem>
          {visibleProducts.length === 0 ? (
            <Box px="12px" py="14px">
              <Text color={mutedColor} fontSize="sm">Brak pasujących produktów.</Text>
            </Box>
          ) : visibleProducts.map((product) => (
            <MenuItem
              key={product.id}
              onClick={() => choose(product.id)}
              bg="transparent"
              borderRadius="8px"
              _hover={{ bg: hoverBg }}
              _focus={{ bg: hoverBg }}
            >
              <Box minW="0">
                <Text color={textColor} fontWeight={product.id === value ? '800' : '700'} noOfLines={1}>
                  {product.name}
                </Text>
                <Text color={mutedColor} fontSize="xs" noOfLines={1}>
                  {[product.producer, product.sku, product.powerCapacity].filter(Boolean).join(' · ') || 'Bez dodatkowych danych'}
                </Text>
              </Box>
            </MenuItem>
          ))}
        </MenuList>
      </Portal>
    </Menu>
  );
}
