'use client';

import { Button, HStack, Input, Text, VStack } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { saleInputToUnitNet } from 'lib/onrevolt/template-sale-input';

type Props = {
  index: number;
  unitNet: number | null;
  vatRate: number | null;
  manual: boolean;
  disabled?: boolean;
  onChange: (unitSaleNet: string | null) => void;
};

export default function TemplateSalePriceEditor({ index, unitNet, vatRate, manual, disabled, onChange }: Props) {
  const [draft, setDraft] = useState<{ basis: 'net' | 'gross'; text: string; error: string | null } | null>(null);
  useEffect(() => { setDraft(null); }, [vatRate]);
  useEffect(() => { if (!manual) setDraft(null); }, [manual]);
  const money = (value: number | null) => value === null || !Number.isFinite(value) ? '' : (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

  function change(text: string, basis: 'net' | 'gross') {
    try {
      const value = saleInputToUnitNet(text, basis, vatRate);
      setDraft({ basis, text, error: null });
      onChange(value);
    } catch (error) {
      setDraft({ basis, text, error: error instanceof Error ? error.message : String(error) });
      // Empty is an unfinished edit; null explicitly restores markup pricing.
      onChange('');
    }
  }

  return <VStack align="stretch" spacing="5px" minW="205px">
    <HStack><Text minW="49px" fontSize="sm">netto:</Text><Input aria-label={`Sprzedaż netto za sztukę ${index + 1}`} inputMode="decimal" size="sm" value={draft?.basis === 'net' ? draft.text : money(unitNet)} onChange={event => change(event.target.value, 'net')} onBlur={() => { if (!draft?.error) setDraft(null); }} isDisabled={disabled} isInvalid={draft?.basis === 'net' && Boolean(draft.error)} /></HStack>
    <HStack><Text minW="49px" fontSize="sm">brutto:</Text><Input aria-label={`Sprzedaż brutto za sztukę ${index + 1}`} inputMode="decimal" size="sm" value={draft?.basis === 'gross' ? draft.text : money(unitNet === null || vatRate === null ? null : unitNet * (1 + vatRate))} onChange={event => change(event.target.value, 'gross')} onBlur={() => { if (!draft?.error) setDraft(null); }} isDisabled={disabled || vatRate === null} isInvalid={draft?.basis === 'gross' && Boolean(draft.error)} /></HStack>
    {draft?.error ? <Text fontSize="xs" color="red.600">{draft.error}</Text> : null}
    <Text fontSize="xs">{vatRate === null ? 'Wybierz VAT dla brutto' : `Za sztukę · VAT ${Math.round(vatRate * 100)}%`}</Text>
    {manual ? <Button size="xs" variant="link" alignSelf="flex-start" isDisabled={disabled} onClick={() => { setDraft(null); onChange(null); }}>Przywróć cenę z narzutu</Button> : null}
  </VStack>;
}
