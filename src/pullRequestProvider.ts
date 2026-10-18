import * as vscode from 'vscode';
import { types } from 'util';
import { getConfig } from './config';
import { generatePullRequestTitleAndDescription, TitleAndDescriptionContext } from './pullRequestGenerator';

const GHPR_EXTENSION_ID = 'GitHub.vscode-pull-request-github';
// Must not contain "Copilot": GHPR looks up the Copilot provider by a substring match on titles.
const PROVIDER_TITLE = 'Commit Generater';

interface TitleAndDescriptionProvider {
  provideTitleAndDescription(
    context: TitleAndDescriptionContext,
    token: vscode.CancellationToken
  ): Promise<{ title: string; description?: string } | undefined>;
}

interface ProviderEntry {
  title: string;
  provider: TitleAndDescriptionProvider;
}

interface PullRequestApi {
  registerTitleAndDescriptionProvider(title: string, provider: TitleAndDescriptionProvider): vscode.Disposable;
}

interface FolderManager {
  getTitleAndDescriptionProvider(title?: string): ProviderEntry | undefined;
}

/**
 * GHPR gates all providers behind chat.disableAIFeatures in its folder managers,
 * before consulting the public provider API. Keep only our standalone provider
 * available there; do not enable Copilot, reviewers, or change the user's setting.
 * This compatibility shim is scoped to manager instances and restored on disposal.
 */
function allowStandaloneProvider(
  context: vscode.ExtensionContext,
  api: PullRequestApi,
  entry: ProviderEntry
): void {
  const repositories = (api as PullRequestApi & {
    repositoriesManager?: {
      folderManagers: FolderManager[];
      onDidChangeFolderRepositories: vscode.Event<unknown>;
    };
  }).repositoriesManager;
  if (!Array.isArray(repositories?.folderManagers) || typeof repositories.onDidChangeFolderRepositories !== 'function') {
    console.warn('Commit Generater: Unsupported GitHub Pull Requests internals; chat.disableAIFeatures may hide PR generation.');
    return;
  }

  const restorers = new Map<FolderManager, () => void>();
  const patchManagers = () => {
    for (const [manager, restore] of restorers) {
      if (!repositories.folderManagers.includes(manager)) {
        restore();
        restorers.delete(manager);
      }
    }
    for (const manager of repositories.folderManagers) {
      if (restorers.has(manager) || typeof manager?.getTitleAndDescriptionProvider !== 'function') {
        continue;
      }
      const original = manager.getTitleAndDescriptionProvider;
      const descriptor = Object.getOwnPropertyDescriptor(manager, 'getTitleAndDescriptionProvider');
      const lookup: FolderManager['getTitleAndDescriptionProvider'] = function (this: FolderManager, title) {
        if (!vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false)) {
          return original.call(this, title);
        }
        return !title || entry.title.toLowerCase().includes(title.toLowerCase()) ? entry : undefined;
      };
      try {
        Object.defineProperty(manager, 'getTitleAndDescriptionProvider', { configurable: true, writable: true, value: lookup });
        restorers.set(manager, () => {
          // Do not overwrite a hook installed by another extension after ours.
          if (manager.getTitleAndDescriptionProvider === lookup) {
            if (descriptor) {
              Object.defineProperty(manager, 'getTitleAndDescriptionProvider', descriptor);
            } else {
              Reflect.deleteProperty(manager, 'getTitleAndDescriptionProvider');
            }
          }
        });
      } catch (error) {
        console.warn('Commit Generater: Could not keep standalone PR generation available:', error);
      }
    }
  };
  context.subscriptions.push(repositories.onDidChangeFolderRepositories(patchManagers));
  context.subscriptions.push({ dispose: () => {
    for (const restore of restorers.values()) {
      restore();
    }
    restorers.clear();
  } });
  patchManagers();
}

function isProviderEntry(value: unknown): value is ProviderEntry {
  const entry = value as Partial<ProviderEntry> | undefined;
  return typeof entry?.title === 'string' && typeof entry.provider?.provideTitleAndDescription === 'function';
}

/**
 * GHPR's ✨ button always calls the first registered provider and offers no
 * choice, so the dispatcher is moved to the front of GHPR's private provider
 * Set (insertion ordered). Entries are re-added as the same objects, so other
 * providers can still unregister themselves. Returns undefined, leaving the
 * plain registration untouched, when GHPR's internals do not match.
 */
