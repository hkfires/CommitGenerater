import * as vscode from 'vscode';
import { listModels } from '../ai/models';
import { getConfig, updateConfig } from '../config';

export async function selectModelCommand(): Promise<void> {
  const config = getConfig();
  
  try {
    const models = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching available models...',
        cancellable: false,
      },
      async () => {
        return await listModels();
      }
    );

    if (!models || models.length === 0) {
      vscode.window.showWarningMessage('No models available from the API.');
      return;
    }

    const items: vscode.QuickPickItem[] = models.map(model => ({
      label: model,
      description: model === config.model ? '(current)' : undefined,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a model for commit message generation',
      title: 'Commit Generater: Select AI Model',
    });

    if (selected) {
      await updateConfig('model', selected.label);
      vscode.window.showInformationMessage(`Model changed to: ${selected.label}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to fetch models: ${error.message}`);
    } else {
      vscode.window.showErrorMessage('Failed to fetch models: Unknown error');
    }
  }
}
