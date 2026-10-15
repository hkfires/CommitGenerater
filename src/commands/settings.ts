import * as vscode from 'vscode';
import { CommitLanguageSetting, getConfig, ReasoningEffort, REASONING_EFFORTS, updateConfig } from '../config';
import { selectModelCommand } from './selectModel';
import { runSetupWizard } from '../setup';

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

export const LANGUAGE_LABELS: Record<CommitLanguageSetting, string> = {
  auto: 'Auto (follow commit history)',
  zh: '中文',
  en: 'English',
};

export async function selectReasoningEffortCommand(): Promise<void> {
  const current = getConfig().reasoningEffort;
  const selected = await vscode.window.showQuickPick(
    REASONING_EFFORTS.map(effort => ({
      label: effort,
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
      language,
    })),
    {
      title: 'Commit Generater: Commit Message Language',
      placeHolder: 'Select the language for generated commit messages',
    }
  );

  if (selected) {
    await updateConfig('language', selected.language);
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
      description: config.reasoningEffort,
      run: selectReasoningEffortCommand,
    },
    {
      label: '$(globe) Commit Language',
      description: LANGUAGE_LABELS[config.language] ?? config.language,
      run: selectLanguageCommand,
    },
    {
      label: '$(book) Include AGENTS.md',
      description: config.includeAgentsMd ? 'On' : 'Off',
      run: () => updateConfig('includeAgentsMd', !config.includeAgentsMd),
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
