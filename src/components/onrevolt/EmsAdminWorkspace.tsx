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
  Heading,
  HStack,
  Icon,
  Spinner,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdCheckCircle, MdRefresh } from 'react-icons/md';
import {
  ADMIN_EMS_COMMAND_POLL_INTERVAL_MS,
  ADMIN_EMS_COMMAND_POLL_LIMIT,
  classifyAdminEmsGroup,
  getAdminEmsFirmwareState,
  getAdminEmsExportCommandDisplayState,
  isAdminEmsExportCommand,
  isAdminEmsCommandPollEligible,
  isAdminEmsLoadRequestCurrent,
  type AdminEmsGroup,
} from 'lib/onrevolt/admin-ems';
import { isValidSolisSmartPortFanSettings } from 'lib/onrevolt/solis-fan';
import { supportsSolisRapidCommands } from 'lib/onrevolt/solis-ota';

type EmsStationRow = {
  projectId: string | null;
  clientId: string | null;
  projectName: string | null;
  clientName: string | null;
  station: string;
  parentStation: string | null;
  parentProjectName: string | null;
  parentClientName: string | null;
  type: string | null;
  firmwareVersion: string | null;
  firmwareTargetVersion: string | null;
  otaEnabled: boolean | null;
  otaLastStatus: string | null;
  otaLastError: string | null;
  otaLastAt: string | null;
  controlEnabled: boolean | null;
  shadowOnly: boolean | null;
  inverterRatedPowerW: number | null;
  exportBlocked: boolean | null;
  exportBlockApplied: boolean | null;
  smartPortFanEnabled: boolean | null;
  smartPortFanOnTemperatureCx10: number | null;
  smartPortFanOffTemperatureCx10: number | null;
  rapidCommand: string | null;
  rapidCommandSequence: number;
  rapidCommandExpiresAt: string | null;
  rapidCommandAcknowledgedSequence: number;
  rapidCommandAcknowledgedAt: string | null;
  rapidCommandResult: string | null;
  rapidCommandOk: boolean | null;
  rapidCommandState: 'IDLE' | 'PENDING' | 'EXPIRED' | 'ACKNOWLEDGED' | 'ACKED' | 'FAILED' | null;
};

type EmsListData = {
  stations: EmsStationRow[];
  latestFirmwareVersion: string | null;
  firmwareCatalogError: string | null;
  latestEnergyMeterFirmwareVersion: string | null;
  energyMeterFirmwareCatalogError: string | null;
  latestPgeFirmwareVersion: string | null;
  pgeFirmwareCatalogError: string | null;
};

const sections: Array<{ id: AdminEmsGroup; title: string }> = [
  { id: 'SOLIS', title: 'Solis' },
  { id: 'VICTRON', title: 'Victron' },
  { id: 'RETERMINAL', title: 'reTerminal' },
  { id: 'ESP32', title: 'Liczniki (ESP32)' },
  { id: 'PGE', title: 'PGE' },
  { id: 'OTHER', title: 'Pozostałe' },
];

const numberFormat = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });

function firmwareStateLabel(
  state: ReturnType<typeof getAdminEmsFirmwareState>,
  hasVersion: boolean,
  currentVersion: string | null,
  latestVersion: string | null,
) {
  switch (state) {
    case 'CURRENT': return { label: 'Aktualny', color: 'green' };
    case 'UPDATE_AVAILABLE': return { label: 'Dostępna aktualizacja', color: 'orange' };
    case 'UPDATING': return { label: 'Aktualizacja w toku', color: 'blue' };
    case 'FAILED': return { label: 'Błąd OTA', color: 'red' };
    case 'MISSING': return { label: 'Brak danych', color: 'gray' };
    case 'UNKNOWN': {
      if (!hasVersion) return { label: 'Brak danych', color: 'gray' };
      if (currentVersion && latestVersion) {
        return { label: 'Wersja spoza katalogu', color: 'gray' };
      }
      return { label: 'Brak katalogu porównawczego', color: 'gray' };
    }
    default: return { label: 'Nieobsługiwane', color: 'gray' };
  }
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : value;
}

