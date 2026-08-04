'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  IconButton,
  Image,
  Input,
  InputGroup,
  InputRightElement,
  Link,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { percentFormValueToRate, rateToPercentFormValue } from 'lib/onrevolt/percentage';
import { useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdArrowDownward,
  MdArrowUpward,
  MdDelete,
  MdEdit,
  MdImage,
  MdOpenInNew,
  MdPictureAsPdf,
  MdRefresh,
  MdSave,
} from 'react-icons/md';

type ProductPrice = {
  purchaseNet: string | number;
  currentPurchaseNet?: string | number | null;
  purchaseVatRate: string | number;
  operatingCostNet: string | number;
  marginRate: string | number;
  saleVatRate?: string | number | null;
  currency: string;
  validFrom: string;
};

type ProductMedia = {
  id: string;
  productId: string;
  url?: string | null;
  storagePath?: string | null;
  kind: string;
  altText?: string | null;
  sortOrder: number;
};

function mediaHref(media: ProductMedia) {
  if (media.storagePath || media.url?.startsWith('/uploads/catalog/products/')) {
    return `/api/catalog/media/${encodeURIComponent(media.id)}/file`;
  }
  return media.url || '';
}

type ProductMediaKind = 'datasheet' | 'manual' | 'certificate' | 'warranty' | 'document' | 'image';
type ProductDocumentKind = Exclude<ProductMediaKind, 'image'>;

const documentKindOptions: Array<{ value: ProductDocumentKind; label: string }> = [
  { value: 'document', label: 'Inny dokument' },
  { value: 'datasheet', label: 'Datasheet' },
  { value: 'manual', label: 'Instrukcja' },
  { value: 'certificate', label: 'Certyfikat' },
  { value: 'warranty', label: 'Gwarancja' },
];

const mediaKindLabels: Record<ProductMediaKind, string> = {
  datasheet: 'Datasheet',
  manual: 'Instrukcja',
  certificate: 'Certyfikat',
  warranty: 'Gwarancja',
  document: 'PDF / Inny',
  image: 'Obraz',
};

type ProductRow = {
  id: string;
  sku?: string | null;
  name: string;
  availability?: string | null;
  producer?: string | null;
  supplier?: string | null;
  supplierSku?: string | null;
  supplierUrl?: string | null;
  supplierSyncedAt?: string | null;
  category: string;
  clientType?: string | null;
  description?: string | null;
  powerCapacity?: string | null;
  voltageKind?: string | null;
  notes?: string | null;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  prices: ProductPrice[];
  media: ProductMedia[];
};

type ProductEditForm = {
  sku: string;
  name: string;
  availability: string;
  producer: string;
  supplier: string;
  supplierSku: string;
  supplierUrl: string;
  category: string;
  clientType: string;
  description: string;
  powerCapacity: string;
  voltageKind: string;
  notes: string;
  sourceSheet: string;
  sourceRow: string;
  purchaseNet: string;
  currentPurchaseNet: string;
  purchaseVatRate: string;
  operatingCostNet: string;
  marginRate: string;
  currency: string;
};

const categoryLabels: Record<string, string> = {
  MAGAZYN_ENERGII: 'Magazyn energii',
  FALOWNIK: 'Falownik',
  INWERTER: 'Falownik',
  FOTOWOLTAIKA: 'Fotowoltaika',
  LICZNIK_GRID: 'Licznik Grid',
  OSPRZET_ELEKTRONIKA: 'Osprzęt / elektronika',
  USLUGA_MONTAZOWA: 'Usługa montażowa',
  KOSZTY_OPERACYJNE: 'Koszty operacyjne',
  MONITOROWANIE: 'Monitorowanie',
  SYSTEM_MONITORUJACY: 'System monitorujący',
  INNE: 'Inne',
};

const hiddenProductCategories = new Set(['INWERTER']);

