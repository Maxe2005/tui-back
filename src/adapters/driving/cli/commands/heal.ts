// cli/commands/heal: the `heal` subcommand (usage, flag parsing and runner).
import { err, ok, type Result } from '../../../../core/result.js';
import { createServiceActions, type RestartMode } from '../../../../core/service-actions/index.js';
import { ContainerPort } from '../../../../core/ports/container.js';
import { planHeal, runHeal } from '../../../../core/heal/index.js';
import { restartNeedsAttention } from '../../../../core/edt/switch/restart/switch-restart.js';
import { DockerPort } from '../../../../core/ports/docker.js';
import { EditorPort } from '../../../../core/ports/editor.js';
import { HealthProbePort } from '../../../../core/ports/health-probe.js';
import { ManifestPort } from '../../../../core/ports/manifest.js';
import { RestartPort } from '../../../../core/ports/restart.js';
import { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import { LockPort } from '../../../../core/ports/lock.js';
import { DEFAULT_SETTINGS, healthCheckEnabledFrom, type SettingsPort } from '../../../../core/ports/settings.js';
import { StatePort } from '../../../../core/ports/state.js';
import { Subcommand } from '../dispatch.js';
import { SubcommandDeps } from './deps.js';

const HEAL_USAGE =
  'tui-back heal [--restart simple|clean]' +
  ' (restarts every active-EDT service that is down or unhealthy and declares a container, then verifies it;' +
  ' --restart defaults to the dashboard.restartMode setting, simple out of the box;' +
  ' exit 1 when a restarted service ends failed, down or unhealthy)';
const HEAL_RESTART_MODES: readonly RestartMode[] = ['simple', 'clean'];

// `heal`: the flag is validated before anything is read or restarted. No confirmation prompt —
// the CLI caller asked for it. The data lists the targets, the skipped services with their
// reason and one restart row per target.
async function runHealCommand(
  deps: {
    manifest: ManifestPort;
    lock: LockPort;
    state: StatePort;
    edtRegistry: EdtRegistryPort;
    settings: SettingsPort;
    container: ContainerPort;
    restart: RestartPort;
    docker: DockerPort;
    editor?: EditorPort;
    healthProbe?: HealthProbePort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let restartFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1]?.trim();
    if (flag !== '--restart') {
      return err('invalid-argument', `Unknown heal option: "${flag}". Usage: ${HEAL_USAGE}`);
    }
    if (value === undefined || value === '' || value.startsWith('--')) {
      return err('invalid-argument', `Missing value for --restart. Usage: ${HEAL_USAGE}`);
    }
    if (restartFlag !== undefined) {
      return err('invalid-argument', `--restart may only be given once. Usage: ${HEAL_USAGE}`);
    }
    restartFlag = value;
    i += 1;
  }
  if (restartFlag !== undefined && !(HEAL_RESTART_MODES as readonly string[]).includes(restartFlag)) {
    return err('invalid-argument', `Unknown --restart value "${restartFlag}" — expected simple or clean. Usage: ${HEAL_USAGE}`);
  }
  if (deps.healthProbe === undefined) {
    return err('restart-unavailable', 'Heal needs the health-probe port, which is not wired — nothing was restarted');
  }

  // A load failure or warning goes to stderr and the built-in defaults apply.
  const loaded = await deps.settings.load();
  if (!loaded.ok) {
    console.error(`tui-back: could not read settings, using defaults: ${loaded.error.message}`);
  } else if (loaded.data.warning !== null) {
    console.error(`tui-back: ${loaded.data.warning}`);
  }
  const settings = loaded.ok ? loaded.data.settings : DEFAULT_SETTINGS;
  const mode = (restartFlag ?? settings.dashboard.restartMode) as RestartMode;

  const plan = await planHeal({
    state: deps.state,
    edtRegistry: deps.edtRegistry,
    manifest: deps.manifest,
    docker: deps.docker,
    healthProbe: deps.healthProbe,
    isHealthCheckEnabled: healthCheckEnabledFrom(() => settings),
  });
  if (!plan.ok) {
    return plan;
  }
  const report = await runHeal({
    plan: plan.data,
    mode,
    concurrency: settings.update.concurrency,
    lock: deps.lock,
    serviceActions: createServiceActions({
      manifest: deps.manifest,
      container: deps.container,
      restart: deps.restart,
      // Never used by restart/verify, but the registry's deps are complete.
      editor: deps.editor ?? { launch: () => err('editor-launch-failed', 'No editor is wired in the CLI') },
      lock: deps.lock,
      docker: deps.docker,
      healthProbe: deps.healthProbe,
      isHealthCheckEnabled: healthCheckEnabledFrom(() => settings),
    }),
  });
  if (!report.ok) {
    return report;
  }

  const { edt, rows, summary, message } = report.data;
  const data = {
    edt,
    mode: report.data.mode,
    targets: plan.data.rows.filter((row) => row.phase === 'pending').map((row) => row.service),
    skipped: plan.data.rows
      .filter((row) => row.phase === 'skipped')
      .map((row) => ({ service: row.service, reason: row.skipReason, ...(row.detail !== undefined ? { detail: row.detail } : {}) })),
    restart: rows
      .filter((row) => row.phase !== 'skipped')
      .map((row) => ({ service: row.service, state: row.phase, ...(row.detail !== undefined ? { detail: row.detail } : {}) })),
    summary,
    ...(message !== undefined ? { message } : {}),
  };
  return restartNeedsAttention(summary)
    ? err('heal-needs-attention', 'A restarted service ended failed, down or unhealthy', data)
    : ok(data);
}

export function healSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'heal',
    usage: HEAL_USAGE,
    run: async (args) => runHealCommand(deps, args),
  };
}
