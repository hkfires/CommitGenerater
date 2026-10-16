// Run after compilation: node --test scripts/review-fixes.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Load compiled extension modules with controlled VS Code dependencies, without an extension host.
function loadModule(relativePath, mocks, globals = {}) {
  const filename = path.resolve(__dirname, '..', 'out', relativePath);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
    Buffer,
    Error,
    ...globals,
  }, { filename });
  return module.exports;
}

class FileSystemError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const rootUri = { path: '/repo' };

function contextModules(readFile, language = 'zh-cn') {
  const vscode = {
    FileSystemError,
    Uri: { joinPath: (root, name) => `${root.path}/${name}` },
    workspace: { fs: { readFile } },
    env: { language },
  };
  const git = loadModule('git.js', { vscode, './config': {} });
  const context = loadModule('projectContext.js', { vscode, './git': git });
  return { vscode, git, context };
}

function repository(log, hasHead = true) {
  return { state: { HEAD: hasHead ? { commit: 'abc123' } : undefined }, log };
}

test('AGENTS.md is read from the repository root, trimmed and bounded', async () => {
  const { context } = contextModules(async uri => {
    assert.equal(uri, '/repo/AGENTS.md');
    return Buffer.from('  Commit in Chinese  \n');
  });
  assert.equal(await context.readAgentsFile(rootUri), 'Commit in Chinese');
  const large = contextModules(async () => Buffer.from('x'.repeat(16001))).context;
  assert.equal(await large.readAgentsFile(rootUri), 'x'.repeat(16000) + '\n\n... (AGENTS.md truncated)');
});

test('missing or empty AGENTS.md is optional', async () => {
  const missing = contextModules(async () => { throw new FileSystemError('FileNotFound'); }).context;
  assert.equal(await missing.readAgentsFile(rootUri), undefined);
  const empty = contextModules(async () => Buffer.from(' \n')).context;
  assert.equal(await empty.readAgentsFile(rootUri), undefined);
});

for (const error of [
  new FileSystemError('NoPermissions'),
  new FileSystemError('Unavailable'),
  Object.assign(new Error('untyped filesystem error'), { code: 'FileNotFound' }),
  new Error('FileNotFound'),
]) {
  test(`AGENTS.md propagates unexpected read failure: ${error.message}`, async () => {
    const { context } = contextModules(async () => { throw error; });
    await assert.rejects(context.readAgentsFile(rootUri), caught => caught === error);
  });
}

test('repositories without HEAD skip Git log and use the display language', async () => {
  const { git, context } = contextModules(async () => Buffer.from(''));
  const repo = repository(() => assert.fail('log must not be called without HEAD'), false);
  assert.equal((await git.getRecentCommitSubjects(repo, 30)).length, 0);
  assert.equal(await context.resolveCommitLanguage(repo, 'auto'), 'zh');
});

test('Git subjects exclude merges, trim bodies and respect the limit', async () => {
  const { git } = contextModules(async () => Buffer.from(''));
  const repo = repository(async options => {
    assert.equal(options.maxEntries, 6);
    return [
      { message: 'merge', parents: ['a', 'b'] },
      { message: ' feat: add feature \n\nBody', parents: ['a'] },
      { message: '   ', parents: [] },
      { message: 'fix: repair feature', parents: ['a'] },
      { message: 'docs: later', parents: ['a'] },
    ];
  });
  assert.deepEqual(Array.from(await git.getRecentCommitSubjects(repo, 2)), [
    'feat: add feature', 'fix: repair feature',
  ]);
});

test('Git history failures propagate through automatic language detection', async () => {
  const error = new Error('Git history unavailable');
  const { git, context } = contextModules(async () => Buffer.from(''));
  const repo = repository(async () => { throw error; });
  await assert.rejects(git.getRecentCommitSubjects(repo, 30), caught => caught === error);
  await assert.rejects(context.resolveCommitLanguage(repo, 'auto'), caught => caught === error);
  assert.equal(await context.resolveCommitLanguage(repo, 'en'), 'en');
});

const generationCases = [
  { name: 'AGENTS failure preserves fixed language', agents: 'failure', history: 'unused', language: 'en', locale: 'zh-cn', expectedLanguage: 'en', warnings: 1 },
  { name: 'history failure preserves AGENTS and falls back to English', agents: 'ok', history: 'failure', language: 'auto', locale: 'en', expectedLanguage: 'en', warnings: 1 },
  { name: 'both failures merge into one warning and fall back to Chinese', agents: 'failure', history: 'failure', language: 'auto', locale: 'zh-cn', expectedLanguage: 'zh', warnings: 1 },
  { name: 'missing AGENTS does not warn', agents: 'missing', history: 'ok', language: 'auto', locale: 'zh-cn', expectedLanguage: 'en', warnings: 0 },
  { name: 'empty AGENTS does not warn', agents: 'empty', history: 'ok', language: 'auto', locale: 'zh-cn', expectedLanguage: 'en', warnings: 0 },
  { name: 'new repository does not warn', agents: 'missing', history: 'empty', language: 'auto', locale: 'zh-cn', expectedLanguage: 'zh', warnings: 0 },
  { name: 'disabled AGENTS and fixed language skip optional reads', agents: 'disabled', history: 'unused', language: 'zh', locale: 'en', expectedLanguage: 'zh', warnings: 0 },
  { name: 'successful optional context does not warn', agents: 'ok', history: 'ok', language: 'auto', locale: 'zh-cn', expectedLanguage: 'en', warnings: 0 },
];

