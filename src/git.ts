import * as vscode from 'vscode';
import { getConfig } from './config';
import { filterDiffExcludingLockFiles } from './exclusionUtils';

interface Change {
  uri: vscode.Uri;
  status: number;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  state: {
    HEAD: { commit: string } | undefined;
    indexChanges: readonly Change[];
    workingTreeChanges: readonly Change[];
  };
  diff(cached?: boolean): Promise<string>;
  show(ref: string, filePath: string): Promise<string>;
}

export interface GitAPI {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

export async function getGitExtension(): Promise<GitAPI | undefined> {
  const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>('vscode.git');
  if (!gitExtension) {
    return undefined;
  }
  
  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }
  
  return gitExtension.exports.getAPI(1);
}

export function getRepositoryForUri(gitAPI: GitAPI, uri: vscode.Uri): GitRepository | undefined {
  const repo = gitAPI.getRepository(uri);
  if (repo) {
    return repo;
  }
  
  for (const repository of gitAPI.repositories) {
    if (uri.fsPath.startsWith(repository.rootUri.fsPath)) {
      return repository;
    }
  }
  
  return gitAPI.repositories[0];
}

async function getNewRepoChanges(repo: GitRepository): Promise<string> {
  const changes: string[] = [];
  
  const stagedChanges = repo.state.indexChanges || [];
  const workingChanges = repo.state.workingTreeChanges || [];
  
  const allChanges = stagedChanges.length > 0 ? stagedChanges : workingChanges;
  
  for (const change of allChanges) {
    try {
      const relativePath = vscode.workspace.asRelativePath(change.uri);
      const doc = await vscode.workspace.openTextDocument(change.uri);
      const content = doc.getText();
      
      const maxContentLength = 2000;
      const truncatedContent = content.length > maxContentLength 
        ? content.substring(0, maxContentLength) + '\n... (content truncated)'
        : content;
      
      changes.push(`+++ ${relativePath}\n${truncatedContent}`);
    } catch {
    }
  }
  
  return changes.join('\n\n');
}

export async function getDiff(rootUri: vscode.Uri): Promise<string> {
  const gitAPI = await getGitExtension();
  if (!gitAPI) {
    throw new Error('Git extension not found');
  }
  
  const repo = getRepositoryForUri(gitAPI, rootUri);
  if (!repo) {
    throw new Error('No Git repository found');
  }
  
  let diff = await repo.diff(true);
  
  if (!diff || diff.trim() === '') {
    diff = await repo.diff(false);
  }
  
  if (!diff || diff.trim() === '') {
    const hasHead = repo.state.HEAD?.commit;
    if (!hasHead) {
      diff = await getNewRepoChanges(repo);
    }
  }
  
  if (!diff || diff.trim() === '') {
    return '';
  }
  
  // Filter out lock files from the diff
  diff = filterDiffExcludingLockFiles(diff);
  
  // Check again after filtering
  if (!diff || diff.trim() === '') {
    return '';
  }
  
  const config = getConfig();
  if (diff.length > config.maxDiffLength) {
    diff = diff.substring(0, config.maxDiffLength) + '\n\n... (diff truncated)';
  }
  
  return diff;
}
