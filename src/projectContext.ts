import * as vscode from 'vscode';
import { CommitLanguage, CommitLanguageSetting } from './config';
import { GitRepository, getRecentCommitSubjects } from './git';

const AGENTS_FILE_NAME = 'AGENTS.md';
const MAX_AGENTS_LENGTH = 16000;
const HISTORY_SAMPLE_SIZE = 30;
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Read AGENTS.md from the repository root. Returns undefined when the file
 * does not exist or is empty. Other read failures propagate to the caller.
 */
export async function readAgentsFile(rootUri: vscode.Uri): Promise<string | undefined> {
  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(rootUri, AGENTS_FILE_NAME));
    content = Buffer.from(bytes).toString('utf8').trim();
  } catch (error) {
    // A missing optional file is safe to omit; other failures must not hide guidelines.
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return undefined;
    }
    throw error;
  }

  if (!content) {
    return undefined;
  }
  if (content.length > MAX_AGENTS_LENGTH) {
    return content.substring(0, MAX_AGENTS_LENGTH) + '\n\n... (AGENTS.md truncated)';
  }
  return content;
}

/**
 * Resolve the commit message language. In 'auto' mode the language is
 * inferred from recent commit subjects (majority vote: subjects containing
 * CJK characters count as Chinese). Repositories without history fall back
 * to the VS Code display language.
 */
export async function resolveCommitLanguage(
  repo: GitRepository,
  setting: CommitLanguageSetting
): Promise<CommitLanguage> {
  if (setting !== 'auto') {
    return setting;
  }

  const subjects = await getRecentCommitSubjects(repo, HISTORY_SAMPLE_SIZE);
  if (subjects.length === 0) {
    return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  const zhCount = subjects.filter(subject => CJK_PATTERN.test(subject)).length;
  return zhCount * 2 > subjects.length ? 'zh' : 'en';
}
