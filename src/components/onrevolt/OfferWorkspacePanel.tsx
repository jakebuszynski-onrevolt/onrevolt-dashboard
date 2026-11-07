'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  IconButton,
  Progress,
  Select,
  Spinner,
  Text,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import {
  defaultOfferCalculationAssumptions,
  emptyOfferWorkspaceDraft,
  parseOfferWorkspaceDraft,
  offerWorkspaceDraftWithBatteryPresence,
  createOfferWorkspacePricingSnapshot,
  offerWorkspacePricingFreshness,
  type OfferWorkspaceDraft,
  type OfferWorkspacePricingFreshness,
  type OfferWorkspacePricingSnapshot,
  type OfferWorkspaceStep,
  type SavedOfferWorkspaceDraft,
} from 'lib/onrevolt/offer-workspace';
import { configurationInvestmentScope } from 'lib/onrevolt/configuration-templates';
import { priceOfferWorkspaceConfiguration, type OfferWorkspacePricingResult } from 'lib/onrevolt/offer-workspace-pricing';
import { applyOfferWorkspaceConfigurationEdits } from 'lib/onrevolt/offer-workspace-configuration-edits';
import { usePublishOfferMargin } from 'contexts/OfferMarginStore';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import { recommendationInputIssues } from 'lib/onrevolt/offer-workspace-recommendation-inputs';
import { tariffToday, type ClientTariffData, type ClientTariffPayload } from 'lib/onrevolt/client-tariffs';
import { offerTariffCatalogKey, resolveCurrentOfferTariff, type OfferTariffRateState } from 'lib/onrevolt/offer-workspace-tariffs';
import OfferWorkspaceConfiguration from './OfferWorkspaceConfiguration';
import type { OfferWorkspaceCalculationMode } from './OfferWorkspaceCalculationControls';
import type { OfferWorkspaceEnergy } from 'lib/onrevolt/offer-workspace-energy';
import { overlayOfferWorkspaceMeasurements } from 'lib/onrevolt/offer-workspace-energy';
import type { OfferWorkspaceMeasurements } from 'lib/onrevolt/offer-workspace-server';
import type { OfferWorkspaceValuation } from 'lib/onrevolt/offer-workspace-valuation';
import { OfferDescriptionScreen, OfferSavingsScreen, OfferSummaryScreen, OfferSystemScreen } from './OfferWorkspaceScreens';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdArrowBack,
  MdArrowForward,
  MdDescription,
  MdOutlineAccountBalance,
  MdOutlineBatteryChargingFull,
  MdOutlineFactCheck,
  MdOutlineInfo,
  MdOutlineSavings,
  MdSave,
  MdDownload,
} from 'react-icons/md';

type Props = { projectId: string; actorId?: string; onBack?: () => void; canEdit: boolean; templatePreview?: boolean };

type WorkspaceTemplateItem = {
  id: string;
  position: number;
  description: string | null;
  quantity: number;
  role: string;
  supplyMode: string;
  pricingMode?: 'LEGACY' | 'CATALOG' | 'INDIVIDUAL';
  operatingCostBasis?: 'PER_LINE' | 'PER_UNIT';
  catalogPriceId?: string | null;
  unitSaleNet?: number | null;
  unitPurchaseNet: number | null;
  purchaseVatRate: number | null;
  operatingCostNet: number | null;
  marginRate: number | null;
  saleVatRate: number | null;
  isOptional: boolean;
  requiresReview: boolean;
  product: null | {
    id: string;
    name: string;
    sku: string | null;
    legacySku: string | null;
    category: string;
    producer: string | null;
    availability: string | null;
    powerCapacity: string | null;
    prices: Array<{
      id?: string;
      purchaseNet: number;
      currentPurchaseNet: number | null;
      purchaseVatRate: number;
      operatingCostNet: number;
      marginRate: number;
      saleVatRate: number | null;
      currency: string;
      validFrom: string;
    }>;
  };
};

export type WorkspaceTemplate = {
  id: string;
  familyKey: string;
  name: string;
  version: number;
  kind: string;
  clientType: string;
  roofType: string | null;
  goal: string | null;
  powerKw: number | null;
  capacityKwh: number | null;
  sortOrder: number;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  notes: string | null;
  items: WorkspaceTemplateItem[];
};

export type WorkspaceData = {
  canEditConfigurationItems?: boolean;
  viewerId?: string;
  documentRevision?: number;
  valuation?: OfferWorkspaceValuation | null;
  valuationLoading?: boolean;
  valuationError?: string;
  energy?: OfferWorkspaceEnergy | null;
  energyLoading?: boolean;
  energyError?: string;
  projectId: string;
  clientId: string;
  projectName: string;
  clientName: string;
  clientType: string;
  ppeNumber: string | null;
  revision: string;
  input: {
    reportDetails?: {
      email: string | null; phone: string | null;
      terrain: string | null; buildingType: string | null; roofType: string | null;
      connectionType: string | null; connectionPowerKw: number | null;
      heatingSource: string | null; heatingDetails: string | null; supplier: string | null;
    };
    existingPv: { powerKw: number | null; tiltDegrees: number | null; azimuthDegrees: number | null } | null;
    existingBatteryKwh: number | null;
    existingBatteryPresent: boolean | null;
    location: { address: string | null; latitude: number | null; longitude: number | null } | null;
    settlementMode: string | null;
    annualConsumptionKwh: number | null;
    issues: string[];
  };
  measurements: OfferWorkspaceMeasurements;
  templates: WorkspaceTemplate[];
  draft: SavedOfferWorkspaceDraft | null;
};

export type TariffData = Pick<ClientTariffData, 'profile' | 'generalTariff' | 'targetTariff' | 'catalog' | 'resolved'>;

type LocalDraftCache = {
  expectedRevision: number;
  sourceRevision?: string;
  input: OfferWorkspaceDraft;
};

type DraftConflict = 'draft' | 'unknown' | null;

export function resolveCachedOfferDraft(
  serverDraft: OfferWorkspaceDraft,
  _sourceRevision: string,
  serverRevision: number,
  cached: LocalDraftCache | null,
) {
  if (!cached) return { input: serverDraft, dirty: false, expectedRevision: serverRevision, conflict: null as DraftConflict };
  if (!Number.isSafeInteger(cached.expectedRevision) || cached.expectedRevision < 0) {
    throw new Error('Nieprawidłowa wersja lokalnego szkicu.');
  }
  const input = offerWorkspaceDraftWithBatteryPresence(
    parseOfferWorkspaceDraft(cached.input), serverDraft.existingBatteryPresent ?? null,
  );
  const content = ({ step: _step, ...value }: OfferWorkspaceDraft) => JSON.stringify(value);
  if (content(input) === content(serverDraft)) {
    return { input: { ...serverDraft, step: input.step }, dirty: false, expectedRevision: serverRevision, conflict: null as DraftConflict };
  }
  const conflict: DraftConflict = cached.expectedRevision !== serverRevision ? 'draft' : null;
  return { input, dirty: true, expectedRevision: cached.expectedRevision, conflict };
}

function draftConflictMessage(kind: DraftConflict) {
  if (kind === 'draft') return 'Na serwerze zapisano inną wersję szkicu. Twoje lokalne zmiany zostały zachowane i nie nadpiszą jej automatycznie. Możesz wyeksportować je do JSON lub wczytać zapisany szkic.';
  return 'Dane projektu lub szkicu zmieniły się na serwerze. Twoje zmiany zostały zachowane. Odśwież dane, aby sprawdzić aktualną wersję przed kolejnym zapisem.';
}