function temperatureLabel(value: number | null) {
  return value == null || value <= 0 ? null : `${numberFormat.format(value / 10)}°C`;
}

export default function EmsAdminWorkspace() {
  const [stations, setStations] = useState<EmsStationRow[]>([]);
  const stationsRef = useRef<EmsStationRow[]>([]);
  const latestLoadRequestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const pollAttemptsRef = useRef(new Map<string, number>());
  const busyStationsRef = useRef(new Set<string>());
  const [latestFirmwareVersion, setLatestFirmwareVersion] = useState<string | null>(null);
  const [firmwareCatalogError, setFirmwareCatalogError] = useState<string | null>(null);
  const [latestEnergyMeterFirmwareVersion, setLatestEnergyMeterFirmwareVersion] = useState<string | null>(null);
  const [energyMeterFirmwareCatalogError, setEnergyMeterFirmwareCatalogError] = useState<string | null>(null);
  const [latestPgeFirmwareVersion, setLatestPgeFirmwareVersion] = useState<string | null>(null);
  const [pgeFirmwareCatalogError, setPgeFirmwareCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busyStations, setBusyStations] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestLoadRequestIdRef.current += 1;
    };
  }, []);

  const loadStations = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRequestIdRef.current;
    const isCurrentRequest = () => isAdminEmsLoadRequestCurrent(
      requestId,
      latestLoadRequestIdRef.current,
      mountedRef.current,
    );
    if (!mountedRef.current) return false;

    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch('/api/admin/ems', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }
      if (!isCurrentRequest()) return false;

      const data = payload.data as EmsListData;
      stationsRef.current = data.stations;
      const currentPollKeys = new Set(data.stations
        .filter((station) => station.rapidCommandState === 'PENDING')
        .map((station) => `${station.station}:${station.rapidCommandSequence}`));
      for (const key of pollAttemptsRef.current.keys()) {
        if (!currentPollKeys.has(key)) pollAttemptsRef.current.delete(key);
      }
      setStations(data.stations);
      setLatestFirmwareVersion(data.latestFirmwareVersion);
      setFirmwareCatalogError(data.firmwareCatalogError);
      setLatestEnergyMeterFirmwareVersion(data.latestEnergyMeterFirmwareVersion ?? null);
      setEnergyMeterFirmwareCatalogError(data.energyMeterFirmwareCatalogError ?? null);
      setLatestPgeFirmwareVersion(data.latestPgeFirmwareVersion ?? null);
      setPgeFirmwareCatalogError(data.pgeFirmwareCatalogError ?? null);
      setLoadError('');
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      setLoadError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  const pendingCommandSignature = useMemo(() => stations
    .filter((station) => station.rapidCommandState === 'PENDING')
    .map((station) => `${station.station}:${station.rapidCommandSequence}`)
    .sort()
    .join('|'), [stations]);

  useEffect(() => {
    if (!pendingCommandSignature) return undefined;
    let disposed = false;
    let timer: number | undefined;

    const schedulePoll = () => {
      const pending = stationsRef.current.filter((station) => station.rapidCommandState === 'PENDING');
      const eligible = pending.filter((station) => isAdminEmsCommandPollEligible(
        station.rapidCommandState,
        pollAttemptsRef.current.get(`${station.station}:${station.rapidCommandSequence}`) || 0,
      ));
      if (disposed || !eligible.length) return;

      timer = window.setTimeout(async () => {
        if (disposed) return;
        for (const station of eligible) {
          const key = `${station.station}:${station.rapidCommandSequence}`;
          pollAttemptsRef.current.set(key, (pollAttemptsRef.current.get(key) || 0) + 1);
        }
        await loadStations(true);
        if (!disposed) schedulePoll();
      }, ADMIN_EMS_COMMAND_POLL_INTERVAL_MS);
    };

    schedulePoll();
    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [pendingCommandSignature, loadStations]);

  const groupedStations = useMemo(() => {
    const grouped = new Map<AdminEmsGroup, EmsStationRow[]>(sections.map(({ id }) => [id, []]));
    for (const station of stations) {
      grouped.get(classifyAdminEmsGroup(station.type))?.push(station);
    }
    return grouped;
  }, [stations]);

  function setStationBusy(stationId: string, busy: boolean) {
    const current = busyStationsRef.current;
    if (busy && current.has(stationId)) return false;
    const next = new Set(current);
    if (busy) next.add(stationId);
    else next.delete(stationId);
    busyStationsRef.current = next;
    setBusyStations(next);
    return true;
  }

  async function patchStation(row: EmsStationRow, action: string, extra: Record<string, unknown>, confirmText: string) {
    if (!row.projectId || !row.clientId) return;
    if (!window.confirm(`${confirmText}\n\nProjekt: ${row.projectName || 'Brak przypisanego projektu'}\nStacja: ${row.station}`)) return;
    const stationId = row.station.trim();
    if (!setStationBusy(stationId, true)) return;
    setActionErrors((current) => ({ ...current, [stationId]: '' }));
    try {
      const response = await fetch('/api/integrations/re/station', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: row.clientId,
          projectId: row.projectId,
          action,
          ...extra,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }
      const refreshed = await loadStations(true);
      if (!refreshed) {
        setActionErrors((current) => ({
          ...current,
          [stationId]: 'Zapisano zmianę, ale lista nie odświeżyła się. Użyj przycisku odświeżania.',
        }));
      }
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [stationId]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setStationBusy(stationId, false);
    }
  }

  function solisControl(row: EmsStationRow) {
    if (row.controlEnabled == null || row.shadowOnly == null) return <Text color="secondaryGray.600">Brak danych</Text>;
    const busy = busyStations.has(row.station);
    const unavailable = !row.projectId || !row.clientId;
    return (
      <VStack align="start" spacing="1">
        <Checkbox
          size="sm"
          isChecked={row.controlEnabled}
          isDisabled={busy || unavailable}
          onChange={(event) => void patchStation(
            row,
            'UPDATE_CONTROL_SETTINGS',
            { controlEnabled: event.target.checked, shadowOnly: row.shadowOnly },
            `${event.target.checked ? 'Włączyć' : 'Wyłączyć'} kontrolę falownika?`,
          )}
        >Kontrola włączona</Checkbox>
        <Checkbox
          size="sm"
          isChecked={row.shadowOnly}
          isDisabled={busy || unavailable}
          onChange={(event) => void patchStation(
            row,
            'UPDATE_CONTROL_SETTINGS',
            { controlEnabled: row.controlEnabled, shadowOnly: event.target.checked },
            `${event.target.checked ? 'Włączyć tryb tylko podglądu' : 'Włączyć aktywne sterowanie'}?`,
          )}
        >Tylko podgląd</Checkbox>
        {unavailable ? <Text fontSize="xs" color="secondaryGray.600">Brak projektu — sterowanie niedostępne</Text> : null}
      </VStack>
    );
  }

  function exportControl(row: EmsStationRow) {
    if (row.exportBlocked == null) return <Text color="secondaryGray.600">Brak danych</Text>;
    const supported = supportsSolisRapidCommands(row.firmwareVersion);
    const commandPending = row.rapidCommandState === 'PENDING';
    const exportCommandPending = commandPending && isAdminEmsExportCommand(row.rapidCommand);
    const busy = busyStations.has(row.station);
    const unavailable = !row.projectId || !row.clientId;
    const exportStateMatches = row.exportBlockApplied == null || row.exportBlocked == null
      ? null
      : row.exportBlockApplied === row.exportBlocked;
    const commandDisplayState = getAdminEmsExportCommandDisplayState(
      row.rapidCommand,
      row.rapidCommandState,
      row.rapidCommandOk,
      exportStateMatches,
    );
    const commandStatus = {
      PENDING: { label: 'Oczekiwanie na urządzenie', color: 'orange.500' },
      FAILED: { label: 'Polecenie nie powiodło się', color: 'red.500' },
      EXPIRED: { label: 'Polecenie wygasło bez potwierdzenia', color: 'orange.500' },
      ACKED: { label: 'Potwierdzono polecenie', color: 'green.600' },
      APPLIED: { label: 'Stan potwierdzony', color: 'green.600' },
      NOT_APPLIED: { label: 'Stan niepotwierdzony', color: 'orange.500' },
      UNKNOWN: { label: 'Brak potwierdzenia', color: 'secondaryGray.600' },
    }[commandDisplayState];
    return (
      <VStack align="start" spacing="1">
        <Checkbox
          size="sm"
          colorScheme="orange"
          isChecked={row.exportBlocked}
          isDisabled={busy || unavailable || !supported || commandPending}
          onChange={(event) => void patchStation(
            row,
            'REQUEST_RAPID_COMMAND',
            { command: event.target.checked ? 'EXPORT_BLOCK_ON' : 'EXPORT_BLOCK_OFF' },
            `${event.target.checked ? 'Włączyć blokadę' : 'Wyłączyć blokadę'} eksportu do sieci?`,
          )}
        >Blokada eksportu</Checkbox>
        <Text fontSize="xs" color={commandStatus.color}>
          {!supported
            ? 'Wymaga nowszego firmware'
            : exportCommandPending && (pollAttemptsRef.current.get(`${row.station}:${row.rapidCommandSequence}`) || 0) >= ADMIN_EMS_COMMAND_POLL_LIMIT
              ? 'Brak odpowiedzi po 30 s · odśwież ręcznie'
              : commandStatus.label}
        </Text>
        {unavailable ? <Text fontSize="xs" color="secondaryGray.600">Brak projektu — sterowanie niedostępne</Text> : null}
      </VStack>
    );
  }

  function fanControl(row: EmsStationRow) {
    if (row.smartPortFanEnabled == null) return <Text color="secondaryGray.600">Brak danych</Text>;
    const onTemperatureCx10 = row.smartPortFanOnTemperatureCx10 ?? 0;
    const offTemperatureCx10 = row.smartPortFanOffTemperatureCx10 ?? 0;
    const thresholdsValid = isValidSolisSmartPortFanSettings({
      enabled: row.smartPortFanEnabled,
      onTemperatureCx10,
      offTemperatureCx10,
    });
    const busy = busyStations.has(row.station);
    const unavailable = !row.projectId || !row.clientId;
    return (
      <VStack align="start" spacing="1">
        <Checkbox
          size="sm"
          colorScheme="teal"
          isChecked={row.smartPortFanEnabled}
          isDisabled={busy || unavailable || (!row.smartPortFanEnabled && !thresholdsValid)}
          onChange={(event) => void patchStation(
            row,
            'UPDATE_SMART_PORT_FAN_SETTINGS',
            { enabled: event.target.checked, onTemperatureCx10, offTemperatureCx10 },
            `${event.target.checked ? 'Włączyć' : 'Wyłączyć'} automatykę wentylatora?`,
          )}
        >Sterowanie wentylatorem</Checkbox>
        <Text fontSize="xs" color="secondaryGray.600">
          {temperatureLabel(onTemperatureCx10) && temperatureLabel(offTemperatureCx10)
            ? `Wł. ${temperatureLabel(onTemperatureCx10)} · wył. ${temperatureLabel(offTemperatureCx10)}`
            : 'Brak prawidłowych progów temperatury'}
        </Text>
        {unavailable ? <Text fontSize="xs" color="secondaryGray.600">Brak projektu — sterowanie niedostępne</Text> : null}
      </VStack>
    );
  }

  function renderTable(group: AdminEmsGroup, rows: EmsStationRow[]) {
    const isSolis = group === 'SOLIS';
    return (
      <TableContainer overflowX="auto">
        <Table size="sm" minW="1420px" variant="simple">
          <Thead>
            <Tr>
              <Th minW="220px">Projekt / klient i stacja</Th>
              <Th minW="170px">Typ / moc</Th>
              <Th minW="165px">Aktualność firmware</Th>
              <Th minW="145px">Aktualny firmware</Th>
              <Th minW="190px">OTA</Th>
              <Th minW="180px">Kontrola falownika</Th>
              <Th minW="165px">Blokada eksportu</Th>
              <Th minW="190px">Wentylator</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const latestVersion = group === 'SOLIS'
                ? latestFirmwareVersion
                : group === 'ESP32'
                  ? latestEnergyMeterFirmwareVersion
                  : group === 'PGE' ? latestPgeFirmwareVersion : null;
              const firmwareState = getAdminEmsFirmwareState({
                type: row.type,
                firmwareVersion: row.firmwareVersion,
                firmwareTargetVersion: row.firmwareTargetVersion,
                otaEnabled: row.otaEnabled === true,
                otaLastStatus: row.otaLastStatus,
                latestVersion: group === 'SOLIS' ? latestFirmwareVersion : null,
                latestEnergyMeterVersion: group === 'ESP32' ? latestEnergyMeterFirmwareVersion : null,
                latestPgeVersion: group === 'PGE' ? latestPgeFirmwareVersion : null,
              });
              const freshness = firmwareStateLabel(
                firmwareState,
                Boolean(row.firmwareVersion),
                row.firmwareVersion,
                latestVersion,
              );
              const power = row.inverterRatedPowerW && row.inverterRatedPowerW > 0
                ? `${numberFormat.format(row.inverterRatedPowerW / 1000)} kW`
                : 'Brak danych';
              const actionError = actionErrors[row.station];
              const parentLabel = row.parentStation
                ? `Podstacja ${row.station} · ${row.parentClientName || row.parentProjectName || `stacja nadrzędna ${row.parentStation}`}`
                : null;
              return (
                <Tr key={row.station}>
                  <Td>
                    <Text fontWeight="700" color="navy.700">
                      {row.projectName || parentLabel || 'Nieprzypisana do projektu'}
                    </Text>
                    {row.projectName && row.clientName ? (
                      <Text fontSize="xs" color="secondaryGray.600">{row.clientName}</Text>
                    ) : null}
                    {row.projectName && row.parentStation ? (
                      <Text fontSize="xs" color="secondaryGray.600">
                        Podstacja stacji {row.parentStation}
                      </Text>
                    ) : null}
                    {!row.projectName
                      && row.parentClientName
                      && row.parentProjectName
                      && row.parentProjectName !== row.parentClientName ? (
                      <Text fontSize="xs" color="secondaryGray.600">Projekt nadrzędny: {row.parentProjectName}</Text>
                    ) : null}
                    <Text fontSize="xs" color="secondaryGray.600">
                      Stacja: {row.station}
                    </Text>
                    {actionError ? <Text fontSize="xs" color="red.500" mt="1">{actionError}</Text> : null}
                  </Td>
                  <Td>
                    <Text>{row.type || 'Brak danych'}</Text>
                    <Text fontSize="xs" color="secondaryGray.600">{power}</Text>
                  </Td>
                  <Td>
                    <Badge colorScheme={freshness.color}>
                      {firmwareState === 'CURRENT' ? <Icon as={MdCheckCircle} me="1" /> : null}
                      {freshness.label}
                    </Badge>
                    {latestVersion ? (
                      <Text fontSize="xs" color="secondaryGray.600" mt="1">Najnowsza: {latestVersion}</Text>
                    ) : null}
                  </Td>
                  <Td>{row.firmwareVersion || 'Brak danych'}</Td>
                  <Td>
                    {row.otaEnabled == null
                      ? <Text color="secondaryGray.600">Brak danych</Text>
                      : (
                        <VStack align="start" spacing="0">
                          <Text fontWeight="600">{row.otaEnabled ? 'Włączone' : 'Wyłączone'}</Text>
                          <Text fontSize="xs" color="secondaryGray.600">{row.otaLastStatus || 'Brak ostatniego statusu'}</Text>
                          {row.firmwareTargetVersion ? <Text fontSize="xs">Cel: {row.firmwareTargetVersion}</Text> : null}
                          {row.otaLastAt ? <Text fontSize="xs" color="secondaryGray.600">{dateLabel(row.otaLastAt)}</Text> : null}
                          {row.otaLastError ? <Text fontSize="xs" color="red.500">{row.otaLastError}</Text> : null}
                        </VStack>
                      )}
                  </Td>
                  <Td>{isSolis ? solisControl(row) : <Text color="secondaryGray.600">Nieobsługiwane</Text>}</Td>
                  <Td>{isSolis ? exportControl(row) : <Text color="secondaryGray.600">Nieobsługiwane</Text>}</Td>
                  <Td>{isSolis ? fanControl(row) : <Text color="secondaryGray.600">Nieobsługiwane</Text>}</Td>
                </Tr>
              );
            })}
            {!rows.length ? (
              <Tr>
                <Td colSpan={8} color="secondaryGray.600">Brak stacji w tej grupie.</Td>
              </Tr>
            ) : null}
          </Tbody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Box pt={{ base: '100px', md: '80px', xl: '80px' }}>
      <Flex justify="space-between" align={{ base: 'start', md: 'center' }} gap="4" wrap="wrap" mb="6">
        <Box>
          <Heading size="lg" color="navy.700">EMS</Heading>
          <Text color="secondaryGray.600" mt="1">Stacje i sterowanie urządzeniami</Text>
        </Box>
        <Button
          leftIcon={<Icon as={MdRefresh} />}
          variant="outline"
          onClick={() => void loadStations(true)}
          isLoading={refreshing}
          isDisabled={loading}
        >Odśwież</Button>
      </Flex>

      {loadError ? (
        <Alert status="error" borderRadius="8px" mb="5">
          <AlertIcon />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {firmwareCatalogError ? (
        <Alert status="warning" borderRadius="8px" mb="5">
          <AlertIcon />
          <AlertDescription>
            Nie udało się zweryfikować najnowszej wersji Solis: {firmwareCatalogError}. Status aktualności pozostaje niepotwierdzony.
          </AlertDescription>
        </Alert>
      ) : null}
      {energyMeterFirmwareCatalogError?.trim() ? (
        <Alert status="warning" borderRadius="8px" mb="5">
          <AlertIcon />
          <AlertDescription>
            Nie udało się odczytać katalogu firmware EnergyMeter: {energyMeterFirmwareCatalogError}. Status aktualności liczników ESP32 pozostaje niepotwierdzony.
          </AlertDescription>
        </Alert>
      ) : null}
      {pgeFirmwareCatalogError?.trim() ? (
        <Alert status="warning" borderRadius="8px" mb="5">
          <AlertIcon />
          <AlertDescription>
            Nie udało się odczytać katalogu firmware PGE: {pgeFirmwareCatalogError}. Status aktualności urządzeń PGE pozostaje niepotwierdzony.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <Flex justify="center" py="16"><Spinner size="lg" /></Flex>
      ) : (
        <VStack align="stretch" spacing="5">
          {sections.map(({ id, title }) => {
            const rows = groupedStations.get(id) || [];
            return (
              <Box key={id} borderWidth="1px" borderColor="gray.200" borderRadius="8px" bg="white" overflow="hidden">
                <Flex justify="space-between" align="center" px="5" py="4" gap="3" wrap="wrap">
                  <HStack>
                    <Heading size="sm" color="navy.700">{title}</Heading>
                    <Badge colorScheme="gray">{rows.length}</Badge>
                  </HStack>
                </Flex>
                {renderTable(id, rows)}
                {id === 'SOLIS' ? (
                  <Flex justify="flex-end" px="5" py="4" borderTopWidth="1px" borderColor="gray.100">
                    <Button size="sm" colorScheme="purple" isDisabled>
                      Aktualizuj wszystkie
                    </Button>
                  </Flex>
                ) : null}
              </Box>
            );
          })}
        </VStack>
      )}
    </Box>
  );
}
