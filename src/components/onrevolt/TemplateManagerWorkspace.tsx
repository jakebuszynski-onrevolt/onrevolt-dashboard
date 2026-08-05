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
  HStack,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Select,
  SimpleGrid,
  Spinner,
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
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { SearchableProductPicker } from 'components/onrevolt/ConfiguratorWorkspace';
import { calculateConfigurationLine } from 'lib/onrevolt/calculator';
import { groupTemplateVariants, resolveTemplateItemCosts } from 'lib/onrevolt/configuration-templates';
import { percentFormValueToRate, rateToPercentFormValue } from 'lib/onrevolt/percentage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdArchive,
  MdContentCopy,
  MdDeleteOutline,
  MdEdit,
  MdInventory2,
  MdRefresh,
  MdRestore,
  MdSave,
  MdSearch,
} from 'react-icons/md';

type PriceRow = {
  purchaseNet: string | number;
  currentPurchaseNet?: string | number | null;
  purchaseVatRate: string | number;
  operatingCostNet: string | number;
  marginRate: string | number;
};

type ProductRow = {
  id: string;
  sku?: string | null;
  name: string;
  category: string;
  producer?: string | null;
  powerCapacity?: string | null;
  availability?: string | null;
  prices: PriceRow[];
};

type TemplateItem = {
  id?: string;
  productId: string;
  product?: ProductRow | null;
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
  notes: string;
};

type TemplateRow = {
  id: string;
  familyKey: string;
  name: string;
  version: number;
  isActive: boolean;
  kind: string;
  clientType: string;
  roofType?: string | null;
  goal?: string | null;
  powerKw?: string | number | null;
  capacityKwh?: string | number | null;
  sortOrder: number;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  notes?: string | null;
  items: Array<any>;
  _count?: { configs: number };
};

type TemplateForm = {
  id: string;
  familyKey: string;
  name: string;
  clientType: string;
  kind: string;
  goal: string;
  roofType: string;
  powerKw: string;
  capacityKwh: string;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  notes: string;
  items: TemplateItem[];
};