const steps: Array<{ id: OfferWorkspaceStep; title: string; subtitle: string; icon: typeof MdOutlineAccountBalance }> = [
  { id: 'SYSTEM', title: 'System rozliczeń', subtitle: 'Taryfa i ceny energii', icon: MdOutlineAccountBalance },
  { id: 'CONFIGURATION', title: 'Konfiguracja', subtitle: 'System i finansowanie', icon: MdOutlineBatteryChargingFull },
  { id: 'SAVINGS', title: 'Oszczędność', subtitle: 'Symulacja z systemem', icon: MdOutlineSavings },
  { id: 'DESCRIPTION', title: 'Opis', subtitle: 'Szczegóły oferty', icon: MdDescription },
  { id: 'SUMMARY', title: 'Podsumowanie', subtitle: 'Wyniki i dokumenty', icon: MdOutlineFactCheck },
];

function parseEnvelope<T>(payload: unknown, response: Response): T {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (!response.ok || body.ok !== true || !body.data) {
    const error = new Error(typeof body.error === 'string' ? body.error : `Błąd żądania (${response.status})`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body.data as T;
}

type OfferWorkspaceCalculationJob = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  completed: number;
  total: number;
  data?: OfferWorkspaceCalculation;
  error?: string;
  stale?: boolean;
  blockedReasons?: string[];
};

export type OfferWorkspaceCalculationPanelState = {
  key: string;
  projectId: string;
  data: OfferWorkspaceCalculation | null;
  jobId: string | null;
  loading: boolean;
  mode: OfferWorkspaceCalculationMode | null;
  error: string;
  completed: number;
  total: number;
};

export function beginOfferWorkspaceCalculationState(
  current: OfferWorkspaceCalculationPanelState,
  key: string,
  projectId: string,
  mode: OfferWorkspaceCalculationMode,
  continueFromJobId?: string,
): OfferWorkspaceCalculationPanelState {
  const continuing = Boolean(continueFromJobId && current.jobId === continueFromJobId
    && current.data?.recommendationSearch?.hasMore === true);
  return {
    ...current,
    key, projectId,
    data: continuing ? current.data : null,
    jobId: continuing ? current.jobId : null,
    loading: true,
    mode,
    error: '',
    completed: continuing ? current.completed : 0,
    total: continuing ? current.total : 0,
  };
}

export function failOfferWorkspaceCalculationState(
  current: OfferWorkspaceCalculationPanelState,
  options: { key: string; error: string; continueFromJobId?: string; resultMatchesDraft: boolean; staleContinuation: boolean },
): OfferWorkspaceCalculationPanelState {
  const keepPrevious = Boolean(options.continueFromJobId && options.resultMatchesDraft);
  return {
    ...current,
    key: options.key,
    data: keepPrevious ? current.data : null,
    jobId: keepPrevious && !options.staleContinuation ? current.jobId : null,
    loading: false,
    mode: null,
    error: options.resultMatchesDraft ? options.error : '',
  };
}

export function staleOfferWorkspaceCalculationState(
  current: OfferWorkspaceCalculationPanelState,
  key: string,
): OfferWorkspaceCalculationPanelState {
  return { ...current, key, data: null, jobId: null, error: '' };
}

export function offerWorkspaceCalculationRestoreOrder(draft: OfferWorkspaceDraft): Array<'selected' | 'recommend'> {
  if (draft.commercialPricing) return ['selected'];
  if (draft.configurationEdits?.length) return ['selected'];
  const order: Array<'selected' | 'recommend'> = draft.selectedTemplateIds.length
    ? ['selected', 'recommend']
    : ['recommend', 'selected'];
  return recommendationInputIssues(draft).length ? order.filter((mode) => mode !== 'recommend') : order;
}

export function parseCalculationJob(payload: unknown, response: Response): OfferWorkspaceCalculationJob {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const job = body.job && typeof body.job === 'object' ? body.job as Record<string, unknown> : null;
  const errorMessage = typeof body.error === 'string' ? body.error : `Błąd żądania (${response.status})`;
  const blockedReasons = job?.blockedReasons;
  const invalidBlockedReasons = blockedReasons !== undefined
    && (!Array.isArray(blockedReasons) || !blockedReasons.every((reason) => typeof reason === 'string'));
  if (!response.ok || body.ok !== true || !job
    || typeof job.id !== 'string'
    || !['running', 'completed', 'failed'].includes(String(job.status))
    || typeof job.completed !== 'number' || !Number.isFinite(job.completed)
    || typeof job.total !== 'number' || !Number.isFinite(job.total)
    || (job.stale !== undefined && typeof job.stale !== 'boolean')
    || invalidBlockedReasons) {
    const error = new Error(errorMessage);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return job as OfferWorkspaceCalculationJob;
}

export function offerWorkspaceCalculationStaleMessage(blockedReasons?: string[]) {
  const reasons = [...new Set((blockedReasons || []).map((reason) => reason.trim()).filter(Boolean))].slice(0, 5);
  return reasons.length
    ? `Wynik kalkulacji jest nieaktualny i został pominięty. Ostatnia próba była zablokowana: ${reasons.join(' ')}`
    : 'Wynik kalkulacji jest nieaktualny i został pominięty. Uruchom obliczenie ręcznie, aby uzyskać aktualny wynik.';
}

function waitForCalculationPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000));
}

function parseSettlement(value: string | null | undefined): OfferWorkspaceDraft['currentSettlement'] {
  const normalized = value?.trim().toUpperCase().replace(/[- ]/g, '_');
  if (normalized === 'NET_METERING' || normalized === 'NETMETERING') return 'NET_METERING';
  if (normalized === 'NET_BILLING' || normalized === 'NETBILLING') return 'NET_BILLING';
  return null;
}

function todayWarsaw() {
  return tariffToday();
}

function currentTariffLabel(data: TariffData | null) {
  if (!data) return null;
  const date = todayWarsaw();
  const period = data.profile?.periods.find((item) => (!item.validFrom || item.validFrom <= date) && (!item.validUntil || item.validUntil > date));
  if (period) {
    const osd = data.catalog.find((item) => item.id === period.osdId);
    const tariff = osd?.tariffs.find((item) => item.id === period.tariffId);
    return {
      label: `${osd?.name || 'Operator'} · ${tariff?.code || tariff?.name || 'Taryfa przypisana'}`,
      source: period.source === 'ENEA' ? 'Metadane ENEA' : 'Historia taryf CRM',
    };
  }
  if (data.generalTariff?.code || data.generalTariff?.operator) {
    return {
      label: [data.generalTariff.operator, data.generalTariff.code].filter(Boolean).join(' · '),
      source: 'Bieżący wybór w CRM / RE',
    };
  }
  return { label: 'Nie wybrano taryfy', source: 'Brak potwierdzonych danych' };
}

function initialDraft(workspace: WorkspaceData, tariffs: TariffData | null): OfferWorkspaceDraft {
  const actualSettlement = parseSettlement(workspace.input.settlementMode);
  if (workspace.draft) {
    return offerWorkspaceDraftWithBatteryPresence(
      parseOfferWorkspaceDraft(workspace.draft.input), workspace.input.existingBatteryPresent ?? null,
    );
  }
  const input = emptyOfferWorkspaceDraft();
  input.existingBatteryPresent = workspace.input.existingBatteryPresent ?? null;
  input.existingPv = {
    powerKw: workspace.input.existingPv?.powerKw ?? null,
    tiltDegrees: workspace.input.existingPv?.tiltDegrees ?? null,
    azimuthDegrees: workspace.input.existingPv?.azimuthDegrees ?? null,
    lossPercent: null,
  };
  input.currentSettlement = actualSettlement;
  input.targetSettlement = actualSettlement;
  const targetOsdId = tariffs?.targetTariff?.osdId ?? null;
  const targetTariffId = tariffs?.targetTariff?.tariffId ?? null;
  if (targetOsdId != null && targetTariffId != null) {
    input.targetOperatorId = targetOsdId;
    input.targetTariffId = targetTariffId;
  }
  return input;
}

