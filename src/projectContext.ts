import * as vscode from 'vscode';
import { CommitGeneraterConfig, CommitLanguage, CommitLanguageSetting } from './config';
import { GitRepository, getRecentCommitSubjects } from './git';

const AGENTS_FILE_NAME = 'AGENTS.md';
const MAX_AGENTS_LENGTH = 16000;
const HISTORY_SAMPLE_SIZE = 30;
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export interface PromptContext {
  language: CommitLanguage;
  agentsContent?: string;
  // Optional context failures, already replaced by fallbacks; callers decide how to report them.
  warnings: string[];
}

function displayLanguage(): CommitLanguage {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

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
    return displayLanguage();
  }

  const zhCount = subjects.filter(subject => CJK_PATTERN.test(subject)).length;
  return zhCount * 2 > subjects.length ? 'zh' : 'en';
}

/**
 * Resolve the output language and AGENTS.md content for a prompt. Failures of
 * these optional reads are translated into warnings and explicit fallbacks:
 * guidelines are omitted and the language falls back to the VS Code display language.
 * Without a repository only the configured or display language is available.
 */
export async function loadPromptContext(
  repo: GitRepository | undefined,
  config: Pick<CommitGeneraterConfig, 'language' | 'includeAgentsMd'>
): Promise<PromptContext> {
  if (!repo) {
    return { language: config.language === 'auto' ? displayLanguage() : config.language, warnings: [] };
  }

  const [languageResult, agentsResult] = await Promise.allSettled([
    resolveCommitLanguage(repo, config.language),
    config.includeAgentsMd ? readAgentsFile(repo.rootUri) : Promise.resolve(undefined),
  ]);

  const language = languageResult.status === 'fulfilled' ? languageResult.value : displayLanguage();
  const agentsContent = agentsResult.status === 'fulfilled' ? agentsResult.value : undefined;
  const warnings: string[] = [];
  if (agentsResult.status === 'rejected') {
    const error = agentsResult.reason;
    warnings.push(`Could not read AGENTS.md (${error instanceof Error ? error.message : String(error)}); project guidelines will be omitted.`);
  }
  if (languageResult.status === 'rejected') {
    const error = languageResult.reason;
    warnings.push(`Could not read Git history (${error instanceof Error ? error.message : String(error)}); using ${language === 'zh' ? 'Chinese' : 'English'} based on the VS Code display language.`);
  }
  return { language, agentsContent, warnings };
}