for (const scenario of generationCases) {
  test(`generation: ${scenario.name}`, async () => {
    const { context, vscode } = contextModules(async () => {
      if (scenario.agents === 'failure') {
        throw new FileSystemError('NoPermissions');
      }
      if (scenario.agents === 'missing') {
        throw new FileSystemError('FileNotFound');
      }
      assert.notEqual(scenario.agents, 'disabled');
      return Buffer.from(scenario.agents === 'empty' ? ' \n' : 'Project guidelines');
    }, scenario.locale);
    const warnings = [];
    const errors = [];
    let chatCalls = 0;
    const repo = repository(async () => {
      if (scenario.history === 'failure') {
        throw new Error('Git history unavailable');
      }
      assert.equal(scenario.history, 'ok');
      return [{ message: 'feat: add feature', parents: ['abc'] }];
    }, scenario.history !== 'empty');
    repo.rootUri = rootUri;
    const provider = loadModule('commitMessageProvider.js', {
      vscode: { ...vscode, window: {
        showErrorMessage: message => errors.push(message),
        showWarningMessage: (...args) => {
          assert.equal(args.length, 1, 'warning must be non-modal');
          warnings.push(args[0]);
          // Never dismiss the notification: generation must not wait for it.
          return new Promise(() => {});
        },
      } },
      './git': { resolveRepository: async () => repo, getDiff: async () => 'diff' },
      './config': { getConfig: () => ({ language: scenario.language, includeAgentsMd: scenario.agents !== 'disabled' }) },
      './projectContext': context,
      './ai/client': { AIClient: class {
        async chat(messages) {
          chatCalls++;
          assert.equal(warnings.length, scenario.warnings);
          assert.equal(messages.language, scenario.expectedLanguage);
          assert.equal(messages.agents, scenario.agents === 'ok' ? 'Project guidelines' : undefined);
          return 'feat: generated';
        }
      } },
      './ai/prompt': { buildPrompt: (diff, language, agents) => ({ diff, language, agents }) },
      './setup': {},
    });
    assert.equal(await provider.generateCommitMessageForUri(rootUri), 'feat: generated');
    assert.equal(chatCalls, 1);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, scenario.warnings);
    if (scenario.agents === 'failure') {
      assert.match(warnings[0], /AGENTS\.md.*NoPermissions.*guidelines will be omitted/);
    }
    if (scenario.history === 'failure') {
      assert.match(warnings[0], /Git history unavailable/);
      assert.ok(warnings[0].includes(scenario.expectedLanguage === 'zh' ? 'Chinese' : 'English'));
    }
  });
}

for (const source of ['diff', 'AI']) {
  test(`${source} failures still stop generation and show an error`, async () => {
    const error = new Error(`${source} unavailable`);
    const errors = [];
    const provider = loadModule('commitMessageProvider.js', {
      vscode: { window: {
        showErrorMessage: message => errors.push(message),
        showWarningMessage: () => assert.fail('must not warn for a required operation failure'),
      } },
      './git': {
        resolveRepository: async () => ({ rootUri }),
        getDiff: async () => {
          if (source === 'diff') {
            throw error;
          }
          return 'diff';
        },
      },
      './config': { getConfig: () => ({ language: 'en', includeAgentsMd: false }) },
      './projectContext': { loadPromptContext: async () => ({ language: 'en', warnings: [] }) },
      './ai/client': { AIClient: class { async chat() { throw error; } } },
      './ai/prompt': { buildPrompt: () => [] },
      './setup': {},
    });
    assert.equal(await provider.generateCommitMessageForUri(rootUri), undefined);
    assert.deepEqual(errors, [`Failed to generate commit message: ${error.message}`]);
  });
}

test('cancelled generation does not warn or call AI after optional context reads', async () => {
  const provider = loadModule('commitMessageProvider.js', {
    vscode: { window: {
      showErrorMessage: () => assert.fail('must not show an error after cancellation'),
      showWarningMessage: () => assert.fail('must not warn after cancellation'),
    } },
    './git': { resolveRepository: async () => ({ rootUri }), getDiff: async () => 'diff' },
    './config': { getConfig: () => ({ language: 'auto', includeAgentsMd: true }) },
    './projectContext': {
      loadPromptContext: async () => ({ language: 'en', warnings: ['Could not read AGENTS.md (NoPermissions)'] }),
    },
    './ai/client': { AIClient: class { constructor() { assert.fail('must not call AI'); } } },
    './ai/prompt': {},
    './setup': {},
  });
  assert.equal(await provider.generateCommitMessageForUri(rootUri, { isCancellationRequested: true }), undefined);
});

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
const properties = manifest.contributes.configuration.properties;
const settings = [
  ['apiBaseUrl', 'https://old.example/v1', 'https://new.example/v1'],
  ['apiKey', 'old-test-key', 'new-test-key'],
  ['apiKey', '', 'new-test-key'],
  ['includeAgentsMd', true, false],
  ['includeAgentsMd', false, true],
  ['model', 'old-model', 'new-model'],
  ['reasoningEffort', 'default', 'max'],
  ['language', 'auto', 'zh'],
  ['maxDiffLength', 65536, 131072],
  ['prTitleProvider', 'ask', 'copilot'],
];

test('all settings forbid workspace and folder overrides in the manifest', () => {
  for (const [key, declaration] of Object.entries(properties)) {
    assert.equal(declaration.scope, 'machine', key);
  }
});

for (const [key, oldValue, newValue] of settings) {
  for (const override of ['absent', 'workspace', 'folder']) {
    test(`${key}: writes only to user settings with ${override} override (previous ${JSON.stringify(oldValue)})`, async () => {
      const state = { globalValue: oldValue };
      if (override !== 'absent') {
        state.workspaceValue = oldValue;
        if (override === 'folder') {
          state.workspaceFolderValue = oldValue;
        }
      }
      const vscode = {
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        workspace: { getConfiguration: () => ({
          inspect: requestedKey => requestedKey === key ? state : undefined,
          get: () => assert.fail('must not read merged workspace configuration'),
          update: async (updatedKey, value, target) => {
            assert.equal(updatedKey, key);
            assert.equal(target, 1, 'must not write to workspace or folder settings');
            state.globalValue = value;
          },
        }) },
      };
      const config = loadModule('config.js', { vscode });
      await config.updateConfig(key, newValue);
      assert.equal(config.getConfig()[key], newValue);
      if (override !== 'absent') {
        assert.equal(state.workspaceValue, oldValue, 'legacy workspace value must not be modified');
        if (override === 'folder') {
          assert.equal(state.workspaceFolderValue, oldValue, 'folder value must not be modified');
        }
      }
    });
  }
}

