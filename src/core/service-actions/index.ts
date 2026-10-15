// core/service-actions: the shared per-service action registry — open in IDE and simple/clean
// restart, with availability computed once from the manifest and lock state so every consumer
// (Logs, Dashboard, Update) lists and runs the same actions. Ports are injected.
import { withActionLock } from '../locking.js';
import type { ContainerPort } from '../ports/container.js';
import type { EditorPort } from '../ports/editor.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import { err, ok, type Result } from '../result.js';
import { GROUP_UPDATE_LOCK_KEY, edtUpdateLockKey, runRestartStep } from '../scripts/group-update.js';
import { serviceRestartLockKey } from '../scripts/service-restart.js';

export type RestartMode = 'simple' | 'clean';

export type ServiceActionAvailability = { available: true } | { available: false; reason: string };

export interface ServiceAction {
  id: string;
  label: string;
  // Default key, displayed as-is (`Ctrl+O`); consumers may remap per zone.
  key: string;
  availability: ServiceActionAvailability;
}

export interface ServiceActionContext {
  // The `general.editorCommand` setting ('' = fall back to $EDITOR, then `vi`).
  editorCommand: string;
}

export interface ServiceActionsDeps {
  manifest: ManifestPort;
  container: ContainerPort;
  restart: RestartPort;
  editor: EditorPort;
  lock: LockPort;
}

export interface RestartOutcome {
  notice?: string;
}

// A restart step the run is on: 1-based `step` out of `total` (a simple restart is 1 of 1).
export interface RestartProgress {
  step: number;
  total: number;
}

// A lock a consumer knows can block a restart, with the name shown when it is held.
export interface NamedLock {
  key: string;
  name: string;
}

export interface ServiceActionsListOptions {
  // Extra locks (group update, EDT switch...) checked after the service's own restart lock.
  blockingLocks?: readonly NamedLock[];
}

export interface ServiceActions {
  list(repoPath: string, options?: ServiceActionsListOptions): Promise<Result<ServiceAction[]>>;
  openInIde(repoPath: string, ctx: ServiceActionContext): Result<void>;
  restart(repoPath: string, mode: RestartMode, onProgress?: (progress: RestartProgress) => void): Promise<Result<RestartOutcome>>;
}

// The locks that can block a restart besides its own: the global group update and, when an EDT
// is active, that EDT's update/switch lock.
export function restartBlockingLocks(activeEdtUlid: string | null): NamedLock[] {
  return [
    { key: GROUP_UPDATE_LOCK_KEY, name: 'group update' },
    ...(activeEdtUlid === null ? [] : [{ key: edtUpdateLockKey(activeEdtUlid), name: 'EDT update/switch' }]),
  ];
}

// The name of the first held lock, or null when none is held (a failed peek reads as free).
export async function heldLockName(lock: LockPort, locks: readonly NamedLock[]): Promise<string | null> {
  for (const candidate of locks) {
    const held = await lock.peek(candidate.key);
    if (held.ok && held.data.locked) {
      return candidate.name;
    }
  }
  return null;
}

export const NO_CLEAN_RECIPE_NOTICE = 'no clean-restart recipe — simple restart';

// A blank repoPath would resolve to the process cwd and target the wrong directory.
function rejectBlankRepoPath(repoPath: string): Result<never> | null {
  return repoPath.trim() === '' ? err('invalid-argument', 'repoPath must not be empty — pass the service repo directory') : null;
}

const AVAILABLE: ServiceActionAvailability = { available: true };

function hasContainer(manifest: Manifest): boolean {
  return manifest.container !== undefined && manifest.container.trim() !== '';
}

// The editor needs nothing else from the registry, so a consumer that only opens the IDE
// (the Update zone's blocker menu) can call it without wiring restart ports.
export function openInIde(editor: EditorPort, repoPath: string, ctx: ServiceActionContext): Result<void> {
  const invalid = rejectBlankRepoPath(repoPath);
  if (invalid !== null) {
    return invalid;
  }
  return editor.launch(repoPath, ctx.editorCommand);
}

export function createServiceActions(deps: ServiceActionsDeps): ServiceActions {
  const { manifest, container, restart, editor, lock } = deps;

  async function restartAvailability(
    repoPath: string,
    mode: RestartMode,
    blockingLocks: readonly NamedLock[],
  ): Promise<ServiceActionAvailability> {
    const loaded = await manifest.load(repoPath);
    if (!loaded.ok) {
      return { available: false, reason: 'manifest unreadable' };
    }
    if (!hasContainer(loaded.data)) {
      return { available: false, reason: 'no container' };
    }
    const held = await lock.peek(serviceRestartLockKey(repoPath));
    if (held.ok && held.data.locked) {
      return { available: false, reason: 'restart in progress' };
    }
    const blocking = await heldLockName(lock, blockingLocks);
    if (blocking !== null) {
      return { available: false, reason: blocking };
    }
    if (mode === 'clean' && (loaded.data.restartCommands?.length ?? 0) === 0) {
      return { available: false, reason: 'no clean recipe' };
    }
    return AVAILABLE;
  }

  return {
    async list(repoPath, options) {
      const invalid = rejectBlankRepoPath(repoPath);
      if (invalid !== null) {
        return invalid;
      }
      const blockingLocks = options?.blockingLocks ?? [];
      const simpleState = await restartAvailability(repoPath, 'simple', blockingLocks);
      const cleanState = await restartAvailability(repoPath, 'clean', blockingLocks);
      return ok([
        { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: AVAILABLE },
        { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: simpleState },
        { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: cleanState },
      ]);
    },

    openInIde(repoPath, ctx) {
      return openInIde(editor, repoPath, ctx);
    },

    async restart(repoPath, mode, onProgress) {
      const invalid = rejectBlankRepoPath(repoPath);
      if (invalid !== null) {
        return invalid;
      }
      if (mode !== 'simple' && mode !== 'clean') {
        return err('invalid-argument', `Unknown restart mode "${String(mode)}" — expected simple or clean`);
      }
      const run = await withActionLock(lock, serviceRestartLockKey(repoPath), async (): Promise<Result<RestartOutcome>> => {
        const loaded = await manifest.load(repoPath);
        if (!loaded.ok) {
          return loaded;
        }
        const { service, container: containerName, restartCommands } = loaded.data;
        if (!hasContainer(loaded.data) || containerName === undefined) {
          return err('no-container', `Repo ${repoPath} declares no container — nothing to restart`);
        }
        if (mode === 'simple') {
          onProgress?.({ step: 1, total: 1 });
          const restarted = await container.restart(containerName);
          return restarted.ok ? ok({}) : restarted;
        }
        const restarted = await runRestartStep({
          container,
          restart,
          containerName,
          restartCommands,
          repoPath,
          cleanRestart: true,
          service,
          onStep: (step, total) => onProgress?.({ step, total }),
        });
        if (!restarted.ok) {
          return restarted;
        }
        return ok((restartCommands?.length ?? 0) > 0 ? {} : { notice: NO_CLEAN_RECIPE_NOTICE });
      });
      if (!run.ok && run.error.code === 'action-in-progress') {
        return err(
          'update-already-running',
          `A restart for ${repoPath} is already in progress — wait for it to finish before starting another.`,
        );
      }
      return run;
    },
  };
}
