'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Box, FormControl, FormLabel, Input, Select, Textarea, useColorModeValue, type TextareaProps } from '@chakra-ui/react';
import InvestmentLocationPicker from './InvestmentLocationPicker';
import styles from './ClientDetailsForm.module.css';

export const clientDetailsKeys = [
  'displayName', 'clientType', 'phone', 'email', 'taxId', 'addressLine', 'postalCode', 'city',
  'investmentAddress', 'latitude', 'longitude', 'mapProvider', 'ownerId', 'clientProblem', 'expectedResult',
  'projectTitle', 'projectClientType', 'status', 'stageId', 'nextActionTitle', 'nextActionAt',
] as const;
export type ClientDetailsValues = Record<typeof clientDetailsKeys[number], string>;
type Props = {
  values: ClientDetailsValues;
  registeredAt?: string | null;
  origin: string;
  statusLabel: string;
  clientTypes: ReadonlyArray<readonly [string, string]>;
  staff: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string }>;
  saving: boolean;
  disabled?: boolean;
  onChange: (key: keyof ClientDetailsValues, value: string) => void;
  onAddressChange: (value: string) => void;
  onLocationSelect: (result: { address: string; latitude: number; longitude: number }) => void;
  onStageChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

function GrowingTextarea({ onInput, value, ...props }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const width = useRef(0);
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(124, element.scrollHeight + element.offsetHeight - element.clientHeight)}px`;
  }, []);
  useLayoutEffect(resize, [resize, value]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width.current) return;
      width.current = entry.contentRect.width;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [resize]);
  return <Textarea {...props} ref={ref} value={value} rows={4} resize="none" overflowY="hidden"
    onInput={event => { onInput?.(event); resize(); }} />;
}

export function resetClientDetails<T extends ClientDetailsValues>(current: T, saved: ClientDetailsValues): T {
  const next = { ...current };
  for (const key of clientDetailsKeys) next[key] = saved[key];
  return next;
}

export default function ClientDetailsForm(props: Props) {
  const { values, onChange } = props;
  const disabled = props.saving || props.disabled;
  const colors = {
    '--details-bg': useColorModeValue('#ffffff', '#111c44'),
    '--details-text': useColorModeValue('#1b2559', '#ffffff'),
    '--details-muted': useColorModeValue('#8f9bba', '#a3aed0'),
    '--details-line': useColorModeValue('#e9edf7', '#2b365d'),
    '--details-soft': useColorModeValue('#f4f7fe', '#1b2857'),
  };
  const input = (key: keyof ClientDetailsValues, label: string, type = 'text', required = false) => (
    <FormControl className={styles.field} isRequired={required} isDisabled={disabled}>
      <FormLabel>{label}</FormLabel><Input type={type} value={values[key]} onChange={event => onChange(key, event.target.value)} />
    </FormControl>
  );
  const typeSelect = (key: 'clientType' | 'projectClientType', label: string) => (
    <FormControl className={styles.field} isDisabled={disabled}><FormLabel>{label}</FormLabel>
      <Select value={values[key]} onChange={event => onChange(key, event.target.value)}>
        {props.clientTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    </FormControl>
  );
  const registration = props.registeredAt ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw' }).format(new Date(props.registeredAt)) : '';
  return <Box className={styles.root} style={colors as React.CSSProperties}>
    <section className={styles.section} aria-label="Podstawowe informacje">
      <header className={styles.header}>
        <h2>Podstawowe informacje</h2>
        <div className={styles.actions}>
          <button type="button" disabled={disabled} onClick={props.onCancel}>Anuluj</button>
          <button type="button" className={styles.save} disabled={disabled || !values.displayName.trim()} onClick={props.onSave}>{props.saving ? 'Zapisywanie…' : 'Zapisz zmiany'}</button>
        </div>
      </header>
      <div className={styles.columns}>
        <div className={styles.column}>
          {input('displayName', 'Imię i nazwisko / Nazwa', 'text', true)}
          {typeSelect('clientType', 'Typ klienta')}
          {input('phone', 'Telefon', 'tel')}
          {input('email', 'Adres e-mail', 'email')}
        </div>
        <div className={styles.column}>
          <h3 className={styles.addressHeading}>Adres korespondencyjny</h3>
          {input('addressLine', 'Ulica')}
          {input('postalCode', 'Kod')}
          {input('city', 'Miasto')}
        </div>
        <div className={styles.column}>
          {input('taxId', 'NIP')}
          <FormControl className={styles.field} isDisabled={disabled}>
            <FormLabel>Opiekun projektu</FormLabel>
            <Select value={values.ownerId} onChange={event => onChange('ownerId', event.target.value)}>
              <option value="">Nieprzypisany</option>
              {props.staff.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
          </FormControl>
          <FormControl className={styles.field}><FormLabel>Data rejestracji</FormLabel><Input value={registration} isReadOnly placeholder="Brak danych" /></FormControl>
          <FormControl className={styles.field}><FormLabel>Źródło projektu</FormLabel><Input value={props.origin} isReadOnly placeholder="Nie określono" /></FormControl>
        </div>
        <div className={styles.column}>
          <FormControl className={styles.field} isDisabled={disabled}><FormLabel>Problematyka</FormLabel><GrowingTextarea value={values.clientProblem} onChange={event => onChange('clientProblem', event.target.value)} /></FormControl>
          <FormControl className={styles.field} isDisabled={disabled}><FormLabel>Oczekiwany rezultat</FormLabel><GrowingTextarea value={values.expectedResult} onChange={event => onChange('expectedResult', event.target.value)} /></FormControl>
        </div>
      </div>
      <fieldset disabled={disabled} className={styles.location}>
        <InvestmentLocationPicker address={values.investmentAddress} latitude={values.latitude} longitude={values.longitude}
          mapProvider={values.mapProvider} onAddressChange={props.onAddressChange}
          onMapProviderChange={value => onChange('mapProvider', value)} onSelect={props.onLocationSelect} />
      </fieldset>
    </section>
    <section className={styles.section} aria-label="Projekt i etap procesu">
      <header className={styles.header}><h2>Projekt i etap procesu</h2></header>
      <div className={styles.projectGrid}>
        {input('projectTitle', 'Nazwa projektu')}
        {typeSelect('projectClientType', 'Typ projektu')}
        <FormControl className={styles.field}><FormLabel>Status projektu</FormLabel><Input value={props.statusLabel} isReadOnly /></FormControl>
        <FormControl className={styles.field} isDisabled={disabled}><FormLabel>Etap</FormLabel>
          <Select value={values.stageId} onChange={event => props.onStageChange(event.target.value)}><option value="">Brak etapu</option>{props.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</Select>
        </FormControl>
        {input('nextActionTitle', 'Następne działanie')}
        {input('nextActionAt', 'Termin następnego działania', 'datetime-local')}
        <FormControl className={`${styles.field} ${styles.projectAddress}`} isDisabled={disabled}><FormLabel>Adres inwestycji projektu</FormLabel><Input value={values.investmentAddress} onChange={event => props.onAddressChange(event.target.value)} /></FormControl>
      </div>
    </section>
  </Box>;
}
