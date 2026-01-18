import { ChatMessage } from './client';
import { getConfig } from '../config';

const SYSTEM_PROMPT_ZH = `你是一个 Git commit 信息生成助手。根据提供的 diff 生成简洁、专业的 commit message。

要求：
1. 使用 Conventional Commits 格式: <type>(<scope>): <description>
2. type 可选: feat, fix, docs, style, refactor, perf, test, build, ci, chore
3. scope 是可选的，表示改动的模块/范围
4. description 用中文，简明扼要，不超过 50 个字符
5. 如果有多个改动，只总结最主要的改动
6. 不要包含任何解释，只输出 commit message 本身

示例输出：
feat(auth): 添加用户登录功能
fix(api): 修复请求超时问题
refactor: 重构配置管理模块`;

const SYSTEM_PROMPT_EN = `You are a Git commit message generator. Generate a concise, professional commit message based on the provided diff.

Requirements:
1. Use Conventional Commits format: <type>(<scope>): <description>
2. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
3. Scope is optional, represents the module/area of change
4. Description should be clear and under 50 characters
5. If there are multiple changes, summarize the most significant one
6. Output ONLY the commit message, no explanations

Example outputs:
feat(auth): add user login functionality
fix(api): resolve request timeout issue
refactor: restructure config management module`;

export function buildPrompt(diff: string): ChatMessage[] {
  const config = getConfig();
  const systemPrompt = config.language === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
  
  const userPrompt = config.language === 'zh'
    ? `请根据以下 diff 生成 commit message:\n\n${diff}`
    : `Generate a commit message for the following diff:\n\n${diff}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