export function resolveDraftAfterSave<T>(
  submittedEditSequence: number,
  currentEditSequence: number,
  currentDraft: T | null,
  serverDraft: T,
): { draft: T; hasNewerEdits: boolean } {
  if (submittedEditSequence === currentEditSequence) return { draft: serverDraft, hasNewerEdits: false };
  return { draft: currentDraft ?? serverDraft, hasNewerEdits: true };
}

export function offerWorkspaceStorageKey(actorId: string | undefined, projectId: string): string | null {
  return actorId ? `onrevolt:offer-workspace:${encodeURIComponent(actorId)}:${encodeURIComponent(projectId)}` : null;
}

export function monthlyMeasurementBarHeight(value: number | null, maxValue: number): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  if (value === 0 || maxValue <= 0) return 2;
  return Math.max(2, Math.min(54, (value / maxValue) * 54));
}

export function monthlyMeasurementValueLabel(value: number | null): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value);
}

export function offerWorkspaceCalculationInputKey(draft: OfferWorkspaceDraft): string {
  return JSON.stringify({
    objective: draft.objective,
    existingBatteryPresent: draft.existingBatteryPresent ?? null,
    existingPv: draft.existingPv,
    pvStrategy: draft.pvStrategy,
    currentSettlement: draft.currentSettlement,
    targetSettlement: draft.targetSettlement,
    targetOperatorId: draft.targetOperatorId,
    targetTariffId: draft.targetTariffId,
    saleVatMode: draft.saleVatMode,
    selectedTemplateIds: draft.selectedTemplateIds,
    configurationEdits: draft.configurationEdits || [],
    commercialPricing: draft.commercialPricing ?? null,
    financing: draft.financing,
    calculation: draft.calculation ?? defaultOfferCalculationAssumptions(),
  });
}

export function offerWorkspaceCalculationPreflightError(
  draft: OfferWorkspaceDraft,
  mode: OfferWorkspaceCalculationMode = 'selected',
): string | null {
  if (!draft.targetOperatorId || !draft.targetTariffId) return 'Wybierz operatora i taryfę scenariusza w kroku System rozliczeń.';
  if (mode === 'recommend') {
    const issues = recommendationInputIssues(draft);
    if (issues.length) return issues.map((issue) => issue.message).join(' ');
  }
  return null;
}

export function offerWorkspaceDraftWithRanking(
  draft: OfferWorkspaceDraft,
  templates: Array<{ id: string; kind: string }>,
  templateIds: string[],
): OfferWorkspaceDraft {
  const hasPv = templateIds.some((id) => configurationInvestmentScope(templates.find((template) => template.id === id)?.kind || '') === 'PV');
  return {
    ...draft,
    selectedTemplateIds: [...templateIds],
    ...(draft.configurationEdits ? { configurationEdits: [] } : {}),
    commercialPricing: undefined,
    pvStrategy: hasPv ? 'ADD_TEMPLATE' : 'KEEP_EXISTING',
  };
}

export function isCurrentOfferWorkspaceCalculationRequest(
  signal: AbortSignal,
  requestKey: string,
  currentKey: string,
  requestId: number,
  activeRequestId: number,
): boolean {
  return !signal.aborted && requestKey === currentKey && requestId === activeRequestId;
}

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return 'Brak danych';
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(value);
}

function formatOfferPrice(value: number | null) {
  return value == null ? 'Brak wartości' : `${new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} zł`;
}

function templateKindLabel(kind: string) {
  if (kind.includes('PV')) return 'Fotowoltaika';
  if (kind === 'MAGAZYN') return 'Magazyn energii';
  if (kind === 'EMS') return 'EMS';
  return kind.replaceAll('_', ' ').toLocaleLowerCase('pl-PL');
}

function settlementLabel(value: OfferWorkspaceDraft['currentSettlement']) {
  if (value === 'NET_METERING') return 'Net-metering';
  if (value === 'NET_BILLING') return 'Net-billing';
  return 'Nieustalone';
}

function templateSummary(template: WorkspaceTemplate) {
  const details = [
    template.powerKw != null ? `${formatNumber(template.powerKw)} kWp` : null,
    template.capacityKwh != null ? `${formatNumber(template.capacityKwh)} kWh` : null,
  ].filter(Boolean);
  return details.join(' · ') || template.goal?.replaceAll('_', ' ') || 'Parametry nieuzupełnione';
}

