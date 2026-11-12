import { offerCalculationDependencyHash } from './offer-workspace-calculation-dependencies';
import { prisma } from './prisma';

export type InvoiceNetMeteringFactor = 0.7 | 0.8;

export type InvoiceNetMeteringFactorPeriod = {
  startMonth: string;
  endDate: string;
};

export type InvoiceNetMeteringFactorResolution =
  | { status: 'missing'; factor: null; sourceRevision: string; invoicePeriods: string[] }
  | { status: 'selected'; factor: InvoiceNetMeteringFactor; sourceRevision: string; invoicePeriods: string[] }
  | { status: 'ambiguous'; factor: null; sourceRevision: string; factors: number[]; invoicePeriods: string[] }
  | { status: 'invalid'; factor: null; sourceRevision: string; invoicePeriods: string[] };

export type InvoiceNetMeteringFactorDocument = {
  id: string;
  clientId: string | null;
  projectId: string | null;
  type?: string;
  invoicePpeNumber: string | null;
  billingPeriodFrom: string | Date | null;
  billingPeriodTo: string | Date | null;
  invoiceRecognition: unknown;
};

function dateKey(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== 'string') return null;
  const key = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

function normalizedPpe(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, '').toUpperCase();
  return normalized || null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function factorValue(value: unknown): { present: false } | { present: true; valid: true; factor: InvoiceNetMeteringFactor } | { present: true; valid: false } {
  if (value == null || value === '') return { present: false };
  if (value === 0.7 || value === 0.8) return { present: true, valid: true, factor: value };
  return { present: true, valid: false };
}

function isConfirmed(recognition: Record<string, unknown>): boolean {
  const confirmation = object(recognition.confirmation);
  return typeof confirmation?.confirmedAt === 'string' && confirmation.confirmedAt.trim() !== ''
    && typeof confirmation.confirmedById === 'string' && confirmation.confirmedById.trim() !== '';
}

export function resolveInvoiceNetMeteringFactor(input: {
  projectId: string;
  clientId: string;
  ppeNumber: string | null | undefined;
  period: InvoiceNetMeteringFactorPeriod;
  documents: readonly InvoiceNetMeteringFactorDocument[];
}): InvoiceNetMeteringFactorResolution {
  const ppe = normalizedPpe(input.ppeNumber);
  const periodStart = `${input.period.startMonth}-01`;
  const periodEnd = input.period.endDate;
  const relevant = input.documents.map(document => {
    const recognition = object(document.invoiceRecognition);
    const fields = object(recognition?.fields);
    const consumption = object(fields?.consumption);
    const from = dateKey(document.billingPeriodFrom);
    const to = dateKey(document.billingPeriodTo);
    const documentPpe = normalizedPpe(document.invoicePpeNumber);
    const recognizedPpe = normalizedPpe(fields?.ppeNumber);
    const factor = factorValue(consumption?.netMeteringFactor);
    const embeddedFrom = dateKey(fields?.periodFrom as string | undefined);
    const embeddedTo = dateKey(fields?.periodTo as string | undefined);
    const ppeConflict = Boolean(documentPpe && recognizedPpe && documentPpe !== recognizedPpe);
    const ppeMatches = Boolean(ppe && ((documentPpe && documentPpe === ppe) || (recognizedPpe && recognizedPpe === ppe)));
    const dateValid = Boolean(from && to && from <= to && from <= periodEnd && to >= periodStart);
    const dateConflict = Boolean((embeddedFrom && from && embeddedFrom !== from) || (embeddedTo && to && embeddedTo !== to));
    const matchingDocument = document.clientId === input.clientId && document.projectId === input.projectId
      && (document.type == null || document.type === 'FAKTURA_PRAD')
      && recognition?.provider === 'ENEA';
    const inScope = matchingDocument && ppeMatches && dateValid;
    const consistentScope = !ppeConflict && !dateConflict;
    const confirmed = recognition ? isConfirmed(recognition) : false;
    return {
      document,
      recognition,
      from,
      to,
      factor,
      inScope,
      consistentScope,
      confirmed,
      revisionPart: {
        id: document.id,
        projectId: document.projectId,
        clientId: document.clientId,
        invoicePpeNumber: documentPpe,
        recognizedPpe,
        billingPeriodFrom: from,
        billingPeriodTo: to,
        recognizedPeriodFrom: embeddedFrom,
        recognizedPeriodTo: embeddedTo,
        provider: recognition?.provider ?? null,
        parser: object(recognition?.parser),
        factor: consumption?.netMeteringFactor ?? null,
        confirmed,
        confirmation: object(recognition?.confirmation),
      },
    };
  });
  const sourceRevision = offerCalculationDependencyHash({
    projectId: input.projectId,
    clientId: input.clientId,
    ppe,
    periodStart,
    periodEnd,
    documents: relevant.map(row => row.revisionPart).sort((left, right) => left.id.localeCompare(right.id)),
  });
  const candidates = relevant.filter(row => row.inScope && row.confirmed && row.factor.present);
  const invoicePeriods = [...new Set(candidates
    .map(row => row.from && row.to ? `${row.from}–${row.to}` : null)
    .filter((value): value is string => value !== null))].sort();
  const factors = new Set<InvoiceNetMeteringFactor>();
  let invalidCandidate = false;
  for (const candidate of candidates) {
    if (!candidate.consistentScope || !candidate.factor.present || !candidate.factor.valid) {
      invalidCandidate = true;
      continue;
    }
    factors.add(candidate.factor.factor);
  }
  if (invalidCandidate) {
    return { status: 'invalid', factor: null, sourceRevision, invoicePeriods };
  }
  const distinctFactors = [...factors].sort();
  if (distinctFactors.length > 1) return { status: 'ambiguous', factor: null, sourceRevision, factors: distinctFactors, invoicePeriods };
  if (distinctFactors.length === 1) return { status: 'selected', factor: distinctFactors[0], sourceRevision, invoicePeriods };
  return { status: 'missing', factor: null, sourceRevision, invoicePeriods: [] };
}

export async function invoiceNetMeteringFactorForPeriod(input: {
  projectId: string;
  clientId: string;
  ppeNumber: string | null | undefined;
  period: InvoiceNetMeteringFactorPeriod;
}): Promise<InvoiceNetMeteringFactorResolution> {
  const ppeNumber = normalizedPpe(input.ppeNumber);
  if (!ppeNumber) {
    return resolveInvoiceNetMeteringFactor({ ...input, ppeNumber: null, documents: [] });
  }
  const documents = await prisma.document.findMany({
    where: {
      projectId: input.projectId,
      clientId: input.clientId,
      type: 'FAKTURA_PRAD',
      billingPeriodFrom: { lte: new Date(`${input.period.endDate}T23:59:59.999Z`) },
      billingPeriodTo: { gte: new Date(`${input.period.startMonth}-01T00:00:00.000Z`) },
    },
    select: {
      id: true,
      projectId: true,
      clientId: true,
      type: true,
      invoicePpeNumber: true,
      billingPeriodFrom: true,
      billingPeriodTo: true,
      invoiceRecognition: true,
    },
  });
  return resolveInvoiceNetMeteringFactor({ ...input, ppeNumber, documents });
}
