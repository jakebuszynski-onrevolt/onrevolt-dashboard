import { apiPath } from '../../lib/basePath';

async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(apiPath(path), { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

function toArray<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x;
  const keys = ['data', 'items', 'value', 'results', 'stages', 'pipelines', 'deals', 'fields'];
  for (const k of keys) if (Array.isArray(x?.[k])) return x[k];
  if (x && typeof x === 'object') {
    const vals = Object.values(x);
    if (vals.every((v) => Array.isArray(v))) return (vals as any[]).flat();
    return vals as T[];
  }
  return [];
}

export async function getDeals(): Promise<any[]> {
  return toArray(await apiGet('/api/pipedrive/deals'));
}
export async function getCustomDealFields(): Promise<any[]> {
  return toArray(await apiGet('/api/pipedrive/deal-fields'));
}
export async function getPipelines(): Promise<any[]> {
  return toArray(await apiGet('/api/pipedrive/pipelines'));
}
export async function getStages(pipelineId?: number | string): Promise<any[]> {
  const url = pipelineId
    ? `/api/pipedrive/stages?pipeline_id=${encodeURIComponent(String(pipelineId))}`
    : `/api/pipedrive/stages`;
  return toArray(await apiGet(url));
}

export async function getDealById(id: number | string): Promise<{
  deal_id: number;
  deal: any;
  person: any;
  std: any;
  custom_by_name: Record<string, any>;
}> {
  const res = await fetch(apiPath(`/api/pipedrive/deals/${id}`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/pipedrive/deals/${id} -> ${res.status}`);
  return res.json();
}