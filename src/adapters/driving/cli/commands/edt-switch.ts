// cli/commands/edt-switch: `edt switch` usage, flag parsing and runner.
import { err, ok, type Result } from '../../../../core/result.js';
import { type DirtyPolicy, switchActiveEdt } from '../../../../core/edt/switch.js';
import { listSwitchRestartRepos, restartAfterSwitch, restartNeedsAttention } from '../../../../core/edt/switch-restart.js';
import { createServiceActions } from '../../../../core/service-actions/index.js';
import { ContainerPort } from '../../../../core/ports/container.js';
import { DockerPort } from '../../../../core/ports/docker.js';
import { EditorPort } from '../../../../core/ports/editor.js';
import { HealthProbePort } from '../../../../core/ports/health-probe.js';
import { GitPort } from '../../../../core/ports/git.js';
import { ManifestPort } from '../../../../core/ports/manifest.js';
import { ManifestCarryPort } from '../../../../core/ports/manifest-carry.js';
import { RestartPort } from '../../../../core/ports/restart.js';
import { RegistryPort } from '../../../../core/ports/registry.js';
import { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import { LockPort } from '../../../../core/ports/lock.js';
import { SWITCH_RESTART_MODES, healthCheckEnabledFrom, type Settings, type SettingsPort, type SwitchRestartMode } from '../../../../core/ports/settings.js';
import { StatePort } from '../../../../core/ports/state.js';
import { loadSettingsOrDefaults } from './shared.js';

export const EDT_SWITCH_USAGE =
  'tui-back edt switch --to <topic> [--force] [--discard-dirty | --adopt-dirty [--adopt-branch <name>]] [--restart none|simple|clean]' +
  ' (--restart defaults to settings.yaml switch.restartMode; exit 1 when a restarted service ends failed, down or unhealthy)';

// Hand-rolled flag parsing for `edt switch` (same style as runEdtCreate): the wrapper owns
// flag syntax (unknown options, missing value, --to given at most once); the use-case owns
// the semantic validations (topic resolution, no-op idempotency, the lock-peek gate).
export async function runEdtSwitch(
  deps: {
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    registry: RegistryPort;
    manifest: ManifestPort;
    manifestCarry: ManifestCarryPort;
    git: GitPort;
    lock: LockPort;
    state: StatePort;
    settings: SettingsPort;
    container: ContainerPort;
    restart: RestartPort;
    editor?: EditorPort;
    docker?: DockerPort;
    healthProbe?: HealthProbePort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  let restartFlag: string | undefined;
  let force = false;
  let discardDirty = false;
  let adoptDirty = false;
  let adoptBranch: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    switch (flag) {
      case '--discard-dirty':
        discardDirty = true;
        break;
      case '--adopt-dirty':
        adoptDirty = true;
        break;
      case '--adopt-branch': {
        const value = args[i + 1]?.trim();
        if (value === undefined || value.startsWith('--')) {
          return err('invalid-argument', `Missing value for --adopt-branch. Usage: ${EDT_SWITCH_USAGE}`);
        }
        if (adoptBranch !== undefined) {
          return err('invalid-argument', `--adopt-branch may only be given once. Usage: ${EDT_SWITCH_USAGE}`);
        }
        adoptBranch = value;
        i += 1;
        break;
      }
      case '--restart': {
        const value = args[i + 1]?.trim();
        if (value === undefined || value.startsWith('--')) {
          return err('invalid-argument', `Missing value for --restart. Usage: ${EDT_SWITCH_USAGE}`);
        }
        if (restartFlag !== undefined) {
          return err('invalid-argument', `--restart may only be given once. Usage: ${EDT_SWITCH_USAGE}`);
        }
        restartFlag = value;
        i += 1;
        break;
      }
      case '--to': {
        const value = args[i + 1];
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --to. Usage: ${EDT_SWITCH_USAGE}`);
        }
        if (topic !== undefined) {
          return err('invalid-argument', `--to may only be given once. Usage: ${EDT_SWITCH_USAGE}`);
        }
        topic = value;
        i += 1;
        break;
      }
      case '--force':
        force = true;
        break;
      default:
        return err('invalid-argument', `Unknown edt switch option: "${flag}". Usage: ${EDT_SWITCH_USAGE}`);
    }
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing --to. Usage: ${EDT_SWITCH_USAGE}`);
  }
  if (adoptDirty && discardDirty) {
    return err('invalid-argument', `--adopt-dirty and --discard-dirty are mutually exclusive. Usage: ${EDT_SWITCH_USAGE}`);
  }
  if (adoptBranch !== undefined && discardDirty) {
    return err('invalid-argument', `--adopt-branch cannot be combined with --discard-dirty. Usage: ${EDT_SWITCH_USAGE}`);
  }
  if (adoptBranch !== undefined && !adoptDirty) {
    return err('invalid-argument', `--adopt-branch requires --adopt-dirty. Usage: ${EDT_SWITCH_USAGE}`);
  }
  if (adoptBranch !== undefined && adoptBranch.trim() === '') {
    return err('invalid-argument', '--adopt-branch must not be empty');
  }
  // An unknown value is rejected before anything is touched; an absent flag falls back to the
  // setting (a load failure or warning goes to stderr and the built-in default applies).
  if (restartFlag !== undefined && !(SWITCH_RESTART_MODES as readonly string[]).includes(restartFlag)) {
    return err('invalid-argument', `Unknown --restart value "${restartFlag}" — expected none, simple or clean. Usage: ${EDT_SWITCH_USAGE}`);
  }
  let restartMode = restartFlag as SwitchRestartMode | undefined;
  // Loaded at most once: for the absent flag here, then for the restart phase below.
  let loadedSettings: Settings | undefined;
  if (restartMode === undefined) {
    loadedSettings = await loadSettingsOrDefaults(deps.settings);
    restartMode = loadedSettings.switch.restartMode;
  }
  if (restartMode !== 'none' && (deps.docker === undefined || deps.healthProbe === undefined)) {
    return err('restart-unavailable', 'Post-switch restart needs the Docker and health-probe ports, which are not wired — nothing was switched');
  }
  const dirtyPolicy: DirtyPolicy | undefined = discardDirty
    ? { kind: 'discard' }
    : adoptDirty
      ? { kind: 'adopt', branch: adoptBranch }
      : undefined;

  const switched = await switchActiveEdt({
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    registry: deps.registry,
    manifest: deps.manifest,
    manifestCarry: deps.manifestCarry,
    git: deps.git,
    lock: deps.lock,
    state: deps.state,
    topic,
    force,
    // no dialog on this path. The flags build a policy the core expands per dirty
    // state-2/3 repo after its own classification; with no flag, a dirty state-2/3 repo fails
    // safe (switch-dirty-services-unresolved). A dirty outgoing-EDT member is auto-stashed.
    dirtyPolicy,
    onDirtyReposBeforeSwitch: undefined,
  });
  // Mode none (the default): exactly the switch's own output, no restart phase, no new key.
  if (restartMode === 'none' || !switched.ok) {
    return switched;
  }

  // The same core orchestration the TUI runs — a second call after the successful switch.
  const repos = await listSwitchRestartRepos({ registry: deps.registry, manifest: deps.manifest });
  if (!repos.ok) {
    return repos;
  }
  const restartSettings = loadedSettings ?? (await loadSettingsOrDefaults(deps.settings));
  const concurrency = restartSettings.update.concurrency;
  const serviceActions = createServiceActions({
    manifest: deps.manifest,
    container: deps.container,
    restart: deps.restart,
    // Never used by restart/verify, but the registry's deps are complete.
    editor: deps.editor ?? { launch: () => err('editor-launch-failed', 'No editor is wired in the CLI') },
    lock: deps.lock,
    docker: deps.docker,
    healthProbe: deps.healthProbe,
    isHealthCheckEnabled: healthCheckEnabledFrom(() => restartSettings),
  });
  const report = await restartAfterSwitch({
    results: switched.data.results,
    repos: repos.data,
    mode: restartMode,
    concurrency,
    serviceActions,
  });
  if (!report.ok) {
    return report;
  }
  const restart = report.data.rows.map((row) => ({
    service: row.service,
    mode: restartMode,
    state: row.phase,
    ...(row.phase === 'skipped' ? { detail: row.skipReason } : row.detail !== undefined ? { detail: row.detail } : {}),
  }));
  const data = { ...switched.data, restart };
  return restartNeedsAttention(report.data.summary)
    ? err('switch-restart-needs-attention', 'The switch succeeded, but a restarted service ended failed, down or unhealthy', data)
    : ok(data);
}
