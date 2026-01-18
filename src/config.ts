import * as vscode from 'vscode';

export interface CommitGeneraterConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  language: 'en' | 'zh';
  maxDiffLength: number;
}

export function getConfig(): CommitGeneraterConfig {
  const config = vscode.workspace.getConfiguration('commitGenerater');
  
  return {
    apiBaseUrl: config.get<string>('apiBaseUrl', 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: config.get<string>('apiKey', ''),
    model: config.get<string>('model', 'gpt-5'),
    language: config.get<'en' | 'zh'>('language', 'zh'),
    maxDiffLength: config.get<number>('maxDiffLength', 65536),
  };
}

export async function updateConfig<K extends keyof CommitGeneraterConfig>(
  key: K,
  value: CommitGeneraterConfig[K]
): Promise<void> {
  const config = vscode.workspace.getConfiguration('commitGenerater');
  await config.update(key, value, vscode.ConfigurationTarget.Global);
}
