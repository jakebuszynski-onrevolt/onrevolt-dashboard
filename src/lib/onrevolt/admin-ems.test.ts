import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_EMS_COMMAND_POLL_LIMIT,
  classifyAdminEmsGroup,
  compareAdminEmsFirmwareVersions,
  deduplicateAdminEmsStations,
  getAdminEmsExportCommandDisplayState,
  getAdminEmsFirmwareState,
  getAdminEmsRapidCommandDisplayState,
  isAdminEmsCommandPollEligible,
  isAdminEmsLoadRequestCurrent,
} from './admin-ems';

test('klasyfikuje rodziny stacji licznikowych na podstawie pola type', () => {
  assert.equal(classifyAdminEmsGroup('Solis S6 Hybrid'), 'SOLIS');
  assert.equal(classifyAdminEmsGroup('Victron GX'), 'VICTRON');
  assert.equal(classifyAdminEmsGroup('reTerminal E10-1'), 'RETERMINAL');
  assert.equal(classifyAdminEmsGroup('OnRevolt EnergyMeter ESP32'), 'ESP32');
  assert.equal(classifyAdminEmsGroup('ENERGYMETER'), 'ESP32');
  assert.equal(classifyAdminEmsGroup('onrevolt_energy-meter v2'), 'ESP32');
  assert.equal(classifyAdminEmsGroup('SDM630MCT'), 'ESP32');
  assert.equal(classifyAdminEmsGroup('OnRevolt SDM-630-MCT 3-fazowy'), 'ESP32');
  assert.equal(classifyAdminEmsGroup('ENERGYMETER PGE'), 'PGE');
});

test('klasyfikuje PGE tylko jako samodzielny typ lub licznik PGE', () => {
  assert.equal(classifyAdminEmsGroup('PGE'), 'PGE');
  assert.equal(classifyAdminEmsGroup('PGE-SX1276'), 'PGE');
  assert.equal(classifyAdminEmsGroup('PGE SX1276 radio meter'), 'PGE');
  assert.equal(classifyAdminEmsGroup('pGe'), 'PGE');
  assert.equal(classifyAdminEmsGroup('Licznik PGE'), 'PGE');
  assert.equal(classifyAdminEmsGroup('LICZNIK-pGe 3-fazowy'), 'PGE');
  assert.equal(classifyAdminEmsGroup('PGE licznik'), 'PGE');
  assert.equal(classifyAdminEmsGroup('PGE-LICZNIK trójfazowy'), 'PGE');
  assert.equal(classifyAdminEmsGroup('Licznik PGE SDM630MCT'), 'PGE');
  assert.equal(classifyAdminEmsGroup('PGE licznik SDM630MCT EnergyMeter'), 'PGE');
  assert.equal(classifyAdminEmsGroup('PGE Energy'), 'OTHER');
  assert.equal(classifyAdminEmsGroup('PGE inverter'), 'OTHER');
});

test('rodzina urządzenia ma pierwszeństwo przed słowem PGE', () => {
  assert.equal(classifyAdminEmsGroup('Solis S6 PGE'), 'SOLIS');
  assert.equal(classifyAdminEmsGroup('Victron GX PGE'), 'VICTRON');
  assert.equal(classifyAdminEmsGroup('reTerminal PGE'), 'RETERMINAL');
});

test('PGE ma pierwszeństwo przed rodziną licznika w typie mieszanym', () => {
  assert.equal(classifyAdminEmsGroup('Licznik PGE SDM630MCT'), 'PGE');
  assert.equal(classifyAdminEmsGroup('SDM630MCT PGE'), 'PGE');
});

test('nieznane typy pozostają w kategorii pozostałych', () => {
  assert.equal(classifyAdminEmsGroup('nieznany kontroler'), 'OTHER');
  assert.equal(classifyAdminEmsGroup(null), 'OTHER');
});

