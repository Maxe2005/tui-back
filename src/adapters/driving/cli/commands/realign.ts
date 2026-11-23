// cli/commands/realign: the `realign` subcommand (usage, flag parsing and runner).
import { err, ok, type Result } from '../../../../core/result.js';
import { restartNeedsAttention } from '../../../../core/workspace/edt/switch/restart/switch-restart.js';
import { createServiceActions } from '../../../../core/service-actions/index.js';
import { ContainerPort } from '../../../../core/ports/runtime/container.js';
import { REALIGN_SCOPES, realignServices, type RealignScope } from '../../../../core/workspace/realign/index.js';
import { DockerPort } from '../../../../core/ports/runtime/docker.js';
import { EditorPort } from '../../../../core/ports/runtime/editor.js';
import { HealthProbePort } from '../../../../core/ports/runtime/health-probe.js';
import { GitPort } from '../../../../core/ports/vcs/git.js';
import { ManifestPort } from '../../../../core/ports/vcs/manifest.js';
import { ManifestCarryPort } from '../../../../core/ports/vcs/manifest-carry.js';
import { RestartPort } from '../../../../core/ports/runtime/restart.js';
import { RegistryPort } from '../../../../core/ports/storage/registry.js';
import { EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import { LockPort } from '../../../../core/ports/runtime/lock.js';
import { DEFAULT_SETTINGS, SWITCH_RESTART_MODES, healthCheckEnabledFrom, type Settings, type SettingsPort, type SwitchRestartMode } from '../../../../core/ports/storage/settings.js';
import { StatePort } from '../../../../core/ports/storage/state.js';
import { Subcommand } from '../dispatch/dispatch.js';
import { SubcommandDeps } from './deps.js';

const REALIGN_USAGE =
  'tui-back realign [--scope none|edt|all] [--service <name>]... [--restart none|simple|clean]' +
  ' (--scope defaults to the realign.defaultScope setting, edt out of the box: the drifted active-EDT members;' +
  ' --service adds a service to the scope; --restart defaults to the realign.restartMode setting, none out of the box;' +
  ' exit 1 when a service fails or a restarted service ends failed, down or unhealthy)';

// Hand-rolled flag parsing for `realign` (same style as runEdtSwitch in edt-switch.ts): every flag, scope and
// restart value is validated here, service names by the use-case — both before any lock is
// taken or any repo touched.
async function runRealign(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    manifestCarry: ManifestCarryPort;
    git: GitPort;
    lock: LockPort;
    state: StatePort;
    edtRegistry: EdtRegistryPort;
    settings: SettingsPort;
    container: ContainerPort;
    restart: RestartPort;
    editor?: EditorPort;
    docker?: DockerPort;
    healthProbe?: HealthProbePort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let scopeFlag: string | undefined;
  let restartFlag: string | undefined;
  const services: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1]?.trim();
    switch (flag) {
      case '--scope':
      case '--restart': {
        if (value === undefined || value === '' || value.startsWith('--')) {
          return err('invalid-argument', `Missing value for ${flag}. Usage: ${REALIGN_USAGE}`);
        }
        if ((flag === '--scope' ? scopeFlag : restartFlag) !== undefined) {
          return err('invalid-argument', `${flag} may only be given once. Usage: ${REALIGN_USAGE}`);
        }
        if (flag === '--scope') {
          scopeFlag = value;
        } else {
          restartFlag = value;
        }
        i += 1;
        break;
      }
      case '--service':
        if (value === undefined || value === '' || value.startsWith('--')) {
          return err('invalid-argument', `Missing value for --service. Usage: ${REALIGN_USAGE}`);
        }
        if (!services.includes(value)) {
          services.push(value);
        }
        i += 1;
        break;
      default:
        return err('invalid-argument', `Unknown realign option: "${flag}". Usage: ${REALIGN_USAGE}`);
    }
  }

  if (scopeFlag !== undefined && !(REALIGN_SCOPES as readonly string[]).includes(scopeFlag)) {
    return err('invalid-argument', `Unknown --scope value "${scopeFlag}" — expected none, edt or all. Usage: ${REALIGN_USAGE}`);
  }
  if (restartFlag !== undefined && !(SWITCH_RESTART_MODES as readonly string[]).includes(restartFlag)) {
    return err('invalid-argument', `Unknown --restart value "${restartFlag}" — expected none, simple or clean. Usage: ${REALIGN_USAGE}`);
  }
  // Settings are read only when needed: an absent flag falls back to them, and a restart takes
  // update.concurrency from them. A load failure or warning goes to stderr and the built-in
  // defaults apply.
  let cached: Settings | undefined;
  const settings = async (): Promise<Settings> => {
    if (cached === undefined) {
      const loaded = await deps.settings.load();
      if (!loaded.ok) {
        console.error(`tui-back: could not read settings, using defaults: ${loaded.error.message}`);
      } else if (loaded.data.warning !== null) {
        console.error(`tui-back: ${loaded.data.warning}`);
      }
      cached = loaded.ok ? loaded.data.settings : DEFAULT_SETTINGS;
    }
    return cached;
  };
  const scope = (scopeFlag ?? (await settings()).realign.defaultScope) as RealignScope;
  const restartMode = (restartFlag ?? (await settings()).realign.restartMode) as SwitchRestartMode;
  if (restartMode !== 'none' && (deps.docker === undefined || deps.healthProbe === undefined)) {
    return err('restart-unavailable', 'Post-realign restart needs the Docker and health-probe ports, which are not wired — nothing was realigned');
  }

  let restart: Parameters<typeof realignServices>[0]['restart'];
  if (restartMode !== 'none') {
    const realignSettings = await settings();
    restart = {
      mode: restartMode,
      concurrency: realignSettings.update.concurrency,
      serviceActions: createServiceActions({
        manifest: deps.manifest,
        container: deps.container,
        restart: deps.restart,
        // Never used by restart/verify, but the registry's deps are complete.
        editor: deps.editor ?? { launch: () => err('editor-launch-failed', 'No editor is wired in the CLI') },
        lock: deps.lock,
        docker: deps.docker,
        healthProbe: deps.healthProbe,
        isHealthCheckEnabled: healthCheckEnabledFrom(() => realignSettings),
      }),
    };
  }

  const realigned = await realignServices({
    registry: deps.registry,
    manifest: deps.manifest,
    manifestCarry: deps.manifestCarry,
    git: deps.git,
    lock: deps.lock,
    state: deps.state,
    edtRegistry: deps.edtRegistry,
    scope,
    services,
    ...(restart !== undefined ? { restart } : {}),
  });
  if (!realigned.ok) {
    return realigned;
  }

  const { rows, restart: report, restartError } = realigned.data;
  const data = {
    rows,
    ...(report !== undefined
      ? {
          restart: report.rows.map((row) => ({
            service: row.service,
            mode: report.mode,
            state: row.phase,
            ...(row.phase === 'skipped' ? { detail: row.skipReason } : row.detail !== undefined ? { detail: row.detail } : {}),
          })),
        }
      : {}),
    ...(restartError !== undefined ? { restartError } : {}),
  };
  if (rows.some((row) => row.outcome === 'failed')) {
    return err('realign-failed', 'One or more services could not be realigned', data);
  }
  if (restartError !== undefined || (report !== undefined && restartNeedsAttention(report.summary))) {
    return err('realign-restart-needs-attention', 'The realign succeeded, but the restart failed or a restarted service ended failed, down or unhealthy', data);
  }
  return ok(data);
}

export function realignSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'realign',
    usage: REALIGN_USAGE,
    run: async (args) => runRealign(deps, args),
  };
}