function moveToFront(api: PullRequestApi, provider: TitleAndDescriptionProvider): Set<unknown> | undefined {
  const providers = (api as unknown as { _titleAndDescriptionProviders?: unknown })._titleAndDescriptionProviders;
  if (!types.isSet(providers)) {
    return undefined;
  }
  const set = providers as Set<unknown>;
  const entries = Array.from(set);
  const own = entries.find(entry => isProviderEntry(entry) && entry.provider === provider);
  if (!own) {
    return undefined;
  }
  set.clear();
  set.add(own);
  for (const entry of entries) {
    if (entry !== own) {
      set.add(entry);
    }
  }
  return set;
}

async function dispatch(
  context: TitleAndDescriptionContext,
  token: vscode.CancellationToken,
  others: ProviderEntry[]
): Promise<{ title: string; description?: string } | undefined> {
  const config = getConfig();
  if (config.prTitleProvider === 'commitGenerater' || (config.prTitleProvider === 'ask' && others.length === 0)) {
    return generatePullRequestTitleAndDescription(context, token);
  }

  if (config.prTitleProvider === 'copilot') {
    const copilot = others.find(entry => entry.title.toLowerCase().includes('copilot'));
    if (!copilot) {
      void vscode.window.showWarningMessage(
        'Commit Generater: GitHub Copilot is not available as a pull request title and description generator. ' +
        'Set commitGenerater.prTitleProvider to "ask" or "commitGenerater" to use another generator.'
      );
      return undefined;
    }
    return copilot.provider.provideTitleAndDescription(context, token);
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(commit-generater-icon) Commit Generater', description: config.model, entry: undefined },
      ...others.map(entry => ({ label: entry.title, description: undefined, entry })),
    ],
    {
      title: 'Generate Pull Request Title and Description',
      placeHolder: 'Select a generator (set commitGenerater.prTitleProvider to skip this step)',
    },
    token
  );
  if (!picked) {
    return undefined;
  }
  return picked.entry
    ? picked.entry.provider.provideTitleAndDescription(context, token)
    : generatePullRequestTitleAndDescription(context, token);
}

function register(context: vscode.ExtensionContext, api: PullRequestApi | undefined): void {
  if (typeof api?.registerTitleAndDescriptionProvider !== 'function') {
    console.warn('Commit Generater: GitHub Pull Requests API does not support title and description providers.');
    return;
  }

  let providers: Set<unknown> | undefined;
  const dispatcher: TitleAndDescriptionProvider = {
    provideTitleAndDescription: (ctx, token) => {
      // Read GHPR's providers on every call: others (e.g. Copilot) may register after us.
      const aiDisabled = vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false);
      const others = providers && !aiDisabled
        ? Array.from(providers).filter((entry): entry is ProviderEntry => isProviderEntry(entry) && entry.provider !== dispatcher)
        : [];
      return dispatch(ctx, token, others);
    },
  };
  context.subscriptions.push(api.registerTitleAndDescriptionProvider(PROVIDER_TITLE, dispatcher));
  providers = moveToFront(api, dispatcher);
  try {
    allowStandaloneProvider(context, api, { title: PROVIDER_TITLE, provider: dispatcher });
  } catch (error) {
    // The optional compatibility shim must not invalidate public registration.
    console.warn('Commit Generater: Could not initialize standalone PR compatibility:', error);
  }
  if (!providers) {
    console.warn('Commit Generater: Unsupported GitHub Pull Requests internals; the ✨ button may use another generator.');
  }
}

/**
 * Register the pull request title and description dispatcher with the GitHub
 * Pull Requests extension, now or once it gets installed.
 */
export function registerPullRequestProvider(context: vscode.ExtensionContext): void {
  let started = false;
  // GHPR activation may finish after this extension is disposed; do not register then.
  let disposed = false;
  context.subscriptions.push({ dispose: () => { disposed = true; } });
  const tryRegister = (): boolean => {
    const extension = vscode.extensions.getExtension<PullRequestApi>(GHPR_EXTENSION_ID);
    if (!extension || started) {
      return started;
    }
    started = true;
    // Isolate optional GHPR activation/registration failures, including synchronous
    // throws, so main extension activation and commit generation remain available.
    Promise.resolve()
      .then(() => extension.activate())
      .then(api => {
        if (!disposed) {
          register(context, api);
        }
      })
      .catch(error => {
        console.warn('Commit Generater: Failed to register with GitHub Pull Requests extension:', error);
        if (!disposed) {
          const detail = error instanceof Error ? error.message : String(error);
          // Do not wait for the user to dismiss the notification.
          void vscode.window.showWarningMessage(
            `Commit Generater: GitHub Pull Requests integration failed: ${detail}. Commit message generation is still available.`
          );
        }
      });
    return true;
  };

  if (!tryRegister()) {
    const listener = vscode.extensions.onDidChange(() => {
      if (tryRegister()) {
        listener.dispose();
      }
    });
    context.subscriptions.push(listener);
  }
}
