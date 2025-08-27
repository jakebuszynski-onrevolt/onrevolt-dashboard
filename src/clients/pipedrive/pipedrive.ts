import { Configuration, DealsApi, DealFieldsApi } from "pipedrive/v1";

const API_KEY = '212d3142e0cc99458fd16c88b08bbde24159f09c';
// Configure Client with API key authorization
const apiConfig = new Configuration({
  apiKey: API_KEY,
});


const getDeals = async () => {
  const dealsApi = new DealsApi(apiConfig);
  const dealFieldsApi = new DealFieldsApi(apiConfig);
  
  // Get custom deal fields first
  const responseCustomFields = await dealFieldsApi.getDealFields();
  const customFields = responseCustomFields.data?.filter(field => field.edit_flag === true) || [];
  
  // Create a mapping of custom field keys to names
  const customFieldMapping = {};
  customFields.forEach(field => {
    if (field.key) {
      customFieldMapping[field.key] = field.name;
    }
  });
  
  // Get all deals
  const responseAllDeals = await dealsApi.getDeals({limit:500});
  const { data: deals } = responseAllDeals;
  
  // Transform deals to replace custom field keys with readable names
  const transformedDeals = deals?.map(deal => {
    const transformedDeal = { ...deal };
    
    Object.keys(deal).forEach(key => {
      if (customFieldMapping[key]) {
        // Replace the custom field key with the readable name + "Custom"
        transformedDeal[customFieldMapping[key]+ "_custom"] = deal[key];
      }
    });
    
    // Convert hist_custom from string to JSON array if it exists
    if (transformedDeal.hist_custom && typeof transformedDeal.hist_custom === 'string') {
      try {
        transformedDeal.hist_custom = JSON.parse(transformedDeal.hist_custom);
      } catch (error) {
        console.warn('Failed to parse hist_custom as JSON:', error);
        // Keep as string if parsing fails
      }
    }
    
    // Convert yield_custom to number if it exists
    if (transformedDeal.yield_custom !== undefined && transformedDeal.yield_custom !== null) {
      const yieldValue = parseFloat(transformedDeal.yield_custom);
      if (!isNaN(yieldValue)) {
        transformedDeal.yield_custom = yieldValue;
      }
    }
    
    return transformedDeal;
  }) || [];
  
  return transformedDeals;
};

const getCustomDealFields = async () => {
  const dealFieldsApi = new DealFieldsApi(apiConfig);
  const responseCustomFields = await dealFieldsApi.getDealFields();
  
  // Filter to only show custom fields with edit_flag as true
  const editableCustomFields = responseCustomFields.data?.filter(field => field.edit_flag === true) || [];
  
  return editableCustomFields;
};

// --- DODAJ NA DOLE PLIKU LUB W MIEJSCU EXPORTÓW ---

// Klientowe helpery – trafiają do naszych API routes
export async function getPipelines(): Promise<any[]> {
  const r = await fetch("/api/pipedrive/pipelines", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/pipedrive/pipelines -> ${r.status}`);
  return await r.json();
}

export async function getStages(pipelineId?: number | string): Promise<any[]> {
  const url = pipelineId
    ? `/api/pipedrive/stages?pipeline_id=${pipelineId}`
    : `/api/pipedrive/stages`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return await r.json();
}



export { getDeals, getCustomDealFields };