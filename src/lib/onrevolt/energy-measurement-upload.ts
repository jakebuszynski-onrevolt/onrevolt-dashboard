/** Import each file independently, retaining successes when another file is rejected. */
export async function uploadEnergyMeasurementBatch<T extends { name: string }>(
  files: T[], upload: (file: T) => Promise<any>,
) {
  const imported: string[] = [];
  const errors: string[] = [];
  const reWarnings: string[] = [];
  let storedWithoutRe = false;
  for (const file of files) {
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Wybierz miesięczny plik XLSX ENEA.');
      const result = await upload(file);
      imported.push(file.name);
      if (result?.reSync?.status === 'not_linked') storedWithoutRe = true;
      else if (result?.reSync?.status !== 'synced') reWarnings.push(`${file.name}: ${result?.reSync?.message || 'RE nie potwierdziło importu pliku.'}`);
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { imported, errors, reWarnings, storedWithoutRe };
}
