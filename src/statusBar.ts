import * as vscode from 'vscode';
import { getConfig } from './config';
import { LANGUAGE_LABELS } from './commands/settings';

/**
 * Status bar entry (bottom right) showing the active model and reasoning
 * effort. Clicking it opens the settings menu.
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
    const effort = config.reasoningEffort === 'default' ? '' : ` · ${config.reasoningEffort}`;
    // Contributed icon (package.json `contributes.icons`), same glyph as the SCM title button.
    item.text = `$(commit-generater-icon) ${config.model}${effort}`;
    item.tooltip = [
      'Commit Generater',
      `Model: ${config.model}`,
      `Reasoning effort: ${config.reasoningEffort}`,
      `Language: ${LANGUAGE_LABELS[config.language] ?? config.language}`,
      `AGENTS.md: ${config.includeAgentsMd ? 'On' : 'Off'}`,
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
