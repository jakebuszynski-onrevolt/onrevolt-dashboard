import {
  Configuration,
  DealsApi,
  DealFieldsApi,
  PipelinesApi,
  StagesApi,
  PersonsApi,            // ⬅️ DODAJ
} from 'pipedrive/v1';

function getConfig() {
  const apiKey = process.env.PIPEDRIVE_API_TOKEN || process.env.API_KEY;
  if (!apiKey) throw new Error('Missing PIPEDRIVE_API_TOKEN/API_KEY');
  return new Configuration({ apiKey });
}

export function apis() {
  const cfg = getConfig();
  return {
    deals: new DealsApi(cfg),
    fields: new DealFieldsApi(cfg),
    pipelines: new PipelinesApi(cfg),
    stages: new StagesApi(cfg),
    persons: new PersonsApi(cfg),    // ⬅️ DODAJ
  };
}
