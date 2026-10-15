import * as vscode from 'vscode';
import { listModels } from '../ai/models';
import { getConfig, updateConfig } from '../config';

interface ModelItem extends vscode.QuickPickItem {
  model: string;
}

/**
 * Show a model picker that fetches models from `{apiBaseUrl}/models`.
 * Typing a name that is not in the list offers it as a custom model, so manual
 * entry keeps working even when the endpoint is unavailable.
 * Resolves to the chosen model name, or undefined if cancelled.
 */
export function pickModel(): Promise<string | undefined> {
  const currentModel = getConfig().model;
  const quickPick = vscode.window.createQuickPick<ModelItem>();
  quickPick.title = 'Commit Generater: Select AI Model';
  quickPick.placeholder = 'Fetching models... (type a model name to enter it manually)';
  quickPick.ignoreFocusOut = true;
  quickPick.busy = true;

  let fetchedItems: ModelItem[] = [];
  let finished = false;

  const render = () => {
    const typed = quickPick.value.trim();
    const items = [...fetchedItems];
    if (typed && !items.some(item => item.model === typed)) {
      items.push({
        label: `$(edit) Use "${typed}"`,
        description: 'custom model name',
        model: typed,
        alwaysShow: true,
      });
    }
    quickPick.items = items;
  };

  return new Promise(resolve => {
    const finish = (model: string | undefined) => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(model);
      quickPick.dispose();
    };

    quickPick.onDidChangeValue(render);
    quickPick.onDidAccept(() => {
      const model = quickPick.selectedItems[0]?.model ?? quickPick.value.trim();
      if (model) {
        finish(model);
      }
    });
    quickPick.onDidHide(() => finish(undefined));
    quickPick.show();

    listModels().then(
      models => {
        if (finished) {
          return;
        }
        const fetchedCount = models.length;
        if (currentModel && !models.includes(currentModel)) {
          models = [currentModel, ...models];
        }
        fetchedItems = models.map(model => ({
          label: model,
          description: model === currentModel ? '(current)' : undefined,
          model,
        }));
        quickPick.placeholder = fetchedCount > 0
          ? 'Select a model, or type a model name to enter it manually'
          : 'No models returned by the API. Type a model name to enter it manually';
      },
      (error: unknown) => {
        if (finished) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        fetchedItems = currentModel
          ? [{ label: currentModel, description: '(current)', model: currentModel }]
          : [];
        quickPick.placeholder = `Failed to fetch models (${message}). Type a model name to enter it manually`;
      }
    ).finally(() => {
      if (!finished) {
        quickPick.busy = false;
        render();
      }
    });
  });
}

export async function selectModelCommand(): Promise<void> {
  const model = await pickModel();
  if (model) {
    await updateConfig('model', model);
    vscode.window.showInformationMessage(`Model changed to: ${model}`);
  }
}
