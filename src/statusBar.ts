import * as vscode from 'vscode';
import { getConfig } from './config';
import { LANGUAGE_LABELS, PR_TITLE_PROVIDER_LABELS, REASONING_EFFORT_LABELS } from './commands/settings';

/**
 * Status bar entry (bottom right) showing the active model; the tooltip lists
 * the other settings. Clicking it opens the settings menu.
 */
export function registerStatusBarItem(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(
    'commitGenerater.status',
    vscode.StatusBarAlignment.Right,
    100
  );
  item.name = 'Commit Generater';
  item.command = 'commitGenerater.openSettings';

  const update = () => {
    const config = getConfig();
    // Contributed icon (package.json `contributes.icons`), same glyph as the SCM title button.
    item.text = `$(commit-generater-icon) ${config.model}`;
    item.tooltip = [
      'Commit Generater',
      `Model: ${config.model}`,
      `Reasoning Effort: ${REASONING_EFFORT_LABELS[config.reasoningEffort] ?? config.reasoningEffort}`,
      `Language: ${LANGUAGE_LABELS[config.language] ?? config.language}`,
      `AGENTS.md: ${config.includeAgentsMd ? 'On' : 'Off'}`,
      `PR Title Generator: ${PR_TITLE_PROVIDER_LABELS[config.prTitleProvider] ?? config.prTitleProvider}`,
      '',
      'Click to configure',
    ].join('\n');
  };

  update();
  item.show();

  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('commitGenerater')) {
        update();
      }
    })
  );
}
