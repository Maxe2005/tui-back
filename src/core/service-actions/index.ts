// core/service-actions: the shared per-service action registry — open in IDE, simple/clean
// restart and the service/container terminals, with availability computed once from the
// manifest, lock state and container health. It is the one registry: every consumer (Logs,
// Dashboard, Update) renders whatever it lists, so a new entry needs no consumer change.
// Ports are injected.
import { withActionLock } from '../locking.js';
import type { ContainerPort } from '../ports/container.js';
import type { DockerPort } from '../ports/docker.js';
import type { EditorPort } from '../ports/editor.js';
import type { HealthProbePort } from '../ports/health-probe.js';
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

// Verification polls the container every second and gives up after 30 s (FR-37).
export const VERIFY_POLL_INTERVAL_MS = 1000;
export const VERIFY_TIMEOUT_MS = 30_000;
// One health GET never waits longer than this, whatever time the overall budget has left.
export const HEALTH_PROBE_TIMEOUT_MS = 5000;

// The closed set of per-service states a post-restart run ends on. `failed` is assigned by the
// caller when the restart itself errored — verifyService never returns it.
export type ServiceFinalState = 'functional' | 'up-unverified' | 'unhealthy' | 'restarting' | 'down' | 'failed';

export interface VerifyOutcome {
  state: Exclude<ServiceFinalState, 'failed'>;
  // Why the state is not green (last probe reason, `still restarting`, ...).
  detail?: string;
}