for (const [fullKey, declaration] of Object.entries(properties)) {
  const key = fullKey.replace('commitGenerater.', '');
  test(`${key}: ignores workspace-only configuration and uses the default`, () => {
    const vscode = {
      workspace: { getConfiguration: () => ({
        inspect: requestedKey => requestedKey === key ? {
          workspaceValue: 'ignored-workspace-value',
          workspaceFolderValue: 'ignored-folder-value',
        } : undefined,
        get: () => assert.fail('must not read merged workspace configuration'),
      }) },
    };
    const config = loadModule('config.js', { vscode });
    assert.equal(config.getConfig()[key], declaration.default);
  });
}

test('explicit empty, false and zero user values are not replaced by workspace values or defaults', () => {
  const values = { apiKey: '', includeAgentsMd: false, maxDiffLength: 0 };
  const config = loadModule('config.js', {
    vscode: { workspace: { getConfiguration: () => ({
      inspect: key => ({ globalValue: values[key], workspaceValue: 'ignored' }),
    }) } },
  });
  for (const [key, value] of Object.entries(values)) {
    assert.equal(config.getConfig()[key], value);
  }
});

test('user API URL is normalized and cannot be redirected by workspace settings', () => {
  const config = loadModule('config.js', {
    vscode: { workspace: { getConfiguration: () => ({
      inspect: key => key === 'apiBaseUrl' ? {
        globalValue: 'https://user.example/v1/',
        workspaceValue: 'https://workspace.example/v1',
      } : undefined,
    }) } },
  });
  assert.equal(config.getConfig().apiBaseUrl, 'https://user.example/v1');
});

