import * as vscode from 'vscode';

export type CommitLanguage = 'en' | 'zh';
export type CommitLanguageSetting = 'auto' | CommitLanguage;

// 'default' means the reasoning_effort parameter is not sent at all.
export const REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

// Generator used by the ✨ button of the GitHub Pull Requests extension.
export const PR_TITLE_PROVIDERS = ['ask', 'commitGenerater', 'copilot'] as const;
export type PullRequestTitleProvider = typeof PR_TITLE_PROVIDERS[number];

export interface CommitGeneraterConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  language: CommitLanguageSetting;
  includeAgentsMd: boolean;
  maxDiffLength: number;
  prTitleProvider: PullRequestTitleProvider;
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
    prTitleProvider: (config.inspect<PullRequestTitleProvider>('prTitleProvider')?.globalValue ?? 'ask'),
  };
}

export async function updateConfig<K extends keyof CommitGeneraterConfig>(
  key: K,
  value: CommitGeneraterConfig[K]
): Promise<void> {
  const config = vscode.workspace.getConfiguration('commitGenerater');
  await config.update(key, value, vscode.ConfigurationTarget.Global);
}
