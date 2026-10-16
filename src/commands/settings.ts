import * as vscode from 'vscode';
import {
  CommitLanguageSetting,
  getConfig,
  PR_TITLE_PROVIDERS,
  PullRequestTitleProvider,
  ReasoningEffort,
  REASONING_EFFORTS,
  updateConfig,
} from '../config';
import { selectModelCommand } from './selectModel';
import { runSetupWizard } from '../setup';

// Display labels only; stored settings and API requests keep the raw lowercase values.
export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  default: 'Default',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

export const LANGUAGE_LABELS: Record<CommitLanguageSetting, string> = {
  auto: 'Auto',
  zh: '中文',
  en: 'English',
};

export const PR_TITLE_PROVIDER_LABELS: Record<PullRequestTitleProvider, string> = {
  ask: 'Ask',
  commitGenerater: 'CommitGenerater',
  copilot: 'Copilot',
};

const REASONING_EFFORT_DESCRIPTIONS: Record<ReasoningEffort, string> = {
  default: 'Do not send reasoning_effort (use the provider default)',
  none: 'Disable reasoning',
  minimal: 'Minimal reasoning, fastest',
  low: 'Low reasoning effort',
  medium: 'Medium reasoning effort',
  high: 'High reasoning effort',
  xhigh: 'Extra high reasoning effort',
  max: 'Maximum reasoning effort',
};

const PR_TITLE_PROVIDER_DESCRIPTIONS: Record<PullRequestTitleProvider, string> = {
  ask: 'Ask which generator to use each time',
  commitGenerater: 'Always use Commit Generater',
  copilot: 'Always use GitHub Copilot',
};

export async function selectReasoningEffortCommand(): Promise<void> {
  const current = getConfig().reasoningEffort;
  const selected = await vscode.window.showQuickPick(
    REASONING_EFFORTS.map(effort => ({
      label: REASONING_EFFORT_LABELS[effort],
      description: effort === current ? '(current)' : undefined,
      detail: REASONING_EFFORT_DESCRIPTIONS[effort],
      effort,
    })),
    {
      title: 'Commit Generater: Reasoning Effort',
      placeHolder: 'Select the reasoning effort sent to the model',
    }
  );

  if (selected) {
    await updateConfig('reasoningEffort', selected.effort);
  }
}

export async function selectLanguageCommand(): Promise<void> {
  const current = getConfig().language;
  const selected = await vscode.window.showQuickPick(
    (Object.keys(LANGUAGE_LABELS) as CommitLanguageSetting[]).map(language => ({
      label: LANGUAGE_LABELS[language],
      description: language === current ? '(current)' : undefined,
      detail: language === 'auto' ? 'Follow the language of recent commit history' : undefined,
      language,
    })),
    {
      title: 'Commit Generater: Language',
      placeHolder: 'Select the language for generated commit messages and pull requests',
    }
  );

  if (selected) {
    await updateConfig('language', selected.language);
  }
}

export async function selectPullRequestTitleProviderCommand(): Promise<void> {
  const current = getConfig().prTitleProvider;
  const selected = await vscode.window.showQuickPick(
    PR_TITLE_PROVIDERS.map(provider => ({
      label: PR_TITLE_PROVIDER_LABELS[provider],
      description: provider === current ? '(current)' : undefined,
      detail: PR_TITLE_PROVIDER_DESCRIPTIONS[provider],
      provider,
    })),
    {
      title: 'Commit Generater: Pull Request Title Generator',
      placeHolder: 'Select the generator used by the ✨ button in the Create Pull Request view',
    }
  );

  if (selected) {
    await updateConfig('prTitleProvider', selected.provider);
  }
}

export async function openSettingsMenuCommand(): Promise<void> {
  const config = getConfig();
  const items: (vscode.QuickPickItem & { run?: () => Thenable<unknown> })[] = [
    {
      label: '$(hubot) Model',
      description: config.model,
      run: selectModelCommand,
    },
    {
      label: '$(lightbulb) Reasoning Effort',
      description: REASONING_EFFORT_LABELS[config.reasoningEffort] ?? config.reasoningEffort,
      run: selectReasoningEffortCommand,
    },
    {
      label: '$(globe) Language',
      description: LANGUAGE_LABELS[config.language] ?? config.language,
      run: selectLanguageCommand,
    },
    {
      label: '$(book) Include AGENTS.md',
      description: config.includeAgentsMd ? 'On' : 'Off',
      run: () => updateConfig('includeAgentsMd', !config.includeAgentsMd),
    },
    {
      label: '$(git-pull-request) PR Title Generator',
      description: PR_TITLE_PROVIDER_LABELS[config.prTitleProvider] ?? config.prTitleProvider,
      run: selectPullRequestTitleProviderCommand,
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(rocket) Setup Wizard',
      run: runSetupWizard,
    },
    {
      label: '$(gear) Open Settings',
      run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'commitGenerater'),
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Commit Generater Settings',
    placeHolder: 'Select a setting to change',
  });

  await selected?.run?.();
}
