import { callClientTariffs, clientTariffScope, readProjectGeneralTariffs } from './client-tariffs-server';
import type { ClientTariffData } from './client-tariffs';
import type { OfferWorkspace } from './offer-workspace-server';
import type { OfferWorkspaceDraft } from './offer-workspace';

type TariffLabelContext = {
  current: string | null; proposed: string | null; currentOperator: string | null;
};

export function offerDocumentTariffLabels(
  data: ClientTariffData,
  period: OfferWorkspace['period'],
  draft: Pick<OfferWorkspaceDraft, 'targetOperatorId' | 'targetTariffId'>,
): TariffLabelContext {
  const target = data.catalog.find(item => item.id === draft.targetOperatorId);
  const proposed = target?.tariffs.find(item => item.id === draft.targetTariffId)?.code || null;
  if (!data.profile?.periods.length) {
    return { current: data.generalTariff?.code || null, currentOperator: data.generalTariff?.operator || null, proposed };
  }
  const periods = data.profile.periods.filter(item => (!item.validFrom || item.validFrom <= period.endDate)
    && (!item.validUntil || item.validUntil > `${period.startMonth}-01`))
    .sort((a, b) => (a.validFrom || '').localeCompare(b.validFrom || ''));
  const entries = periods.map(item => {
    const operator = data.catalog.find(osd => osd.id === item.osdId);
    return { operator: operator?.name, code: operator?.tariffs.find(tariff => tariff.id === item.tariffId)?.code };
  });
  return {
    current: entries.length && entries.every(item => item.code) ? [...new Set(entries.map(item => item.code))].join(' / ') : null,
    currentOperator: entries.length && entries.every(item => item.operator) ? [...new Set(entries.map(item => item.operator))].join(' / ') : null,
    proposed,
  };
}

/** Project authorization is performed by the document endpoint before this read. */
export async function loadOfferDocumentTariffLabels(workspace: OfferWorkspace, draft: OfferWorkspaceDraft) {
  const scope = await clientTariffScope(workspace.clientId, workspace.projectId);
  const data = await callClientTariffs<ClientTariffData>({ action: 'get', scope });
  if (!data.profile?.periods.length) {
    const selection = await readProjectGeneralTariffs(scope);
    data.generalTariff = selection.generalTariff;
  }
  return offerDocumentTariffLabels(data, workspace.period, draft);
}
