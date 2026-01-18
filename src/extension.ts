import * as vscode from 'vscode';
import { CommitMessageProvider, generateCommitCommand } from './commitMessageProvider';
import { selectModelCommand } from './commands/selectModel';
import { runSetupWizard } from './setup';

async function ensureGitExtension(): Promise<void> {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (gitExtension && !gitExtension.isActive) {
    await gitExtension.activate();
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Commit Generater extension is now active!');

  await ensureGitExtension();

  const generateDisposable = vscode.commands.registerCommand(
    'commitGenerater.generate',
    generateCommitCommand
  );
  context.subscriptions.push(generateDisposable);

  const selectModelDisposable = vscode.commands.registerCommand(
    'commitGenerater.selectModel',
    selectModelCommand
  );
  context.subscriptions.push(selectModelDisposable);

  const setupDisposable = vscode.commands.registerCommand(
    'commitGenerater.setup',
    runSetupWizard
  );
  context.subscriptions.push(setupDisposable);

  const scmAny = vscode.scm as any;
  if (typeof scmAny.registerSourceControlInputBoxValueProvider === 'function') {
    try {
      const provider = new CommitMessageProvider();
      const providerDisposable = scmAny.registerSourceControlInputBoxValueProvider(
        'git',
        provider
      );
      context.subscriptions.push(providerDisposable);
      console.log('Commit Generater: SCM InputBox Value Provider registered (proposed API).');
    } catch (error) {
      console.warn('Commit Generater: Failed to register proposed API provider:', error);
    }
  } else {
    console.log('Commit Generater: Using scm/title menu fallback (proposed API not available).');
  }
}

export function deactivate() {
  console.log('Commit Generater extension is now deactivated.');
}
