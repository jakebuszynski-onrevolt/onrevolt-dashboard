export const SITE_AUDIT_SCHEMA_VERSION = 2;

export type SiteAuditClientType = 'UNKNOWN' | 'B2C' | 'B2B' | 'B2C_B2B';

export const SITE_AUDIT_TYPE_DEPENDENT_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;

export function normalizeSiteAuditClientType(value: unknown): SiteAuditClientType {
  return value === 'B2C' || value === 'B2B' || value === 'B2C_B2B'
    ? value
    : 'UNKNOWN';
}

export function siteAuditAudience(value: unknown) {
  const clientType = normalizeSiteAuditClientType(value);
  return {
    clientType,
    hasKnownType: clientType !== 'UNKNOWN',
    showB2C: clientType === 'B2C' || clientType === 'B2C_B2B',
    showB2B: clientType === 'B2B' || clientType === 'B2C_B2B',
  };
}

export function normalizeSiteAuditFormData(value: unknown): Record<string, any> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
  const documentReceived = source.document_received
    && typeof source.document_received === 'object'
    && !Array.isArray(source.document_received)
    ? source.document_received
    : {};
  const loads = Array.isArray(source.loads)
    ? source.loads.map((load: any, index: number) => ({
      id: load?.id || `load-${index + 1}`,
      device: load?.device || '',
      params: load?.params || '',
      power_kw: load?.power_kw || '',
      work_cycle: load?.work_cycle || '',
      backup_power: load?.backup_power || 'no',
    }))
    : [];

  return {
    ...source,
    client_type: normalizeSiteAuditClientType(source.client_type),
    client_email: source.client_email || '',
    company_name: source.company_name || '',
    representative_name: source.representative_name || '',
    document_received: documentReceived,
    loads: loads.length ? loads : [{
      id: 'load-1',
      device: '',
      params: '',
      power_kw: '',
      work_cycle: '',
      backup_power: 'no',
    }],
    existing_pv_inverter_manufacturer: source.existing_pv_inverter_manufacturer || '',
    existing_pv_inverter_model: source.existing_pv_inverter_model || source.existing_pv_device || '',
    existing_pv_inverter_type: source.existing_pv_inverter_type || '',
    existing_pv_inverter_mppt: source.existing_pv_inverter_mppt || '',
    existing_pv_inverter_kw: source.existing_pv_inverter_kw || '',
    existing_pv_module_count: source.existing_pv_module_count || '',
    existing_pv_module_manufacturer: source.existing_pv_module_manufacturer || '',
    existing_pv_module_model: source.existing_pv_module_model || '',
    existing_pv_module_wp: source.existing_pv_module_wp || '',
    existing_pv_strings: source.existing_pv_strings || '',
    existing_pv_string_config: source.existing_pv_string_config || '',
    existing_pv_optimizers: source.existing_pv_optimizers || 'no',
    existing_pv_optimizer_manufacturer: source.existing_pv_optimizer_manufacturer || '',
    existing_pv_total_kw: source.existing_pv_total_kw || source.existing_pv_kw || '',
    existing_pv_year: source.existing_pv_year || '',
    existing_pv_place: source.existing_pv_place || 'ROOF',
    existing_pv_notes: source.existing_pv_notes || source.existing_pv_params || '',
  };
}

export function resetTypeDependentCompletion(completedSteps: unknown): number[] {
  if (!Array.isArray(completedSteps)) return [];
  const dependent = new Set<number>(SITE_AUDIT_TYPE_DEPENDENT_STEPS);
  return completedSteps
    .map(Number)
    .filter((step) => Number.isInteger(step) && !dependent.has(step));
}

export function siteAuditCompletionErrors(data: Record<string, any>, auditorId?: string): string[] {
  const audience = siteAuditAudience(data.client_type);
  const required = [
    ['visit_date', 'data wizyty'],
    ['client_address', 'adres inwestycji'],
    ['audit_result', 'wynik audytu'],
    ['audit_next_action', 'następny krok'],
    ['final_summary_notes', 'wniosek końcowy'],
  ] as const;
  const missing: string[] = required
    .filter(([key]) => typeof data[key] !== 'string' || !data[key].trim())
    .map(([, label]) => label);
  if (!audience.hasKnownType) missing.unshift('typ klienta');
  if (audience.showB2B && !String(data.company_name || '').trim()) missing.push('nazwa firmy');
  if (!audience.showB2B && !String(data.client_name || '').trim()) missing.push('nazwa klienta');
  if (!auditorId) missing.push('audytor');
  return [...new Set(missing)];
}
