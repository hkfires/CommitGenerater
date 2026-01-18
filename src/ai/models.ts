import { getConfig } from '../config';

interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  object: string;
  data: Model[];
}

export async function listModels(): Promise<string[]> {
  const config = getConfig();
  
  if (!config.apiKey) {
    throw new Error('API Key not configured');
  }

  const response = await fetch(`${config.apiBaseUrl}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as ModelsResponse;
  
  return data.data
    ?.map(model => model.id)
    ?.sort((a, b) => a.localeCompare(b)) ?? [];
}