export default function OfferWorkspacePanel({ projectId, actorId, onBack, canEdit, templatePreview = false }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [tariffs, setTariffs] = useState<TariffData | null>(null);
  const [draft, setDraft] = useState<OfferWorkspaceDraft | null>(null);
  const [itemPricingPreview, setItemPricingPreview] = useState<{ projectId: string; pricing: OfferWorkspacePricingResult | null } | null>(null);
  const itemEditsPendingRef = useRef(false);
  const itemEditsPending = itemPricingPreview?.projectId === projectId;
  const updatePricingPreview = useCallback((pricing: OfferWorkspacePricingResult | null, active: boolean) => {
    itemEditsPendingRef.current = active;
    setItemPricingPreview(active ? { projectId, pricing } : null);
  }, [projectId]);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [acknowledgedPricingRevision, setAcknowledgedPricingRevision] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conflictKind, setConflictKind] = useState<DraftConflict>(null);
  const conflict = conflictKind !== null;
  const [error, setError] = useState('');
  const [tariffError, setTariffError] = useState('');
  const [tariffsLoaded, setTariffsLoaded] = useState(false);
  const [tariffCatalogRates, setTariffCatalogRates] = useState<Record<string, OfferTariffRateState>>({});
  const [status, setStatus] = useState('');
  const [energyState, setEnergyState] = useState<{ key: string; data: OfferWorkspaceEnergy | null; loading: boolean; error: string }>({ key: '', data: null, loading: false, error: '' });
  const [valuationState, setValuationState] = useState<{ key: string; data: OfferWorkspaceValuation | null; loading: boolean; error: string }>({ key: '', data: null, loading: false, error: '' });
  const generation = useRef(0);
  const editSequence = useRef(0);
  const latestDraft = useRef<OfferWorkspaceDraft | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const calculationRequestId = useRef(0);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [calculationState, setCalculationState] = useState<OfferWorkspaceCalculationPanelState>({
    key: '', projectId: '', data: null, jobId: null, loading: false, mode: null, error: '', completed: 0, total: 0,
  });

  const background = useColorModeValue('white', 'navy.800');
  const softBackground = useColorModeValue('secondaryGray.50', 'whiteAlpha.50');
  const selectedBackground = useColorModeValue('#f1f0f8', 'whiteAlpha.100');
  const text = useColorModeValue('navy.700', 'white');
  const muted = useColorModeValue('secondaryGray.600', 'secondaryGray.300');
  const border = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const step = draft?.step || 'SYSTEM';
  const stepIndex = steps.findIndex((item) => item.id === step);
  const currentIndex = Math.max(0, stepIndex);
  const tariffLabel = useMemo(() => currentTariffLabel(tariffs), [tariffs]);
  const tariffRateDate = todayWarsaw();
  const currentRateResolution = useMemo(() => resolveCurrentOfferTariff(
    tariffs?.profile ? { periods: tariffs.profile.periods, resolved: tariffs.resolved } : null,
    tariffRateDate,
  ), [tariffs, tariffRateDate]);
  const currentGeneralTariff = !currentRateResolution.hasHistory ? tariffs?.generalTariff : null;
  const currentCatalogKey = offerTariffCatalogKey(currentGeneralTariff?.osdId, currentGeneralTariff?.tariffId, tariffRateDate);
  const targetCatalogKey = offerTariffCatalogKey(draft?.targetOperatorId, draft?.targetTariffId, tariffRateDate);
  const catalogLoadState: OfferTariffRateState = !tariffsLoaded
    ? tariffError
      ? { status: 'unavailable', message: tariffError }
      : { status: 'loading' }
    : { status: 'loading' };
  const currentTariffRates = !tariffsLoaded
    ? catalogLoadState
    : currentRateResolution.hasHistory
      ? currentRateResolution.state
      : currentCatalogKey
        ? tariffCatalogRates[currentCatalogKey] || { status: 'loading' as const }
        : currentRateResolution.state;
  const targetTariffRates = targetCatalogKey
    ? tariffsLoaded
      ? tariffCatalogRates[targetCatalogKey] || { status: 'loading' as const }
      : catalogLoadState
    : { status: 'unavailable' as const, message: 'Wybierz operatora i taryfę docelową.' };
  const storageKey = offerWorkspaceStorageKey(actorId, projectId);
  const energyKey = workspace && draft ? JSON.stringify({ projectId, sourceRevision: workspace.revision, existingPv: draft.existingPv, existingBatteryPresent: workspace.input.existingBatteryPresent ?? null, pvReconstructionAccepted: draft.calculation?.pvReconstructionAccepted === true }) : '';
  const valuationKey = workspace && draft ? JSON.stringify({ projectId, sourceRevision: workspace.revision,
    currentSettlement: parseSettlement(workspace.input.settlementMode), targetSettlement: draft.targetSettlement,
    targetOperatorId: draft.targetOperatorId, targetTariffId: draft.targetTariffId, pricesAsOf: tariffRateDate }) : '';
  const calculationKey = workspace && draft
    ? JSON.stringify([projectId, workspace.revision, tariffRateDate, offerWorkspaceCalculationInputKey(draft)])
    : '';
  const calculationKeyRef = useRef(calculationKey);
  calculationKeyRef.current = calculationKey;
  useEffect(() => {
    if (!energyKey || templatePreview) return;
    const request = JSON.parse(energyKey);
    const controller = new AbortController();
    setEnergyState({ key: energyKey, data: null, loading: true, error: '' });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(request.projectId)}/offer-workspace/energy`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ sourceRevision: request.sourceRevision, draft: { ...emptyOfferWorkspaceDraft(), existingPv: request.existingPv, existingBatteryPresent: request.existingBatteryPresent,
            calculation: { ...defaultOfferCalculationAssumptions(), pvReconstructionAccepted: request.pvReconstructionAccepted } } }),
        });
        const data = parseEnvelope<OfferWorkspaceEnergy>(await response.json(), response);
        if (!controller.signal.aborted) setEnergyState({ key: energyKey, data, loading: false, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setEnergyState({ key: energyKey, data: null, loading: false, error: error instanceof Error ? error.message : 'Nie udało się obliczyć energii.' });
      }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [energyKey, templatePreview]);

  useEffect(() => {
    if (!valuationKey || templatePreview) return;
    const request = JSON.parse(valuationKey);
    const controller = new AbortController();
    setValuationState({ key: valuationKey, data: null, loading: true, error: '' });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(request.projectId)}/offer-workspace/valuation`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ sourceRevision: request.sourceRevision, draft: { ...emptyOfferWorkspaceDraft(),
            currentSettlement: request.currentSettlement, targetSettlement: request.targetSettlement,
            targetOperatorId: request.targetOperatorId, targetTariffId: request.targetTariffId } }),
        });
        const data = parseEnvelope<OfferWorkspaceValuation>(await response.json(), response);
        if (!controller.signal.aborted) setValuationState({ key: valuationKey, data, loading: false, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setValuationState({ key: valuationKey, data: null, loading: false,
          error: cause instanceof Error ? cause.message : 'Nie udało się wycenić energii.' });
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [valuationKey, templatePreview]);

  useEffect(() => {
    setCalculationState((current) => staleOfferWorkspaceCalculationState(current, calculationKey));
    if (!calculationKey || !workspace || !draft || templatePreview) return;
    const controller = new AbortController();
    const requestId = calculationRequestId.current;
    const key = calculationKey;
    const timer = setTimeout(async () => {
      try {
        // Prefer the exact selected result when the draft has a selection.
        // With no selection, restore the ranking first so its continuation button survives reload.
        for (const mode of offerWorkspaceCalculationRestoreOrder(draft)) {
          const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/offer-workspace/calculate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ sourceRevision: workspace.revision, draft, mode, cacheOnly: true }),
          });
          const payload = await response.json();
          if (response.ok && payload.ok === true && payload.cached === false && payload.job === null) continue;
          const job = parseCalculationJob(payload, response);
          if (!isCurrentOfferWorkspaceCalculationRequest(controller.signal, key, calculationKeyRef.current, requestId, calculationRequestId.current)) return;
          if (job.status !== 'completed' || !job.data || job.stale) return;
          setCalculationState(current => current.loading ? current : {
            key, projectId, data: job.data!, jobId: job.id, loading: false, mode: null, error: '', completed: job.completed, total: job.total,
          });
          return;
        }
      } catch (cause) {
        if (!isCurrentOfferWorkspaceCalculationRequest(controller.signal, key, calculationKeyRef.current, requestId, calculationRequestId.current)) return;
        setCalculationState(current => current.loading ? current : {
          ...current, error: cause instanceof Error ? cause.message : 'Nie udało się odczytać zapisanej kalkulacji.',
        });
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [calculationKey, templatePreview]);

  const tariffCatalogRequests = useMemo(() => {
    const requests = new Map<string, { osdId: number; tariffId: number }>();
    if (!currentRateResolution.hasHistory && currentCatalogKey && currentGeneralTariff?.osdId && currentGeneralTariff.tariffId) {
      requests.set(currentCatalogKey, { osdId: currentGeneralTariff.osdId, tariffId: currentGeneralTariff.tariffId });
    }
    if (targetCatalogKey && draft?.targetOperatorId && draft.targetTariffId) {
      requests.set(targetCatalogKey, { osdId: draft.targetOperatorId, tariffId: draft.targetTariffId });
    }
    return Array.from(requests, ([key, selection]) => ({ key, ...selection }));
  }, [currentRateResolution.hasHistory, currentCatalogKey, currentGeneralTariff?.osdId, currentGeneralTariff?.tariffId,
    targetCatalogKey, draft?.targetOperatorId, draft?.targetTariffId]);

  useEffect(() => {
    if (!workspace || !tariffsLoaded || tariffCatalogRequests.length === 0) {
      setTariffCatalogRates({});
      return;
    }
    const controller = new AbortController();
    setTariffCatalogRates(Object.fromEntries(tariffCatalogRequests.map(({ key }) => [key, { status: 'loading' as const }])));
    void Promise.all(tariffCatalogRequests.map(async ({ key, osdId, tariffId }) => {
      try {
        const params = new URLSearchParams({
          clientId: workspace.clientId,
          projectId,
          action: 'catalog',
          osdId: String(osdId),
          tariffId: String(tariffId),
          date: tariffRateDate,
        });
        const response = await fetch(`/api/crm/projects/tariffs?${params}`, { cache: 'no-store', signal: controller.signal });
        const tariff = parseEnvelope<ClientTariffPayload>(await response.json(), response);
        return [key, { status: 'ready', tariff } satisfies OfferTariffRateState] as const;
      } catch (cause) {
        if (controller.signal.aborted) return null;
        return [key, {
          status: 'unavailable',
          message: cause instanceof Error ? cause.message : 'Nie udało się odczytać cen katalogowych.',
        } satisfies OfferTariffRateState] as const;
      }
    })).then((results) => {
      if (controller.signal.aborted) return;
      setTariffCatalogRates(Object.fromEntries(results.filter((item): item is NonNullable<typeof item> => item !== null)));
    });
    return () => controller.abort();
  }, [workspace, tariffsLoaded, projectId, tariffRateDate, tariffCatalogRequests]);

  const load = useCallback(async (signal: AbortSignal, requestGeneration: number, ignoreLocalCache = false, clearLocalCacheAfterLoad = false, refreshLocalDraft?: LocalDraftCache): Promise<boolean> => {
    if (itemEditsPendingRef.current) return false;
    setLoading(true);
    setError('');
    setTariffError('');
    setTariffsLoaded(false);
    setTariffs(null);
    setTariffCatalogRates({});
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/offer-workspace`, { cache: 'no-store', signal });
      const data = parseEnvelope<WorkspaceData>(await response.json(), response);
      let tariffData: TariffData | null = null;
      let tariffLoadError = '';
      try {
        const params = new URLSearchParams({ clientId: data.clientId, projectId });
        const tariffResponse = await fetch(`/api/crm/projects/tariffs?${params}`, { cache: 'no-store', signal });
        tariffData = parseEnvelope<TariffData>(await tariffResponse.json(), tariffResponse);
      } catch (cause) {
        if (signal.aborted) return false;
        tariffLoadError = cause instanceof Error ? cause.message : 'Nie udało się odczytać taryf.';
      }
      if (signal.aborted || generation.current !== requestGeneration || itemEditsPendingRef.current) return false;

      if (clearLocalCacheAfterLoad && storageKey) window.sessionStorage.removeItem(storageKey);

      const serverDraft = initialDraft(data, tariffData);
      let nextDraft = serverDraft;
      let nextDirty = false;
      let nextConflict: DraftConflict = null;
      let nextExpectedRevision = data.draft?.revision || 0;
      try {
        const cachedText = !ignoreLocalCache && storageKey ? window.sessionStorage.getItem(storageKey) : null;
        if (refreshLocalDraft || cachedText) {
          let cached = refreshLocalDraft || JSON.parse(cachedText!) as LocalDraftCache;
          if (data.canEditConfigurationItems !== true) cached = { ...cached, input: { ...cached.input,
            configurationEdits: serverDraft.configurationEdits } };
          const resolved = resolveCachedOfferDraft(serverDraft, data.revision, data.draft?.revision || 0, cached);
          nextDraft = resolved.input;
          nextDirty = resolved.dirty;
          nextExpectedRevision = resolved.expectedRevision;
          nextConflict = resolved.conflict;
          if (!nextDirty && storageKey) window.sessionStorage.removeItem(storageKey);
        }
      } catch {
        if (storageKey) window.sessionStorage.removeItem(storageKey);
      }

      setWorkspace(data);
      setTariffs(tariffData);
      setTariffError(tariffLoadError);
      setTariffsLoaded(!tariffLoadError);
      setDraft(nextDraft);
      latestDraft.current = nextDraft;
      editSequence.current = 0;
      setExpectedRevision(nextExpectedRevision);
      setDirty(nextDirty);
      setConflictKind(nextConflict);
      if (nextConflict) setError(draftConflictMessage(nextConflict));
      setStatus(nextDirty ? (nextConflict ? '' : 'Szkic lokalny przywrócony') : data.draft ? 'Zapisany szkic' : 'Nowy szkic');
      return true;
    } catch (cause) {
      if (!signal.aborted && generation.current === requestGeneration) {
        setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać workspace oferty.');
      }
      return false;
    } finally {
      if (!signal.aborted && generation.current === requestGeneration) setLoading(false);
    }
  }, [projectId, storageKey]);

  useEffect(() => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    const controller = new AbortController();
    saveAbort.current?.abort();
    setWorkspace(null);
    setTariffs(null);
    setTariffsLoaded(false);
    setTariffCatalogRates({});
    setDraft(null);
    itemEditsPendingRef.current = false;
    setItemPricingPreview(null);
    latestDraft.current = null;
    editSequence.current = 0;
    setExpectedRevision(0);
    setDirty(false);
    setConflictKind(null);
    setLoading(true);
    setError('');
    setStatus('');
    void load(controller.signal, requestGeneration);
    return () => {
      controller.abort();
      if (generation.current === requestGeneration) generation.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!itemEditsPending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [itemEditsPending]);

  useEffect(() => {
    if (!draft || !workspace || !dirty || !storageKey || conflict) return;
    const cached: LocalDraftCache = { expectedRevision, input: draft };
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(cached));
    } catch {
      setStatus('Zmiany są tylko w bieżącej karcie przeglądarki');
    }
  }, [draft, dirty, expectedRevision, storageKey, workspace, conflict]);

  const updateDraft = useCallback((update: Partial<OfferWorkspaceDraft> | ((value: OfferWorkspaceDraft) => OfferWorkspaceDraft)) => {
    if (!canEdit || conflict) return;
    editSequence.current += 1;
    setDraft((current) => {
      if (!current) return current;
      const next = typeof update === 'function' ? update(current) : { ...current, ...update };
      latestDraft.current = next;
      return next;
    });
    setDirty(true);
    setStatus('Niezapisane zmiany');
  }, [canEdit, conflict]);

  async function calculateOffer(mode: OfferWorkspaceCalculationMode, continueRecommendation?: true) {
    const continueFromJobId = continueRecommendation ? calculationState.jobId ?? undefined : undefined;
    if (!workspace || !draft || !canEdit || conflict || templatePreview || calculationState.loading || itemEditsPendingRef.current) return;
    if (continueRecommendation && (!continueFromJobId || calculationState.key !== calculationKeyRef.current
      || calculationState.projectId !== projectId || mode !== 'recommend'
      || !calculationState.data?.recommendationSearch?.hasMore)) return;
    const preflightError = offerWorkspaceCalculationPreflightError(draft, mode);
    if (preflightError) {
      setCalculationState((current) => ({ ...current, key: calculationKeyRef.current, data: null, loading: false, mode: null, error: preflightError }));
      return;
    }
    const controller = new AbortController();
    const requestId = ++calculationRequestId.current;
    const requestKey = calculationKeyRef.current;
    const projectAtStart = projectId;
    setCalculationState((current) => beginOfferWorkspaceCalculationState(
      current, requestKey, projectAtStart, mode, continueFromJobId,
    ));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/offer-workspace/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          draft: {
            ...parseOfferWorkspaceDraft(draft),
            calculation: draft.calculation ?? defaultOfferCalculationAssumptions(),
          },
          sourceRevision: workspace.revision,
          mode,
          ...(continueFromJobId ? { continueFromJobId } : {}),
        }),
      });
      let job = parseCalculationJob(await response.json(), response);
      // Keep polling the server-owned job when the draft changes; aborting fetch does not stop its worker.
      while (job.status === 'running') {
        if (controller.signal.aborted || requestId !== calculationRequestId.current) return;
        if (job.stale) throw Object.assign(new Error(offerWorkspaceCalculationStaleMessage(job.blockedReasons)), { status: 409 });
        setCalculationState((current) => ({ ...current, completed: job.completed, total: job.total }));
        await waitForCalculationPoll();
        const pollParams = new URLSearchParams({ jobId: job.id });
        try {
          const pollResponse = await fetch(`/api/projects/${encodeURIComponent(projectAtStart)}/offer-workspace/calculate?${pollParams}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          job = parseCalculationJob(await pollResponse.json(), pollResponse);
          setCalculationState((current) => ({ ...current, completed: job.completed, total: job.total, error: '' }));
        } catch (cause) {
          const statusCode = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
          if (statusCode > 0 && statusCode < 500) throw cause;
          setCalculationState((current) => ({
            ...current,
            error: 'Nie udało się odczytać postępu zadania. Ponawiam sprawdzenie.',
          }));
        }
      }
      if (job.stale) throw Object.assign(new Error(offerWorkspaceCalculationStaleMessage(job.blockedReasons)), { status: 409 });
      if (job.status === 'failed') throw new Error(job.error || 'Obliczenie oferty nie powiodło się.');
      if (!job.data) throw new Error('Zadanie zakończyło się bez wyniku kalkulacji.');
      if (controller.signal.aborted || requestId !== calculationRequestId.current) return;
      const resultMatchesDraft = isCurrentOfferWorkspaceCalculationRequest(
        controller.signal, requestKey, calculationKeyRef.current, requestId, calculationRequestId.current,
      ) && projectAtStart === projectId;
      if (resultMatchesDraft) setDocumentRevision(value => value + 1);
      setCalculationState((current) => ({
        ...current,
        key: calculationKeyRef.current,
        data: resultMatchesDraft ? job.data || null : null,
        jobId: resultMatchesDraft ? job.id : null,
        loading: false,
        mode: null,
        error: '',
        completed: job.completed,
        total: job.total,
      }));
    } catch (cause) {
      if (requestId === calculationRequestId.current) {
        const resultMatchesDraft = isCurrentOfferWorkspaceCalculationRequest(
          controller.signal, requestKey, calculationKeyRef.current, requestId, calculationRequestId.current,
        ) && projectAtStart === projectId;
        const statusCode = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
        const errorMessage = cause instanceof Error ? cause.message : '';
        const continuationIsStale = continueFromJobId !== undefined && statusCode === 409
          && /^(?:Poprzednia rekomendacja jest nieaktualna|Dane projektu zmieniły się|Wynik kalkulacji jest nieaktualny)/.test(errorMessage);
        setCalculationState((current) => failOfferWorkspaceCalculationState(current, {
          key: calculationKeyRef.current,
          continueFromJobId,
          resultMatchesDraft,
          staleContinuation: continuationIsStale,
          error: resultMatchesDraft ? errorMessage || 'Nie udało się obliczyć oferty.' : '',
        }));
      }
    }
  }

  const changeStep = useCallback((next: OfferWorkspaceStep) => {
    if (itemEditsPendingRef.current) return;
    if (!canEdit) {
      setDraft((current) => {
        const updated = current ? { ...current, step: next } : current;
        latestDraft.current = updated;
        return updated;
      });
      return;
    }
    updateDraft((current) => ({ ...current, step: next }));
  }, [canEdit, updateDraft]);

  async function saveDraft() {
    if (!workspace || !draft || !canEdit || saving || conflict || itemEditsPendingRef.current || (!dirty && !pricingIsStale)
      || (pricingIsStale && !pricingChangeAcknowledged)) return;
    const projectAtStart = projectId;
    const requestGeneration = generation.current;
    const submittedEditSequence = editSequence.current;
    const submittedDraft = parseOfferWorkspaceDraft(draft);
    const expectedRevisionAtStart = expectedRevision;
    const sourceRevisionAtStart = workspace.revision;
    const controller = new AbortController();
    saveAbort.current?.abort();
    saveAbort.current = controller;
    setSaving(true);
    setError('');
    setStatus('Zapisywanie szkicu…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectAtStart)}/offer-workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          expectedRevision: expectedRevisionAtStart,
          sourceRevision: sourceRevisionAtStart,
          input: submittedDraft,
          ...(pricingIsStale && pricingChangeAcknowledged && currentPricingSnapshot
            ? { acceptedPricingRevision: currentPricingSnapshot.revision } : {}),
        }),
      });
      const saved = parseEnvelope<SavedOfferWorkspaceDraft>(await response.json(), response);
      if (controller.signal.aborted || generation.current !== requestGeneration || projectId !== projectAtStart) return;
      const resolution = resolveDraftAfterSave(
        submittedEditSequence,
        editSequence.current,
        latestDraft.current,
        parseOfferWorkspaceDraft(saved.input),
      );
      latestDraft.current = resolution.draft;
      setDraft(resolution.draft);
      setExpectedRevision(saved.revision);
      setWorkspace((current) => current ? { ...current, draft: saved } : current);
      setDirty(resolution.hasNewerEdits);
      setConflictKind(null);
      setStatus(resolution.hasNewerEdits
        ? `Zapisano rewizję ${saved.revision}; nowsze zmiany nadal wymagają zapisu`
        : `Zapisano · rewizja ${saved.revision}`);
      if (!resolution.hasNewerEdits && storageKey) window.sessionStorage.removeItem(storageKey);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      const statusCode = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
      if (statusCode === 409) {
        setConflictKind('unknown');
        setStatus('Konflikt wersji · szkic zachowany lokalnie');
        setError(draftConflictMessage('unknown'));
      } else {
        setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać szkicu.');
        setStatus('Nie zapisano');
      }
    } finally {
      if (generation.current === requestGeneration) setSaving(false);
    }
  }

  async function discardLocalDraft() {
    if (!workspace || !conflict || itemEditsPendingRef.current) return;
    const projectAtStart = projectId;
    const requestGeneration = generation.current;
    editSequence.current += 1;
    setStatus('Pobieram aktualny szkic z serwera…');
    const refreshed = await load(new AbortController().signal, requestGeneration, true, true);
    if (generation.current !== requestGeneration || projectId !== projectAtStart) return;
    if (!refreshed) {
      setStatus('Nie udało się odświeżyć · lokalny szkic zachowany');
      return;
    }
    setStatus('Wczytano aktualny szkic z serwera');
  }

  async function refreshLocalDraft() {
    if (!workspace || !draft || !conflict || conflictKind === 'draft' || itemEditsPendingRef.current) return;
    const requestGeneration = generation.current;
    setStatus('Sprawdzam aktualne dane; zachowuję lokalny szkic…');
    await load(new AbortController().signal, requestGeneration, false, false, {
      expectedRevision, input: draft,
    });
  }

  function setNumeric(path: keyof OfferWorkspaceDraft['existingPv'], value: string) {
    const parsed = value.trim() === '' ? null : Number(value);
    updateDraft((current) => ({
      ...current,
      existingPv: { ...current.existingPv, [path]: parsed != null && Number.isFinite(parsed) ? parsed : null },
    }));
  }

  const configurationResolution = useMemo(() => {
    try { return { templates: workspace && draft ? applyOfferWorkspaceConfigurationEdits(workspace.templates, draft)
      .filter(item => draft.selectedTemplateIds.includes(item.id)) : [], error: '' }; }
    catch (cause) { return { templates: [], error: cause instanceof Error ? cause.message : 'Nie można odczytać pozycji konfiguracji.' }; }
  }, [draft?.selectedTemplateIds, draft?.configurationEdits, workspace?.templates]);
  const selectedTemplates = configurationResolution.templates;
  const selectedPricing = workspace && draft && !configurationResolution.error && ['B2C', 'B2B'].includes(workspace.clientType)
    ? priceOfferWorkspaceConfiguration(selectedTemplates, draft.saleVatMode, workspace.clientType) : null;
  const marginPricing = itemPricingPreview?.projectId === projectId ? itemPricingPreview.pricing : selectedPricing;
  const marginPercent = marginPricing?.totals && marginPricing.totals.saleNet > 0
    ? marginPricing.totals.profitNet / marginPricing.totals.saleNet * 100 : null;
  usePublishOfferMargin({ projectId, actorId, visible: !loading && Boolean(workspace && draft) && !templatePreview
    && canEdit && workspace?.canEditConfigurationItems === true && !conflict, marginPercent });
  const currentPricingSnapshot: OfferWorkspacePricingSnapshot | null = workspace && draft && selectedPricing
    && ['B2C', 'B2B'].includes(workspace.clientType)
    ? createOfferWorkspacePricingSnapshot(
      draft,
      workspace.clientType,
      selectedPricing!,
      selectedTemplates,
    )
    : null;
  const savedPricingSnapshot = workspace?.draft?.pricingSnapshot;
  const pricingFreshness: OfferWorkspacePricingFreshness = offerWorkspacePricingFreshness(savedPricingSnapshot, currentPricingSnapshot);
  const pricingIsStale = pricingFreshness === 'STALE';
  const pricingChangeAcknowledged = Boolean(currentPricingSnapshot)
    && acknowledgedPricingRevision === currentPricingSnapshot?.revision;
  const canSaveDraft = canEdit && !conflict && !saving && !itemEditsPending && !configurationResolution.error
    && (dirty || pricingIsStale)
    && (!pricingIsStale || pricingChangeAcknowledged);

  if (loading) {
    return <Flex minH="320px" align="center" justify="center" gap="12px"><Spinner color="purple.500" /><Text color={muted}>Wczytuję dane projektu i katalogu…</Text></Flex>;
  }

  if (error && !workspace) {
    return <Box p="20px" bg={background} border="1px solid" borderColor={border} borderRadius="8px">
      <Alert status="error" borderRadius="6px"><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>
      {onBack ? <Button mt="16px" size="sm" leftIcon={<MdArrowBack />} onClick={onBack}>Wróć do projektu</Button> : null}
    </Box>;
  }

  if (!workspace || !draft) return null;

  const calculatedWorkspace: WorkspaceData = { ...workspace,
    viewerId: actorId,
    documentRevision,
    measurements: energyState.key === energyKey && energyState.data
      ? overlayOfferWorkspaceMeasurements(workspace.measurements, energyState.data)
      : workspace.measurements,
    valuation: valuationState.key === valuationKey ? valuationState.data : null,
    valuationLoading: !templatePreview && (valuationState.key !== valuationKey || valuationState.loading),
    valuationError: valuationState.key === valuationKey ? valuationState.error : '',
    energy: energyState.key === energyKey ? energyState.data : null,
    energyLoading: !templatePreview && (energyState.key !== energyKey || energyState.loading),
    energyError: energyState.key === energyKey ? energyState.error : '',
  };
  const screenProps = {
    workspace: calculatedWorkspace, draft, tariffs, disabled: !canEdit || conflict, onChange: updateDraft,
    currentTariffLabel: tariffLabel?.label || 'Nie wybrano taryfy',
    currentTariffRates, targetTariffRates, tariffRateDate,
    actualSettlement: parseSettlement(workspace.input.settlementMode),
  };
  const stepContent = step === 'SYSTEM'
    ? <OfferSystemScreen {...screenProps} tariffError={tariffError} />
    : step === 'CONFIGURATION'
      ? <OfferWorkspaceConfiguration
        draft={draft}
        templates={workspace.templates}
        clientType={workspace.clientType}
        disabled={!canEdit || conflict || saving}
        itemsEditable={workspace.canEditConfigurationItems === true}
        onPricingPreview={updatePricingPreview}
        pendingConfigurationEdits={itemEditsPending}
        pendingPricing={itemPricingPreview?.projectId === projectId ? itemPricingPreview.pricing : null}
        calculationDisabled={templatePreview || itemEditsPending}
        calculation={calculationState.key === calculationKey ? calculationState.data : null}
        calculationLoading={calculationState.loading}
        calculationMode={calculationState.mode}
        calculationProgress={calculationState.loading ? { completed: calculationState.completed, total: calculationState.total } : null}
        calculationIsStale={(calculationState.loading && calculationState.key !== calculationKey)
          || (calculationState.key === calculationKey && calculationState.data?.recommendationSearch?.hasMore === true && !calculationState.jobId)}
        calculationError={calculationState.key === calculationKey ? calculationState.error : ''}
        onCalculate={calculateOffer}
        onSelectRanking={(templateIds) => {
          if (itemEditsPendingRef.current || templateIds.length > 2 || templateIds.some((id) => !workspace.templates.some((template) => template.id === id))) return;
          updateDraft((current) => offerWorkspaceDraftWithRanking(current, workspace.templates, templateIds));
        }}
        onChange={updateDraft}
      />
      : step === 'SAVINGS'
        ? <OfferSavingsScreen {...screenProps}
          targetTariffLabel={tariffs?.catalog.flatMap(operator => operator.tariffs.filter(tariff => tariff.id === draft.targetTariffId && operator.id === draft.targetOperatorId).map(tariff => `${operator.name} · ${tariff.code}`))[0] || 'Nie wybrano taryfy'}
          calculation={calculationState.key === calculationKey && !(draft.configurationEdits?.length && calculationState.data?.recommendationSearch) ? calculationState.data : null}
          calculationLoading={calculationState.loading}
          calculationError={calculationState.key === calculationKey ? calculationState.error : ''}
          calculationDisabled={!canEdit || conflict || templatePreview}
          onCalculate={() => calculateOffer('selected')}
        />
        : step === 'DESCRIPTION'
          ? <OfferDescriptionScreen draft={draft} disabled={!canEdit || conflict} onChange={updateDraft} />
        : <OfferSummaryScreen
          workspace={calculatedWorkspace}
          draft={draft}
          disabled={!canEdit || conflict || saving || itemEditsPending}
          itemsEditable={workspace.canEditConfigurationItems === true}
          onChange={updateDraft}
          templatePreview={templatePreview}
        />;

  function exportDraft() {
    if (itemEditsPendingRef.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ projectId, input: draft }, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `oferta-szkic-${projectId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Box bg={background} color={text} minW="0" sx={{ letterSpacing: 0, button: { boxShadow: 'none' } }}>
    <Flex justify="space-between" align="end" gap="14px" mb="24px" wrap="wrap">
      <Flex align="end" gap="10px" flex="1" minW="200px" maxW="400px">
        {onBack ? <Tooltip label="Wróć do projektu"><IconButton aria-label="Wróć do projektu" icon={<MdArrowBack />} variant="ghost" size="sm" mb="5px" isDisabled={itemEditsPending} onClick={() => { if (!itemEditsPendingRef.current) onBack(); }} /></Tooltip> : null}
        <FormControl minW="0"><FormLabel fontSize="11px" fontWeight="500" mb="6px">Wariant oferty</FormLabel><Select aria-label="Wariant oferty" value="draft" onChange={() => undefined} h="42px" fontSize="12px" borderRadius="13px" title={workspace.projectName}><option value="draft">{selectedTemplates.length ? selectedTemplates.map((item) => templateKindLabel(item.kind)).join(' + ') : 'Nowa oferta'} · wariant roboczy</option></Select></FormControl>
      </Flex>
      <HStack spacing="8px" wrap="wrap" sx={{ button: { fontSize: '12px', borderRadius: '13px', height: '40px' } }}>
        <Tooltip label="Wczytywanie innych wariantów będzie dostępne po podłączeniu wersji ofert."><Box><Button variant="outline" isDisabled>Wczytaj</Button></Box></Tooltip>
        <Button variant="outline" leftIcon={<MdDownload />} isDisabled={itemEditsPending} onClick={exportDraft}>Eksport JSON</Button>
        <Tooltip label="Ten etap zapisuje jeden szkic projektu; kolejne warianty nie są jeszcze dostępne."><Box><Button variant="outline" isDisabled>Nowy wariant</Button></Box></Tooltip>
        {workspace.revision ? <Tooltip label={`Rewizja danych źródłowych: ${workspace.revision}`}><IconButton aria-label="Pokaż rewizję danych źródłowych" icon={<MdOutlineInfo />} variant="ghost" size="xs" /></Tooltip> : null}
        <Button colorScheme="purple" bg="#8a47ff" isLoading={saving} isDisabled={!canSaveDraft} onClick={saveDraft}>Zapisz szkic</Button>
      </HStack>
    </Flex>
    <Text role="status" fontSize="11px" color={conflict ? 'orange.600' : muted} mb="12px" textAlign="right">{pricingIsStale ? 'Ceny wymagają przeliczenia' : status || (dirty ? 'Niezapisane zmiany' : 'Szkic')}{conflict ? ' · konflikt szkicu' : ''}</Text>
    {itemEditsPending ? <Alert status="info" borderRadius="8px" mb="14px"><AlertIcon /><AlertDescription fontSize="sm">Zastosuj lub anuluj zmiany w tabeli „Wybrana konfiguracja”, aby zapisać szkic, obliczyć ofertę albo przejść dalej.</AlertDescription></Alert> : null}

    {error && workspace ? <Alert status={conflict ? 'warning' : 'error'} alignItems="flex-start" borderRadius="0"><AlertIcon mt="2px" /><AlertDescription flex="1">
      <Text fontSize="sm">{error}</Text>
      {conflict ? <Flex mt="8px" gap="8px" wrap="wrap">
        {conflictKind !== 'draft' ? <Button size="xs" variant="outline" colorScheme="orange" isDisabled={itemEditsPending} onClick={refreshLocalDraft}>Zachowaj szkic i odśwież dane</Button> : null}
        <Button size="xs" variant="outline" leftIcon={<MdDownload />} isDisabled={itemEditsPending} onClick={exportDraft}>Eksportuj mój szkic JSON</Button>
        <Button size="xs" variant="outline" colorScheme="orange" isDisabled={itemEditsPending} onClick={discardLocalDraft}>Odrzuć lokalne zmiany i wczytaj zapisany szkic</Button>
      </Flex> : null}
    </AlertDescription></Alert> : null}
    {pricingIsStale && savedPricingSnapshot && currentPricingSnapshot ? <Alert status="warning" alignItems="flex-start" borderRadius="0" mb="14px">
      <AlertIcon mt="2px" />
      <AlertDescription flex="1">
        <Text fontWeight="700">Ceny wymagają przeliczenia</Text>
        <Text fontSize="sm" mt="4px">Zapisane: netto {formatOfferPrice(savedPricingSnapshot.totals.net)} · brutto {formatOfferPrice(savedPricingSnapshot.totals.gross)}</Text>
        <Text fontSize="sm">Aktualne: netto {formatOfferPrice(currentPricingSnapshot.totals.net)} · brutto {formatOfferPrice(currentPricingSnapshot.totals.gross)}</Text>
        <Checkbox
          mt="8px"
          isChecked={pricingChangeAcknowledged}
          isDisabled={!canEdit || conflict || itemEditsPending}
          onChange={(event) => setAcknowledgedPricingRevision(event.target.checked ? currentPricingSnapshot.revision : '')}
        >Potwierdzam nowe ceny przed zapisem</Checkbox>
      </AlertDescription>
    </Alert> : null}
    {workspace.draft && ['NO_BASELINE', 'UNAVAILABLE'].includes(pricingFreshness) ? <Alert status="info" alignItems="flex-start" borderRadius="0" mb="14px">
      <AlertIcon mt="2px" /><AlertDescription fontSize="sm">{pricingFreshness === 'NO_BASELINE'
        ? 'Brak dostępnej zapisanej migawki cenowej dla tego szkicu. Nie można porównać poprzednich i aktualnych sum.'
        : 'Nie można porównać cen dla aktualnego typu klienta; nie wyznaczono nowej sumy.'}</AlertDescription>
    </Alert> : null}
    {!canEdit ? <Alert status="info" borderRadius="0"><AlertIcon /><AlertDescription fontSize="sm">Masz dostęp do podglądu. Edycja i zapis wymagają uprawnienia do zarządzania ofertami.</AlertDescription></Alert> : null}
    {canEdit && !actorId ? <Alert status="warning" borderRadius="0"><AlertIcon /><AlertDescription fontSize="sm">Brak identyfikatora zalogowanego użytkownika. Lokalna kopia robocza jest wyłączona; zapis na serwerze działa normalnie.</AlertDescription></Alert> : null}

    <Grid templateColumns={{ base: 'minmax(0, 1fr)', lg: '180px minmax(0, 1fr)', xl: '200px minmax(0, 1fr)' }} gap="24px" minH="520px" alignItems="start">
      <Box minW="0" pt={{ base: '0', lg: '12px' }} position={{ lg: 'sticky' }} top="20px">
        <Text fontSize="15px" fontWeight="700" mb={{ base: '8px', lg: '20px' }}>Etapy ofertowania</Text>
        <Flex direction={{ base: 'row', lg: 'column' }} gap="8px" overflowX={{ base: 'auto', lg: 'visible' }}>
          {steps.map((item, index) => {
            const active = item.id === step;
            return <Button key={item.id} variant="ghost" flex={{ base: '0 0 auto', lg: 'initial' }} justifyContent="flex-start" alignItems="center" h="auto" minH="58px" px="9px" py="12px" textAlign="left" whiteSpace="normal" bg={active ? selectedBackground : 'transparent'} _hover={{ bg: selectedBackground }} color={text} borderRadius="13px" isDisabled={itemEditsPending} onClick={() => changeStep(item.id)} aria-current={active ? 'step' : undefined}>
              <Flex minW="25px" h="25px" align="center" justify="center" borderRadius="50%" bg={active ? '#8a47ff' : softBackground} color={active ? 'white' : muted} mr="10px" fontSize="12px" fontWeight="500">{index + 1}</Flex>
              <Box minW="0"><Text fontSize="12px" fontWeight="500">{item.title}</Text><Text fontSize="10px" color={muted} fontWeight="400" mt="3px">{item.subtitle}</Text></Box>
            </Button>;
          })}
        </Flex>
        <Box display={{ base: 'none', lg: 'block' }} mt="22px" px="8px"><Flex justify="space-between" fontSize="11px" mb="10px"><Text>Postęp</Text><Text fontWeight="700">{((currentIndex + 1) / steps.length) * 100}%</Text></Flex><Progress value={((currentIndex + 1) / steps.length) * 100} w="100%" h="6px" colorScheme="purple" borderRadius="full" sx={{ '& > div': { bg: '#8a47ff' } }} /></Box>
      </Box>

      <Box minW="0">
        <Box minH="370px">{stepContent}</Box>
        <Divider my="18px" />
        <Flex justify="space-between" gap="10px" wrap="wrap">
          <Button size="sm" variant="outline" leftIcon={<MdArrowBack />} isDisabled={currentIndex === 0 || itemEditsPending} onClick={() => changeStep(steps[Math.max(0, currentIndex - 1)].id)}>Wstecz</Button>
          {currentIndex < steps.length - 1 ? <Button size="sm" colorScheme="purple" rightIcon={<MdArrowForward />} isDisabled={itemEditsPending} onClick={() => changeStep(steps[currentIndex + 1].id)}>Dalej</Button> : <Button size="sm" colorScheme="purple" leftIcon={<MdSave />} isLoading={saving} isDisabled={!canSaveDraft} onClick={saveDraft}>Zapisz szkic</Button>}
        </Flex>
      </Box>
    </Grid>
  </Box>;
}