test('status firmware Solis odróżnia aktualne, dostępne, trwające, błędne i nieznane', () => {
  const common = {
    type: 'Solis S6 Hybrid',
    firmwareVersion: '2026.09.02.3',
    firmwareTargetVersion: null,
    otaEnabled: false,
    otaLastStatus: null,
    latestVersion: '2026.09.02.3',
  };

  assert.equal(getAdminEmsFirmwareState(common), 'CURRENT');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestVersion: '2026.10.01.1' }), 'UPDATE_AVAILABLE');
  assert.equal(getAdminEmsFirmwareState({ ...common, otaEnabled: true }), 'UPDATING');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestVersion: '2026.10.01.1', otaLastStatus: 'failed' }), 'FAILED');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestVersion: null }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, firmwareVersion: null }), 'MISSING');
  assert.equal(getAdminEmsFirmwareState({ ...common, type: 'OnRevolt EnergyMeter ESP32' }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, type: 'PGE', otaEnabled: true }), 'UPDATING');
  assert.equal(getAdminEmsFirmwareState({ ...common, type: 'Victron GX' }), 'UNKNOWN');
});

test('status firmware ESP32 korzysta wyłącznie z katalogu EnergyMeter', () => {
  const common = {
    type: 'SDM630MCT EnergyMeter ESP32',
    firmwareVersion: '2026.09.26.2',
    firmwareTargetVersion: null,
    otaEnabled: false,
    otaLastStatus: null,
    latestVersion: '2026.10.01.1',
    latestEnergyMeterVersion: '2026.09.26.2',
  };

  assert.equal(getAdminEmsFirmwareState(common), 'CURRENT');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestEnergyMeterVersion: '2026.10.01.1' }), 'UPDATE_AVAILABLE');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestVersion: null, latestEnergyMeterVersion: '2026.10.01.1' }), 'UPDATE_AVAILABLE');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestEnergyMeterVersion: null }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestEnergyMeterVersion: '2026.09.26.1' }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestEnergyMeterVersion: '2026.09.26.2', otaEnabled: true }), 'UPDATING');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestEnergyMeterVersion: '2026.09.26.2', otaLastStatus: 'failed' }), 'FAILED');
  assert.equal(getAdminEmsFirmwareState({ ...common, type: 'Licznik PGE', latestEnergyMeterVersion: '2026.10.01.1' }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, type: 'Solis S6', latestEnergyMeterVersion: '2026.09.26.2' }), 'UPDATE_AVAILABLE');
});

test('wersje EnergyMeter są porównywane numerycznie po członach', () => {
  assert.equal(compareAdminEmsFirmwareVersions('2026.9.26.10', '2026.9.26.2'), 1);
  assert.equal(compareAdminEmsFirmwareVersions('2026.9.26.2', '2026.9.26.10'), -1);
  assert.equal(compareAdminEmsFirmwareVersions('01.002.0', '1.2'), 0);
  assert.equal(compareAdminEmsFirmwareVersions('2026.09.rc1', '2026.09.1'), null);
});

test('status i prefiks wersji PGE korzystają wyłącznie z katalogu PGE', () => {
  const common = {
    type: 'Licznik PGE-SX1276',
    firmwareVersion: 'PGE-2026.09.26.4',
    firmwareTargetVersion: null,
    otaEnabled: false,
    otaLastStatus: null,
    latestVersion: 'PGE-2026.10.01.1',
    latestEnergyMeterVersion: '2026.10.01.1',
    latestPgeVersion: 'PGE-2026.09.26.4',
  };

  assert.equal(getAdminEmsFirmwareState(common), 'CURRENT');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestPgeVersion: 'PGE-2026.10.01.4' }), 'UPDATE_AVAILABLE');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestPgeVersion: null }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestPgeVersion: 'PGE-2026.09.26.2' }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({ ...common, latestPgeVersion: '2026.09.26.4' }), 'UNKNOWN');
  assert.equal(getAdminEmsFirmwareState({
    ...common,
    type: 'EnergyMeter ESP32',
    firmwareVersion: '2026.09.26.2',
    latestEnergyMeterVersion: null,
    latestPgeVersion: 'PGE-2026.10.01.4',
  }), 'UNKNOWN');
  assert.equal(compareAdminEmsFirmwareVersions('PGE-2026.09.26.10', 'PGE-2026.09.26.2', 'PGE-'), 1);
  assert.equal(compareAdminEmsFirmwareVersions('PGE-2026.09.26.2', 'PGE-2026.09.26.10', 'PGE-'), -1);
  assert.equal(compareAdminEmsFirmwareVersions('2026.09.26.4', 'PGE-2026.09.26.4', 'PGE-'), null);
});