const clientTypeOptions = ['UNKNOWN', 'B2C', 'B2B', 'B2C_B2B'];
const availabilityOptions = ['Dostępny', 'Mało', 'W dostawie', 'Niedostępny', 'Na zamówienie'];
const visibleAvailabilityValues = new Set(['dostępny', 'dostepny', 'mało', 'malo', 'w dostawie', 'instock', 'limited stock']);
const editablePriceFields: Array<keyof ProductEditForm> = [
  'purchaseNet',
  'currentPurchaseNet',
  'purchaseVatRate',
  'operatingCostNet',
  'marginRate',
];
const emptyProductForm: ProductEditForm = {
  sku: '',
  name: '',
  availability: '',
  producer: '',
  supplier: '',
  supplierSku: '',
  supplierUrl: '',
  category: 'INNE',
  clientType: '',
  description: '',
  powerCapacity: '',
  voltageKind: '',
  notes: '',
  sourceSheet: '',
  sourceRow: '',
  purchaseNet: '',
  currentPurchaseNet: '',
  purchaseVatRate: '',
  operatingCostNet: '',
  marginRate: '',
  currency: 'PLN',
};

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 0;
  return Number(value);
}

function formValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatMoney(value: number, currency = 'PLN') {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: string | number | null | undefined) {
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(asNumber(value) * 100)}%`;
}

function productTotals(product: ProductRow) {
  const price = product.prices?.[0];
  if (!price) return null;

  const totalCostNet = asNumber(price.purchaseNet) + asNumber(price.operatingCostNet);
  const profitNet = totalCostNet * asNumber(price.marginRate);
  return {
    saleNet: totalCostNet + profitNet,
    profitNet,
  };
}

function mediaLabel(media: ProductMedia) {
  if (media.kind in mediaKindLabels) return mediaKindLabels[media.kind as ProductMediaKind];
  return media.kind;
}

function mediaColor(media: ProductMedia) {
  if (media.kind === 'image') return 'blue';
  if (media.kind === 'manual') return 'orange';
  if (media.kind === 'certificate') return 'green';
  if (media.kind === 'warranty') return 'purple';
  if (media.kind === 'document') return 'gray';
  return 'red';
}

function sortMediaItems(media: ProductMedia[]) {
  return [...media].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function normalizedAvailability(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function isVisibleAvailability(value: string | null | undefined) {
  return visibleAvailabilityValues.has(normalizedAvailability(value));
}

function editFormFromProduct(product: ProductRow): ProductEditForm {
  const price = product.prices?.[0];
  return {
    sku: product.sku || '',
    name: product.name || '',
    availability: product.availability || '',
    producer: product.producer || '',
    supplier: product.supplier || '',
    supplierSku: product.supplierSku || '',
    supplierUrl: product.supplierUrl || '',
    category: product.category || 'INNE',
    clientType: product.clientType || '',
    description: product.description || '',
    powerCapacity: product.powerCapacity || '',
    voltageKind: product.voltageKind || '',
    notes: product.notes || '',
    sourceSheet: product.sourceSheet || '',
    sourceRow: product.sourceRow == null ? '' : String(product.sourceRow),
    purchaseNet: formValue(price?.purchaseNet),
    currentPurchaseNet: formValue(price?.currentPurchaseNet),
    purchaseVatRate: rateToPercentFormValue(price?.purchaseVatRate),
    operatingCostNet: formValue(price?.operatingCostNet),
    marginRate: rateToPercentFormValue(price?.marginRate),
    currency: price?.currency || 'PLN',
  };
}

function normalizeEmpty(value: string) {
  const trimmed = value.trim();
  return trimmed ? value.trim() : null;
}

function buildPricePayload(form: ProductEditForm) {
  const hasPriceInput = editablePriceFields.some((field) => form[field].trim() !== '');
  if (!hasPriceInput) return undefined;

  const requiredFields = editablePriceFields.filter((field) => field !== 'currentPurchaseNet');
  const missing = requiredFields.filter((field) => form[field].trim() === '');
  if (missing.length) {
    throw new Error('Cena wymaga pól: koszt netto, VAT zakupu, koszty operacyjne i marża');
  }

  return {
    purchaseNet: form.purchaseNet,
    currentPurchaseNet: form.currentPurchaseNet.trim() ? form.currentPurchaseNet : null,
    purchaseVatRate: percentFormValueToRate(form.purchaseVatRate),
    operatingCostNet: form.operatingCostNet,
    marginRate: percentFormValueToRate(form.marginRate),
    currency: form.currency.trim() || 'PLN',
  };
}

async function readApiPayload(response: Response) {
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  return payload;
}

export default function CatalogWorkspace() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [clientType, setClientType] = useState('all');
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mediaUploading, setMediaUploading] = useState('');
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editForm, setEditForm] = useState<ProductEditForm | null>(null);
  const [productModalMode, setProductModalMode] = useState<'create' | 'edit'>('edit');
  const [savingProduct, setSavingProduct] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState('');
  const [sortingMediaId, setSortingMediaId] = useState('');
  const [updatingMediaKindId, setUpdatingMediaKindId] = useState('');
  const [selectedPdfKind, setSelectedPdfKind] = useState<ProductDocumentKind>('document');
  const [productModalError, setProductModalError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const subtleBorder = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const panelBg = useColorModeValue('white', 'navy.800');

  async function loadProducts() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/catalog/products', { cache: 'no-store' });
      const payload = await readApiPayload(response);
      setProducts(payload.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  function closeProductModal() {
    setEditingProduct(null);
    setEditForm(null);
    setProductModalMode('edit');
    setProductModalError('');
  }

  function openCreate() {
    setProductModalMode('create');
    setEditingProduct(null);
    setEditForm(emptyProductForm);
    setError('');
    setNotice('');
    setProductModalError('');
  }

  function openEdit(product: ProductRow) {
    setProductModalMode('edit');
    setEditingProduct(product);
    setEditForm(editFormFromProduct(product));
    setError('');
    setNotice('');
    setProductModalError('');
  }

  function updateEditField(field: keyof ProductEditForm, value: string) {
    setEditForm((current) => current ? { ...current, [field]: value } : current);
  }

  async function saveProduct() {
    if (!editForm) return;
    if (productModalMode === 'edit' && !editingProduct) return;

    setSavingProduct(true);
    setProductModalError('');
    setNotice('');
    try {
      if (!editForm.name.trim()) {
        throw new Error('Nazwa produktu jest wymagana');
      }

      const sourceRow = editForm.sourceRow.trim() ? Number(editForm.sourceRow) : null;
      if (sourceRow !== null && !Number.isInteger(sourceRow)) {
        throw new Error('Wiersz źródłowy musi być liczbą całkowitą');
      }

      const body: Record<string, unknown> = {
        sku: normalizeEmpty(editForm.sku),
        name: editForm.name,
        availability: normalizeEmpty(editForm.availability),
        producer: normalizeEmpty(editForm.producer),
        supplier: normalizeEmpty(editForm.supplier),
        supplierSku: normalizeEmpty(editForm.supplierSku),
        supplierUrl: normalizeEmpty(editForm.supplierUrl),
        category: editForm.category,
        clientType: normalizeEmpty(editForm.clientType),
        description: normalizeEmpty(editForm.description),
        powerCapacity: normalizeEmpty(editForm.powerCapacity),
        voltageKind: normalizeEmpty(editForm.voltageKind),
        notes: normalizeEmpty(editForm.notes),
        sourceSheet: normalizeEmpty(editForm.sourceSheet),
        sourceRow: productModalMode === 'edit' ? sourceRow : sourceRow ?? undefined,
        price: buildPricePayload(editForm),
      };

      if (productModalMode === 'edit') body.id = editingProduct!.id;

      const response = await fetch('/api/catalog/products', {
        method: productModalMode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readApiPayload(response);
      const saved = payload.data as ProductRow;
      setProducts((current) => {
        const exists = current.some((product) => product.id === saved.id);
        const next = exists
          ? current.map((product) => (product.id === saved.id ? saved : product))
          : [...current, saved];
        return next.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
      });
      closeProductModal();
      setNotice(productModalMode === 'edit' ? `Zapisano produkt: ${saved.name}` : `Dodano towar: ${saved.name}`);
    } catch (e) {
      setProductModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProduct(false);
    }
  }

  async function deleteMedia(media: ProductMedia) {
    if (!editingProduct) return;
    const confirmed = window.confirm(`Usunąć załącznik ${mediaLabel(media)} z produktu ${editingProduct.name}?`);
    if (!confirmed) return;

    setDeletingMediaId(media.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/catalog/media', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: media.id }),
      });
      await readApiPayload(response);
      setProducts((current) => current.map((product) => (
        product.id === media.productId
          ? { ...product, media: product.media.filter((item) => item.id !== media.id) }
          : product
      )));
      setEditingProduct((current) => current ? {
        ...current,
        media: current.media.filter((item) => item.id !== media.id),
      } : current);
      setNotice('Usunięto załącznik produktu');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingMediaId('');
    }
  }

  async function moveMedia(media: ProductMedia, direction: -1 | 1) {
    if (!editingProduct) return;

    const ordered = sortMediaItems(editingProduct.media);
    const currentIndex = ordered.findIndex((item) => item.id === media.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;

    const reordered = [...ordered];
    const [selected] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, selected);
    const updatedMedia = reordered.map((item, index) => ({ ...item, sortOrder: index * 10 }));

    setSortingMediaId(media.id);
    setError('');
    setNotice('');
    try {
      await Promise.all(updatedMedia.map(async (item) => {
        const response = await fetch('/api/catalog/media', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, sortOrder: item.sortOrder }),
        });
        await readApiPayload(response);
      }));

      setProducts((current) => current.map((product) => (
        product.id === editingProduct.id
          ? { ...product, media: updatedMedia }
          : product
      )));
      setEditingProduct((current) => current ? { ...current, media: updatedMedia } : current);
      setNotice('Zmieniono kolejność załączników');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSortingMediaId('');
    }
  }

  async function updateMediaKind(media: ProductMedia, kind: ProductDocumentKind) {
    setUpdatingMediaKindId(media.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/catalog/media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: media.id, kind }),
      });
      const payload = await readApiPayload(response);
      const updated = payload.data as ProductMedia;
      setProducts((current) => current.map((product) => (
        product.id === updated.productId
          ? { ...product, media: sortMediaItems(product.media.map((item) => item.id === updated.id ? updated : item)) }
          : product
      )));
      setEditingProduct((current) => current
        ? { ...current, media: sortMediaItems(current.media.map((item) => item.id === updated.id ? updated : item)) }
        : current);
      setNotice('Zmieniono typ załącznika');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingMediaKindId('');
    }
  }

  async function uploadMedia(product: ProductRow, file: File, kind: ProductMediaKind) {
    const uploadKey = `${product.id}:${kind}`;
    setMediaUploading(uploadKey);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('productId', product.id);
      form.append('kind', kind);
      form.append('altText', `${product.name} - ${(mediaKindLabels[kind] || kind).toLowerCase()}`);
      form.append('file', file);

      const response = await fetch('/api/catalog/media', {
        method: 'POST',
        body: form,
      });
      await readApiPayload(response);
      setNotice(`Dodano załącznik do produktu: ${product.name}`);
      await loadProducts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMediaUploading('');
    }
  }

  const categories = useMemo(
    () => Array.from(new Set([...Object.keys(categoryLabels), ...products.map((product) => product.category)]))
      .filter((category) => !hiddenProductCategories.has(category))
      .sort(),
    [products],
  );
  const clientTypes = useMemo(
    () => Array.from(new Set([...clientTypeOptions, ...products.map((product) => product.clientType).filter(Boolean) as string[]])).sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return products.filter((product) => {
      if (category !== 'all' && product.category !== category) return false;
      if (clientType !== 'all' && product.clientType !== clientType) return false;
      if (showAvailableOnly && !isVisibleAvailability(product.availability)) return false;
      if (!text) return true;
      return [
        product.sku,
        product.name,
        product.producer,
        product.supplier,
        product.supplierSku,
        product.supplierUrl,
        product.category,
        product.clientType,
        product.description,
        product.powerCapacity,
        product.notes,
      ].join(' ').toLowerCase().includes(text);
    });
  }, [products, query, category, clientType, showAvailableOnly]);

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', xl: 'row' }} gap="16px" align={{ xl: 'center' }}>
          <Box flex="1">
            <Badge colorScheme="purple" mb="12px" borderRadius="8px" px="10px" py="4px">
              Katalog
            </Badge>
            <Text color={textColor} fontSize="2xl" fontWeight="800">
              Katalog urządzeń
            </Text>
            <Text color={mutedColor} mt="6px">
              Produkty, usługi, ceny zakupu i domyślne marże wykorzystywane w konfiguracjach.
            </Text>
          </Box>
          <Flex gap="10px" wrap="wrap">
            <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={loadProducts} isLoading={loading}>
              Odśwież
            </Button>
            <Button leftIcon={<Icon as={MdAdd} />} colorScheme="purple" onClick={openCreate}>
              Nowy towar
            </Button>
          </Flex>
        </Flex>
      </Card>

      {error ? (
        <Alert status="error" borderRadius="8px">
          <AlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert status="success" borderRadius="8px">
          <AlertIcon />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card p="22px">
        <Flex mb="18px" gap="12px" align="center" wrap="wrap">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj po nazwie, producencie, mocy, uwagach..."
            maxW="420px"
          />
          <Select value={category} onChange={(event) => setCategory(event.target.value)} maxW="260px">
            <option value="all">Wszystkie kategorie</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {categoryLabels[item] || item}
              </option>
            ))}
          </Select>
          <Select value={clientType} onChange={(event) => setClientType(event.target.value)} maxW="180px">
            <option value="all">B2C / B2B</option>
            {clientTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Checkbox
            isChecked={showAvailableOnly}
            onChange={(event) => setShowAvailableOnly(event.target.checked)}
            colorScheme="green"
          >
            Tylko dostępne
          </Checkbox>
          <Text ml="auto" color={mutedColor} fontSize="sm">
            {filtered.length} / {products.length}
          </Text>
        </Flex>

        <Box overflowX="auto">
          <Table variant="simple">
            <Thead>
              <Tr>
                <Th>Nazwa</Th>
                <Th>Kategoria</Th>
                <Th>Parametry</Th>
                <Th isNumeric>Koszt netto</Th>
                <Th isNumeric>Marża</Th>
                <Th isNumeric>Sugerowana cena netto</Th>
                <Th isNumeric>Zysk</Th>
                <Th>Media</Th>
                <Th>Działania</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((product) => {
                const price = product.prices?.[0];
                const totals = productTotals(product);
                return (
                  <Tr key={product.id}>
                    <Td minW="300px">
                      <Text color={textColor} fontWeight="700">{product.name}</Text>
                      <Text color={mutedColor} fontSize="sm">
                        {[product.producer, product.sku].filter(Boolean).join(' · ') || 'Bez producenta'}
                      </Text>
                      {product.supplierSku ? (
                        <Text color={mutedColor} fontSize="xs" mt="4px">
                          OSW SKU: {product.supplierSku}
                        </Text>
                      ) : null}
                      {product.supplierUrl ? (
                        <Link href={product.supplierUrl} isExternal color="blue.300" fontSize="xs" mt="4px" display="inline-flex" alignItems="center" gap="4px">
                          URL dostawcy
                          <Icon as={MdOpenInNew} />
                        </Link>
                      ) : null}
                      {product.notes ? (
                        <Text color={mutedColor} fontSize="xs" mt="4px" maxW="420px">
                          {product.notes}
                        </Text>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge colorScheme="purple">{categoryLabels[product.category] || product.category}</Badge>
                      <Text color={mutedColor} fontSize="sm" mt="6px">{product.clientType || 'B2C/B2B'}</Text>
                    </Td>
                    <Td minW="200px">
                      <Text>{product.powerCapacity || '-'}</Text>
                      <Text color={mutedColor} fontSize="sm">{product.availability || product.voltageKind || '-'}</Text>
                    </Td>
                    <Td isNumeric>{price ? formatMoney(asNumber(price.purchaseNet), price.currency) : '-'}</Td>
                    <Td isNumeric>{price ? formatPercent(price.marginRate) : '-'}</Td>
                    <Td isNumeric>{totals && price ? formatMoney(totals.saleNet, price.currency) : '-'}</Td>
                    <Td isNumeric>{totals && price ? formatMoney(totals.profitNet, price.currency) : '-'}</Td>
                    <Td minW="260px">
                      <Flex gap="8px" wrap="wrap" align="center" mb="10px">
                        {product.media?.length ? sortMediaItems(product.media).map((media) => {
                          const href = mediaHref(media);
                          return (
                            <Link
                              key={media.id}
                              href={href || undefined}
                              isExternal={Boolean(href)}
                              _hover={{ textDecoration: 'none' }}
                            >
                              <Badge colorScheme={mediaColor(media)} display="inline-flex" alignItems="center" gap="4px">
                                {media.kind === 'image' ? <Icon as={MdImage} /> : <Icon as={MdPictureAsPdf} />}
                                {mediaLabel(media)}
                                {href ? <Icon as={MdOpenInNew} /> : null}
                              </Badge>
                            </Link>
                          );
                        }) : (
                          <Text color={mutedColor} fontSize="sm">Brak załączników</Text>
                        )}
                      </Flex>

                      {product.media?.find((media) => media.kind === 'image' && (media.url || media.storagePath)) ? (
                        <Image
                          src={mediaHref(product.media.find((media) => media.kind === 'image' && (media.url || media.storagePath))!)}
                          alt={product.name}
                          boxSize="44px"
                          objectFit="contain"
                          borderRadius="8px"
                          border="1px solid"
                          borderColor={subtleBorder}
                          mb="10px"
                        />
                      ) : null}

                      <Flex gap="8px" wrap="wrap" align="center">
                        <Select
                          size="sm"
                          maxW="150px"
                          value={selectedPdfKind}
                          onChange={(event) => setSelectedPdfKind(event.target.value as ProductDocumentKind)}
                          aria-label="Typ dodawanego PDF"
                        >
                          {documentKindOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </Select>
                        <Tooltip label={`Dodaj PDF jako ${mediaKindLabels[selectedPdfKind].toLowerCase()}`}>
                          <Button
                            as="label"
                            size="sm"
                            variant="outline"
                            leftIcon={<Icon as={MdPictureAsPdf} />}
                            cursor="pointer"
                            isLoading={mediaUploading === `${product.id}:${selectedPdfKind}`}
                          >
                            PDF
                            <Input
                              type="file"
                              accept="application/pdf"
                              display="none"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = '';
                                if (file) void uploadMedia(product, file, selectedPdfKind);
                              }}
                            />
                          </Button>
                        </Tooltip>
                        <Tooltip label="Dodaj obraz produktu">
                          <Button
                            as="label"
                            aria-label="Dodaj obraz produktu"
                            size="sm"
                            variant="outline"
                            cursor="pointer"
                            minW="36px"
                            px="0"
                            isLoading={mediaUploading === `${product.id}:image`}
                          >
                            <Icon as={MdImage} />
                            <Input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              display="none"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = '';
                                if (file) void uploadMedia(product, file, 'image');
                              }}
                            />
                          </Button>
                        </Tooltip>
                      </Flex>
                    </Td>
                    <Td>
                      <Button size="sm" variant="outline" leftIcon={<Icon as={MdEdit} />} onClick={() => openEdit(product)}>
                        Edytuj
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      </Card>

      <Modal
        isOpen={Boolean(editForm)}
        onClose={closeProductModal}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent borderRadius="8px" bg={panelBg}>
          <ModalHeader color={textColor}>{productModalMode === 'edit' ? 'Edytuj produkt' : 'Nowy towar'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {productModalError ? (
              <Alert status="error" borderRadius="8px" mb="16px">
                <AlertIcon />
                <AlertDescription>{productModalError}</AlertDescription>
              </Alert>
            ) : null}
            {editForm ? (
              <Box>
                <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
                  <FormControl isRequired>
                    <FormLabel>Nazwa</FormLabel>
                    <Input value={editForm.name} onChange={(event) => updateEditField('name', event.target.value)} />
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel>Kategoria</FormLabel>
                    <Select value={editForm.category} onChange={(event) => updateEditField('category', event.target.value)}>
                      {categories.map((item) => (
                        <option key={item} value={item}>{categoryLabels[item] || item}</option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>SKU</FormLabel>
                    <Input value={editForm.sku} onChange={(event) => updateEditField('sku', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Supplier SKU</FormLabel>
                    <Input value={editForm.supplierSku} onChange={(event) => updateEditField('supplierSku', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Producent</FormLabel>
                    <Input value={editForm.producer} onChange={(event) => updateEditField('producer', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Dostawca</FormLabel>
                    <Input value={editForm.supplier} onChange={(event) => updateEditField('supplier', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>URL dostawcy</FormLabel>
                    <Input value={editForm.supplierUrl} onChange={(event) => updateEditField('supplierUrl', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Dostępność</FormLabel>
                    <Select value={editForm.availability} onChange={(event) => updateEditField('availability', event.target.value)}>
                      <option value="">Brak statusu</option>
                      {availabilityOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>Typ klienta</FormLabel>
                    <Select value={editForm.clientType} onChange={(event) => updateEditField('clientType', event.target.value)}>
                      <option value="">B2C/B2B</option>
                      {clientTypeOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>Moc / pojemność</FormLabel>
                    <Input value={editForm.powerCapacity} onChange={(event) => updateEditField('powerCapacity', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Napięcie / wariant</FormLabel>
                    <Input value={editForm.voltageKind} onChange={(event) => updateEditField('voltageKind', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Źródło</FormLabel>
                    <Input value={editForm.sourceSheet} onChange={(event) => updateEditField('sourceSheet', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Wiersz źródłowy</FormLabel>
                    <Input value={editForm.sourceRow} inputMode="numeric" onChange={(event) => updateEditField('sourceRow', event.target.value)} />
                  </FormControl>
                </SimpleGrid>

                <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px" mt="14px">
                  <FormControl>
                    <FormLabel>Opis</FormLabel>
                    <Textarea value={editForm.description} onChange={(event) => updateEditField('description', event.target.value)} minH="110px" />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Uwagi</FormLabel>
                    <Textarea value={editForm.notes} onChange={(event) => updateEditField('notes', event.target.value)} minH="110px" />
                  </FormControl>
                </SimpleGrid>

                <Divider my="22px" />

                <Text color={textColor} fontWeight="800" mb="12px">Cena</Text>
                <SimpleGrid columns={{ base: 1, md: 3 }} gap="14px">
                  <FormControl>
                    <FormLabel>Koszt netto</FormLabel>
                    <Input value={editForm.purchaseNet} inputMode="decimal" onChange={(event) => updateEditField('purchaseNet', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Aktualny koszt netto</FormLabel>
                    <Input value={editForm.currentPurchaseNet} inputMode="decimal" onChange={(event) => updateEditField('currentPurchaseNet', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Waluta</FormLabel>
                    <Input value={editForm.currency} onChange={(event) => updateEditField('currency', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>VAT zakupu (%)</FormLabel>
                    <InputGroup>
                      <Input value={editForm.purchaseVatRate} inputMode="decimal" pe="38px" onChange={(event) => updateEditField('purchaseVatRate', event.target.value)} />
                      <InputRightElement pointerEvents="none" color={mutedColor}>%</InputRightElement>
                    </InputGroup>
                  </FormControl>
                  <FormControl>
                    <FormLabel>Koszty operacyjne</FormLabel>
                    <Input value={editForm.operatingCostNet} inputMode="decimal" onChange={(event) => updateEditField('operatingCostNet', event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Marża (%)</FormLabel>
                    <InputGroup>
                      <Input value={editForm.marginRate} inputMode="decimal" pe="38px" onChange={(event) => updateEditField('marginRate', event.target.value)} />
                      <InputRightElement pointerEvents="none" color={mutedColor}>%</InputRightElement>
                    </InputGroup>
                  </FormControl>
                </SimpleGrid>

                <Divider my="22px" />

                <Text color={textColor} fontWeight="800" mb="12px">Media</Text>
                {editingProduct?.media?.length ? (
                  <Flex gap="10px" wrap="wrap">
                    {sortMediaItems(editingProduct.media).map((media, index, orderedMedia) => {
                      const href = mediaHref(media);
                      return (
                        <Flex
                          key={media.id}
                          align="center"
                          gap="8px"
                          border="1px solid"
                          borderColor={subtleBorder}
                          borderRadius="8px"
                          px="10px"
                          py="8px"
                        >
                          {media.kind === 'image' ? (
                            <Badge colorScheme={mediaColor(media)}>{mediaLabel(media)}</Badge>
                          ) : (
                            <Select
                              size="sm"
                              w="150px"
                              value={documentKindOptions.some((option) => option.value === media.kind) ? media.kind : 'document'}
                              onChange={(event) => updateMediaKind(media, event.target.value as ProductDocumentKind)}
                              isDisabled={updatingMediaKindId === media.id}
                              aria-label="Typ załącznika PDF"
                            >
                              {documentKindOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </Select>
                          )}
                          {href ? (
                            <Link href={href} isExternal color={textColor} fontSize="sm">
                              Otwórz
                            </Link>
                          ) : null}
                          <Tooltip label="Przenieś wyżej">
                            <IconButton
                              aria-label="Przenieś załącznik wyżej"
                              icon={<Icon as={MdArrowUpward} />}
                              size="sm"
                              variant="ghost"
                              isDisabled={index === 0}
                              isLoading={sortingMediaId === media.id}
                              onClick={() => moveMedia(media, -1)}
                            />
                          </Tooltip>
                          <Tooltip label="Przenieś niżej">
                            <IconButton
                              aria-label="Przenieś załącznik niżej"
                              icon={<Icon as={MdArrowDownward} />}
                              size="sm"
                              variant="ghost"
                              isDisabled={index === orderedMedia.length - 1}
                              isLoading={sortingMediaId === media.id}
                              onClick={() => moveMedia(media, 1)}
                            />
                          </Tooltip>
                          <Tooltip label="Usuń załącznik">
                            <IconButton
                              aria-label="Usuń załącznik"
                              icon={<Icon as={MdDelete} />}
                              size="sm"
                              variant="ghost"
                              colorScheme="red"
                              isLoading={deletingMediaId === media.id}
                              onClick={() => deleteMedia(media)}
                            />
                          </Tooltip>
                        </Flex>
                      );
                    })}
                  </Flex>
                ) : (
                  <Text color={mutedColor} fontSize="sm">Brak załączników</Text>
                )}
              </Box>
            ) : null}
          </ModalBody>
          <ModalFooter gap="10px">
            <Button
              variant="ghost"
              onClick={closeProductModal}
            >
              Anuluj
            </Button>
            <Button colorScheme="blue" leftIcon={<Icon as={MdSave} />} isLoading={savingProduct} onClick={saveProduct}>
              {productModalMode === 'edit' ? 'Zapisz' : 'Dodaj towar'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Flex>
  );
}
