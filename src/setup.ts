import * as vscode from 'vscode';
import { CommitLanguageSetting, getConfig, updateConfig } from './config';
import { pickModel } from './commands/selectModel';

export function needsSetup(): boolean {
  const config = getConfig();
  return !config.apiKey || config.apiKey.trim() === '';
}

export async function runSetupWizard(): Promise<boolean> {
  const baseUrl = await vscode.window.showInputBox({
    title: 'Commit Generater Setup (1/4)',
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
    title: 'Commit Generater Setup (2/4)',
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

  // Step 3/4: model (fetched from /models, or typed manually). Cancelling keeps the current model.
  const model = await pickModel();
  if (model) {
    await updateConfig('model', model);
  }

  const language = await vscode.window.showQuickPick(
    [
      { label: 'Auto', description: 'Follow the language of recent commits', value: 'auto' },
      { label: '中文', value: 'zh' },
      { label: 'English', value: 'en' },
    ],
    {
      title: 'Commit Generater Setup (4/4): Commit Message Language',
      placeHolder: 'Select the language for generated commit messages',
      ignoreFocusOut: true,
    }
  );

  if (language) {
    await updateConfig('language', language.value as CommitLanguageSetting);
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
