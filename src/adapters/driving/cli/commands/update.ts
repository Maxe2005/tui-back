// cli/commands/update: the `update` subcommand (usage, override flags, EDT / all / from-edt flows).
import { err } from '../../../../core/result.js';
import { groupUpdate, type OnUpdatePhase, type UpdatePhase } from '../../../../core/workspace/scripts/group-update/group-update.js';
import { selectionFromEdt } from '../../../../core/workspace/scripts/update-support/resolve-merge-sources.js';
import { DEFAULT_SETTINGS } from '../../../../core/ports/storage/settings.js';
import { Subcommand, SubcommandContext } from '../dispatch/dispatch.js';
import { SubcommandDeps } from './deps.js';

const UPDATE_FLAGS = '[--migrations|--no-migrations] [--clean-restart|--no-clean-restart]';
const UPDATE_USAGE =
  `tui-back update ${UPDATE_FLAGS}\n` +
  `tui-back update --from-edt <topic> ${UPDATE_FLAGS}\n` +
  `tui-back update --all --yes ${UPDATE_FLAGS}\n` +
  '(unflagged options default to settings.yaml update.runMigrations / update.cleanRestart)';

// Pulls the run-wide override flags out of `update`'s args. A flag and its negation together are
// contradictory: reported as an invalid-argument rather than silently picking one.
function parseUpdateOverrides(
  args: readonly string[],
): { ok: true; rest: string[]; runMigrations?: boolean; cleanRestart?: boolean } | { ok: false; message: string } {
  const has = (flag: string): boolean => args.includes(flag);
  if (has('--migrations') && has('--no-migrations')) {
    return { ok: false, message: '--migrations and --no-migrations are mutually exclusive' };
  }
  if (has('--clean-restart') && has('--no-clean-restart')) {
    return { ok: false, message: '--clean-restart and --no-clean-restart are mutually exclusive' };
  }
  const flags = new Set(['--migrations', '--no-migrations', '--clean-restart', '--no-clean-restart']);
  return {
    ok: true,
    rest: args.filter((arg) => !flags.has(arg)),
    ...(has('--migrations') ? { runMigrations: true } : has('--no-migrations') ? { runMigrations: false } : {}),
    ...(has('--clean-restart') ? { cleanRestart: true } : has('--no-clean-restart') ? { cleanRestart: false } : {}),
  };
}

export function updateSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'update',
    usage: UPDATE_USAGE,
    // The bare invocation is EDT-scoped (`--all` is never implied); `--all --yes`
    // (order-insensitive) runs the same per-service flow against every managed repo; `--all`
    // alone is a `confirmation-required` rejection naming `--yes` (confirmation stays out of
    // core — a driving concern). Any other flag is an explicit invalid-argument rejection.
    run: async (rawArgs, ctx) => {
      const overrides = parseUpdateOverrides(rawArgs);
      if (!overrides.ok) {
        return err('invalid-argument', `${overrides.message}. Usage: ${UPDATE_USAGE}`);
      }
      const args = overrides.rest;
      // Defaults come from settings.yaml (a load failure falls back to the built-in ones);
      // explicit flags win.
      const loaded = await deps.settings.load();
      if (!loaded.ok) {
        // stderr is separate from the stdout JSON envelope (same idiom as dispatch/dispatch.ts in the parent folder).
        console.error(`tui-back: could not read settings, using defaults: ${loaded.error.message}`);
      } else if (loaded.data.warning !== null) {
        console.error(`tui-back: ${loaded.data.warning}`);
      }
      const defaults = (loaded.ok ? loaded.data.settings : DEFAULT_SETTINGS).update;
      const runMigrations = overrides.runMigrations ?? defaults.runMigrations;
      const cleanRestart = overrides.cleanRestart ?? defaults.cleanRestart;
      // The CLI passes no resolution seam: dirty worktrees stay `skipped`/`dirty-worktree`
      // rows and conflicts abort-and-report as `failed`/`merge-conflict`, with no prompt and
      // single-line JSON output.
      if (args.length === 0) {
        return groupUpdate({
          edtRegistry: deps.edtRegistry,
          state: deps.state,
          manifest: deps.manifest,
          git: deps.git,
          container: deps.container,
          migration: deps.migration,
          restart: deps.restart,
          lock: deps.lock,
          registry: deps.registry,
          scope: 'edt',
          // Full default selection (no `selection` filter); the two toggles are the
          // settings defaults unless a flag overrides them.
          runMigrations,
          cleanRestart,
          onUpdateBlocker: undefined,
          ...updateContext(ctx),
        });
      }
      const sorted = [...args].sort();
      if (sorted.length === 2 && sorted[0] === '--all' && sorted[1] === '--yes') {
        return groupUpdate({
          edtRegistry: deps.edtRegistry,
          state: deps.state,
          manifest: deps.manifest,
          git: deps.git,
          container: deps.container,
          migration: deps.migration,
          restart: deps.restart,
          lock: deps.lock,
          registry: deps.registry,
          scope: 'all',
          // Same toggles as the bare invocation (first groupUpdate call).
          runMigrations,
          cleanRestart,
          onUpdateBlocker: undefined,
          ...updateContext(ctx),
        });
      }
      if (args.length === 2 && args[0] === '--from-edt' && args[1].trim() !== '') {
        const selection = await selectionFromEdt({ edtRegistry: deps.edtRegistry, state: deps.state, git: deps.git }, args[1].trim());
        if (!selection.ok) {
          return selection;
        }
        return groupUpdate({
          edtRegistry: deps.edtRegistry,
          state: deps.state,
          manifest: deps.manifest,
          git: deps.git,
          container: deps.container,
          migration: deps.migration,
          restart: deps.restart,
          lock: deps.lock,
          registry: deps.registry,
          scope: 'edt',
          selection: selection.data,
          runMigrations,
          cleanRestart,
          onUpdateBlocker: undefined,
          ...updateContext(ctx),
        });
      }
      if (args.length === 1 && args[0] === '--all') {
        return err(
          'confirmation-required',
          `All-repos update touches every managed repo — rerun with --all --yes to confirm. Usage: ${UPDATE_USAGE}`,
        );
      }
      return err('invalid-argument', `Usage: ${UPDATE_USAGE}`);
    },
  };
}

// Maps the optional driver context to groupUpdate's observer/cancel seams; empty on the CLI path.
function updateContext(ctx: SubcommandContext | undefined): { onPhase?: OnUpdatePhase; shouldCancel?: () => boolean } {
  if (ctx === undefined) {
    return {};
  }
  const { signal, onPhase } = ctx;
  return {
    ...(onPhase === undefined ? {} : { onPhase: (service: string, phase: UpdatePhase) => onPhase(service, phase) }),
    ...(signal === undefined ? {} : { shouldCancel: () => signal.aborted }),
  };
}
