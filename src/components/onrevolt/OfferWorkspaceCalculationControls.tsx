'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Grid,
  Input,
  Progress,
  Select,
  Text,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import React, { useState } from 'react';
import { MdAdd, MdCalculate, MdDeleteOutline, MdOutlineAutoAwesome } from 'react-icons/md';
import {
  DEFAULT_OFFER_BILLING_CYCLE_MONTHS,
  DEFAULT_OFFER_TAX_RATE_PERCENT,
  usesOfferTaxEstimate,
  defaultOfferCalculationAssumptions,
  offerWorkspaceDraftWithCalculationValue,
  parseOfferWorkspaceDraft,
  type OfferCalculationAssumptionKey,
  type OfferWorkspaceDraft,
  type OfferWorkspaceInitialCreditLot,
  type OfferWorkspaceInitialDepositLot,
} from 'lib/onrevolt/offer-workspace';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import { recommendationInputIssues } from 'lib/onrevolt/offer-workspace-recommendation-inputs';

export type OfferWorkspaceCalculationMode = 'selected' | 'recommend';

type Props = {
  draft: OfferWorkspaceDraft;
  clientType: string;
  disabled: boolean;
  calculationDisabled?: boolean;
  calculation: OfferWorkspaceCalculation | null;
  calculationLoading: boolean;
  calculationMode: OfferWorkspaceCalculationMode | null;
  calculationProgress: { completed: number; total: number } | null;
  calculationIsStale: boolean;
  calculationError: string;
  onChange: (update: (draft: OfferWorkspaceDraft) => OfferWorkspaceDraft) => void;
  onCalculate: (mode: OfferWorkspaceCalculationMode, continueRecommendation?: true) => void;
  onSelectRanking: (templateIds: string[]) => void;
};

type CalculationAcceptance = 'pvReconstructionAccepted' | 'taxEstimateAccepted';
type Assumptions = ReturnType<typeof defaultOfferCalculationAssumptions> & Partial<Record<CalculationAcceptance, boolean>>;
type AssumptionKey = OfferCalculationAssumptionKey;
type PendingCreditLot = { kwh: string; creditedMonth: string; expiresMonth: string };
type PendingDepositLot = { amountPln: string; creditedMonth: string; expiresMonth: string; refundCapPln: string };
type CalculationEstimates = OfferWorkspaceCalculation & {
  estimatedPaybackYears?: number | null;
  estimatedRecommendedTemplateIds?: string[] | null;
  rankings: Array<OfferWorkspaceCalculation['rankings'][number] & { estimatedPaybackYears?: number | null }>;
};

function sameTemplateIds(left: string[] | null | undefined, right: string[]) {
  return left != null && left.length === right.length && right.every((id) => left.includes(id));
}

function groupDatedPriceWarnings(warnings: string[]) {
  const standalone: string[] = [];
  const dated = new Map<string, Array<{ warning: string; date: string }>>();
  for (const warning of warnings) {
    const dates = warning.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    if (!dates.length || !/(?:brak|missing).*(?:cen|cena|price|taryf|staw)|(?:cen|cena|price|taryf|staw).*(?:brak|missing)/i.test(warning)) {
      standalone.push(warning);
      continue;
    }
    const key = warning.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '{data}');
    const group = dated.get(key) || [];
    group.push({ warning, date: dates[0] });
    dated.set(key, group);
  }
  const grouped = [...dated.entries()].flatMap(([pattern, entries]) => entries.length < 2
    ? entries.map(({ warning }) => ({ pattern: null, warnings: [warning], dates: [] as string[] }))
    : [{ pattern, warnings: entries.map(({ warning }) => warning), dates: [...new Set(entries.map(({ date }) => date))].sort() }]);
  return { standalone, grouped };
}

const fields: Array<{
  key: AssumptionKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  required?: boolean;
  placeholder?: string;
}> = [
  { key: 'billingCycleMonths', label: 'Okres rozliczeniowy', unit: 'mies.', min: 1, max: 12, step: 1, placeholder: `${DEFAULT_OFFER_BILLING_CYCLE_MONTHS} (domyślnie)` },
  { key: 'initialCreditKwh', label: 'Saldo opustu na początek okresu danych', unit: 'kWh', min: 0, max: 1000000, step: 0.1, placeholder: '0 (szacunek przy braku salda i transz)' },
  { key: 'initialDepositPln', label: 'Saldo depozytu na początek okresu danych', unit: 'zł', min: 0, max: 1000000, step: 0.01, placeholder: '0 (szacunek przy braku salda i transz)' },
  { key: 'batteryReservePercent', label: 'Rezerwa magazynu', unit: '%', min: 0, max: 99, step: 1 },
  { key: 'chargeEfficiencyPercent', label: 'Sprawność ładowania', unit: '%', min: 1, max: 100, step: 1 },
  { key: 'dischargeEfficiencyPercent', label: 'Sprawność rozładowania', unit: '%', min: 1, max: 100, step: 1 },
  { key: 'addedPvTiltDegrees', label: 'Nachylenie dodatkowej PV', unit: '°', min: 0, max: 90, step: 1, placeholder: 'Nie określono' },
  { key: 'addedPvAzimuthDegrees', label: 'Azymut dodatkowej PV', unit: '°', min: 0, max: 360, step: 1, placeholder: 'Nie określono' },
  { key: 'taxBasePln', label: 'Podstawa opodatkowania przed ulgą', unit: 'zł', min: 0, max: 100000000, step: 1, placeholder: 'Nie określono' },
  { key: 'taxRatePercent', label: 'Stawka podatku w symulacji', unit: '%', min: 0, max: 100, step: 1, placeholder: 'Np. 12, 19 lub 32' },
  { key: 'taxRemainingLimitPln', label: 'Pozostały limit ulgi', unit: 'zł', min: 0, max: 53000, step: 1, placeholder: 'Nie określono' },
  { key: 'taxEligibleCostPln', label: 'Koszt kwalifikowany do ulgi', unit: 'zł', min: 0, max: 10000000, step: 1, placeholder: 'Nie określono' },
];

