import { prisma } from './prisma';

type ImportOptions = {
  apply: boolean;
};

type ImportCounters = {
  stagesSeen: number;
  stagesImported: number;
  stagesWouldImport: number;
  stagesExisting: number;
  dealsSeen: number;
  clientsImported: number;
  clientsWouldImport: number;
  existingClients: number;
  projectsImported: number;
  projectsWouldImport: number;
  skippedExisting: number;
  duplicatePersonDeals: Array<{ personId: string; dealIds: string[]; name?: string }>;
  requiresReview: Array<{ pipedriveId: string; reason: string; title?: string }>;
};

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : '');
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || '';

async function fetchPipedrivePayload(path: string) {
  if (!TOKEN) throw new Error('Missing PIPEDRIVE_API_TOKEN');
  if (!BASE) throw new Error('Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN');

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'x-api-token': TOKEN },
      cache: 'no-store',
    });
  } catch (error: any) {
    const causeCode = error?.cause?.code ? ` (${error.cause.code})` : '';
    const causeMessage = error?.cause?.message ? `: ${error.cause.message}` : '';
    throw new Error(`Nie udało się połączyć z Pipedrive${causeCode}${causeMessage}`);
  }

  if (!response.ok) {
    throw new Error(`Pipedrive ${path} ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function fetchPipedrivePages(path: string, limit = 500) {
  const items: any[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await fetchPipedrivePayload(`${path}${separator}start=${start}&limit=${limit}`);
    items.push(...(payload?.data ?? []));

    const pagination = payload?.additional_data?.pagination;
    hasMore = Boolean(pagination?.more_items_in_collection);
    start = Number(pagination?.next_start ?? 0);
    if (hasMore && !Number.isFinite(start)) {
      throw new Error(`Pipedrive pagination returned invalid next_start for ${path}`);
    }
  }

  return items;
}

function firstContactValue(value: any) {
  if (Array.isArray(value)) {
    return value.find((item) => item?.value)?.value ?? '';
  }
  return '';
}

function normalizePersonId(deal: any) {
  return String(
    deal?.person_id?.value ??
    deal?.person_id?.id ??
    (typeof deal?.person_id === 'number' ? deal.person_id : '') ??
    '',
  ).trim();
}

function explicitInvestmentAddress(deal: any) {
  const candidates = [
    deal?.investment_address,
    deal?.investmentAddress,
    deal?.location_address,
    deal?.locationAddress,
  ];
  const value = candidates.find((item) => typeof item === 'string' && item.trim() !== '');
  return value ? String(value).trim() : '';
}

export async function importPipedriveToLocal(options: ImportOptions): Promise<ImportCounters> {
  const counters: ImportCounters = {
    stagesSeen: 0,
    stagesImported: 0,
    stagesWouldImport: 0,
    stagesExisting: 0,
    dealsSeen: 0,
    clientsImported: 0,
    clientsWouldImport: 0,
    existingClients: 0,
    projectsImported: 0,
    projectsWouldImport: 0,
    skippedExisting: 0,
    duplicatePersonDeals: [],
    requiresReview: [],
  };

  const [stages, deals] = await Promise.all([
    fetchPipedrivePages('/stages'),
    fetchPipedrivePages('/deals'),
  ]);

  counters.stagesSeen = stages.length;
  counters.dealsSeen = deals.length;

  const localStageByPipedriveId = new Map<string, string>();

  for (const stage of stages) {
    const pipedriveStageId = String(stage?.id ?? '').trim();
    if (!pipedriveStageId) continue;

    const existingStage = await prisma.pipelineStage.findUnique({ where: { pipedriveStageId } });
    if (existingStage) {
      counters.stagesExisting += 1;
      localStageByPipedriveId.set(pipedriveStageId, existingStage.id);
    } else if (!options.apply) {
      counters.stagesWouldImport += 1;
    }

    if (options.apply) {
      const saved = await prisma.pipelineStage.upsert({
        where: { pipedriveStageId },
        update: {
          name: String(stage?.name || `Pipedrive stage ${pipedriveStageId}`),
          sortOrder: Number(stage?.order_nr ?? 0),
        },
        create: {
          name: String(stage?.name || `Pipedrive stage ${pipedriveStageId}`),
          sortOrder: Number(stage?.order_nr ?? 0),
          pipedriveStageId,
        },
      });
      localStageByPipedriveId.set(pipedriveStageId, saved.id);
      counters.stagesImported += 1;
    }
  }

  const dealsByPerson = new Map<string, { name?: string; dealIds: string[] }>();
  for (const deal of deals) {
    const pipedriveDealId = String(deal?.id ?? '').trim();
    if (!pipedriveDealId) continue;

    const personId = normalizePersonId(deal);
    const title = String(deal?.title || deal?.person_name || '').trim();
    if (!personId) {
      counters.requiresReview.push({ pipedriveId: pipedriveDealId, title, reason: 'Brak person_id w Pipedrive' });
      continue;
    }

    const personDeals = dealsByPerson.get(personId) || { name: String(deal?.person_name || deal?.person_id?.name || '').trim(), dealIds: [] };
    personDeals.dealIds.push(pipedriveDealId);
    dealsByPerson.set(personId, personDeals);

    const [existingProject, existingClient] = await Promise.all([
      prisma.project.findUnique({ where: { pipedriveDealId } }),
      prisma.client.findUnique({ where: { pipedrivePersonId: personId } }),
    ]);

    if (existingProject) {
      counters.skippedExisting += 1;
      continue;
    }

    if (!options.apply) {
      counters.projectsWouldImport += 1;
      if (existingClient) counters.existingClients += 1;
      else counters.clientsWouldImport += 1;
      continue;
    }

    const personName = String(deal?.person_name || deal?.person_id?.name || title || `Pipedrive ${personId}`).trim();
    const email = firstContactValue(deal?.person_id?.email);
    const phone = firstContactValue(deal?.person_id?.phone);
    const stageId = localStageByPipedriveId.get(String(deal?.stage_id ?? ''));
    const investmentAddress = explicitInvestmentAddress(deal);

    const client = await prisma.client.upsert({
      where: { pipedrivePersonId: personId },
      update: {
        displayName: personName,
      },
      create: {
        displayName: personName,
        clientType: 'UNKNOWN',
        pipedrivePersonId: personId,
        contacts: {
          create: {
            name: personName,
            email,
            phone,
            investmentAddress: investmentAddress || undefined,
          },
        },
      },
      include: { contacts: { take: 1 } },
    });
    if (existingClient) counters.existingClients += 1;
    else counters.clientsImported += 1;

    if (existingClient && client.contacts.length === 0 && (email || phone || investmentAddress)) {
      await prisma.contact.create({
        data: {
          clientId: client.id,
          name: personName,
          email,
          phone,
          investmentAddress: investmentAddress || undefined,
        },
      });
    }

    const site = investmentAddress
      ? await prisma.investmentSite.upsert({
        where: { pipedriveDealId },
        update: {
          clientId: client.id,
          name: title || personName,
          addressLine: investmentAddress,
          fullAddress: investmentAddress,
          source: 'pipedrive',
        },
        create: {
          clientId: client.id,
          name: title || personName,
          addressLine: investmentAddress,
          fullAddress: investmentAddress,
          source: 'pipedrive',
          pipedriveDealId,
        },
      })
      : null;

    const project = await prisma.project.create({
      data: {
        clientId: client.id,
        investmentSiteId: site?.id,
        clientType: 'UNKNOWN',
        title: title || personName,
        source: 'pipedrive',
        pipedriveDealId,
        stageId,
        locationAddress: investmentAddress || undefined,
        notes: deal?.org_name ? `Organizacja: ${deal.org_name}` : undefined,
      },
    });
    counters.projectsImported += 1;

    await prisma.pipedriveSyncState.upsert({
      where: { entityType_pipedriveId: { entityType: 'deal', pipedriveId: pipedriveDealId } },
      update: {
        localModel: 'Project',
        localId: project.id,
        rawSnapshot: deal,
        syncedAt: new Date(),
      },
      create: {
        entityType: 'deal',
        pipedriveId: pipedriveDealId,
        localModel: 'Project',
        localId: project.id,
        rawSnapshot: deal,
        syncedAt: new Date(),
      },
    });

    await prisma.pipedriveSyncState.upsert({
      where: { entityType_pipedriveId: { entityType: 'person', pipedriveId: personId } },
      update: {
        localModel: 'Client',
        localId: client.id,
        rawSnapshot: deal?.person_id || { id: personId, name: personName, email, phone },
        syncedAt: new Date(),
      },
      create: {
        entityType: 'person',
        pipedriveId: personId,
        localModel: 'Client',
        localId: client.id,
        rawSnapshot: deal?.person_id || { id: personId, name: personName, email, phone },
        syncedAt: new Date(),
      },
    });
  }

  counters.duplicatePersonDeals = Array.from(dealsByPerson.entries())
    .filter(([, value]) => value.dealIds.length > 1)
    .map(([personId, value]) => ({ personId, name: value.name, dealIds: value.dealIds }))
    .slice(0, 50);

  return counters;
}
