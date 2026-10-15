import * as vscode from 'vscode';

export type CommitLanguage = 'en' | 'zh';
export type CommitLanguageSetting = 'auto' | CommitLanguage;

// 'default' means the reasoning_effort parameter is not sent at all.
export const REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export interface CommitGeneraterConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  language: CommitLanguageSetting;
  includeAgentsMd: boolean;
  maxDiffLength: number;
}

export function getConfig(): CommitGeneraterConfig {
  const config = vscode.workspace.getConfiguration('commitGenerater');
  // Read only user values; legacy workspace and folder overrides are intentionally ignored.
  return {
    apiBaseUrl: (config.inspect<string>('apiBaseUrl')?.globalValue ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: (config.inspect<string>('apiKey')?.globalValue ?? ''),
    model: (config.inspect<string>('model')?.globalValue ?? 'gpt-5'),
    reasoningEffort: (config.inspect<ReasoningEffort>('reasoningEffort')?.globalValue ?? 'default'),
    language: (config.inspect<CommitLanguageSetting>('language')?.globalValue ?? 'auto'),
    includeAgentsMd: (config.inspect<boolean>('includeAgentsMd')?.globalValue ?? true),
    maxDiffLength: (config.inspect<number>('maxDiffLength')?.globalValue ?? 131072),
  };
}

export async function updateConfig<K extends keyof CommitGeneraterConfig>(
  key: K,
  value: CommitGeneraterConfig[K]
): Promise<void> {
  const config = vscode.workspace.getConfiguration('commitGenerater');
  await config.update(key, value, vscode.ConfigurationTarget.Global);
}
