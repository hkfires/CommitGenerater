import * as vscode from 'vscode';
import { getConfig, updateConfig } from './config';
import { listModels } from './ai/models';

export function needsSetup(): boolean {
  const config = getConfig();
  return !config.apiKey || config.apiKey.trim() === '';
}

export async function runSetupWizard(): Promise<boolean> {
  const baseUrl = await vscode.window.showInputBox({
    title: 'Commit Generater Setup (1/3)',
    prompt: 'Enter your OpenAI-compatible API Base URL',
    value: getConfig().apiBaseUrl,
    placeHolder: 'https://api.openai.com/v1',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === '') {
        return 'API Base URL is required';
      }
      try {
        new URL(value);
        return undefined;
      } catch {
        return 'Please enter a valid URL';
      }
    },
  });

  if (baseUrl === undefined) {
    return false;
  }

  await updateConfig('apiBaseUrl', baseUrl.replace(/\/$/, ''));

  const apiKey = await vscode.window.showInputBox({
    title: 'Commit Generater Setup (2/3)',
    prompt: 'Enter your API Key',
    password: true,
    placeHolder: 'sk-...',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === '') {
        return 'API Key is required';
      }
      return undefined;
    },
  });

  if (apiKey === undefined) {
    return false;
  }

  await updateConfig('apiKey', apiKey);

  const selectModel = await vscode.window.showQuickPick(
    ['Select from available models', 'Enter model name manually'],
    {
      title: 'Commit Generater Setup (3/3)',
      placeHolder: 'How would you like to configure the model?',
      ignoreFocusOut: true,
    }
  );

  if (selectModel === undefined) {
    return false;
  }

  if (selectModel === 'Select from available models') {
    try {
      const models = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Fetching available models...',
        },
        async () => {
          return await listModels();
        }
      );

      if (models && models.length > 0) {
        const selectedModel = await vscode.window.showQuickPick(models, {
          title: 'Select a Model',
          placeHolder: 'Choose the model for commit message generation',
          ignoreFocusOut: true,
        });

        if (selectedModel) {
          await updateConfig('model', selectedModel);
        }
      } else {
        vscode.window.showWarningMessage('No models found. Using default model.');
      }
    } catch (error) {
      vscode.window.showWarningMessage(`Failed to fetch models: ${error}. Using default model.`);
    }
  } else {
    const modelName = await vscode.window.showInputBox({
      title: 'Enter Model Name',
      prompt: 'Enter the model name to use',
      value: getConfig().model,
      placeHolder: 'gpt-4o-mini',
      ignoreFocusOut: true,
    });

    if (modelName) {
      await updateConfig('model', modelName);
    }
  }

  const language = await vscode.window.showQuickPick(
    [
      { label: '中文', value: 'zh' },
      { label: 'English', value: 'en' },
    ],
    {
      title: 'Commit Message Language',
      placeHolder: 'Select the language for generated commit messages',
      ignoreFocusOut: true,
    }
  );

  if (language) {
    await updateConfig('language', language.value as 'zh' | 'en');
  }

  vscode.window.showInformationMessage('Commit Generater setup complete! Click the ✨ button to generate commit messages.');
  return true;
}

export async function promptForSetup(): Promise<boolean> {
  const action = await vscode.window.showWarningMessage(
    'Commit Generater: API Key not configured.',
    'Setup Now',
    'Open Settings',
    'Cancel'
  );

  if (action === 'Setup Now') {
    return await runSetupWizard();
  } else if (action === 'Open Settings') {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'commitGenerater'
    );
    return false;
  }
  
  return false;
}