export interface ServiceActionsDeps {
  manifest: ManifestPort;
  container: ContainerPort;
  restart: RestartPort;
  editor: EditorPort;
  lock: LockPort;
  // `verifyService` needs these two, and `list` reads container health through `docker` for the
  // container terminal's availability; without it that entry reads `container state unknown`.
  docker?: DockerPort;
  healthProbe?: HealthProbePort;
  // Test seams for the verification poll: defaults are the wall clock and a real timer.
  clock?: { now(): number; sleep(ms: number): Promise<void> };
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
  // Settles on the first definitive state of the service's container (and `healthUrl`, when
  // declared) after a restart. Never rejects.
  verifyService(repoPath: string): Promise<Result<VerifyOutcome>>;
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

// Blank recipe entries are not a recipe: only runnable commands count.
function recipeCommands(manifest: Manifest): string[] {
  return (manifest.restartCommands ?? []).filter((command) => command.trim() !== '');
}

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
  const clock = deps.clock ?? { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) };

  // `loaded` is the manifest read once per `list()` call, shared by every availability rule.
  async function restartAvailability(
    repoPath: string,
    loaded: Result<Manifest>,
    mode: RestartMode,
    blockingLocks: readonly NamedLock[],
  ): Promise<ServiceActionAvailability> {
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
    if (mode === 'clean' && recipeCommands(loaded.data).length === 0) {
      return { available: false, reason: 'no clean recipe' };
    }
    return AVAILABLE;
  }

  // The container terminal needs a running container. Never fails: a Docker probe error (or no
  // Docker port wired) reads `container state unknown` rather than claiming the container is down.
  async function containerTerminalAvailability(loaded: Result<Manifest>): Promise<ServiceActionAvailability> {
    if (!loaded.ok) {
      return { available: false, reason: 'manifest unreadable' };
    }
    const containerName = loaded.data.container;
    if (!hasContainer(loaded.data) || containerName === undefined) {
      return { available: false, reason: 'no container' };
    }
    if (deps.docker === undefined) {
      return { available: false, reason: 'container state unknown' };
    }
    const health = await deps.docker.getContainerHealth(containerName).catch(() => null);
    if (health === null || !health.ok) {
      return { available: false, reason: 'container state unknown' };
    }
    return health.data === 'up' ? AVAILABLE : { available: false, reason: 'container not running' };
  }

  return {
    async list(repoPath, options) {
      const invalid = rejectBlankRepoPath(repoPath);
      if (invalid !== null) {
        return invalid;
      }
      const blockingLocks = options?.blockingLocks ?? [];
      const loaded = await manifest.load(repoPath);
      const simpleState = await restartAvailability(repoPath, loaded, 'simple', blockingLocks);
      const cleanState = await restartAvailability(repoPath, loaded, 'clean', blockingLocks);
      const containerTerminalState = await containerTerminalAvailability(loaded);
      return ok([
        { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: AVAILABLE },
        { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: simpleState },
        { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: cleanState },
        // The service terminal only needs the repo directory, which `list` already requires.
        { id: 'terminal-service', label: 'Terminal', key: 'Ctrl+T', availability: AVAILABLE },
        { id: 'terminal-container', label: 'Container terminal', key: 'Ctrl+X', availability: containerTerminalState },
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
          restartCommands: recipeCommands(loaded.data),
          repoPath,
          cleanRestart: true,
          service,
          onStep: (step, total) => onProgress?.({ step, total }),
        });
        if (!restarted.ok) {
          return restarted;
        }
        return ok(recipeCommands(loaded.data).length > 0 ? {} : { notice: NO_CLEAN_RECIPE_NOTICE });
      });
      if (!run.ok && run.error.code === 'action-in-progress') {
        return err(
          'update-already-running',
          `A restart for ${repoPath} is already in progress — wait for it to finish before starting another.`,
        );
      }
      return run;
    },

    async verifyService(repoPath) {
      const invalid = rejectBlankRepoPath(repoPath);
      if (invalid !== null) {
        return invalid;
      }
      const { docker, healthProbe } = deps;
      if (docker === undefined) {
        return err('verification-unavailable', 'No Docker port is wired — cannot verify the service');
      }
      const loaded = await manifest.load(repoPath);
      if (!loaded.ok) {
        return loaded;
      }
      const { container: containerName, healthUrl } = loaded.data;
      if (!hasContainer(loaded.data) || containerName === undefined) {
        return err('no-container', `Repo ${repoPath} declares no container — nothing to verify`);
      }
      if (healthUrl !== undefined && healthProbe === undefined) {
        return err('verification-unavailable', 'No health probe is wired — cannot verify the declared healthUrl');
      }
      const deadline = clock.now() + VERIFY_TIMEOUT_MS;
      let lastDockerError: Result<never> | null = null;
      let lastProbeReason: string | undefined;
      let sawRestarting = false;
      for (;;) {
        const health = await docker.getContainerHealth(containerName);
        if (!health.ok) {
          lastDockerError = health;
        } else if (health.data === 'down') {
          return ok({ state: 'down', detail: 'container is not running' });
        } else if (health.data === 'restarting') {
          sawRestarting = true;
          lastProbeReason = undefined;
        } else {
          sawRestarting = false;
          if (healthUrl === undefined || healthProbe === undefined) {
            return ok({ state: 'up-unverified' });
          }
          const remaining = Math.max(1, deadline - clock.now());
          const probed = await healthProbe.probe(healthUrl, Math.min(HEALTH_PROBE_TIMEOUT_MS, remaining));
          if (probed.ok && probed.data.healthy) {
            return ok({ state: 'functional' });
          }
          lastProbeReason = probed.ok ? probed.data.reason : probed.error.message;
        }
        if (clock.now() + VERIFY_POLL_INTERVAL_MS > deadline) {
          break;
        }
        await clock.sleep(VERIFY_POLL_INTERVAL_MS);
      }
      if (sawRestarting) {
        return ok({ state: 'restarting', detail: 'still restarting after the verification timeout' });
      }
      if (lastProbeReason !== undefined) {
        return ok({ state: 'unhealthy', detail: lastProbeReason });
      }
      return lastDockerError ?? err('verification-timeout', `Could not verify ${repoPath} within the verification timeout`);
    },
  };
}
