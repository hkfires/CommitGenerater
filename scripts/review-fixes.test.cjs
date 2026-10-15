// Run after compilation: node --test scripts/review-fixes.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Load compiled extension modules with controlled VS Code dependencies, without an extension host.
function loadModule(relativePath, mocks) {
  const filename = path.resolve(__dirname, '..', 'out', relativePath);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
    Buffer,
    Error,
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
      './projectContext': { resolveCommitLanguage: async () => 'en' },
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
      resolveCommitLanguage: async () => { throw new Error('Git unavailable'); },
      readAgentsFile: async () => { throw new FileSystemError('NoPermissions'); },
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
