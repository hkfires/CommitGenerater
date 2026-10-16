import { ChatMessage } from './client';
import { CommitLanguage } from '../config';

const MAX_COMMITS_LENGTH = 32000;
const MAX_ISSUE_LENGTH = 4000;

export interface PullRequestPromptInput {
  compareBranch?: string;
  commitMessages: readonly string[];
  issues?: readonly { reference: string; content: string }[];
  template?: string;
  diff: string;
}

export interface PullRequestTitleAndDescription {
  title: string;
  description: string;
}

const SYSTEM_PROMPT_ZH = `# Pull Request 标题与描述生成器

## 系统指令
你是一个专业的 Pull Request 撰写助手。根据提供的提交记录、代码变更 diff，以及可选的关联 issue 和 PR 模板，为该 Pull Request 生成标题和描述。

## 输出格式
- 第一行：PR 标题
- 第二行：空行
- 第三行起：PR 描述（Markdown）
- 不要输出任何解释、前缀（如 "标题："）或包裹整个输出的代码块标记

## 标题规则
- 遵循约定式提交格式：\`<type>[可选 scope]: <description>\`
- type 取 feat、fix、docs、style、refactor、perf、test、build、ci、chore、revert 之一
- 概括整个 PR 最主要的变更，而不是罗列单个提交
- 使用祈使语气，结尾不加句号，不超过 72 个字符
- 存在破坏性变更时在 type 或 scope 后添加 \`!\`

## 描述规则
- 先用一两句话概括 PR 的目的和背景
- 再用列表列出主要变更，按重要程度排序，合并相似变更
- 存在破坏性变更、迁移步骤或需要审阅者特别注意的地方时单独说明
- 如果提供了 PR 模板，按模板结构填写描述，保留模板中的标题和复选框，无法确定的部分保持模板原样
- 如果提供了关联 issue 且本次变更解决了它，在描述中使用其引用标记注明（如 \`Closes #123\`）
- 只描述 diff 和提交记录中能体现的内容，不要编造

## 语言
使用简体中文撰写标题的 description 部分和 PR 描述，type、scope、代码标识符、文件路径保持原样。`;

const SYSTEM_PROMPT_EN = `# Pull Request Title and Description Generator

## System Instructions
You are an expert at writing pull requests. Based on the provided commit messages, code diff, and optional related issues and pull request template, generate a title and description for this pull request.

## Output Format
- Line 1: the pull request title
- Line 2: empty
- Line 3 onwards: the pull request description (Markdown)
- Do NOT include explanations, prefixes (such as "Title:"), or code block markers wrapping the whole output

## Title Rules
- Follow the Conventional Commits format: \`<type>[optional scope]: <description>\`
- type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Summarize the most significant change of the whole pull request instead of listing individual commits
- Use imperative mood, no period at the end, maximum 72 characters
- Add \`!\` after the type or scope for breaking changes

## Description Rules
- Start with one or two sentences summarizing the purpose and background
- Then list the main changes as bullet points, ordered by importance, merging similar changes
- Call out breaking changes, migration steps, or anything reviewers should pay special attention to
- If a pull request template is provided, fill in the description following its structure, keeping its headings and checkboxes; leave parts you cannot determine as in the template
- If related issues are provided and these changes resolve them, mention them using their reference (e.g. \`Closes #123\`)
- Only describe what is evident from the diff and commit messages; do not invent details

## Language
Write the title description and the pull request description in English.`;

function buildAgentsSection(language: CommitLanguage, agentsContent: string): string {
  return language === 'zh'
    ? `

## 项目规范（来自 AGENTS.md）
以下内容来自项目根目录的 AGENTS.md。若其中包含与 Pull Request 相关的约定（标题格式、描述结构、语言等），以其为准并优先于上述默认规则（包括输出语言）；若只定义了 commit message 约定，PR 标题也遵循该约定；与 PR 和 commit message 无关的内容请忽略。无论如何，都必须遵守上述输出格式。

<agents_md>
${agentsContent}
</agents_md>`
    : `

## Project Guidelines (from AGENTS.md)
The following content comes from AGENTS.md in the project root. If it defines pull request conventions (title format, description structure, language, etc.), follow them and let them take precedence over the defaults above (including the output language); if it only defines commit message conventions, apply them to the pull request title as well; ignore anything unrelated to pull requests and commit messages. Regardless, always follow the output format above.

<agents_md>
${agentsContent}
</agents_md>`;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength) + '\n... (truncated)' : text;
}

export function buildPullRequestPrompt(
  input: PullRequestPromptInput,
  language: CommitLanguage,
  agentsContent?: string
): ChatMessage[] {
  let systemPrompt = language === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
  if (agentsContent) {
    systemPrompt += buildAgentsSection(language, agentsContent);
  }

  const zh = language === 'zh';
  const sections: string[] = [zh ? '## Pull Request 上下文' : '## Pull Request Context'];
  if (input.compareBranch) {
    sections.push(`### ${zh ? '源分支' : 'Source Branch'}\n${input.compareBranch}`);
  }
  if (input.commitMessages.length > 0) {
    const commits = input.commitMessages
      .map((message, index) => `${index + 1}. ${message.trim().split('\n').join('\n   ')}`)
      .join('\n');
    sections.push(`### ${zh ? '提交记录' : 'Commits'}\n${truncate(commits, MAX_COMMITS_LENGTH)}`);
  }
  if (input.issues && input.issues.length > 0) {
    const issues = input.issues
      .map(issue => `<issue reference="${issue.reference}">\n${truncate(issue.content.trim(), MAX_ISSUE_LENGTH)}\n</issue>`)
      .join('\n');
    sections.push(`### ${zh ? '关联 Issue' : 'Related Issues'}\n${issues}`);
  }
  if (input.template?.trim()) {
    sections.push(`### ${zh ? 'PR 模板' : 'Pull Request Template'}\n<template>\n${input.template.trim()}\n</template>`);
  }
  if (input.diff) {
    sections.push(`### ${zh ? '代码变更 Diff' : 'Code Diff'}\n\`\`\`diff\n${input.diff}\n\`\`\``);
  }
  sections.push(zh
    ? '请基于以上内容生成 PR 标题和描述。'
    : 'Generate the pull request title and description based on the above.');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

/**
 * Split the model output into title (first line) and description (the rest).
 * Returns undefined when the output has no title.
 */
export function parsePullRequestResponse(content: string): PullRequestTitleAndDescription | undefined {
  const text = content.trim();
  const newline = text.indexOf('\n');
  // Models occasionally format the title as a Markdown heading.
  const title = (newline === -1 ? text : text.substring(0, newline)).replace(/^#{1,6}[ \t]+/, '').trim();
  if (!title) {
    return undefined;
  }
  return { title, description: newline === -1 ? '' : text.substring(newline + 1).trim() };
}
