export type ClientJourneyKey =
  | 'client'
  | 'billing'
  | 'configuration'
  | 'offer'
  | 'audit'
  | 'contract'
  | 'installation'
  | 'documents';

export const clientJourneyKeys: ClientJourneyKey[] = [
  'client',
  'billing',
  'configuration',
  'offer',
  'audit',
  'contract',
  'installation',
  'documents',
];

export type ClientJourneyInput = {
  displayName?: string | null;
  clientType?: string | null;
  hasContactChannel?: boolean;
  hasAddress?: boolean;
  energyAccounts?: Array<{ ppeNumber?: string | null; measurementFiles?: unknown[] }>;
  invoiceCount?: number;
  odsCase?: { status?: string | null } | null;
  configurations?: Array<{ status?: string | null }>;
  offers?: Array<{ status?: string | null; contracts?: Array<{ status?: string | null }> }>;
  audits?: Array<{ status?: string | null; progressPercent?: number | null }>;
  installations?: Array<{ status?: string | null }>;
  formalDocumentCount?: number;
  projectStatus?: string | null;
};

export type ClientJourneyResult = {
  progress: Record<ClientJourneyKey, number>;
  currentKey: ClientJourneyKey;
  serviceStage: boolean;
  paused: boolean;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function maximum(values: number[]) {
  return values.length ? Math.max(...values) : 0;
}

function configurationProgress(status?: string | null) {
  if (['OFFERED', 'ACCEPTED', 'INSTALLED'].includes(status || '')) return 100;
  if (status === 'READY') return 75;
  if (status === 'DRAFT') return 40;
  return 0;
}

function offerProgress(status?: string | null) {
  if (status === 'ACCEPTED') return 100;
  if (status === 'SENT') return 75;
  if (status === 'DRAFT') return 35;
  return 0;
}

function contractProgress(status?: string | null) {
  if (['SIGNED', 'COMPLETED'].includes(status || '')) return 100;
  if (status === 'DRAFT') return 40;
  return 0;
}

function installationProgress(status?: string | null) {
  if (status === 'COMPLETED') return 100;
  if (['NEEDS_COMPLETION', 'WAITING_OSD', 'SERVICE_REQUIRED'].includes(status || '')) return 80;
  if (status === 'IN_PROGRESS') return 65;
  if (['PLANNED', 'CONFIRMED'].includes(status || '')) return 40;
  if (status === 'TO_SCHEDULE') return 20;
  return 0;
}

function billingProgress(input: ClientJourneyInput) {
  const hasAccount = Boolean(input.energyAccounts?.length);
  const hasPpe = Boolean(input.energyAccounts?.some((account) => account.ppeNumber));
  const hasMeasurements = Boolean(input.energyAccounts?.some((account) => account.measurementFiles?.length));
  let progress = hasAccount || hasPpe ? 30 : 0;
  if (hasMeasurements || Number(input.invoiceCount) > 0) progress = Math.max(progress, 55);
  if (input.odsCase && input.odsCase.status !== 'CANCELLED') progress = Math.max(progress, 80);
  if (input.odsCase?.status === 'COMPLETED') progress = 100;
  return progress;
}

function inferredCurrent(progress: Record<ClientJourneyKey, number>) {
  return clientJourneyKeys.find((key) => progress[key] < 100) || 'documents';
}

function statusCurrent(status: string | null | undefined, progress: Record<ClientJourneyKey, number>) {
  const direct: Partial<Record<string, ClientJourneyKey>> = {
    LEAD: 'client',
    CZEKA_NA_KALKULACJE: 'configuration',
    OFERTA_PRZYGOTOWANA: 'offer',
    OFERTA_ZAAKCEPTOWANA: 'contract',
    ZALICZKA_MONTAZ: 'installation',
    PROCEDURA_OSD: 'billing',
    ODBIOR: 'documents',
    ZAKONCZONY: 'documents',
  };
  if (status && direct[status]) return direct[status];
  return inferredCurrent(progress);
}

export function calculateClientJourney(input: ClientJourneyInput): ClientJourneyResult {
  const contactChecks = [
    Boolean(input.displayName?.trim()),
    Boolean(input.hasContactChannel),
    Boolean(input.hasAddress),
    Boolean(input.clientType && input.clientType !== 'UNKNOWN'),
  ];
  const contracts = (input.offers || []).flatMap((offer) => offer.contracts || []);
  const hasAcceptedOffer = input.offers?.some((offer) => offer.status === 'ACCEPTED');

  const progress: Record<ClientJourneyKey, number> = {
    client: clamp((contactChecks.filter(Boolean).length / contactChecks.length) * 100),
    billing: billingProgress(input),
    configuration: maximum((input.configurations || []).map((item) => configurationProgress(item.status))),
    offer: maximum((input.offers || []).map((item) => offerProgress(item.status))),
    audit: maximum((input.audits || []).map((item) => (
      item.status === 'COMPLETED' ? 100 : clamp(Number(item.progressPercent || 0))
    ))),
    contract: Math.max(
      hasAcceptedOffer ? 25 : 0,
      maximum(contracts.map((item) => contractProgress(item.status))),
    ),
    installation: maximum((input.installations || []).map((item) => installationProgress(item.status))),
    documents: Number(input.formalDocumentCount) > 0 ? 100 : 0,
  };

  return {
    progress,
    currentKey: statusCurrent(input.projectStatus, progress),
    serviceStage: input.projectStatus === 'SERWIS',
    paused: input.projectStatus === 'WSTRZYMANY',
  };
}
