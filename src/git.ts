import * as vscode from 'vscode';
import { getConfig } from './config';
import { filterDiffExcludingLockFiles } from './exclusionUtils';

interface Change {
  uri: vscode.Uri;
  status: number;
}

export interface GitCommit {
  message: string;
  parents: string[];
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
  log(options?: { maxEntries?: number }): Promise<GitCommit[]>;
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

export async function resolveRepository(rootUri: vscode.Uri): Promise<GitRepository> {
  const gitAPI = await getGitExtension();
  if (!gitAPI) {
    throw new Error('Git extension not found');
  }
  
  const repo = getRepositoryForUri(gitAPI, rootUri);
  if (!repo) {
    throw new Error('No Git repository found');
  }
  return repo;
}

/**
 * Return subject lines of up to `maxEntries` recent non-merge commits, newest first.
 * Fetches extra history so merge commits do not shrink the sample.
 * Returns an empty array for repositories without history.
 */
export async function getRecentCommitSubjects(repo: GitRepository, maxEntries: number): Promise<string[]> {
  if (!repo.state.HEAD?.commit) {
    return [];
  }
  const commits = await repo.log({ maxEntries: maxEntries * 3 });
  return commits
    .filter(commit => commit.parents.length <= 1)
    .map(commit => commit.message.split('\n')[0].trim())
    .filter(subject => subject.length > 0)
    .slice(0, maxEntries);
}

export async function getDiff(repo: GitRepository): Promise<string> {
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