const money = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const number = (value: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(value);
const recommendationNumber = (value: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(value);
function configurationCountLabel(count: number): string {
  if (count === 1) return 'konfigurację';
  return new Intl.PluralRules('pl-PL').select(count) === 'few' ? 'konfiguracje' : 'konfiguracji';
}
const knownAmount = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null;
function currentWarsawMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function monthAfter(month: string, offset: number): string {
  const [year, value] = month.split('-').map(Number);
  const ordinal = year * 12 + value - 1 + offset;
  return `${String(Math.floor(ordinal / 12)).padStart(4, '0')}-${String(ordinal % 12 + 1).padStart(2, '0')}`;
}

function isValidMonthInput(month: string): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return !!match && Number(match[1]) >= 1900 && Number(match[1]) <= 2100;
}

function nonnegativeInput(value: string, max: number): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

export default function OfferWorkspaceCalculationControls({
  draft,
  clientType,
  disabled,
  calculationDisabled = false,
  calculation,
  calculationLoading,
  calculationMode,
  calculationProgress,
  calculationIsStale,
  calculationError,
  onChange,
  onCalculate,
  onSelectRanking,
}: Props) {
  const assumptions = {
    ...defaultOfferCalculationAssumptions(),
    ...(draft.calculation || {}),
  } as Assumptions;
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [pendingCreditLot, setPendingCreditLot] = useState<PendingCreditLot | null>(null);
  const [pendingDepositLot, setPendingDepositLot] = useState<PendingDepositLot | null>(null);
  const [lotValidationError, setLotValidationError] = useState('');
  const currentMonth = currentWarsawMonth();
  const hasUncommittedInput = Object.keys(editingValues).length > 0
    || pendingCreditLot !== null || pendingDepositLot !== null;

  function draftValidationError(calculation: Assumptions): string | null {
    try {
      parseOfferWorkspaceDraft({ ...draft, calculation });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Nieprawidłowe dane salda początkowego.';
    }
  }

  function clearEditingValues(keys: string[]) {
    setEditingValues((current) => {
      const next = { ...current };
      keys.forEach((key) => { delete next[key]; });
      return next;
    });
  }

  function requestCalculation(mode: OfferWorkspaceCalculationMode, continueRecommendation?: true) {
    if (disabled || calculationDisabled || calculationLoading || hasUncommittedInput
      || (mode === 'recommend' && recommendationIssues.length > 0)) return;
    onCalculate(mode, continueRecommendation);
  }

  function setAssumption(field: typeof fields[number], raw: string) {
    const normalized = raw.trim().replace(',', '.');
    if (normalized === '') {
      clearEditingValues([field.key]);
      updateAssumption(field.key, null);
      return;
    }
    if (!/^\d+(?:\.\d*)?$/.test(normalized) || normalized.endsWith('.')) {
      setEditingValues((current) => ({ ...current, [field.key]: raw }));
      return;
    }
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < field.min || value > field.max
      || (field.key === 'billingCycleMonths' && !Number.isInteger(value))) {
      setEditingValues((current) => ({ ...current, [field.key]: raw }));
      return;
    }
    clearEditingValues([field.key]);
    updateAssumption(field.key, value);
  }

  function updateAssumption(key: AssumptionKey, value: number | null) {
    onChange((current) => offerWorkspaceDraftWithCalculationValue(current, key, value));
  }

  function updateCalculation(update: (current: Assumptions) => Assumptions) {
    onChange((current) => ({
      ...current,
      calculation: update({
        ...defaultOfferCalculationAssumptions(),
        ...(current.calculation || {}),
      }) as OfferWorkspaceDraft['calculation'],
    }));
  }

  function updateCreditAmount(index: number, raw: string) {
    const key = `credit-${index}-kwh`;
    const value = nonnegativeInput(raw, 1000000);
    if (value === null) {
      setEditingValues((current) => ({ ...current, [key]: raw }));
      setLotValidationError('Saldo transzy energii musi być nieujemną liczbą do 1 000 000 kWh.');
      return;
    }
    clearEditingValues([key]);
    setLotValidationError('');
    updateCalculation((current) => {
      const initialCreditLots = (current.initialCreditLots || []).map((lot, lotIndex) => lotIndex === index ? { ...lot, kwh: value } : lot);
      return { ...current, initialCreditLots, initialCreditKwh: initialCreditLots.reduce((sum, lot) => sum + lot.kwh, 0) };
    });
  }

  function editCreditMonth(index: number, field: 'creditedMonth' | 'expiresMonth', raw: string) {
    const lots = assumptions.initialCreditLots || [];
    const currentLot = lots[index];
    if (!currentLot) return;
    const creditedKey = `credit-${index}-creditedMonth`;
    const expiresKey = `credit-${index}-expiresMonth`;
    const candidateLot: OfferWorkspaceInitialCreditLot = {
      ...currentLot,
      creditedMonth: field === 'creditedMonth' ? raw : editingValues[creditedKey] ?? currentLot.creditedMonth,
      expiresMonth: field === 'expiresMonth' ? raw : editingValues[expiresKey] ?? currentLot.expiresMonth,
    };
    setEditingValues((current) => ({ ...current, [field === 'creditedMonth' ? creditedKey : expiresKey]: raw }));
    const initialCreditLots = lots.map((lot, lotIndex) => lotIndex === index ? candidateLot : lot);
    const candidate = { ...assumptions, initialCreditLots };
    const error = draftValidationError(candidate);
    if (error) {
      setLotValidationError(error);
      return;
    }
    clearEditingValues([creditedKey, expiresKey]);
    setLotValidationError('');
    updateCalculation((latest) => ({
      ...latest,
      initialCreditLots: (latest.initialCreditLots || []).map((lot, lotIndex) => lotIndex === index ? candidateLot : lot),
    }));
  }

  function removeCreditLot(index: number) {
    updateCalculation((current) => {
      const initialCreditLots = (current.initialCreditLots || []).filter((_, lotIndex) => lotIndex !== index);
      return {
        ...current,
        initialCreditLots,
        initialCreditKwh: initialCreditLots.length
          ? initialCreditLots.reduce((sum, lot) => sum + lot.kwh, 0)
          : current.initialCreditKwh,
      };
    });
  }

  function addCreditLot() {
    if (!pendingCreditLot) return;
    const kwh = nonnegativeInput(pendingCreditLot.kwh, 1000000);
    if (kwh === null || !pendingCreditLot.creditedMonth || !pendingCreditLot.expiresMonth) return;
    const lot = { kwh, creditedMonth: pendingCreditLot.creditedMonth, expiresMonth: pendingCreditLot.expiresMonth };
    const initialCreditLots = [...(assumptions.initialCreditLots || []), lot];
    const candidate = {
      ...assumptions,
      initialCreditLots,
      initialCreditKwh: initialCreditLots.reduce((sum, item) => sum + item.kwh, 0),
    };
    const error = draftValidationError(candidate);
    if (error) {
      setLotValidationError(error);
      return;
    }
    updateCalculation((current) => {
      const nextLots = [...(current.initialCreditLots || []), lot];
      return { ...current, initialCreditLots: nextLots, initialCreditKwh: nextLots.reduce((sum, item) => sum + item.kwh, 0) };
    });
    setPendingCreditLot(null);
    setLotValidationError('');
  }

  function updateDepositLot(index: number, update: (lot: OfferWorkspaceInitialDepositLot) => OfferWorkspaceInitialDepositLot) {
    updateCalculation((current) => ({
      ...current,
      initialDepositLots: (current.initialDepositLots || []).map((lot, lotIndex) => lotIndex === index ? update(lot) : lot),
    }));
  }

  function updateDepositAmount(index: number, raw: string) {
    const key = `deposit-${index}-amount`;
    const value = nonnegativeInput(raw, 1000000);
    if (value === null) {
      setEditingValues((current) => ({ ...current, [key]: raw }));
      setLotValidationError('Saldo transzy depozytu musi być nieujemną kwotą do 1 000 000 zł.');
      return;
    }
    clearEditingValues([key]);
    setLotValidationError('');
    updateCalculation((current) => {
      const initialDepositLots = (current.initialDepositLots || []).map((lot, lotIndex) => lotIndex === index ? { ...lot, amountPln: value } : lot);
      return { ...current, initialDepositLots, initialDepositPln: initialDepositLots.reduce((sum, lot) => sum + lot.amountPln, 0) };
    });
  }

  function updateDepositRefundCap(index: number, raw: string) {
    const key = `deposit-${index}-refund`;
    const value = nonnegativeInput(raw, 1000000);
    if (value === null) {
      setEditingValues((current) => ({ ...current, [key]: raw }));
      setLotValidationError('Limit zwrotu transzy depozytu musi być nieujemną kwotą do 1 000 000 zł.');
      return;
    }
    clearEditingValues([key]);
    setLotValidationError('');
    updateDepositLot(index, (current) => ({ ...current, refundCapPln: value }));
  }

  function editDepositMonth(index: number, field: 'creditedMonth' | 'expiresMonth', raw: string) {
    const lots = assumptions.initialDepositLots || [];
    const currentLot = lots[index];
    if (!currentLot) return;
    const creditedKey = `deposit-${index}-creditedMonth`;
    const expiresKey = `deposit-${index}-expiresMonth`;
    const candidateLot: OfferWorkspaceInitialDepositLot = {
      ...currentLot,
      creditedMonth: field === 'creditedMonth' ? raw : editingValues[creditedKey] ?? currentLot.creditedMonth,
      expiresMonth: field === 'expiresMonth' ? raw : editingValues[expiresKey] ?? currentLot.expiresMonth,
    };
    setEditingValues((current) => ({ ...current, [field === 'creditedMonth' ? creditedKey : expiresKey]: raw }));
    const initialDepositLots = lots.map((lot, lotIndex) => lotIndex === index ? candidateLot : lot);
    const candidate = { ...assumptions, initialDepositLots };
    const error = draftValidationError(candidate);
    if (error) {
      setLotValidationError(error);
      return;
    }
    clearEditingValues([creditedKey, expiresKey]);
    setLotValidationError('');
    updateCalculation((latest) => ({
      ...latest,
      initialDepositLots: (latest.initialDepositLots || []).map((lot, lotIndex) => lotIndex === index ? candidateLot : lot),
    }));
  }

  function removeDepositLot(index: number) {
    updateCalculation((current) => {
      const initialDepositLots = (current.initialDepositLots || []).filter((_, lotIndex) => lotIndex !== index);
      return {
        ...current,
        initialDepositLots,
        initialDepositPln: initialDepositLots.length
          ? initialDepositLots.reduce((sum, lot) => sum + lot.amountPln, 0)
          : current.initialDepositPln,
      };
    });
  }

  function addDepositLot() {
    if (!pendingDepositLot) return;
    const amountPln = nonnegativeInput(pendingDepositLot.amountPln, 1000000);
    const refundCapPln = nonnegativeInput(pendingDepositLot.refundCapPln, 1000000);
    if (amountPln === null || refundCapPln === null || !pendingDepositLot.creditedMonth || !pendingDepositLot.expiresMonth) return;
    const lot = { amountPln, creditedMonth: pendingDepositLot.creditedMonth, expiresMonth: pendingDepositLot.expiresMonth, refundCapPln };
    const initialDepositLots = [...(assumptions.initialDepositLots || []), lot];
    const candidate = {
      ...assumptions,
      initialDepositLots,
      initialDepositPln: initialDepositLots.reduce((sum, item) => sum + item.amountPln, 0),
    };
    const error = draftValidationError(candidate);
    if (error) {
      setLotValidationError(error);
      return;
    }
    updateCalculation((current) => {
      const nextLots = [...(current.initialDepositLots || []), lot];
      return { ...current, initialDepositLots: nextLots, initialDepositPln: nextLots.reduce((sum, item) => sum + item.amountPln, 0) };
    });
    setPendingDepositLot(null);
    setLotValidationError('');
  }

  const muted = useColorModeValue('secondaryGray.600', 'secondaryGray.300');
  const line = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const recommendationIssues = recommendationInputIssues(draft);
  const taxRate = assumptions.taxRatePercent ?? DEFAULT_OFFER_TAX_RATE_PERCENT;
  const taxIsEstimate = usesOfferTaxEstimate(assumptions);
  const taxFieldsRequired = clientType === 'B2C' && draft.financing.considerTaxRelief
    && !taxIsEstimate;
  const requiredFields = fields.filter((field) =>
    (draft.pvStrategy === 'ADD_TEMPLATE' && ['addedPvTiltDegrees', 'addedPvAzimuthDegrees'].includes(field.key))
    || (taxFieldsRequired && ['taxBasePln', 'taxRemainingLimitPln', 'taxEligibleCostPln'].includes(field.key)));
  const missingFields = requiredFields.filter((field) => assumptions[field.key] == null);
  const visibleCalculation = recommendationIssues.length > 0 && calculation?.recommendationSearch
    ? null
    : calculation;
  const calculationWithEstimates = visibleCalculation as CalculationEstimates | null;
  const strictRecommendation = visibleCalculation?.status === 'ready' && visibleCalculation.recommendationEligible === true;
  const warningGroups = groupDatedPriceWarnings(visibleCalculation?.warnings || []);

  return <Box mt="18px" pt="16px" borderTop="1px solid" borderColor={line}>
    {recommendationIssues.length ? <Alert status="warning" mb="10px" alignItems="flex-start" borderRadius="6px" data-testid="recommendation-input-issues">
      <AlertIcon mt="2px" />
      <AlertDescription>
        <Text fontWeight="700">Uzupełnij dane wymagane do rekomendacji</Text>
        {recommendationIssues.map((issue) => <Text key={issue.code} mt="4px">{issue.message}</Text>)}
      </AlertDescription>
    </Alert> : null}
    <Grid templateColumns="repeat(auto-fit, minmax(min(100%, 220px), 1fr))" gap="8px">
      <Button leftIcon={<MdCalculate />} colorScheme="purple" bg="#8a47ff" size="sm" isDisabled={disabled || calculationDisabled || calculationLoading || hasUncommittedInput} isLoading={calculationLoading && calculationMode === 'selected'} onClick={() => requestCalculation('selected')}>
        Oblicz wybrany wariant
      </Button>
      <Button leftIcon={<MdOutlineAutoAwesome />} variant="outline" colorScheme="purple" size="sm" isDisabled={disabled || calculationDisabled || calculationLoading || hasUncommittedInput || recommendationIssues.length > 0} isLoading={calculationLoading && calculationMode === 'recommend'} onClick={() => requestCalculation('recommend')}>
        Rekomenduj konfigurację
      </Button>
      {visibleCalculation?.recommendationSearch?.hasMore && recommendationIssues.length === 0 ? <Button variant="outline" colorScheme="purple" size="sm"
        isDisabled={disabled || calculationDisabled || calculationLoading || hasUncommittedInput || calculationIsStale}
        isLoading={calculationLoading && calculationMode === 'recommend'}
        onClick={() => requestCalculation('recommend', true)}>
        Szukaj dalej
      </Button> : null}
    </Grid>

    {calculationLoading ? <Box mt="10px" role="status" aria-live="polite">
      <Text fontSize="11px" color={muted} mb="5px">{calculationIsStale
        ? 'Trwa kalkulacja wcześniejszej wersji szkicu; jej wynik zostanie pominięty.'
        : calculationMode === 'recommend' && visibleCalculation?.recommendationSearch?.hasMore
          ? 'Trwa dalsze szukanie. Poprzedni wynik pozostaje widoczny.'
          : calculationMode === 'recommend' ? 'Trwa ranking konfiguracji…' : 'Trwa obliczanie wariantu…'}</Text>
      <Progress size="xs" colorScheme="purple" value={calculationProgress && calculationProgress.total > 0
        ? Math.min(100, calculationProgress.completed / calculationProgress.total * 100) : undefined}
      isIndeterminate={!calculationProgress || calculationProgress.total <= 0} />
      {calculationProgress ? <Text fontSize="10px" color={muted} mt="4px">{calculationProgress.completed} / {calculationProgress.total || '—'}</Text> : null}
    </Box> : null}

    {calculationError ? <Alert status="error" mt="12px" borderRadius="6px"><AlertIcon /><AlertDescription>{calculationError}</AlertDescription></Alert> : null}
    {visibleCalculation?.recommendationSearch ? <Box mt="12px" role="status" aria-live="polite" data-testid="recommendation-search-status">
      {visibleCalculation.recommendationSearch.hasMore ? <>
        <Text fontWeight="700">{visibleCalculation.rankings.length ? 'Najlepszy znaleziony wariant' : 'Brak porównywalnego wariantu w tej partii'}</Text>
        <Text color={muted} fontSize="11px" mt="2px">Sprawdzono {number(visibleCalculation.recommendationSearch.evaluatedCandidates)} z {number(visibleCalculation.recommendationSearch.totalCandidates)} konfiguracji.</Text>
      </> : <Text fontWeight="700">Sprawdzono {visibleCalculation.recommendationSearch.totalCandidates === 1 ? '' : 'wszystkie '}{number(visibleCalculation.recommendationSearch.totalCandidates)} {configurationCountLabel(visibleCalculation.recommendationSearch.totalCandidates)}</Text>}
    </Box> : null}
    {!calculationIsStale && visibleCalculation?.recommendationBatteryBounds ? <Box mt="10px" role="status" data-testid="recommendation-battery-bounds">
      <Text color={muted} fontSize="11px">
        {visibleCalculation.recommendationBatteryBounds.basis === 'pv_production'
          ? `Zużycie w okresie: ${number(visibleCalculation.recommendationBatteryBounds.totalConsumptionKwh)} kWh · Produkcja PV: ${number(visibleCalculation.recommendationBatteryBounds.minimumPvProductionKwh)}–${number(visibleCalculation.recommendationBatteryBounds.maximumPvProductionKwh)} kWh (80–120% zużycia). Magazyn: 2–3 kWh na 1 kWp łącznej PV. `
          : visibleCalculation.recommendationBatteryBounds.basis === 'daily_consumption'
          ? `Średnie zużycie: ${recommendationNumber(visibleCalculation.recommendationBatteryBounds.averageDailyConsumptionKwh)} kWh/dobę · Magazyn: ${recommendationNumber(visibleCalculation.recommendationBatteryBounds.minimumBatteryCapacityKwh)}–${recommendationNumber(visibleCalculation.recommendationBatteryBounds.maximumBatteryCapacityKwh)} kWh (0,5–2× dobowe zużycie). `
          : `Magazyn: ${recommendationNumber(visibleCalculation.recommendationBatteryBounds.minimumBatteryCapacityKwh)}–${recommendationNumber(visibleCalculation.recommendationBatteryBounds.maximumBatteryCapacityKwh)} kWh (${number(visibleCalculation.recommendationBatteryBounds.minimumBatteryKwhPerPvKwp)}–${number(visibleCalculation.recommendationBatteryBounds.maximumBatteryKwhPerPvKwp)}× istniejąca moc PV: ${number(visibleCalculation.recommendationBatteryBounds.existingPvPowerKw)} kWp). `}
        {visibleCalculation.recommendationPvBounds
          ? `Maksymalnie ${number(visibleCalculation.recommendationPvBounds.maximumBatteryKwhPerPvKwp)} kWh magazynu na 1 kWp łącznej mocy PV (istniejąca + dodawana). ` : ''}
        Tylko gotowe konfiguracje.
        {visibleCalculation.recommendationBatteryBounds.basis === 'existing_pv'
          ? visibleCalculation.recommendationBatteryBounds.excludedCandidates > 0
            ? ` Pominięto: ${number(visibleCalculation.recommendationBatteryBounds.excludedCandidates)} poza zakresem istniejącej PV.` : ''
          : visibleCalculation.recommendationBatteryBounds.excludedCandidates > 0 || (visibleCalculation.recommendationPvBounds?.excludedCandidates ?? 0) > 0
            ? ` Pominięto: ${number(visibleCalculation.recommendationBatteryBounds.excludedCandidates)} poza zakresem magazynu; ${number(visibleCalculation.recommendationPvBounds?.excludedCandidates ?? 0)} poza zakresem produkcji PV.` : ''}
      </Text>
    </Box> : null}
    {visibleCalculation?.status === 'blocked' && visibleCalculation.reasons.length ? <Alert status="warning" mt="12px" alignItems="flex-start" borderRadius="6px"><AlertIcon mt="2px" /><AlertDescription><Text fontWeight="700">Nie można przygotować pełnego wyniku.</Text>{visibleCalculation.reasons.map((reason, index) => <Text key={`${index}-${reason}`} mt="4px">{reason}</Text>)}</AlertDescription></Alert> : null}
    {visibleCalculation?.warnings.length ? <Alert status="warning" mt="12px" alignItems="flex-start" borderRadius="6px"><AlertIcon mt="2px" /><AlertDescription width="100%" minW={0}>
      <Box as="details" key={visibleCalculation.warnings.join('\n')} data-testid="calculation-warnings">
      <Box as="summary" cursor="pointer" fontWeight="700" py="2px" _focusVisible={{ outline: '2px solid', outlineColor: 'orange.500', outlineOffset: '4px' }}>
        Uwagi i założenia do wyniku ({visibleCalculation.warnings.length})
      </Box>
      <Box mt="10px">
      {warningGroups.standalone.map((warning, index) => <Text key={`${index}-${warning}`} mt={index ? '4px' : 0}>{warning}</Text>)}
      {warningGroups.grouped.map((group, index) => group.pattern ? <Box key={`${index}-${group.pattern}`} mt={index || warningGroups.standalone.length ? '7px' : 0}>
        <Text>Luki cenowe wymagają weryfikacji. Liczba dat: {group.dates.length}.</Text>
        <Box as="details" mt="3px" fontSize="11px"><Box as="summary" cursor="pointer">Szczegóły dat ({group.warnings.length})</Box>
          {group.warnings.map((warning, warningIndex) => <Text key={`${warningIndex}-${warning}`} mt="3px">{warning}</Text>)}
        </Box>
      </Box> : group.warnings.map((warning, warningIndex) => <Text key={`${index}-${warningIndex}-${warning}`} mt="4px">{warning}</Text>))}
      </Box>
      </Box>
    </AlertDescription></Alert> : null}

    {visibleCalculation?.rankings.length ? <Box mt="14px" aria-label="Ranking konfiguracji">
      <Text fontWeight="700" mb="8px">Ranking konfiguracji</Text>
      <Grid gap="8px">
        {visibleCalculation.rankings.map((ranking, index) => {
          const strictRecommended = strictRecommendation && ranking.recommendationEligible !== false
            && sameTemplateIds(visibleCalculation.recommendedTemplateIds, ranking.templateIds);
          const estimatedRecommended = !strictRecommended
            && sameTemplateIds(calculationWithEstimates?.estimatedRecommendedTemplateIds, ranking.templateIds);
          const strictPayback = strictRecommendation && ranking.recommendationEligible !== false
            ? knownAmount(ranking.paybackYears) : null;
          const estimatedPayback = strictPayback == null ? knownAmount(ranking.estimatedPaybackYears) : null;
          const payback = strictPayback ?? estimatedPayback;
          return <Grid key={`${ranking.templateIds.join('-')}-${index}`} templateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto' }} gap="10px" alignItems="center" border="1px solid" borderColor={strictRecommended || estimatedRecommended ? 'green.300' : line} borderRadius="6px" p="10px">
            <Box minW="0">
              <Text fontWeight="700" overflowWrap="anywhere">{ranking.name}{strictRecommended ? (visibleCalculation.recommendationSearch?.hasMore ? ' · najlepszy znaleziony wariant' : ' · rekomendowana') : estimatedRecommended ? ' · Najkrótszy szacunkowy zwrot' : ''}{visibleCalculation.status === 'blocked' || ranking.recommendationEligible === false ? ' · porównanie częściowe' : ''}</Text>
              <Text color={muted} mt="3px" fontSize="11px">
                Korzyść sprzętu przy tej samej taryfie: {knownAmount(ranking.annualSavingsPln) == null ? '— zł/rok' : `${money(ranking.annualSavingsPln!)} zł/rok`} · szacunkowo po finansowaniu {knownAmount(ranking.costAfterFinancingPln) == null ? '—' : `${money(ranking.costAfterFinancingPln)} zł`} · {payback == null ? 'czas zwrotu —' : strictPayback != null ? `zwrot ${number(Math.round(payback * 10) / 10)} lat` : <Tooltip label={`Dokładny szacunek: ${number(payback)} lat`}><Text as="span" title={`Dokładny szacunek: ${number(payback)} lat`} textDecoration="underline dotted">szacunkowy zwrot {number(Math.round(payback * 10) / 10)} lat</Text></Tooltip>}
              </Text>
              {ranking.reasons?.length ? <Box as="details" mt="5px" fontSize="11px"><Box as="summary" cursor="pointer">Do weryfikacji ({ranking.reasons.length})</Box>{ranking.reasons.map((reason, reasonIndex) => <Text key={reasonIndex} mt="3px">{reason}</Text>)}</Box> : null}
            </Box>
            <Button size="xs" variant={estimatedRecommended ? 'solid' : 'outline'} colorScheme={estimatedRecommended ? 'green' : 'purple'} isDisabled={disabled} onClick={() => onSelectRanking(ranking.templateIds)}>
              {estimatedRecommended ? 'Wybierz szacunkowy wariant' : 'Wybierz konfigurację'}
            </Button>
          </Grid>;
        })}
      </Grid>
    </Box> : null}

    <Box as="details" mt="14px" borderTop="1px solid" borderColor={line} pt="12px">
      <Box as="summary" cursor="pointer" fontWeight="700" color={missingFields.length ? 'red.500' : undefined}>Założenia obliczeń{missingFields.length ? ` · Uzupełnij wymagane pola (${missingFields.length})` : ''}</Box>
      {missingFields.length ? <Text mt="8px" color="red.500" role="alert">Do obliczenia rekomendacji i czasu zwrotu uzupełnij: {missingFields.map((field) => field.label.toLocaleLowerCase('pl-PL')).join(', ')}. Brakujące pola zaznaczono na czerwono.</Text> : null}
      <Text mt="6px" color={muted} fontSize="10px">Saldo oznacza stan na początek pierwszego miesiąca danych pomiarowych, nie saldo na dziś. Brak salda i transz oznacza szacunek od 0, bez zmiany zapisanego szkicu. Znane saldo dodatnie wymaga datowanych transz. Stawka podatku jest parametrem scenariusza, nie oceną prawną.</Text>
      <Grid templateColumns={{ base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap="10px" mt="12px">
        <Checkbox aria-label="Prognoza PV oparta na pomiarach ENEA i modelowanej autokonsumpcji" isChecked={assumptions.pvReconstructionAccepted === true} isDisabled={disabled} onChange={(event) => updateCalculation((current) => ({ ...current, pvReconstructionAccepted: event.target.checked }))}>
          Prognoza PV oparta na pomiarach ENEA i modelowanej autokonsumpcji
        </Checkbox>
        {clientType === 'B2C' && draft.financing.considerTaxRelief ? <Box>
          <Checkbox aria-label="Dokładne dane do ulgi (opcjonalnie)" isChecked={!taxIsEstimate} isDisabled={disabled}
            onChange={(event) => {
              const detailed = event.target.checked;
              if (!detailed) clearEditingValues(['taxBasePln', 'taxRemainingLimitPln', 'taxEligibleCostPln']);
              updateCalculation((current) => ({ ...current, taxDetailedCalculation: detailed }));
            }}>
            Dokładne dane do ulgi (opcjonalnie)
          </Checkbox>
          <Text mt="4px" fontSize="11px" color={muted}>{taxIsEstimate
            ? `Ulga szacunkowa ${taxRate}%. Przy braku danych: wolny limit 53 000 zł i wystarczający dochód. Zapisane ograniczenia są uwzględniane.`
            : 'Uzupełnij dane poniżej, aby doprecyzować symulację ulgi.'}</Text>
        </Box> : null}
      </Grid>
      {lotValidationError ? <Alert status="error" mt="8px" borderRadius="6px" role="alert"><AlertIcon /><AlertDescription>{lotValidationError}</AlertDescription></Alert> : null}
      <Grid templateColumns={{ base: '1fr 1fr', lg: 'repeat(3, minmax(0, 1fr))' }} gap="10px" mt="12px">
        {fields.filter((field) => !['taxBasePln', 'taxRemainingLimitPln', 'taxEligibleCostPln'].includes(field.key) || taxFieldsRequired).map((field) => {
          const value = assumptions[field.key];
          const missing = missingFields.includes(field);
          const invalidInput = editingValues[field.key] != null;
          return <FormControl key={field.key} minW="0" isRequired={requiredFields.includes(field)} isInvalid={missing || invalidInput}>
            <FormLabel color={missing || invalidInput ? 'red.500' : undefined} fontSize="10px" minH="30px" mb="4px">{field.label} [{field.unit}]</FormLabel>
            {field.key === 'taxRatePercent' ? <>
              <Select aria-label={`${field.label} [${field.unit}]`} h="36px" fontSize="11px" isDisabled={disabled}
                value={taxRate} onChange={(event) => setAssumption(field, event.target.value)}>
                {[12, 19, 32].map((rate) => <option key={rate} value={rate}>{rate}%{rate === 12 && value == null ? ' — domyślnie w symulacji' : ''}</option>)}
                {value != null && ![12, 19, 32].includes(value) ? <option value={value}>{value}% — zapisana stawka</option> : null}
              </Select>
              <Text color={muted} fontSize="10px" mt="4px">Założenie symulacji; wybierz stawkę właściwą dla klienta.</Text>
            </> : <Input
              aria-label={`${field.label} [${field.unit}]`}
              type="text"
              inputMode="decimal"
              isDisabled={disabled}
              value={editingValues[field.key] ?? (value == null ? '' : String(value))}
              placeholder={field.placeholder}
              h="36px"
              fontSize="11px"
              onChange={(event) => setAssumption(field, event.target.value)}
            />}
            <FormErrorMessage fontSize="10px">{invalidInput ? `Wpisz poprawną wartość od ${field.min} do ${field.max}.` : 'Wymagane do obliczenia rekomendacji i czasu zwrotu.'}</FormErrorMessage>
          </FormControl>;
        })}
        <FormControl minW="0">
          <FormLabel fontSize="10px" minH="30px" mb="4px">Początek cyklu rozliczeniowego [YYYY-MM]</FormLabel>
          <Input
            aria-label="Początek cyklu rozliczeniowego [YYYY-MM]"
            type="month"
            max={currentMonth}
            isDisabled={disabled}
            value={assumptions.billingCycleStartMonth ?? ''}
            h="36px"
            fontSize="11px"
            onChange={(event) => updateCalculation((current) => ({ ...current, billingCycleStartMonth: event.target.value || null }))}
          />
        </FormControl>
      </Grid>
      <Box mt="14px" borderTop="1px solid" borderColor={line} pt="12px">
        <Grid templateColumns={{ base: 'minmax(0, 1fr) auto' }} alignItems="center" gap="8px">
          <Text fontWeight="700">Datowane partie salda opustu</Text>
          <Button size="xs" leftIcon={<MdAdd />} variant="outline" isDisabled={disabled || pendingCreditLot !== null}
            onClick={() => setPendingCreditLot({ kwh: '', creditedMonth: '', expiresMonth: '' })}>Dodaj transzę</Button>
        </Grid>
        {(assumptions.initialCreditLots || []).map((lot, index) => <Grid key={`credit-${index}`}
          templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr)) auto' }} gap="8px" mt="8px" alignItems="end">
          <FormControl><FormLabel fontSize="10px">Saldo opustu [kWh]</FormLabel><Input aria-label={`Saldo opustu transzy ${index + 1} [kWh]`} type="text" inputMode="decimal" isDisabled={disabled} value={editingValues[`credit-${index}-kwh`] ?? String(lot.kwh)} onChange={(event) => updateCreditAmount(index, event.target.value)} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Uznano [YYYY-MM]</FormLabel><Input aria-label={`Miesiąc uznania transzy energii ${index + 1}`} type="month" max={currentMonth} isDisabled={disabled} value={editingValues[`credit-${index}-creditedMonth`] ?? lot.creditedMonth} onChange={(event) => editCreditMonth(index, 'creditedMonth', event.target.value)} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Wygasa [YYYY-MM]</FormLabel><Input aria-label={`Miesiąc wygaśnięcia transzy energii ${index + 1}`} type="month" max={isValidMonthInput(editingValues[`credit-${index}-creditedMonth`] ?? lot.creditedMonth) ? monthAfter(editingValues[`credit-${index}-creditedMonth`] ?? lot.creditedMonth, 13) : undefined} isDisabled={disabled} value={editingValues[`credit-${index}-expiresMonth`] ?? lot.expiresMonth} onChange={(event) => editCreditMonth(index, 'expiresMonth', event.target.value)} /></FormControl>
          <Text fontSize="10px" color={muted} alignSelf="center">Wygaśnięcie opustu: do 12 mies.</Text>
          <Button aria-label={`Usuń transzę energii ${index + 1}`} size="xs" variant="ghost" colorScheme="red" isDisabled={disabled} onClick={() => removeCreditLot(index)}><MdDeleteOutline /></Button>
        </Grid>)}
        {pendingCreditLot ? <Grid templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr)) auto' }} gap="8px" mt="8px" alignItems="end">
          <FormControl><FormLabel fontSize="10px">Saldo opustu [kWh]</FormLabel><Input aria-label="Nowa transza energii [kWh]" type="number" min="0" max="1000000" step="any" isDisabled={disabled} value={pendingCreditLot.kwh} onChange={(event) => { setLotValidationError(''); setPendingCreditLot({ ...pendingCreditLot, kwh: event.target.value }); }} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Uznano [YYYY-MM]</FormLabel><Input aria-label="Miesiąc uznania nowej transzy energii" type="month" max={currentMonth} isDisabled={disabled} value={pendingCreditLot.creditedMonth} onChange={(event) => { setLotValidationError(''); setPendingCreditLot({ ...pendingCreditLot, creditedMonth: event.target.value }); }} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Wygasa [YYYY-MM]</FormLabel><Input aria-label="Miesiąc wygaśnięcia nowej transzy energii" type="month" max={isValidMonthInput(pendingCreditLot.creditedMonth) ? monthAfter(pendingCreditLot.creditedMonth, 13) : undefined} isDisabled={disabled} value={pendingCreditLot.expiresMonth} onChange={(event) => { setLotValidationError(''); setPendingCreditLot({ ...pendingCreditLot, expiresMonth: event.target.value }); }} /></FormControl>
          <Button size="xs" leftIcon={<MdAdd />} isDisabled={disabled || nonnegativeInput(pendingCreditLot.kwh, 1000000) === null || !pendingCreditLot.creditedMonth || !pendingCreditLot.expiresMonth} onClick={addCreditLot}>Zapisz transzę</Button>
          <Button size="xs" variant="ghost" isDisabled={disabled} onClick={() => { setPendingCreditLot(null); setLotValidationError(''); }}>Anuluj</Button>
        </Grid> : null}
      </Box>
      <Box mt="14px" borderTop="1px solid" borderColor={line} pt="12px">
        <Grid templateColumns={{ base: 'minmax(0, 1fr) auto' }} alignItems="center" gap="8px">
          <Text fontWeight="700">Datowane partie salda depozytu</Text>
          <Button size="xs" leftIcon={<MdAdd />} variant="outline" isDisabled={disabled || pendingDepositLot !== null}
            onClick={() => setPendingDepositLot({ amountPln: '', creditedMonth: '', expiresMonth: '', refundCapPln: '' })}>Dodaj transzę</Button>
        </Grid>
        {(assumptions.initialDepositLots || []).map((lot, index) => <Grid key={`deposit-${index}`}
          templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr)) auto' }} gap="8px" mt="8px" alignItems="end">
          <FormControl><FormLabel fontSize="10px">Saldo depozytu [zł]</FormLabel><Input aria-label={`Saldo depozytu transzy ${index + 1} [zł]`} type="text" inputMode="decimal" isDisabled={disabled} value={editingValues[`deposit-${index}-amount`] ?? String(lot.amountPln)} onChange={(event) => updateDepositAmount(index, event.target.value)} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Uznano [YYYY-MM]</FormLabel><Input aria-label={`Miesiąc uznania transzy depozytu ${index + 1}`} type="month" max={currentMonth} isDisabled={disabled} value={editingValues[`deposit-${index}-creditedMonth`] ?? lot.creditedMonth} onChange={(event) => editDepositMonth(index, 'creditedMonth', event.target.value)} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Wygasa [YYYY-MM]</FormLabel><Input aria-label={`Miesiąc wygaśnięcia transzy depozytu ${index + 1}`} type="month" max={isValidMonthInput(editingValues[`deposit-${index}-creditedMonth`] ?? lot.creditedMonth) ? monthAfter(editingValues[`deposit-${index}-creditedMonth`] ?? lot.creditedMonth, 12) : undefined} isDisabled={disabled} value={editingValues[`deposit-${index}-expiresMonth`] ?? lot.expiresMonth} onChange={(event) => editDepositMonth(index, 'expiresMonth', event.target.value)} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Limit zwrotu [zł]</FormLabel><Input aria-label={`Limit zwrotu transzy depozytu ${index + 1} [zł]`} type="text" inputMode="decimal" isDisabled={disabled} value={editingValues[`deposit-${index}-refund`] ?? String(lot.refundCapPln)} onChange={(event) => updateDepositRefundCap(index, event.target.value)} /></FormControl>
          <Text fontSize="10px" color={muted} alignSelf="center">Wygaśnięcie zgodnie z dokumentem sprzedawcy.</Text>
          <Button aria-label={`Usuń transzę depozytu ${index + 1}`} size="xs" variant="ghost" colorScheme="red" isDisabled={disabled} onClick={() => removeDepositLot(index)}><MdDeleteOutline /></Button>
        </Grid>)}
        {pendingDepositLot ? <Grid templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr)) auto' }} gap="8px" mt="8px" alignItems="end">
          <FormControl><FormLabel fontSize="10px">Saldo depozytu [zł]</FormLabel><Input aria-label="Nowa transza depozytu [zł]" type="number" min="0" max="1000000" step="any" isDisabled={disabled} value={pendingDepositLot.amountPln} onChange={(event) => { setLotValidationError(''); setPendingDepositLot({ ...pendingDepositLot, amountPln: event.target.value }); }} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Uznano [YYYY-MM]</FormLabel><Input aria-label="Miesiąc uznania nowej transzy depozytu" type="month" max={currentMonth} isDisabled={disabled} value={pendingDepositLot.creditedMonth} onChange={(event) => { setLotValidationError(''); setPendingDepositLot({ ...pendingDepositLot, creditedMonth: event.target.value }); }} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Wygasa [YYYY-MM]</FormLabel><Input aria-label="Miesiąc wygaśnięcia nowej transzy depozytu" type="month" max={isValidMonthInput(pendingDepositLot.creditedMonth) ? monthAfter(pendingDepositLot.creditedMonth, 12) : undefined} isDisabled={disabled} value={pendingDepositLot.expiresMonth} onChange={(event) => { setLotValidationError(''); setPendingDepositLot({ ...pendingDepositLot, expiresMonth: event.target.value }); }} /></FormControl>
          <FormControl><FormLabel fontSize="10px">Limit zwrotu [zł]</FormLabel><Input aria-label="Limit zwrotu nowej transzy depozytu [zł]" type="number" min="0" max="1000000" step="any" isDisabled={disabled} value={pendingDepositLot.refundCapPln} onChange={(event) => { setLotValidationError(''); setPendingDepositLot({ ...pendingDepositLot, refundCapPln: event.target.value }); }} /></FormControl>
          <Button size="xs" leftIcon={<MdAdd />} isDisabled={disabled || nonnegativeInput(pendingDepositLot.amountPln, 1000000) === null || nonnegativeInput(pendingDepositLot.refundCapPln, 1000000) === null || !pendingDepositLot.creditedMonth || !pendingDepositLot.expiresMonth} onClick={addDepositLot}>Zapisz transzę</Button>
          <Button size="xs" variant="ghost" isDisabled={disabled} onClick={() => { setPendingDepositLot(null); setLotValidationError(''); }}>Anuluj</Button>
        </Grid> : null}
      </Box>
    </Box>
  </Box>;
}
