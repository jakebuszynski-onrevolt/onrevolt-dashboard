import { loadEnvConfig } from '@next/env';

function parseArguments(args: string[]) {
  const result = { apply: false, clientId: '', projectId: undefined as string | undefined, replaceExisting: false, kind: 'both' };
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) throw new Error(`Powtórzony argument: ${key}`);
    seen.add(key);
    if (arg === '--apply') result.apply = true;
    else if (arg === '--dry-run') result.apply = false;
    else if (arg === '--replace-existing') result.replaceExisting = true;
    else if (arg.startsWith('--client=')) result.clientId = arg.slice('--client='.length).trim();
    else if (arg.startsWith('--project=')) {
      result.projectId = arg.slice('--project='.length).trim();
      if (!result.projectId) throw new Error('Brak wartości --project');
    } else if (arg.startsWith('--kind=')) result.kind = arg.slice('--kind='.length);
    else throw new Error(`Nieznany argument: ${arg}`);
  }
  if (!result.clientId) throw new Error('Wymagany --client=ID; nie ma domyślnego klienta');
  if (!['import', 'export', 'both'].includes(result.kind)) throw new Error('--kind musi być import, export albo both');
  if (seen.has('--apply') && seen.has('--dry-run')) throw new Error('Wybierz --apply albo --dry-run');
  if (result.replaceExisting && !result.apply) throw new Error('--replace-existing wymaga --apply');
  return result;
}

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    console.log('tsx scripts/sync-crm-consumption-to-re.ts --client=ID [--project=ID] [--kind=import|export|both] [--apply [--replace-existing]]');
    console.log('Domyślnie dry-run: tylko odczyt CRM i walidacja XLSX, bez połączenia z RE. --apply sprawdza RE i domyślnie pomija istniejące XLSX. Przed --apply wykonaj kopię tabel stacji.');
    return;
  }
  const args = parseArguments(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const { prisma } = await import('../src/lib/onrevolt/prisma');
  const { inspectStoredEnergyMeasurementForRe, listReConsumptionMeasurements, syncEnergyMeasurementToRe } = await import('../src/lib/onrevolt/re-consumption-sync');
  try {
    const { project, measurements } = await listReConsumptionMeasurements(args.clientId, args.projectId);
    const selected = measurements.filter((file) => args.kind === 'both'
      || file.kind === (args.kind === 'import' ? 'ACTIVE_IMPORT' : 'ACTIVE_EXPORT'));
    console.log(JSON.stringify({
      mode: args.apply ? 'apply' : 'dry-run', clientId: args.clientId, projectId: project.id,
      station: project.dashboardStationNumber, files: selected.length, replaceExisting: args.replaceExisting,
      message: args.apply ? 'Istniejące XLSX są chronione, chyba że podano --replace-existing.'
        : 'Bez zapisu i bez wywołań RE. Dostępność miesięcy zostanie sprawdzona przy --apply; GET RE może odbudować profil godzinowy.',
    }));
    const counts = { ready: 0, synced: 0, existing: 0, failed: 0 };
    for (const measurement of selected) {
      let result;
      if (args.apply) {
        result = await syncEnergyMeasurementToRe(measurement.id, {
          clientId: args.clientId, projectId: project.id, replaceExisting: args.replaceExisting,
        });
      } else {
        try {
          const inspected = await inspectStoredEnergyMeasurementForRe(measurement.id, { clientId: args.clientId, projectId: project.id });
          result = { status: 'ready', station: project.dashboardStationNumber, workbook: inspected.workbook, message: 'XLSX poprawny; stan RE niesprawdzony, bez zapisu.' };
        } catch (error) {
          result = { status: 'failed', message: error instanceof Error ? error.message : String(error) };
        }
      }
      counts[result.status] += 1;
      console.log(JSON.stringify({ measurementId: measurement.id, kind: measurement.kind, periodYear: measurement.periodYear, periodMonth: measurement.periodMonth, ...result }));
    }
    console.log(JSON.stringify({ counts, message: selected.length ? 'Zakończono.' : 'Brak pasujących pobranych XLSX w ostatnich 12 zamkniętych miesiącach.' }));
    if (counts.failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    const rePrisma = (globalThis as unknown as { onrevoltRePrisma?: { $disconnect(): Promise<void> } }).onrevoltRePrisma;
    if (rePrisma) await rePrisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