const kindLabels: Record<string, string> = {
  PV_DACH_PLASKI: 'PV dach płaski',
  PV_DACH_SKOSNY: 'PV dach skośny',
  MAGAZYN: 'Magazyn energii',
  EMS: 'EMS',
  MIXED: 'Mieszane',
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

const roleLabels: Record<string, string> = {
  MAIN_EQUIPMENT: 'Sprzęt główny',
  ACCESSORY: 'Osprzęt',
  MOUNTING: 'Konstrukcja',
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
  ONREVOLT_SUPPLIED: 'onRevolt dostarcza',
  CLIENT_OWNED_USED: 'Sprzęt klienta',
  CLIENT_SUPPLIED_NEW: 'Klient dostarcza',
  SERVICE_ONLY: 'Tylko usługa',
  NOT_INCLUDED: 'Nie ujmuj',
};

const roles = Object.keys(roleLabels);
const supplyModes = Object.keys(supplyModeLabels);
const nonPricedSupplyModes = new Set(['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED']);

function textValue(value: unknown) {
  return value == null ? '' : String(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(value);
}

function emptyItem(position: number): TemplateItem {
  return {
    productId: '',
    position,
    description: '',
    quantity: '1',
    role: 'OTHER',
    supplyMode: 'ONREVOLT_SUPPLIED',
    unitPurchaseNet: '',
    purchaseVatRate: '23',
    operatingCostNet: '0',
    marginRate: '30',
    saleVatRate: '',
    isOptional: false,
    requiresReview: false,
    notes: '',
  };
}

function itemFromTemplate(item: any): TemplateItem {
  const currentPrice = item.product?.prices?.[0];
  return {
    id: item.id,
    productId: item.productId || '',
    product: item.product || null,
    position: Number(item.position || 1),
    description: item.description || item.product?.name || '',
    quantity: textValue(item.quantity || 1),
    role: item.role || 'OTHER',
    supplyMode: item.supplyMode || 'ONREVOLT_SUPPLIED',
    unitPurchaseNet: textValue(item.productId ? currentPrice?.currentPurchaseNet ?? currentPrice?.purchaseNet : item.unitPurchaseNet),
    purchaseVatRate: rateToPercentFormValue(item.productId ? currentPrice?.purchaseVatRate : item.purchaseVatRate),
    operatingCostNet: textValue(item.operatingCostNet),
    marginRate: rateToPercentFormValue(item.marginRate),
    saleVatRate: rateToPercentFormValue(item.saleVatRate),
    isOptional: Boolean(item.isOptional),
    requiresReview: Boolean(item.requiresReview),
    notes: item.notes || '',
  };
}

function formFromTemplate(template: TemplateRow): TemplateForm {
  return {
    id: template.id,
    familyKey: template.familyKey,
    name: template.name,
    clientType: template.clientType,
    kind: template.kind,
    goal: template.goal || 'MIXED',
    roofType: template.roofType || 'UNKNOWN',
    powerKw: textValue(template.powerKw),
    capacityKwh: textValue(template.capacityKwh),
    requiresExistingPv: template.requiresExistingPv,
    requiresExistingInverter: template.requiresExistingInverter,
    notes: template.notes || '',
    items: template.items.map(itemFromTemplate),
  };
}

function blankForm(): TemplateForm {
  return {
    id: '',
    familyKey: '',
    name: '',
    clientType: 'B2C',
    kind: 'MAGAZYN',
    goal: 'STORAGE_RETROFIT',
    roofType: 'UNKNOWN',
    powerKw: '',
    capacityKwh: '',
    requiresExistingPv: false,
    requiresExistingInverter: false,
    notes: '',
    items: [],
  };
}

function estimateGross(template: TemplateRow) {
  try {
    const saleVatRate = template.clientType === 'B2C' ? 0.08 : 0.23;
    return template.items.reduce((total, item) => {
      if (nonPricedSupplyModes.has(item.supplyMode)) return total;
      const costs = resolveTemplateItemCosts(item);
      return total + calculateConfigurationLine({
        quantity: Number(item.quantity),
        ...costs,
        saleVatRate,
      }).saleGross;
    }, 0);
  } catch {
    return null;
  }
}

function estimateFormGross(form: TemplateForm) {
  try {
    const saleVatRate = form.clientType === 'B2C' ? 0.08 : 0.23;
    return form.items.reduce((total, item) => {
      if (nonPricedSupplyModes.has(item.supplyMode)) return total;
      const costs = resolveTemplateItemCosts({
        ...item,
        purchaseVatRate: percentFormValueToRate(item.purchaseVatRate),
        marginRate: percentFormValueToRate(item.marginRate),
      });
      return total + calculateConfigurationLine({
        quantity: Number(item.quantity),
        ...costs,
        saleVatRate,
      }).saleGross;
    }, 0);
  } catch {
    return null;
  }
}

export default function TemplateManagerWorkspace() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const inputBg = useColorModeValue('white', 'navy.900');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const subtleBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');
  const tableHeadBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');
  const fieldStyles = { bg: inputBg, color: textColor, borderColor };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [workspaceResponse, meResponse] = await Promise.all([
        fetch('/api/configurations?workspace=1', { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }),
      ]);
      const workspace = await workspaceResponse.json();
      const me = await meResponse.json();
      if (!workspaceResponse.ok || !workspace.ok) throw new Error(workspace.message || workspace.error || 'Nie udało się pobrać szablonów');
      setTemplates(workspace.data.templates || []);
      setProducts(workspace.data.products || []);
      setIsAdmin(meResponse.ok && me?.data?.systemRole === 'ADMIN');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const families = useMemo(() => groupTemplateVariants(templates), [templates]);
  const visibleFamilies = useMemo(() => {
    const needles = query.trim().toLocaleLowerCase('pl-PL').split(/\s+/).filter(Boolean);
    return families.filter((family) => {
      const active = family.variants.some((variant) => variant.isActive);
      if (statusFilter === 'ACTIVE' && !active) return false;
      if (statusFilter === 'ARCHIVED' && active) return false;
      if (needles.length === 0) return true;
      const haystack = [family.name, ...family.variants.flatMap((variant) => [variant.kind, variant.goal, variant.clientType])]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pl-PL');
      return needles.every((needle) => haystack.includes(needle));
    });
  }, [families, query, statusFilter]);

  function updateForm(field: keyof Omit<TemplateForm, 'items'>, value: string | boolean) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateItem(index: number, field: keyof TemplateItem, value: string | boolean) {
    setForm((current) => {
      if (!current) return current;
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (field !== 'productId') return { ...item, [field]: value };
        const product = products.find((entry) => entry.id === value);
        const price = product?.prices?.[0];
        return {
          ...item,
          productId: typeof value === 'string' ? value : '',
          product: product || null,
          description: product?.name || item.description,
          unitPurchaseNet: textValue(price?.currentPurchaseNet ?? price?.purchaseNet),
          purchaseVatRate: rateToPercentFormValue(price?.purchaseVatRate ?? 0.23),
          operatingCostNet: textValue(price?.operatingCostNet ?? 0),
          marginRate: rateToPercentFormValue(price?.marginRate ?? 0.3),
        };
      });
      return { ...current, items };
    });
  }

  function editTemplate(template: TemplateRow) {
    setForm(formFromTemplate(template));
    setError('');
    setNotice('');
  }

  function duplicateTemplate(template: TemplateRow) {
    setForm({ ...formFromTemplate(template), id: '', familyKey: '', name: `${template.name} - kopia` });
    setError('');
    setNotice('');
  }

  function addVariant(family: ReturnType<typeof groupTemplateVariants<TemplateRow>>[number]) {
    const source = family.variants.find((variant) => variant.isActive) || family.variants[0];
    const existingTypes = new Set(family.variants.map((variant) => variant.clientType));
    const clientType = !existingTypes.has('B2C') ? 'B2C' : !existingTypes.has('B2B') ? 'B2B' : 'B2C_B2B';
    setForm({ ...formFromTemplate(source), id: '', familyKey: family.familyKey, clientType });
    setError('');
    setNotice('');
  }

  async function saveTemplate() {
    if (!form) return;
    if (!form.name.trim()) return setError('Podaj nazwę szablonu');
    if (form.items.length === 0) return setError('Szablon wymaga przynajmniej jednej pozycji');
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/configurations/templates', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          items: form.items.map((item) => ({
            ...item,
            purchaseVatRate: percentFormValueToRate(item.purchaseVatRate),
            marginRate: percentFormValueToRate(item.marginRate),
            saleVatRate: item.saleVatRate ? percentFormValueToRate(item.saleVatRate) : null,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Nie udało się zapisać szablonu');
      setNotice(`Zapisano szablon: ${result.data.name}`);
      setForm(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function setFamilyActive(familyKey: string, isActive: boolean) {
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/configurations/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyKey, isActive }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Nie udało się zmienić aktywności');
      setNotice(isActive ? 'Przywrócono rodzinę szablonów' : 'Zarchiwizowano rodzinę szablonów');
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  async function deleteTemplate() {
    if (!form?.id || !window.confirm(`Trwale usunąć wariant „${form.name}” (${form.clientType})?`)) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/configurations/templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Nie udało się usunąć szablonu');
      setForm(null);
      setNotice('Usunięto nieużywany wariant szablonu');
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Flex pt={{ base: '130px', md: '90px' }} justify="center"><Spinner /></Flex>;
  }

  return (
    <Box pt={{ base: '130px', md: '80px' }}>
      <Flex align="center" justify="space-between" gap="16px" mb="18px" wrap="wrap">
        <Box>
          <Text color={mutedColor} fontSize="sm" fontWeight="700">Pages / Konfigurator</Text>
          <Text color={textColor} fontSize={{ base: '28px', md: '36px' }} fontWeight="800" lineHeight="1.1">
            Szablony konfiguracji
          </Text>
        </Box>
        <HStack spacing="10px">
          <Tooltip label="Odśwież szablony"><IconButton aria-label="Odśwież szablony" icon={<MdRefresh />} variant="outline" onClick={load} /></Tooltip>
          {form ? (
            <Button leftIcon={<MdSave />} colorScheme="purple" onClick={saveTemplate} isLoading={saving}>Zapisz szablon</Button>
          ) : (
            <Button leftIcon={<MdAdd />} colorScheme="purple" onClick={() => setForm(blankForm())}>Nowy szablon</Button>
          )}
        </HStack>
      </Flex>

      {error ? <Alert status="error" borderRadius="8px" mb="16px"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert status="success" borderRadius="8px" mb="16px"><AlertIcon /><AlertDescription>{notice}</AlertDescription></Alert> : null}

      {!form ? (
        <>
          <Card p="20px" mb="18px">
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
              <FormControl>
                <FormLabel>Szukaj</FormLabel>
                <InputGroup>
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nazwa, typ, moc, cel..." ps="40px" sx={fieldStyles} />
                  <Box position="absolute" left="14px" top="10px" zIndex={1}><Icon as={MdSearch} color={mutedColor} /></Box>
                </InputGroup>
              </FormControl>
              <FormControl>
                <FormLabel>Widok</FormLabel>
                <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={fieldStyles}>
                  <option value="ACTIVE">Aktywne</option>
                  <option value="ARCHIVED">Archiwalne</option>
                  <option value="ALL">Wszystkie</option>
                </Select>
              </FormControl>
            </SimpleGrid>
          </Card>

          <Flex direction="column" gap="12px">
            {visibleFamilies.map((family) => {
              const active = family.variants.some((variant) => variant.isActive);
              const prices = family.variants.map(estimateGross).filter((value): value is number => value !== null);
              const minPrice = prices.length ? Math.min(...prices) : null;
              const maxPrice = prices.length ? Math.max(...prices) : null;
              const representative = family.variants.find((variant) => variant.isActive) || family.variants[0];
              return (
                <Card key={family.familyKey} p="18px" opacity={active ? 1 : 0.72}>
                  <Flex direction={{ base: 'column', lg: 'row' }} justify="space-between" align={{ lg: 'center' }} gap="16px">
                    <Box minW="0" flex="1">
                      <Flex gap="7px" wrap="wrap" mb="7px">
                        <Badge colorScheme={active ? 'green' : 'gray'}>{active ? 'Aktywny' : 'Archiwalny'}</Badge>
                        <Badge colorScheme="blue">{kindLabels[representative.kind] || representative.kind}</Badge>
                        {family.variants.map((variant) => (
                          <Badge key={variant.id} colorScheme={variant.isActive ? 'purple' : 'gray'}>{variant.clientType} · v{variant.version}</Badge>
                        ))}
                      </Flex>
                      <Text color={textColor} fontSize="lg" fontWeight="900">{family.name}</Text>
                      <Text color={mutedColor} fontSize="sm">
                        {representative.powerKw ? `${representative.powerKw} kW` : 'moc nieokreślona'}
                        {representative.capacityKwh ? ` · ${representative.capacityKwh} kWh` : ''}
                        {minPrice == null ? ' · brak kompletnej ceny' : ` · ${formatMoney(minPrice)}${maxPrice !== minPrice ? ` – ${formatMoney(maxPrice!)}` : ''}`}
                      </Text>
                    </Box>
                    <Flex gap="8px" wrap="wrap">
                      {family.variants.map((variant) => (
                        <Button key={variant.id} size="sm" leftIcon={<MdEdit />} variant="outline" onClick={() => editTemplate(variant)}>
                          {variant.clientType}
                        </Button>
                      ))}
                      {!family.variants.some((variant) => variant.clientType === 'B2C') || !family.variants.some((variant) => variant.clientType === 'B2B') ? (
                        <Tooltip label="Dodaj brakujący wariant klienta">
                          <IconButton aria-label="Dodaj wariant" size="sm" icon={<MdAdd />} variant="outline" onClick={() => addVariant(family)} />
                        </Tooltip>
                      ) : null}
                      <Tooltip label="Duplikuj jako nową rodzinę">
                        <IconButton aria-label="Duplikuj szablon" size="sm" icon={<MdContentCopy />} variant="outline" onClick={() => duplicateTemplate(representative)} />
                      </Tooltip>
                      <Tooltip label={active ? 'Archiwizuj rodzinę' : 'Przywróć rodzinę'}>
                        <IconButton
                          aria-label={active ? 'Archiwizuj rodzinę' : 'Przywróć rodzinę'}
                          size="sm"
                          icon={active ? <MdArchive /> : <MdRestore />}
                          variant="outline"
                          onClick={() => setFamilyActive(family.familyKey, !active)}
                        />
                      </Tooltip>
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
            {visibleFamilies.length === 0 ? <Card p="20px"><Text color={mutedColor}>Brak szablonów pasujących do filtrów.</Text></Card> : null}
          </Flex>
        </>
      ) : (
        <VStack spacing="18px" align="stretch">
          <Card p="20px">
            <Flex justify="space-between" gap="12px" align="center" mb="16px" wrap="wrap">
              <Box>
                <Text color={textColor} fontSize="lg" fontWeight="900">{form.id ? 'Edycja wariantu' : 'Nowy wariant szablonu'}</Text>
                <Text color={mutedColor} fontSize="sm">Pozycje techniczne są wspólnym wzorcem dla przyszłych konfiguracji klientów.</Text>
              </Box>
              <Flex gap="8px">
                {isAdmin && form.id ? (
                  <Tooltip label="Usuń trwale nieużywany wariant">
                    <IconButton aria-label="Usuń szablon" icon={<MdDeleteOutline />} colorScheme="red" variant="outline" onClick={deleteTemplate} />
                  </Tooltip>
                ) : null}
                <Button variant="outline" onClick={() => setForm(null)} isDisabled={saving}>Wróć do listy</Button>
              </Flex>
            </Flex>
            <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="14px">
              <FormControl gridColumn={{ md: 'span 2' }} isRequired><FormLabel>Nazwa szablonu</FormLabel><Input value={form.name} onChange={(event) => updateForm('name', event.target.value)} sx={fieldStyles} /></FormControl>
              <FormControl><FormLabel>Wariant klienta</FormLabel><Select value={form.clientType} onChange={(event) => updateForm('clientType', event.target.value)} sx={fieldStyles} isDisabled={Boolean(form.id)}><option value="B2C">B2C</option><option value="B2B">B2B</option><option value="B2C_B2B">B2C / B2B</option></Select></FormControl>
              <FormControl><FormLabel>Typ konfiguracji</FormLabel><Select value={form.kind} onChange={(event) => updateForm('kind', event.target.value)} sx={fieldStyles}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl>
              <FormControl><FormLabel>Cel</FormLabel><Select value={form.goal} onChange={(event) => updateForm('goal', event.target.value)} sx={fieldStyles}>{Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl>
              <FormControl><FormLabel>Dach</FormLabel><Select value={form.roofType} onChange={(event) => updateForm('roofType', event.target.value)} sx={fieldStyles}>{Object.entries(roofLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl>
              <FormControl><FormLabel>Moc kW</FormLabel><Input value={form.powerKw} onChange={(event) => updateForm('powerKw', event.target.value)} sx={fieldStyles} /></FormControl>
              <FormControl><FormLabel>Pojemność kWh</FormLabel><Input value={form.capacityKwh} onChange={(event) => updateForm('capacityKwh', event.target.value)} sx={fieldStyles} /></FormControl>
              <FormControl gridColumn={{ md: 'span 2' }}><FormLabel>Opis / notatki</FormLabel><Textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} minH="92px" sx={fieldStyles} /></FormControl>
            </SimpleGrid>
            <HStack mt="14px" spacing="18px" wrap="wrap">
              <Checkbox isChecked={form.requiresExistingPv} onChange={(event) => updateForm('requiresExistingPv', event.target.checked)}>Wymaga istniejącej PV</Checkbox>
              <Checkbox isChecked={form.requiresExistingInverter} onChange={(event) => updateForm('requiresExistingInverter', event.target.checked)}>Wymaga istniejącego falownika</Checkbox>
            </HStack>
          </Card>

          <Card p="20px">
            <Flex justify="space-between" align="center" gap="12px" mb="14px" wrap="wrap">
              <Box><Text color={textColor} fontSize="lg" fontWeight="900">Skład techniczny</Text><Text color={mutedColor} fontSize="sm">{form.items.length} pozycji · ceny produktów zostaną odświeżone z katalogu przy użyciu szablonu</Text></Box>
              <Button leftIcon={<MdAdd />} variant="outline" onClick={() => setForm({ ...form, items: [...form.items, emptyItem(form.items.length + 1)] })}>Dodaj pozycję</Button>
            </Flex>
            <Box overflowX="auto" border="1px solid" borderColor={borderColor} borderRadius="8px">
              <Table size="sm" minW="1540px">
                <Thead bg={tableHeadBg}><Tr><Th>#</Th><Th minW="250px">Pozycja</Th><Th minW="250px">Produkt</Th><Th minW="160px">Rola</Th><Th minW="180px">Tryb</Th><Th>Ilość</Th><Th>Zakup netto</Th><Th>VAT zakup</Th><Th>Koszt firmy</Th><Th>Marża</Th><Th>Akcje</Th></Tr></Thead>
                <Tbody>
                  {form.items.map((item, index) => (
                    <Tr key={`${item.id || 'new'}-${index}`}>
                      <Td fontWeight="800">{index + 1}</Td>
                      <Td><Input value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} sx={fieldStyles} /><Checkbox mt="5px" size="sm" isChecked={item.requiresReview} onChange={(event) => updateItem(index, 'requiresReview', event.target.checked)}>Do sprawdzenia</Checkbox></Td>
                      <Td><SearchableProductPicker value={item.productId} products={products} onChange={(value) => updateItem(index, 'productId', value)} /></Td>
                      <Td><Select value={item.role} onChange={(event) => updateItem(index, 'role', event.target.value)} sx={fieldStyles}>{roles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</Select></Td>
                      <Td><Select value={item.supplyMode} onChange={(event) => updateItem(index, 'supplyMode', event.target.value)} sx={fieldStyles}>{supplyModes.map((value) => <option key={value} value={value}>{supplyModeLabels[value]}</option>)}</Select></Td>
                      <Td><Input minW="90px" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} sx={fieldStyles} /></Td>
                      <Td><Input minW="118px" value={item.unitPurchaseNet} onChange={(event) => updateItem(index, 'unitPurchaseNet', event.target.value)} sx={fieldStyles} isDisabled={Boolean(item.productId)} /></Td>
                      <Td><InputGroup minW="105px"><Input value={item.purchaseVatRate} onChange={(event) => updateItem(index, 'purchaseVatRate', event.target.value)} pe="30px" sx={fieldStyles} isDisabled={Boolean(item.productId)} /><InputRightElement pointerEvents="none">%</InputRightElement></InputGroup></Td>
                      <Td><Input minW="118px" value={item.operatingCostNet} onChange={(event) => updateItem(index, 'operatingCostNet', event.target.value)} sx={fieldStyles} /></Td>
                      <Td><InputGroup minW="105px"><Input value={item.marginRate} onChange={(event) => updateItem(index, 'marginRate', event.target.value)} pe="30px" sx={fieldStyles} /><InputRightElement pointerEvents="none">%</InputRightElement></InputGroup></Td>
                      <Td><Tooltip label="Usuń pozycję"><IconButton aria-label="Usuń pozycję" icon={<MdDeleteOutline />} variant="ghost" colorScheme="red" onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index).map((entry, itemIndex) => ({ ...entry, position: itemIndex + 1 })) })} /></Tooltip></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
            {form.items.length === 0 ? <Flex py="30px" align="center" justify="center" color={mutedColor} gap="10px"><Icon as={MdInventory2} /><Text>Dodaj pierwszą pozycję techniczną.</Text></Flex> : null}
          </Card>

          <Card p="20px">
            <Flex justify="space-between" align="center" gap="12px" wrap="wrap">
              <Box><Text color={textColor} fontWeight="900">Podsumowanie wariantu</Text><Text color={mutedColor} fontSize="sm">Cena jest orientacyjna; właściwy VAT zostanie ustalony przy kliencie.</Text></Box>
              <Text color={textColor} fontSize="xl" fontWeight="900">{estimateFormGross(form) == null ? 'Brak kompletnej ceny' : formatMoney(estimateFormGross(form)!)}</Text>
            </Flex>
          </Card>
        </VStack>
      )}
    </Box>
  );
}