test('settings write failures propagate without retrying another scope', async () => {
  const error = new Error('Settings write denied');
  let calls = 0;
  const vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    workspace: { getConfiguration: () => ({
      update: async (_key, _value, target) => {
        calls++;
        assert.equal(target, 1);
        throw error;
      },
    }) },
  };
  const config = loadModule('config.js', { vscode });
  await assert.rejects(config.updateConfig('apiKey', 'test-key'), caught => caught === error);
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// Pull request title and description generation (GitHub Pull Requests integration)
// ---------------------------------------------------------------------------

const prPrompt = () => loadModule('ai/prPrompt.js', {});

test('PR response: first line is the title, the rest is the description', () => {
  const { parsePullRequestResponse } = prPrompt();
  assert.deepEqual({ ...parsePullRequestResponse('feat: add x\n\n## Summary\n- a\n') }, {
    title: 'feat: add x', description: '## Summary\n- a',
  });
  assert.deepEqual({ ...parsePullRequestResponse('## feat: add x') }, { title: 'feat: add x', description: '' });
  assert.equal(parsePullRequestResponse('  \n '), undefined);
});

test('PR response preserves issue references and other non-heading prefixes', () => {
  const { parsePullRequestResponse } = prPrompt();
  const description = '## Summary\n- Fixed login';
  for (const title of ['#123: fix login', '##123: fix login', '#fix login', '####### fix login']) {
    assert.deepEqual({ ...parsePullRequestResponse(`${title}\n\n${description}`) }, { title, description });
  }
});

test('PR response strips genuine Markdown headings without changing the issue reference', () => {
  const { parsePullRequestResponse } = prPrompt();
  const title = '#123: fix login';
  const description = '## Summary\n- Fixed login';
  for (const prefix of ['# ', '## ', '###### ', '###\t']) {
    assert.deepEqual({ ...parsePullRequestResponse(`${prefix}${title}\n\n${description}`) }, { title, description });
  }
});

test('PR prompt includes optional context only when present', () => {
  const { buildPullRequestPrompt } = prPrompt();
  const full = buildPullRequestPrompt({
    compareBranch: 'dev',
    commitMessages: ['feat: add x\n\nbody line', 'fix: y'],
    issues: [{ reference: '#12', content: 'Issue title\nIssue body' }],
    template: '## Checklist\n- [ ] tests',
    diff: 'diff --git a/a.ts b/a.ts',
  }, 'zh', 'Use English PR titles');
  assert.equal(full.length, 2);
  assert.match(full[0].content, /Pull Request 标题与描述生成器/);
  assert.match(full[0].content, /<agents_md>\nUse English PR titles\n<\/agents_md>/);
  const user = full[1].content;
  for (const expected of ['dev', '1. feat: add x\n   \n   body line\n2. fix: y', '<issue reference="#12">',
    '<template>\n## Checklist\n- [ ] tests\n</template>', '```diff\ndiff --git a/a.ts b/a.ts\n```']) {
    assert.ok(user.includes(expected), expected);
  }

  const minimal = buildPullRequestPrompt({ commitMessages: ['feat: add x'], diff: '' }, 'en');
  assert.match(minimal[0].content, /Write the title description and the pull request description in English/);
  assert.doesNotMatch(minimal[0].content, /agents_md/);
  for (const absent of ['Source Branch', 'Related Issues', '<template>', '```diff']) {
    assert.ok(!minimal[1].content.includes(absent), absent);
  }
});

const prVscode = (extra = {}) => ({
  Uri: { parse: value => {
    const uri = new URL(value);
    return { scheme: uri.protocol.slice(0, -1), authority: uri.host, path: decodeURIComponent(uri.pathname) };
  } },
  workspace: { workspaceFolders: undefined },
  ...extra,
});

function prGenerator(mocks = {}) {
  return loadModule('pullRequestGenerator.js', {
    vscode: prVscode(mocks.vscode),
    './ai/client': mocks.client ?? {},
    './ai/prPrompt': prPrompt(),
    './config': { getConfig: () => ({ maxDiffLength: 131072, language: 'en', includeAgentsMd: true, ...mocks.config }) },
    './git': mocks.git ?? {},
    './projectContext': mocks.projectContext ?? {},
    './setup': mocks.setup ?? { needsSetup: () => false },
  });
}

test('PR diff keeps supplied patch text without deriving headers from file URIs', () => {
  const { buildPullRequestDiff } = prGenerator();
  const diff = buildPullRequestDiff([
    { patch: '@@ -1 +1 @@\n-a\n+b', fileUri: 'vsls:/home/build/repo/src/a.ts' },
    { patch: '@@ -1 +1 @@\n-c\n+d', fileUri: 'file:///repo/src/new.ts', previousFileUri: 'file:///repo/src/old.ts' },
    { patch: 'diff --git a/b.ts b/b.ts\n@@ -1 +1 @@', fileUri: 'file:///repo/b.ts' },
    { patch: '@@ -1 +1 @@\n-1\n+2', fileUri: 'file:///repo/package-lock.json' },
    'diff --git a/legacy.ts b/legacy.ts',
  ], 100000);
  assert.ok(diff.startsWith('@@ -1 +1 @@\n-a\n+b\n\n@@ -1 +1 @@\n-c\n+d'));
  assert.ok(diff.includes('diff --git a/b.ts b/b.ts\n@@ -1 +1 @@'));
  assert.ok(diff.includes('diff --git a/legacy.ts b/legacy.ts'));
  assert.ok(diff.includes('-1\n+2'), 'file URIs must not be used to filter supplied patches');
  for (const uriPath of ['/home/build/repo', 'src/a.ts', 'src/old.ts', 'src/new.ts', 'package-lock.json']) {
    assert.ok(!diff.includes(uriPath), uriPath);
  }
  assert.equal(buildPullRequestDiff(['x'.repeat(20)], 10), 'xxxxxxxxxx\n\n... (diff truncated)');
});

function prGenerationScenario({ chat, warnings = [], token = { isCancellationRequested: false }, patches,
  repositories = [{ rootUri: prVscode().Uri.parse('file:///repo') }], git } = {}) {
  const calls = { warnings: [], errors: [], repo: undefined, contextReads: 0, prompt: undefined, chats: 0 };
  const generator = prGenerator({
    vscode: { window: {
      showWarningMessage: (...args) => {
        assert.equal(args.length, 1, 'warning must be non-modal');
        calls.warnings.push(args[0]);
        return new Promise(() => {});
      },
      showErrorMessage: message => calls.errors.push(message),
    } },
    git: git ?? { getGitExtension: async () => ({ repositories }) },
    projectContext: { loadPromptContext: async repo => {
      calls.repo = repo;
      calls.contextReads++;
      return { language: 'zh', agentsContent: 'Guidelines', warnings };
    } },
    client: { AIClient: class {
      async chat(messages) {
        calls.chats++;
        calls.prompt = messages;
        return chat ? chat() : 'feat: add pr generation\n\n- details';
      }
    } },
  });
  const context = {
    commitMessages: ['feat: add pr generation'],
    patches: patches ?? [{ patch: '@@ -1 +1 @@\n-a\n+b', fileUri: 'file:///repo/src/a.ts' }],
    compareBranch: 'dev',
  };
  return { calls, run: () => generator.generatePullRequestTitleAndDescription(context, token) };
}

test('PR generation resolves the repository from patches and returns the parsed result', async () => {
  const { calls, run } = prGenerationScenario({ warnings: ['Could not read AGENTS.md (denied).'] });
  assert.deepEqual({ ...(await run()) }, { title: 'feat: add pr generation', description: '- details' });
  assert.equal(calls.repo.rootUri.path, '/repo');
  assert.equal(calls.chats, 1);
  assert.match(calls.prompt[0].content, /Pull Request 标题与描述生成器[\s\S]*<agents_md>\nGuidelines/);
  assert.match(calls.prompt[1].content, /@@ -1 \+1 @@\n-a\n\+b/);
  assert.doesNotMatch(calls.prompt[1].content, /diff --git a\/src\/a\.ts/);
  assert.deepEqual(calls.warnings, ['Commit Generater: Could not read AGENTS.md (denied). Continuing pull request generation.']);
  assert.deepEqual(calls.errors, []);
});

test('PR generation retains UNC repository guidelines and history after URI serialization', async () => {
  let agentsReads = 0;
  let historyReads = 0;
  const { context } = contextModules(async uri => {
    assert.equal(uri, '/share/repo/AGENTS.md');
    agentsReads++;
    return Buffer.from('Preserve issue references in PR titles');
  }, 'en');
  const repo = repository(async () => {
    historyReads++;
    return [{ message: 'fix: 修复登录', parents: ['parent'] }];
  });
  // Uri.file('\\\\SERVER\\share\\repo') can retain uppercase authority, while
  // GHPR's Uri.toString() serializes file URIs with a lowercase authority.
  repo.rootUri = { scheme: 'file', authority: 'SERVER', path: '/share/repo' };
  const unrelated = {
    rootUri: { ...repo.rootUri, authority: 'other-server' },
    log: () => assert.fail('must not read another server repository'),
  };
  let prompt;
  const generator = prGenerator({
    config: { language: 'auto', includeAgentsMd: true },
    vscode: { window: {
      showWarningMessage: message => assert.fail(message),
      showErrorMessage: message => assert.fail(message),
    } },
    git: { getGitExtension: async () => ({ repositories: [unrelated, repo] }) },
    projectContext: context,
    client: { AIClient: class {
      async chat(messages) {
        prompt = messages;
        return '#123: 修复登录\n\n- 修复登录问题';
      }
    } },
  });
  const result = await generator.generatePullRequestTitleAndDescription({
    commitMessages: ['fix: 修复登录'],
    patches: [{
      fileUri: 'file://server/share/repo/src/new.ts',
      previousFileUri: 'file://server/share/repo/src/old.ts',
      patch: '@@ -1 +1 @@\n-a\n+b',
    }],
  }, { isCancellationRequested: false });
  assert.ok(result);
  assert.equal(agentsReads, 1);
  assert.equal(historyReads, 1);
  assert.match(prompt[0].content, /Pull Request 标题与描述生成器/);
  assert.match(prompt[0].content, /<agents_md>\nPreserve issue references in PR titles\n<\/agents_md>/);
});

test('PR generation retains Windows drive repository context after URI serialization', async () => {
  let agentsReads = 0;
  let historyReads = 0;
  const { context } = contextModules(async uri => {
    assert.equal(uri, '/E:/Repo/AGENTS.md');
    agentsReads++;
    return Buffer.from('Preserve issue references in PR titles');
  }, 'en');
  const repo = repository(async () => {
    historyReads++;
    return [{ message: 'fix: 修复登录', parents: ['parent'] }];
  });
  // Uri.file preserves the uppercase drive; GHPR's Uri.toString() lowercases
  // the drive and encodes the colon before the provider parses the URI again.
  repo.rootUri = { scheme: 'file', authority: '', path: '/E:/Repo' };
  let prompt;
  const generator = prGenerator({
    config: { language: 'auto', includeAgentsMd: true },
    vscode: { window: {
      showWarningMessage: message => assert.fail(message),
      showErrorMessage: message => assert.fail(message),
    } },
    git: { getGitExtension: async () => ({ repositories: [repo] }) },
    projectContext: context,
    client: { AIClient: class {
      async chat(messages) {
        prompt = messages;
        return '#123: 修复登录\n\n- 修复登录问题';
      }
    } },
  });
  const result = await generator.generatePullRequestTitleAndDescription({
    commitMessages: ['fix: 修复登录'],
    patches: [{
      fileUri: 'file:///e%3A/Repo/src/new.ts',
      previousFileUri: 'file:///e%3A/Repo/src/old.ts',
      patch: '@@ -1 +1 @@\n-a\n+b',
    }],
  }, { isCancellationRequested: false });
  assert.ok(result);
  assert.equal(agentsReads, 1);
  assert.equal(historyReads, 1);
  assert.match(prompt[0].content, /Pull Request 标题与描述生成器/);
  assert.match(prompt[0].content, /<agents_md>\nPreserve issue references in PR titles\n<\/agents_md>/);
});

test('PR Windows drive matching normalizes both sides and preserves submodule ownership', async () => {
  for (const [rootDrive, patchDrive] of [['E', 'e'], ['e', 'E']]) {
    const parent = { rootUri: prVscode().Uri.parse(`file:///${rootDrive}:/Repo`) };
    const submodule = { rootUri: prVscode().Uri.parse(`file:///${rootDrive}:/Repo/deps/sdk`) };
    for (const repositories of [[parent, submodule], [submodule, parent]]) {
      for (const [filePath, expectedRepo] of [['deps/sdk', parent], ['deps/sdk/src/a.ts', submodule]]) {
        const { calls, run } = prGenerationScenario({ repositories, patches: [{
          fileUri: `file:///${patchDrive}%3A/Repo/${filePath}`,
          patch: '@@ -1 +1 @@\n-a\n+b',
        }] });
        assert.ok(await run());
        assert.equal(calls.repo, expectedRepo);
        assert.deepEqual(calls.errors, []);
      }
    }
  }
});

test('PR generation stops on cancellation, empty input and AI failures', async () => {
  const cancelled = prGenerationScenario({ warnings: ['w'], token: { isCancellationRequested: true } });
  assert.equal(await cancelled.run(), undefined);
  assert.equal(cancelled.calls.chats, 0);
  assert.deepEqual(cancelled.calls.warnings, []);

  const failed = prGenerationScenario({ chat: () => { throw new Error('quota exceeded'); } });
  assert.equal(await failed.run(), undefined);
  assert.deepEqual(failed.calls.errors, ['Failed to generate pull request title and description: quota exceeded']);

  const aborted = prGenerationScenario({ chat: () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
  assert.equal(await aborted.run(), undefined);
  assert.deepEqual(aborted.calls.errors, []);

  const emptyTitle = prGenerationScenario({ chat: () => '\n' });
  assert.equal(await emptyTitle.run(), undefined);
  assert.deepEqual(emptyTitle.calls.errors, ['Failed to generate pull request title and description: The model returned an empty title']);
});

test('PR generation assigns submodule pointer patches to the parent regardless of ordering', async () => {
  const parent = { rootUri: prVscode().Uri.parse('file:///repo') };
  const submodule = { rootUri: prVscode().Uri.parse('file:///repo/deps/sdk') };
  const pointer = { fileUri: 'file:///repo/deps/sdk', patch: '@@ -1 +1 @@\n-Subproject commit aaa\n+Subproject commit bbb' };
  const source = { fileUri: 'file:///repo/src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' };
  for (const repositories of [[parent, submodule], [submodule, parent]]) {
    for (const patches of [[pointer], [pointer, source], [source, pointer]]) {
      const { calls, run } = prGenerationScenario({ repositories, patches });
      assert.ok(await run());
      assert.equal(calls.repo, parent);
      assert.match(calls.prompt[1].content, /Subproject commit bbb/);
      assert.deepEqual(calls.errors, []);
    }
  }
});

test('PR generation still uses the deepest repository for changes inside a submodule', async () => {
  const parent = { rootUri: prVscode().Uri.parse('file:///repo') };
  const submodule = { rootUri: prVscode().Uri.parse('file:///repo/deps/sdk') };
  for (const repositories of [[parent, submodule], [submodule, parent]]) {
    const { calls, run } = prGenerationScenario({ repositories, patches: [
      { fileUri: 'file:///repo/deps/sdk/src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
    ] });
    assert.ok(await run());
    assert.equal(calls.repo, submodule);
    assert.match(calls.prompt[1].content, /@@ -1 \+1 @@\n-a\n\+b/);
  }
});

test('PR repository matching includes both paths of renamed files', async () => {
  const parent = { rootUri: prVscode().Uri.parse('file:///repo') };
  const nested = { rootUri: prVscode().Uri.parse('file:///repo/nested') };
  const { calls, run } = prGenerationScenario({ repositories: [nested, parent], patches: [
    { fileUri: 'file:///repo/nested/new.ts', previousFileUri: 'file:///repo/old.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
  ] });
  assert.ok(await run());
  assert.equal(calls.repo, parent);
});

const unmatchedPrRepositories = [
  { name: 'no local repositories', roots: [], files: ['vsls:/repo/src/a.ts'] },
  { name: 'Git extension unavailable', roots: undefined, files: ['vsls:/repo/src/a.ts'] },
  { name: 'unrelated local repository', roots: ['file:///other'], files: ['file:///repo/src/a.ts'] },
  { name: 'sibling path prefix', roots: ['file:///repo'], files: ['file:///repo-other/src/a.ts'] },
  { name: 'different URI scheme', roots: ['file:///repo'], files: ['vsls:/repo/src/a.ts'] },
  { name: 'different URI authority', roots: ['vsls://host-a/repo'], files: ['vsls://host-b/repo/src/a.ts'] },
  { name: 'different Windows drive', roots: ['file:///E:/Repo'], files: ['file:///f%3A/Repo/src/a.ts'] },
  { name: 'different directory casing on a drive path', roots: ['file:///E:/Repo'], files: ['file:///e%3A/repo/src/a.ts'] },
  { name: 'patches spanning separate repositories', roots: ['file:///repo', 'file:///other'], files: ['file:///repo/a.ts', 'file:///other/b.ts'] },
  { name: 'submodule root without its parent', roots: ['file:///repo/deps/sdk'], files: ['file:///repo/deps/sdk'] },
];

for (const scenario of unmatchedPrRepositories) {
  for (const config of [{ language: 'en', includeAgentsMd: false }, { language: 'auto', includeAgentsMd: true }]) {
    test(`PR generation without matching local context: ${scenario.name}, language=${config.language}`, async () => {
      const { context } = contextModules(() => assert.fail('must not read unrelated AGENTS.md'), 'zh-cn');
      const repositories = scenario.roots?.map(root => ({
        rootUri: prVscode().Uri.parse(root),
        state: { HEAD: { commit: 'abc' } },
        log: () => assert.fail('must not read unrelated history'),
      }));
      let prompt;
      const generator = prGenerator({
        config,
        vscode: { window: { showWarningMessage: () => assert.fail('must not warn'), showErrorMessage: message => assert.fail(message) } },
        git: { getGitExtension: async () => repositories ? { repositories } : undefined },
        projectContext: context,
        client: { AIClient: class { async chat(messages) { prompt = messages; return 'feat: supplied context\n\n- details'; } } },
      });
      const result = await generator.generatePullRequestTitleAndDescription({
        commitMessages: ['feat: supplied context'],
        patches: scenario.files.map(fileUri => ({ fileUri, patch: '@@ -1 +1 @@\n-a\n+b' })),
        issues: [{ reference: '#12', content: 'Related issue' }],
        template: '## Checklist',
      }, { isCancellationRequested: false });
      assert.equal(result.title, 'feat: supplied context');
      assert.doesNotMatch(prompt[0].content, /<agents_md>/);
      assert.match(prompt[0].content, config.language === 'auto' ? /Pull Request 标题与描述生成器/ : /Write the title description and the pull request description in English/);
      for (const content of ['feat: supplied context', '@@ -1 +1 @@', 'Related issue', '## Checklist']) {
        assert.ok(prompt[1].content.includes(content), content);
      }
    });
  }
}

test('PR generation reports Git API failures instead of treating them as a missing repository', async () => {
  const { calls, run } = prGenerationScenario({ git: {
    getGitExtension: async () => { throw new Error('Git activation failed'); },
  } });
  assert.equal(await run(), undefined);
  assert.equal(calls.contextReads, 0);
  assert.equal(calls.chats, 0);
  assert.deepEqual(calls.errors, ['Failed to generate pull request title and description: Git activation failed']);
});

// Mirrors GHPR's GitApiImpl provider registry (src/api/api1.ts).
class FakePullRequestApi {
  constructor() {
    this._titleAndDescriptionProviders = new Set();
  }
  registerTitleAndDescriptionProvider(title, provider) {
    const entry = { title, provider };
    this._titleAndDescriptionProviders.add(entry);
    return { dispose: () => this._titleAndDescriptionProviders.delete(entry) };
  }
  first() {
    return this._titleAndDescriptionProviders.values().next().value;
  }
}

function copilotProvider(log) {
  return { provideTitleAndDescription: async ctx => { log.push(['copilot', ctx]); return { title: 'copilot title' }; } };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
}

async function prProviderScenario({ mode = 'ask', api = new FakePullRequestApi(), installed = true, pick, log = [] } = {}) {
  const extensionListeners = [];
  let extension = installed ? { activate: async () => api } : undefined;
  const vscode = {
    extensions: {
      getExtension: id => {
        assert.equal(id, 'GitHub.vscode-pull-request-github');
        return extension;
      },
      onDidChange: listener => {
        extensionListeners.push(listener);
        return { dispose: () => extensionListeners.splice(extensionListeners.indexOf(listener), 1) };
      },
    },
    window: {
      showQuickPick: async (items, options, token) => {
        // Array.from: arrays created inside the module sandbox have a foreign prototype.
        log.push(['pick', Array.from(items, item => item.label), options.title, token]);
        return pick?.(items);
      },
      showWarningMessage: (...args) => { log.push(['warning', ...args]); return Promise.resolve(); },
    },
  };
  const module = loadModule('pullRequestProvider.js', {
    vscode,
    './config': { getConfig: () => ({ prTitleProvider: mode, model: 'test-model' }) },
    './pullRequestGenerator': {
      generatePullRequestTitleAndDescription: async ctx => { log.push(['commitGenerater', ctx]); return { title: 'our title', description: '' }; },
    },
  });
  const context = { subscriptions: [] };
  module.registerPullRequestProvider(context);
  await flush();
  return {
    api, log, context,
    install: async () => {
      extension = { activate: async () => api };
      for (const listener of [...extensionListeners]) {
        listener();
      }
      await flush();
    },
    // What GHPR does when the ✨ button is clicked: call the first registered provider.
    click: () => api.first().provider.provideTitleAndDescription({ commitMessages: [] }, { token: true }),
  };
}

test('PR provider moves itself before Copilot without breaking Copilot unregistration', async () => {
  const api = new FakePullRequestApi();
  const copilotDisposable = api.registerTitleAndDescriptionProvider('Generate with Copilot', copilotProvider([]));
  const { context } = await prProviderScenario({ api });
  assert.equal(api.first().title, 'Commit Generater');
  assert.ok(!api.first().title.toLowerCase().includes('copilot'), 'GHPR matches Copilot by title substring');
  assert.equal(api._titleAndDescriptionProviders.size, 2);

  copilotDisposable.dispose();
  assert.deepEqual([...api._titleAndDescriptionProviders].map(entry => entry.title), ['Commit Generater']);
  context.subscriptions.forEach(disposable => disposable.dispose());
  assert.equal(api._titleAndDescriptionProviders.size, 0);
});

test('PR provider uses the configured generator without a picker', async () => {
  for (const [mode, expected] of [['commitGenerater', 'our title'], ['copilot', 'copilot title']]) {
    const api = new FakePullRequestApi();
    const scenario = await prProviderScenario({ mode, api });
    // Copilot registers after us (GHPR activation order is not guaranteed).
    api.registerTitleAndDescriptionProvider('Generate with Copilot', copilotProvider(scenario.log));
    assert.equal((await scenario.click()).title, expected);
    assert.deepEqual(scenario.log.map(entry => entry[0]), [mode]);
  }
});

test('PR provider asks which generator to use and honours the choice', async () => {
  for (const [choice, expected] of [[0, 'commitGenerater'], [1, 'copilot'], [undefined, undefined]]) {
    const api = new FakePullRequestApi();
    const log = [];
    api.registerTitleAndDescriptionProvider('Generate with Copilot', copilotProvider(log));
    const scenario = await prProviderScenario({ api, log, pick: items => choice === undefined ? undefined : items[choice] });
    const result = await scenario.click();
    const [pickEntry, ...rest] = scenario.log;
    assert.deepEqual(pickEntry.slice(0, 3), ['pick', ['$(commit-generater-icon) Commit Generater', 'Generate with Copilot'], 'Generate Pull Request Title and Description']);
    assert.deepEqual(pickEntry[3], { token: true }, 'picker must close when GHPR cancels generation');
    assert.deepEqual(rest.map(entry => entry[0]), expected ? [expected] : []);
    assert.equal(result?.title, expected === 'commitGenerater' ? 'our title' : expected ? 'copilot title' : undefined);
  }
});

test('PR provider skips the picker when it is the only generator', async () => {
  const scenario = await prProviderScenario();
  assert.equal((await scenario.click()).title, 'our title');
  assert.deepEqual(scenario.log.map(entry => entry[0]), ['commitGenerater']);
});

test('PR provider warns when Copilot is configured but unavailable', async () => {
  const scenario = await prProviderScenario({ mode: 'copilot' });
  assert.equal(await scenario.click(), undefined);
  assert.equal(scenario.log.length, 1);
  assert.equal(scenario.log[0].length, 2, 'warning must be non-modal');
  assert.match(scenario.log[0][1], /GitHub Copilot is not available/);
});

test('PR provider keeps the plain registration when GHPR internals differ', async () => {
  const providers = [];
  const api = {
    registerTitleAndDescriptionProvider: (title, provider) => {
      providers.push({ title, provider });
      return { dispose: () => {} };
    },
  };
  const scenario = await prProviderScenario({ api });
  assert.deepEqual(providers.map(entry => entry.title), ['Commit Generater']);
  assert.equal((await providers[0].provider.provideTitleAndDescription({}, {})).title, 'our title');
  assert.deepEqual(scenario.log.map(entry => entry[0]), ['commitGenerater']);
});

test('PR provider registers once GitHub Pull Requests gets installed', async () => {
  const api = new FakePullRequestApi();
  const scenario = await prProviderScenario({ api, installed: false });
  assert.equal(api._titleAndDescriptionProviders.size, 0);
  await scenario.install();
  await scenario.install();
  assert.deepEqual([...api._titleAndDescriptionProviders].map(entry => entry.title), ['Commit Generater']);
});

test('PR generation only uses an unambiguous repository when patches carry no file URI', async () => {
  for (const [repositories, expectedRoot] of [[[{ rootUri: { path: '/only' } }], '/only'], [[{ rootUri: { path: '/a' } }, { rootUri: { path: '/b' } }], undefined]]) {
    let contextRepo = 'not called';
    const generator = prGenerator({
      vscode: { window: { showWarningMessage: () => assert.fail('must not warn'), showErrorMessage: message => assert.fail(message) } },
      git: { getGitExtension: async () => ({ repositories }) },
      projectContext: { loadPromptContext: async repo => { contextRepo = repo; return { language: 'en', warnings: [] }; } },
      client: { AIClient: class { async chat() { return 'feat: legacy'; } } },
    });
    const result = await generator.generatePullRequestTitleAndDescription(
      { commitMessages: ['feat: legacy'], patches: ['diff --git a/x b/x'] }, { isCancellationRequested: false });
    assert.equal(result.title, 'feat: legacy');
    assert.equal(contextRepo?.rootUri?.path, expectedRoot);
  }
});

test('prompt context without a repository skips AGENTS.md and Git history', async () => {
  const { context } = contextModules(async () => assert.fail('must not read AGENTS.md'), 'zh-cn');
  const auto = await context.loadPromptContext(undefined, { language: 'auto', includeAgentsMd: true });
  assert.equal(auto.language, 'zh');
  assert.equal(auto.agentsContent, undefined);
  assert.equal(auto.warnings.length, 0);
  assert.equal((await context.loadPromptContext(undefined, { language: 'en', includeAgentsMd: true })).language, 'en');
});

for (const failure of ['activation rejection', 'activation throw', 'registration throw']) {
  test(`PR integration failure notifies without disabling commit generation: ${failure}`, async () => {
    const error = Object.assign(new Error('GHPR initialization unavailable'), { code: 'TEST_GHPR_FAILURE' });
    const notifications = [];
    const diagnostics = [];
    const commands = new Map();
    const scmProviders = [];
    const repo = { rootUri, inputBox: { value: '' } };
    let statusBarRegistered = false;
    let chatCalls = 0;
    const api = {
      registerTitleAndDescriptionProvider: () => { throw error; },
    };
    const vscode = {
      ThemeIcon: class { constructor(id) { this.id = id; } },
      ProgressLocation: { SourceControl: 1 },
      extensions: {
        getExtension: id => {
          if (id === 'vscode.git') {
            return { isActive: true };
          }
          assert.equal(id, 'GitHub.vscode-pull-request-github');
          return { activate: () => {
            if (failure === 'activation throw') {
              throw error;
            }
            return failure === 'activation rejection' ? Promise.reject(error) : Promise.resolve(api);
          } };
        },
        onDidChange: () => assert.fail('GHPR is already installed'),
      },
      commands: { registerCommand: (id, callback) => {
        assert.equal(typeof callback, 'function');
        commands.set(id, callback);
        return { dispose: () => commands.delete(id) };
      } },
      scm: { registerSourceControlInputBoxValueProvider: (id, provider) => {
        assert.equal(id, 'git');
        scmProviders.push(provider);
        return { dispose: () => {} };
      } },
      window: {
        showWarningMessage: (...args) => {
          notifications.push(args);
          // Leave the notification open; activation and commit generation must still finish.
          return new Promise(() => {});
        },
        showErrorMessage: message => assert.fail(message),
        withProgress: async (_options, task) => task({}, { isCancellationRequested: false }),
      },
    };
    const setup = { needsSetup: () => false, runSetupWizard: async () => true };
    const commits = loadModule('commitMessageProvider.js', {
      vscode,
      './git': {
        getGitExtension: async () => ({ repositories: [repo] }),
        resolveRepository: async () => repo,
        getDiff: async () => 'diff',
      },
      './config': { getConfig: () => ({ language: 'en', includeAgentsMd: false }) },
      './projectContext': { loadPromptContext: async () => ({ language: 'en', warnings: [] }) },
      './ai/client': { AIClient: class { async chat() { chatCalls++; return 'fix: commit still works'; } } },
      './ai/prompt': { buildPrompt: () => [] },
      './setup': setup,
    });
    const pr = loadModule('pullRequestProvider.js', {
      vscode,
      './config': {},
      './pullRequestGenerator': {},
    }, { console: { warn: (...args) => diagnostics.push(args) } });
    const extension = loadModule('extension.js', {
      vscode,
      './commitMessageProvider': commits,
      './pullRequestProvider': pr,
      './commands/selectModel': { selectModelCommand: async () => {} },
      './commands/settings': { openSettingsMenuCommand: async () => {}, selectReasoningEffortCommand: async () => {} },
      './setup': setup,
      './statusBar': { registerStatusBarItem: () => { statusBarRegistered = true; } },
    });

    await extension.activate({ subscriptions: [] });
    await flush();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].length, 1, 'integration failure notification must be non-modal');
    assert.equal(notifications[0][0], `Commit Generater: GitHub Pull Requests integration failed: ${error.message}. Commit message generation is still available.`);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][1], error, 'retain the original error and stack in the diagnostic log');
    assert.equal(statusBarRegistered, true);
    assert.equal(scmProviders.length, 1);
    assert.equal(commands.size, 5);
    await commands.get('commitGenerater.generate')();
    assert.equal(chatCalls, 1);
    assert.equal(repo.inputBox.value, 'fix: commit still works');
  });
}

test('PR integration failure after disposal retains diagnostics without notifying', async () => {
  const error = new Error('GHPR activation failed after disposal');
  const diagnostics = [];
  let rejectActivation;
  const module = loadModule('pullRequestProvider.js', {
    vscode: {
      extensions: {
        getExtension: () => ({ activate: () => new Promise((_resolve, reject) => { rejectActivation = reject; }) }),
        onDidChange: () => assert.fail('extension is installed'),
      },
      window: { showWarningMessage: () => assert.fail('must not notify after disposal') },
    },
    './config': {},
    './pullRequestGenerator': {},
  }, { console: { warn: (...args) => diagnostics.push(args) } });
  const context = { subscriptions: [] };
  module.registerPullRequestProvider(context);
  await flush();
  context.subscriptions.forEach(disposable => disposable.dispose());
  rejectActivation(error);
  await flush();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][1], error);
});

test('PR provider does not register when disposed before GHPR finishes activating', async () => {
  const api = new FakePullRequestApi();
  let finishActivation;
  const module = loadModule('pullRequestProvider.js', {
    vscode: { extensions: {
      getExtension: () => ({ activate: () => new Promise(resolve => { finishActivation = resolve; }) }),
      onDidChange: () => assert.fail('extension is installed'),
    } },
    './config': {},
    './pullRequestGenerator': {},
  });
  const context = { subscriptions: [] };
  module.registerPullRequestProvider(context);
  await flush();
  context.subscriptions.forEach(disposable => disposable.dispose());
  finishActivation(api);
  await flush();
  assert.equal(api._titleAndDescriptionProviders.size, 0);
});
