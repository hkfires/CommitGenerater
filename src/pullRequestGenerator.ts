import * as vscode from 'vscode';
import { AIClient } from './ai/client';
import { buildPullRequestPrompt, parsePullRequestResponse, PullRequestTitleAndDescription } from './ai/prPrompt';
import { getConfig } from './config';
import { getGitExtension, GitRepository } from './git';
import { loadPromptContext } from './projectContext';
import { needsSetup, promptForSetup } from './setup';

export interface FilePatch {
  patch: string;
  fileUri: string;
  previousFileUri?: string;
}

/**
 * Context passed by the GitHub Pull Requests extension to title and description
 * providers (TitleAndDescriptionProvider in its api.d.ts).
 */
export interface TitleAndDescriptionContext {
  commitMessages: string[];
  patches: readonly (string | FilePatch)[];
  issues?: { reference: string; content: string }[];
  template?: string;
  compareBranch?: string;
}

/**
 * Use the deepest open repository that owns every patched path. A patch at a
 * submodule root changes its gitlink in the parent, not a file in the submodule.
 * No matching local repository is expected for other Git providers; their
 * supplied patches remain usable without local guidelines or history.
 * Legacy string patches and binary-only changes retain the single-repo lookup.
 */
async function findRepository(patches: readonly (string | FilePatch)[]): Promise<GitRepository | undefined> {
  const repositories = (await getGitExtension())?.repositories ?? [];
  const fileUris = patches.flatMap(patch => typeof patch === 'string'
    ? []
    : [patch.fileUri, ...(patch.previousFileUri ? [patch.previousFileUri] : [])]
  ).map(uri => vscode.Uri.parse(uri));
  if (fileUris.length === 0) {
    return repositories.length === 1 ? repositories[0] : undefined;
  }

  const candidates = repositories.filter(({ rootUri }) => {
    // URI serialization lowercases Windows drive letters, not the rest of the path.
    const rootPath = rootUri.path.replace(/^\/[A-Z]:(?=\/|$)/, drive => drive.toLowerCase());
    const rootPrefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
    return fileUris.every(uri => {
      const filePath = uri.path.replace(/^\/[A-Z]:(?=\/|$)/, drive => drive.toLowerCase());
      return uri.scheme === rootUri.scheme
        && uri.authority.toLowerCase() === rootUri.authority.toLowerCase()
        && filePath !== rootPath && filePath.startsWith(rootPrefix);
    });
  });
  return candidates.sort((a, b) => b.rootUri.path.length - a.rootUri.path.length)[0];
}

/**
 * Join the supplied patch text, as Copilot's provider does. File URIs are
 * metadata for repository lookup and are not converted into diff headers.
 */
export function buildPullRequestDiff(
  patches: readonly (string | FilePatch)[],
  maxLength: number
): string {
  const diff = patches.map(patch => typeof patch === 'string' ? patch : patch.patch).join('\n\n').trim();

  return diff.length > maxLength ? diff.substring(0, maxLength) + '\n\n... (diff truncated)' : diff;
}

export async function generatePullRequestTitleAndDescription(
  context: TitleAndDescriptionContext,
  token: vscode.CancellationToken
): Promise<PullRequestTitleAndDescription | undefined> {
  if (needsSetup() && !(await promptForSetup())) {
    return undefined;
  }

  try {
    const repo = await findRepository(context.patches);
    const config = getConfig();
    const diff = buildPullRequestDiff(context.patches, config.maxDiffLength);
    if (!diff && context.commitMessages.length === 0) {
      vscode.window.showWarningMessage('No changes to generate a pull request title and description for.');
      return undefined;
    }

    const { language, agentsContent, warnings } = await loadPromptContext(repo, config);
    if (token.isCancellationRequested) {
      return undefined;
    }
    if (warnings.length > 0) {
      // Non-modal notification: do not wait for dismissal before generating.
      void vscode.window.showWarningMessage(`Commit Generater: ${warnings.join(' ')} Continuing pull request generation.`);
    }

    const messages = buildPullRequestPrompt({
      compareBranch: context.compareBranch,
      commitMessages: context.commitMessages,
      issues: context.issues,
      template: context.template,
      diff,
    }, language, agentsContent);
    const result = parsePullRequestResponse(await new AIClient().chat(messages, token));
    if (!result) {
      throw new Error('The model returned an empty title');
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return undefined;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to generate pull request title and description: ${message}`);
    return undefined;
  }
}
