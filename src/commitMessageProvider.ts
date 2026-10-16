import * as vscode from 'vscode';
import { getDiff, getGitExtension, resolveRepository } from './git';
import { AIClient } from './ai/client';
import { buildPrompt } from './ai/prompt';
import { getConfig } from './config';
import { loadPromptContext } from './projectContext';
import { needsSetup, promptForSetup } from './setup';

export class CommitMessageProvider implements vscode.SourceControlInputBoxValueProvider {
  readonly label = 'Generate Commit Message (AI)';
  readonly icon = new vscode.ThemeIcon('sparkle');

  async provideValue(
    rootUri: vscode.Uri,
    context: vscode.SourceControlInputBoxValueProviderContext[],
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    if (needsSetup()) {
      const configured = await promptForSetup();
      if (!configured) {
        return undefined;
      }
    }
    return generateCommitMessageForUri(rootUri, token);
  }
}

export async function generateCommitMessageForUri(
  rootUri: vscode.Uri,
  token?: vscode.CancellationToken
): Promise<string | undefined> {
  try {
    const repo = await resolveRepository(rootUri);
    const diff = await getDiff(repo);
    
    if (!diff) {
      vscode.window.showWarningMessage('No changes to generate commit message for.');
      return undefined;
    }

    const { language, agentsContent, warnings } = await loadPromptContext(repo, getConfig());
    if (token?.isCancellationRequested) {
      return undefined;
    }
    if (warnings.length > 0) {
      // Non-modal notification: do not wait for dismissal before generating.
      void vscode.window.showWarningMessage(`Commit Generater: ${warnings.join(' ')} Continuing commit message generation.`);
    }

    const client = new AIClient();
    const messages = buildPrompt(diff, language, agentsContent);
    
    const commitMessage = await client.chat(messages, token);
    
    return commitMessage;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return undefined;
      }
      vscode.window.showErrorMessage(`Failed to generate commit message: ${error.message}`);
    } else {
      vscode.window.showErrorMessage('Failed to generate commit message: Unknown error');
    }
    return undefined;
  }
}

export async function generateCommitCommand(): Promise<void> {
  if (needsSetup()) {
    const configured = await promptForSetup();
    if (!configured) {
      return;
    }
  }

  const gitAPI = await getGitExtension();
  if (!gitAPI) {
    vscode.window.showErrorMessage('Git extension not found');
    return;
  }

  if (gitAPI.repositories.length === 0) {
    vscode.window.showErrorMessage('No Git repository found');
    return;
  }

  const repo = gitAPI.repositories[0];
  
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: 'Generating commit message...',
      cancellable: true,
    },
    async (progress, token) => {
      const message = await generateCommitMessageForUri(repo.rootUri, token);
      if (message) {
        repo.inputBox.value = message;
      }
    }
  );
}