test('deduplikuje stacje po kanonicznym numerze, nie po tokenie/hashu', () => {
  const stations = [
    { station: '41', stationHash: 'hash-a', name: 'pierwszy' },
    { station: '41', stationHash: 'hash-b', name: 'duplikat' },
    { station: '42', stationHash: 'hash-a', name: 'inna stacja' },
    { station: ' ', stationHash: null, name: 'brak identyfikatora' },
  ];

  assert.deepEqual(deduplicateAdminEmsStations(stations), [stations[0], stations[2]]);
});

test('status komendy nie pokazuje sukcesu dla błędu, wygaśnięcia ani oczekiwania', () => {
  assert.equal(getAdminEmsRapidCommandDisplayState('PENDING', null, true), 'PENDING');
  assert.equal(getAdminEmsRapidCommandDisplayState('FAILED', false, true), 'FAILED');
  assert.equal(getAdminEmsRapidCommandDisplayState('EXPIRED', null, true), 'EXPIRED');
  assert.equal(getAdminEmsRapidCommandDisplayState('ACKED', true, false), 'ACKED');
  assert.equal(getAdminEmsRapidCommandDisplayState('ACKNOWLEDGED', false, true), 'FAILED');
  assert.equal(getAdminEmsRapidCommandDisplayState('ACKNOWLEDGED', null, true), 'UNKNOWN');
  assert.equal(getAdminEmsRapidCommandDisplayState('IDLE', null, true), 'APPLIED');
  assert.equal(getAdminEmsRapidCommandDisplayState('IDLE', null, false), 'NOT_APPLIED');
});

test('status eksportu zależy wyłącznie od ostatniej komendy blokady eksportu', () => {
  assert.equal(getAdminEmsExportCommandDisplayState('EXPORT_BLOCK_ON', 'PENDING', null, false), 'PENDING');
  assert.equal(getAdminEmsExportCommandDisplayState('EXPORT_BLOCK_OFF', 'FAILED', false, true), 'FAILED');
  assert.equal(getAdminEmsExportCommandDisplayState('EXPORT_BLOCK_ON', 'EXPIRED', null, false), 'EXPIRED');
  assert.equal(getAdminEmsExportCommandDisplayState('EXPORT_BLOCK_OFF', 'ACKED', true, true), 'ACKED');

  assert.equal(getAdminEmsExportCommandDisplayState('OTA_CHECK_NOW', 'PENDING', null, true), 'APPLIED');
  assert.equal(getAdminEmsExportCommandDisplayState('PV_BLOCK_ON', 'FAILED', false, false), 'NOT_APPLIED');
  assert.equal(getAdminEmsExportCommandDisplayState('OTHER_COMMAND', 'ACKED', true, null), 'UNKNOWN');
  assert.equal(getAdminEmsExportCommandDisplayState(null, 'PENDING', null, true), 'APPLIED');
});

test('automatyczny polling kończy się po ograniczonej liczbie prób', () => {
  assert.equal(isAdminEmsCommandPollEligible('PENDING', 0), true);
  assert.equal(isAdminEmsCommandPollEligible('PENDING', ADMIN_EMS_COMMAND_POLL_LIMIT - 1), true);
  assert.equal(isAdminEmsCommandPollEligible('PENDING', ADMIN_EMS_COMMAND_POLL_LIMIT), false);
  assert.equal(isAdminEmsCommandPollEligible('FAILED', 0), false);
});

test('odpowiedź może ustawić stan tylko z najnowszego requestu podczas montowania', () => {
  assert.equal(isAdminEmsLoadRequestCurrent(4, 4, true), true);
  assert.equal(isAdminEmsLoadRequestCurrent(3, 4, true), false);
  assert.equal(isAdminEmsLoadRequestCurrent(4, 4, false), false);
});
