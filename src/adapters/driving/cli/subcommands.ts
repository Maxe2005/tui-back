// adapters/driving/cli/subcommands: the production subcommand registry (AD-2). Each entry is a
// thin wrapper around one core use-case that also validates argument cardinality, so a typo'd
// or excess argument is an explicit invalid-argument instead of being ignored.
// assertUniqueSubcommandNames keeps a later entry from silently shadowing an earlier one.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { err, ok, type Result } from '../../../core/result.js';
import { ping } from '../../../core/ping.js';
import { createEdt } from '../../../core/edt/create.js';
import { type DirtyPolicy, switchActiveEdt } from '../../../core/edt/switch.js';
import { listSwitchRestartRepos, restartAfterSwitch, restartNeedsAttention } from '../../../core/edt/switch-restart.js';
import { createServiceActions } from '../../../core/service-actions/index.js';
import { modifyEdt } from '../../../core/edt/modify.js';
import { deleteEdt, type MemberDisposition } from '../../../core/edt/delete.js';
import { listEdtBranchesDivergence } from '../../../core/edt/list.js';
import { groupUpdate } from '../../../core/scripts/group-update.js';
import { selectionFromEdt } from '../../../core/scripts/resolve-merge-sources.js';
import { classifyStaleRegistry, removeStaleRegistryEntries } from '../../../core/scripts/clean-registry.js';
import { validateRegistry } from '../../../core/scripts/validate-registry.js';
import type { ContainerPort } from '../../../core/ports/container.js';
import { buildDashboardSnapshot } from '../../../core/dashboard/snapshot.js';
import { REALIGN_SCOPES, realignServices, type RealignScope } from '../../../core/realign/index.js';
import { planHeal, runHeal } from '../../../core/heal/index.js';
import type { RestartMode } from '../../../core/service-actions/index.js';
import type { DevAuthPort } from '../../../core/ports/dev-auth.js';
import type { DockerPort } from '../../../core/ports/docker.js';
import type { EditorPort } from '../../../core/ports/editor.js';
import type { HealthProbePort } from '../../../core/ports/health-probe.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { ManifestCarryPort } from '../../../core/ports/manifest-carry.js';
import type { MigrationPort } from '../../../core/ports/migration.js';
import type { RestartPort } from '../../../core/ports/restart.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../core/ports/lock.js';
import type { RouteScannerPort } from '../../../core/ports/route-scanner.js';
import type { SavedRequestPort } from '../../../core/ports/saved-request.js';
import { DEFAULT_SETTINGS, SWITCH_RESTART_MODES, healthCheckEnabledFrom, type Settings, type SettingsPort, type SwitchRestartMode } from '../../../core/ports/settings.js';
import type { StatePort } from '../../../core/ports/state.js';
import { registerRepo } from '../../../core/scripts/register.js';
import { resetRepo } from '../../../core/scripts/reset.js';
import { listRepos } from '../../../core/scripts/list-repos.js';
import { scanRepos } from '../../../core/scripts/scan.js';
import { listRoutes } from '../../../core/routes/list-routes.js';
import { fireRequest, type FireRequestOptions } from '../../../core/routes/fire-request.js';
import { deleteSavedRequest, fireSavedRequest, listSavedRequests, saveRequest } from '../../../core/routes/saved-requests.js';
import type { Subcommand } from './dispatch.js';

const EDT_CREATE_USAGE =
  'tui-back edt create --topic <topic> --member <path> [--create-branches] ' +
  '[--base <branch>] [--branch-mode grouped|individual] [--branch-name <name>|<path>=<name>]';
const EDT_SWITCH_USAGE =
  'tui-back edt switch --to <topic> [--force] [--discard-dirty | --adopt-dirty [--adopt-branch <name>]] [--restart none|simple|clean]' +
  ' (--restart defaults to settings.yaml switch.restartMode; exit 1 when a restarted service ends failed, down or unhealthy)';
const EDT_MODIFY_USAGE =
  'tui-back edt modify --topic <topic> [--add-member <path> --set-branch <path>=<branch>]... [--remove-member <path>]... [--set-branch <path>=<branch>]... [--rename-to <topic>]' +
  ' (each --add-member requires a matching --set-branch for that same path — no current-branch default)';
const EDT_DELETE_USAGE =
  'tui-back edt delete <topic> [--branches <repoPath>=<leave|delete>]... ' +
  '(a member with no matching --branches entry defaults to leave; the active EDT can never be deleted)';
const EDT_USAGE = `${EDT_CREATE_USAGE}\n${EDT_SWITCH_USAGE}\n${EDT_MODIFY_USAGE}\n${EDT_DELETE_USAGE}`;
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
const REALIGN_USAGE =
  'tui-back realign [--scope none|edt|all] [--service <name>]... [--restart none|simple|clean]' +
  ' (--scope defaults to the realign.defaultScope setting, edt out of the box: the drifted active-EDT members;' +
  ' --service adds a service to the scope; --restart defaults to the realign.restartMode setting, none out of the box;' +
  ' exit 1 when a service fails or a restarted service ends failed, down or unhealthy)';
const HEAL_USAGE =
  'tui-back heal [--restart simple|clean]' +
  ' (restarts every active-EDT service that is down or unhealthy and declares a container, then verifies it;' +
  ' --restart defaults to the dashboard.restartMode setting, simple out of the box;' +
  ' exit 1 when a restarted service ends failed, down or unhealthy)';
const HEAL_RESTART_MODES: readonly RestartMode[] = ['simple', 'clean'];
const REGISTRY_CLEAN_USAGE =
  'tui-back registry clean (interactive on a TTY) | tui-back registry clean --yes --path <path>...';
const REGISTRY_VALIDATE_USAGE = 'tui-back registry validate';
const REGISTRY_USAGE = `${REGISTRY_CLEAN_USAGE}\n${REGISTRY_VALIDATE_USAGE}`;

export function buildSubcommands(deps: {
  registry: RegistryPort;
  manifest: ManifestPort;
  manifestCarry: ManifestCarryPort;
  lock: LockPort;
  registryResourceKey: string;
  edtsBaseDir: string;
  edtRegistry: EdtRegistryPort;
  edtRegistryResourceKey: string;
  git: GitPort;
  container: ContainerPort;
  docker: DockerPort;
  migration: MigrationPort;
  restart: RestartPort;
  state: StatePort;
  // Source of the `update` defaults (runMigrations / cleanRestart); a load failure or warning is reported on stderr and the built-in defaults apply.
  settings: SettingsPort;
  // The post-switch restart's verification ports (`edt switch --restart`, with `docker` above).
  // Optional: without them a restart request is rejected up front, before anything is touched.
  editor?: EditorPort;
  healthProbe?: HealthProbePort;
  // Gates `registry clean`'s bare-invocation interactive list-then-confirm prompt. Defaults to
  // false (never prompts); only bin/main.ts wires it, and only when BOTH stdout and stdin are
  // real TTYs — a piped stdin must never let `rl.question()` block on or misread a
  // nonexistent answer.
  isTTY?: boolean;
  scanner: RouteScannerPort;
  auth: DevAuthPort;
  savedRequests: SavedRequestPort;
}): Subcommand[] {
  const subcommands: Subcommand[] = [
    {
      name: 'register',
      usage: 'tui-back register [--reset] <path>',
      run: async (args) => {
        if (args.length === 0) {
          return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, undefined);
        }
        if (args[0] === '--reset') {
          if (args.length > 2) {
            return err('invalid-argument', 'Usage: tui-back register --reset <path>');
          }
          return resetRepo(deps.registry, deps.lock, deps.registryResourceKey, args[1]);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back register <path>');
        }
        return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, args[0]);
      },
    },
    {
      name: 'list-repos',
      usage: 'tui-back list-repos',
      run: async (args) =>
        args.length === 0
          ? listRepos(deps.registry, deps.manifest)
          : err('invalid-argument', 'Usage: tui-back list-repos'),
    },
    {
      name: 'scan',
      usage: 'tui-back scan <root>',
      run: async (args) => {
        if (args.length === 0) {
          return scanRepos(deps.registry, undefined);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back scan <root>');
        }
        return scanRepos(deps.registry, args[0]);
      },
    },
    {
      name: 'ping',
      usage: 'tui-back ping',
      run: async (args) => (args.length === 0 ? ping() : err('invalid-argument', 'Usage: tui-back ping')),
    },
    {
      name: 'edts',
      usage: 'tui-back edts',
      // Every managed service's current branch + ahead/behind divergence from its own
      // configured upstream (FR-9), uniformly for EDT members and non-members alike.
      run: async (args) =>
        args.length === 0
          ? listEdtBranchesDivergence({
              registry: deps.registry,
              manifest: deps.manifest,
              git: deps.git,
              edtRegistry: deps.edtRegistry,
              state: deps.state,
            })
          : err('invalid-argument', 'Usage: tui-back edts'),
    },
    {
      name: 'dashboard',
      usage: 'tui-back dashboard',
      // The Dashboard's snapshot (active EDT services with their health-first status, registry
      // health), read-only.
      run: async (args) => {
        if (args.length !== 0) {
          return err('invalid-argument', 'Usage: tui-back dashboard');
        }
        const settings = await loadSettingsOrDefaults(deps.settings);
        return buildDashboardSnapshot({
          registry: deps.registry,
          manifest: deps.manifest,
          git: deps.git,
          docker: deps.docker,
          ...(deps.healthProbe === undefined ? {} : { healthProbe: deps.healthProbe }),
          isHealthCheckEnabled: healthCheckEnabledFrom(() => settings),
          edtRegistry: deps.edtRegistry,
          state: deps.state,
        });
      },
    },
    {
      name: 'edt',
      usage: EDT_USAGE,
      run: async (args) => {
        if (args[0] === 'create') {
          return runEdtCreate(deps, args.slice(1));
        }
        if (args[0] === 'switch') {
          return runEdtSwitch(deps, args.slice(1));
        }
        if (args[0] === 'modify') {
          return runEdtModify(deps, args.slice(1));
        }
        if (args[0] === 'delete') {
          return runEdtDelete(deps, args.slice(1));
        }
        const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
        return err('invalid-argument', `Unknown edt action: ${label}. Usage:\n${EDT_USAGE}`);
      },
    },
    {
      name: 'update',
      usage: UPDATE_USAGE,
      // The bare invocation is EDT-scoped (`--all` is never implied); `--all --yes`
      // (order-insensitive) runs the same per-service flow against every managed repo; `--all`
      // alone is a `confirmation-required` rejection naming `--yes` (confirmation stays out of
      // core — a driving concern). Any other flag is an explicit invalid-argument rejection.
      run: async (rawArgs) => {
        const overrides = parseUpdateOverrides(rawArgs);
        if (!overrides.ok) {
          return err('invalid-argument', `${overrides.message}. Usage: ${UPDATE_USAGE}`);
        }
        const args = overrides.rest;
        // Defaults come from settings.yaml (a load failure falls back to the built-in ones);
        // explicit flags win.
        const loaded = await deps.settings.load();
        if (!loaded.ok) {
          // stderr is separate from the stdout JSON envelope (same idiom as dispatch.ts).
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
            // No live observer either: the output stays a single JSON line.
            onPhase: undefined,
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
            // Same toggles as the bare invocation above.
            runMigrations,
            cleanRestart,
            onUpdateBlocker: undefined,
            // Same no-observer wiring as above.
            onPhase: undefined,
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
            onPhase: undefined,
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
    },
    {
      name: 'realign',
      usage: REALIGN_USAGE,
      run: async (args) => runRealign(deps, args),
    },
    {
      name: 'heal',
      usage: HEAL_USAGE,
      run: async (args) => runHealCommand(deps, args),
    },
    {
      name: 'registry',
      usage: REGISTRY_USAGE,
      // Verb-dispatch subcommand, same shape as `edt` above — `clean` is the only action, but
      // the dispatch shape leaves room for another registry verb without renaming.
      run: async (args) => {
        if (args[0] === 'clean') {
          return runRegistryClean(deps, args.slice(1));
        }
        if (args[0] === 'validate') {
          return runRegistryValidate(deps, args.slice(1));
        }
        const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
        return err('invalid-argument', `Unknown registry action: ${label}. Usage:\n${REGISTRY_USAGE}`);
      },
    },
    {
      name: 'list-routes',
      usage: 'tui-back list-routes <repoPath>',
      // The wrapper owns argument cardinality (missing → missing-argument, excess or blank →
      // invalid-argument); the use-case owns the manifest gate and the scanner delegation.
      run: async (args) => {
        if (args.length === 0) {
          return err('missing-argument', 'Usage: tui-back list-routes <repoPath>');
        }
        if (args.length > 1 || args[0].trim() === '') {
          return err('invalid-argument', 'Usage: tui-back list-routes <repoPath>');
        }
        return listRoutes({ manifest: deps.manifest, scanner: deps.scanner }, resolve(args[0]));
      },
    },
    {
      name: 'fire-request',
      usage: FIRE_REQUEST_USAGE,
      // The wrapper owns argument cardinality (missing → missing-argument, any other arity or
      // a blank argument → invalid-argument) and the optional repeatable
      // --body/--query/--header flags plus a single --save <name> after the three positionals;
      // the use-case owns the manifest gate, the route-exists check, the session, and the fire
      // itself. A --save name is collision-checked before anything is fired (a colliding name
      // is duplicate-request-name with nothing sent) and persisted only after a successful fire.
      run: async (args) => {
        if (args.length === 0) {
          return err('missing-argument', `Usage: ${FIRE_REQUEST_USAGE}`);
        }
        const positionals = args.slice(0, 3);
        if (positionals.length !== 3 || positionals.some((arg) => arg.trim() === '' || arg.startsWith('--'))) {
          return err('invalid-argument', `Usage: ${FIRE_REQUEST_USAGE}`);
        }
        const parsed = parseFireRequestFlags(args.slice(3));
        if (!parsed.ok) {
          return parsed;
        }
        if (parsed.data.saveName !== null) {
          const collision = await deps.savedRequests.get(parsed.data.saveName.trim());
          if (collision.ok) {
            return err('duplicate-request-name', `A request named "${parsed.data.saveName.trim()}" already exists: choose a different name`);
          }
          if (collision.error.code !== 'saved-request-not-found') {
            return collision;
          }
        }
        const fired = await fireRequest(
          { manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth },
          resolve(args[0]),
          args[1],
          args[2],
          ...(parsed.data.options === null ? [] : [parsed.data.options]),
        );
        if (!fired.ok || parsed.data.saveName === null) {
          return fired;
        }
        const options = parsed.data.options;
        const headers = options?.headers;
        const explicit =
          headers === undefined
            ? undefined
            : Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
        const contentType = explicit ?? (options?.body !== undefined ? 'application/json' : undefined);
        const saved = await saveRequest(
          { store: deps.savedRequests },
          {
            name: parsed.data.saveName,
            repoPath: resolve(args[0]),
            method: args[1],
            path: args[2],
            ...(options?.query === undefined ? {} : { query: options.query }),
            ...(headers === undefined ? {} : { headers }),
            ...(options?.body === undefined ? {} : { bodyText: JSON.stringify(options.body) }),
            ...(contentType === undefined ? {} : { contentType }),
          },
        );
        if (!saved.ok) {
          return saved;
        }
        return fired;
      },
    },
    {
      name: 'request-list',
      usage: REQUEST_LIST_USAGE,
      // An optional --repo <path> narrows the library to one repo; without it every saved
      // request is listed with its advisory stale flag (computed per repo via a fresh scan).
      run: async (args) => {
        let repo: string | undefined;
        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          const value = args[i + 1];
          if (flag !== '--repo') {
            return err('invalid-argument', `Unknown argument ${flag}. Usage: ${REQUEST_LIST_USAGE}`);
          }
          if (value === undefined || value.startsWith('--')) {
            return err('invalid-argument', `Missing value for --repo. Usage: ${REQUEST_LIST_USAGE}`);
          }
          if (repo !== undefined) {
            return err('invalid-argument', `--repo may be given only once. Usage: ${REQUEST_LIST_USAGE}`);
          }
          if (value.trim() === '') {
            return err('invalid-argument', `--repo must not be blank. Usage: ${REQUEST_LIST_USAGE}`);
          }
          repo = resolve(value);
          i += 1;
        }
        return listSavedRequests(
          { store: deps.savedRequests, manifest: deps.manifest, scanner: deps.scanner },
          ...(repo === undefined ? [] : [{ repoPath: repo }]),
        );
      },
    },
    {
      name: 'request-fire',
      usage: REQUEST_FIRE_USAGE,
      // Re-fires a saved request by exact name with optional --body/--query/--header overrides;
      // --overwrite writes the overrides back onto the original, --save-as <new> stores them as
      // a new record (a colliding name is duplicate-request-name, before anything is fired).
      // A stale record is rejected with unknown-route and nothing is sent.
      run: async (args) => {
        if (args.length === 0) {
          return err('missing-argument', `Usage: ${REQUEST_FIRE_USAGE}`);
        }
        const name = args[0];
        if (name.trim() === '' || name.startsWith('--')) {
          return err('invalid-argument', `Usage: ${REQUEST_FIRE_USAGE}`);
        }
        const parsed = parseRequestFireFlags(args.slice(1));
        if (!parsed.ok) {
          return parsed;
        }
        return fireSavedRequest(
          { store: deps.savedRequests, manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth },
          name,
          parsed.data.overrides,
          parsed.data.save,
        );
      },
    },
    {
      name: 'request-delete',
      usage: REQUEST_DELETE_USAGE,
      // Removes one saved request by exact name; an unknown name is saved-request-not-found.
      run: async (args) => {
        if (args.length === 0) {
          return err('missing-argument', `Usage: ${REQUEST_DELETE_USAGE}`);
        }
        if (args.length > 1 || args[0].trim() === '') {
          return err('invalid-argument', `Usage: ${REQUEST_DELETE_USAGE}`);
        }
        const removed = await deleteSavedRequest({ store: deps.savedRequests }, args[0]);
        if (!removed.ok) {
          return removed;
        }
        return ok({ name: args[0] });
      },
    },
  ];
  assertUniqueSubcommandNames(subcommands);
  return subcommands;
}

const FIRE_REQUEST_USAGE =
  "tui-back fire-request <repoPath> <METHOD> <path> [--body <json>] [--query name=value]... [--header 'Name: value']... [--save <name>]";
const REQUEST_LIST_USAGE = 'tui-back request-list [--repo <path>]';
const REQUEST_FIRE_USAGE =
  "tui-back request-fire <name> [--body <json>] [--query name=value]... [--header 'Name: value']... [--overwrite | --save-as <new>]";
const REQUEST_DELETE_USAGE = 'tui-back request-delete <name>';

// Hand-rolled `fire-request` flags (same dependency-free walk as `edt create` below).
// `--body` takes JSON (unparsable → invalid-argument, at most once); `--query name=value` and
// `--header 'Name: value'` repeat with distinct names (a repeated query name, or a header name
// repeated in any case, is invalid-argument rather than silently overwritten or comma-merged);
// `--save <name>` persists the fired request under that name (at most once, blank rejected).
// A value that is itself a flag counts as missing.
function parseFireRequestFlags(flags: string[]): Result<{ options: FireRequestOptions | null; saveName: string | null }> {
  if (flags.length === 0) {
    return ok({ options: null, saveName: null });
  }
  const options: FireRequestOptions = {};
  let saveName: string | null = null;
  let sawOption = false;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (flag !== '--body' && flag !== '--query' && flag !== '--header' && flag !== '--save') {
      return err('invalid-argument', `Unknown argument ${flag}. Usage: ${FIRE_REQUEST_USAGE}`);
    }
    if (value === undefined || value.startsWith('--')) {
      return err('invalid-argument', `Missing value for ${flag}. Usage: ${FIRE_REQUEST_USAGE}`);
    }
    i += 1;
    if (flag === '--save') {
      if (saveName !== null) {
        return err('invalid-argument', `--save may be given only once. Usage: ${FIRE_REQUEST_USAGE}`);
      }
      if (value.trim() === '') {
        return err('invalid-argument', `--save must not be blank. Usage: ${FIRE_REQUEST_USAGE}`);
      }
      saveName = value;
      continue;
    }
    sawOption = true;
    if (flag === '--body') {
      if (options.body !== undefined) {
        return err('invalid-argument', `--body may be given only once. Usage: ${FIRE_REQUEST_USAGE}`);
      }
      try {
        options.body = JSON.parse(value) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return err('invalid-argument', `--body is not valid JSON: ${reason}`);
      }
      continue;
    }
    if (flag === '--query') {
      const separator = value.indexOf('=');
      const name = separator === -1 ? '' : value.slice(0, separator).trim();
      if (name === '') {
        return err('invalid-argument', `--query expects name=value, got "${value}". Usage: ${FIRE_REQUEST_USAGE}`);
      }
      if (options.query !== undefined && Object.prototype.hasOwnProperty.call(options.query, name)) {
        return err('invalid-argument', `--query ${name} is given more than once. Usage: ${FIRE_REQUEST_USAGE}`);
      }
      options.query = { ...(options.query ?? {}), [name]: value.slice(separator + 1) };
      continue;
    }
    const separator = value.indexOf(':');
    const name = separator === -1 ? '' : value.slice(0, separator).trim();
    if (name === '') {
      return err('invalid-argument', `--header expects 'Name: value', got "${value}". Usage: ${FIRE_REQUEST_USAGE}`);
    }
    if (Object.keys(options.headers ?? {}).some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      return err('invalid-argument', `--header ${name} is given more than once. Usage: ${FIRE_REQUEST_USAGE}`);
    }
    options.headers = { ...(options.headers ?? {}), [name]: value.slice(separator + 1).trim() };
  }
  return ok({ options: sawOption ? options : null, saveName });
}

// Hand-rolled `request-fire` flags: the same --body/--query/--header walk as `fire-request`
// plus the per-fire persistence choice — either --overwrite (no value) or --save-as <new>,
// never both.
function parseRequestFireFlags(
  flags: string[],
): Result<{ overrides: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> }; save: { overwrite?: boolean; saveAs?: string } }> {
  const overrides: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {};
  const save: { overwrite?: boolean; saveAs?: string } = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (flag === '--overwrite') {
      if (save.overwrite === true) {
        return err('invalid-argument', `--overwrite may be given only once. Usage: ${REQUEST_FIRE_USAGE}`);
      }
      save.overwrite = true;
      continue;
    }
    if (flag !== '--body' && flag !== '--query' && flag !== '--header' && flag !== '--save-as') {
      return err('invalid-argument', `Unknown argument ${flag}. Usage: ${REQUEST_FIRE_USAGE}`);
    }
    if (value === undefined || value.startsWith('--')) {
      return err('invalid-argument', `Missing value for ${flag}. Usage: ${REQUEST_FIRE_USAGE}`);
    }
    i += 1;
    if (flag === '--save-as') {
      if (save.saveAs !== undefined) {
        return err('invalid-argument', `--save-as may be given only once. Usage: ${REQUEST_FIRE_USAGE}`);
      }
      if (value.trim() === '') {
        return err('invalid-argument', `--save-as must not be blank. Usage: ${REQUEST_FIRE_USAGE}`);
      }
      save.saveAs = value;
      continue;
    }
    if (flag === '--body') {
      if (overrides.body !== undefined) {
        return err('invalid-argument', `--body may be given only once. Usage: ${REQUEST_FIRE_USAGE}`);
      }
      try {
        overrides.body = JSON.parse(value) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return err('invalid-argument', `--body is not valid JSON: ${reason}`);
      }
      continue;
    }
    if (flag === '--query') {
      const separator = value.indexOf('=');
      const name = separator === -1 ? '' : value.slice(0, separator).trim();
      if (name === '') {
        return err('invalid-argument', `--query expects name=value, got "${value}". Usage: ${REQUEST_FIRE_USAGE}`);
      }
      if (overrides.query !== undefined && Object.prototype.hasOwnProperty.call(overrides.query, name)) {
        return err('invalid-argument', `--query ${name} is given more than once. Usage: ${REQUEST_FIRE_USAGE}`);
      }
      overrides.query = { ...(overrides.query ?? {}), [name]: value.slice(separator + 1) };
      continue;
    }
    const separator = value.indexOf(':');
    const name = separator === -1 ? '' : value.slice(0, separator).trim();
    if (name === '') {
      return err('invalid-argument', `--header expects 'Name: value', got "${value}". Usage: ${REQUEST_FIRE_USAGE}`);
    }
    if (Object.keys(overrides.headers ?? {}).some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      return err('invalid-argument', `--header ${name} is given more than once. Usage: ${REQUEST_FIRE_USAGE}`);
    }
    overrides.headers = { ...(overrides.headers ?? {}), [name]: value.slice(separator + 1).trim() };
  }
  if (save.overwrite === true && save.saveAs !== undefined) {
    return err('invalid-argument', `Choose either --overwrite or --save-as <new>, not both. Usage: ${REQUEST_FIRE_USAGE}`);
  }
  return ok({ overrides, save });
}

// Hand-rolled flag parsing for `edt create` (following the register --reset pattern): the
// CLI stays dependency-free, so flags are walked here rather than through an arg parser.
// The use-case owns the semantic validations (topic presence, membership, duplicate topic);
// this wrapper owns the flag syntax (unknown options, missing values, branch-name arity and
// the path=name mapping for individual mode).
async function runEdtCreate(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    lock: LockPort;
    edtsBaseDir: string;
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    git: GitPort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  const rawMembers: string[] = [];
  let createBranches = false;
  let base = 'development';
  let branchMode: 'grouped' | 'individual' = 'grouped';
  const branchNames: string[] = [];
  let sawBranchFlag = false;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '--topic':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --topic. Usage: ${EDT_CREATE_USAGE}`);
        }
        topic = value;
        i += 1;
        break;
      case '--member':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --member. Usage: ${EDT_CREATE_USAGE}`);
        }
        if (value.trim() === '') {
          return err('invalid-argument', `Empty --member value is not allowed. Usage: ${EDT_CREATE_USAGE}`);
        }
        rawMembers.push(value);
        i += 1;
        break;
      case '--create-branches':
        createBranches = true;
        break;
      case '--base':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --base. Usage: ${EDT_CREATE_USAGE}`);
        }
        base = value;
        sawBranchFlag = true;
        i += 1;
        break;
      case '--branch-mode':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --branch-mode. Usage: ${EDT_CREATE_USAGE}`);
        }
        if (value !== 'grouped' && value !== 'individual') {
          return err('invalid-argument', `--branch-mode must be "grouped" or "individual", got "${value}"`);
        }
        branchMode = value;
        sawBranchFlag = true;
        i += 1;
        break;
      case '--branch-name':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --branch-name. Usage: ${EDT_CREATE_USAGE}`);
        }
        branchNames.push(value);
        sawBranchFlag = true;
        i += 1;
        break;
      default:
        return err('invalid-argument', `Unknown edt create option: "${flag}". Usage: ${EDT_CREATE_USAGE}`);
    }
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing --topic. Usage: ${EDT_CREATE_USAGE}`);
  }
  if (rawMembers.length === 0) {
    return err('invalid-member', `At least one --member is required. Usage: ${EDT_CREATE_USAGE}`);
  }

  // Members are canonicalized (resolve) the same way the registry stores registered paths
  // and the branch-name keys must match them 1:1. Duplicate values are rejected rather than
  // deduped: two identical --member flags mean a typo, and silently dropping one would
  // silently change which repos were selected.
  const members = rawMembers.map((member) => resolve(member));
  const seenMembers = new Set<string>();
  for (const member of members) {
    if (seenMembers.has(member)) {
      return err('invalid-argument', `Duplicate --member: ${member}`);
    }
    seenMembers.add(member);
  }
  if (!createBranches && sawBranchFlag) {
    return err('invalid-argument', '--base/--branch-mode/--branch-name require --create-branches');
  }

  const names: Record<string, string> = {};
  if (createBranches) {
    if (branchMode === 'grouped') {
      if (branchNames.length !== 1) {
        return err('invalid-argument', `Grouped branch mode needs exactly one --branch-name. Usage: ${EDT_CREATE_USAGE}`);
      }
      if (branchNames[0].trim() === '') {
        return err('invalid-argument', '--branch-name must not be empty');
      }
      for (const member of members) {
        names[member] = branchNames[0];
      }
    } else {
      if (branchNames.length !== members.length) {
        return err(
          'invalid-argument',
          `Individual branch mode needs one --branch-name <path>=<name> per member. Usage: ${EDT_CREATE_USAGE}`,
        );
      }
      for (const raw of branchNames) {
        const eq = raw.indexOf('=');
        if (eq === -1) {
          return err('invalid-argument', `--branch-name must be <path>=<name> in individual mode, got "${raw}"`);
        }
        const path = resolve(raw.slice(0, eq));
        const name = raw.slice(eq + 1);
        if (name.trim() === '') {
          return err('invalid-argument', `--branch-name "${raw}" has an empty branch name`);
        }
        if (!members.includes(path)) {
          return err('invalid-argument', `--branch-name "${raw}" names a non-member path`);
        }
        if (names[path] !== undefined) {
          return err('invalid-argument', `Multiple --branch-name entries for member ${path}`);
        }
        names[path] = name;
      }
    }
  }

  return createEdt({
    edtsBaseDir: deps.edtsBaseDir,
    manifest: deps.manifest,
    edtRegistry: deps.edtRegistry,
    lock: deps.lock,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    registry: deps.registry,
    git: deps.git,
    topic,
    members,
    branchOptions: { create: createBranches, base, mode: branchMode, names },
  });
}

// Hand-rolled flag parsing for `edt switch` (same style as runEdtCreate): the wrapper owns
// flag syntax (unknown options, missing value, --to given at most once); the use-case owns
// the semantic validations (topic resolution, no-op idempotency, the lock-peek gate).
async function runEdtSwitch(
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

// Hand-rolled flag parsing for `realign` (same style as runEdtSwitch): every flag, scope and
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

// Hand-rolled flag parsing for `edt modify`: the wrapper owns flag syntax (unknown options,
// missing values, --to given at most once, repeated --add-member/--remove-member/--set-branch
// <path>=<name>); the use-case owns the semantic validations (topic resolution, membership
// gating, branch-gate, rename uniqueness, per-repo failure isolation).
async function runEdtModify(
  deps: {
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    registry: RegistryPort;
    manifest: ManifestPort;
    git: GitPort;
    lock: LockPort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  const rawAddMembers: string[] = [];
  const rawRemoveMembers: string[] = [];
  const rawSetBranches: Array<{ repoPath: string; branch: string }> = [];
  let renameTo: string | undefined;
  let sawFlag = false;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    sawFlag = true;
    switch (flag) {
      case '--topic':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --topic. Usage: ${EDT_MODIFY_USAGE}`);
        }
        topic = value;
        i += 1;
        break;
      case '--add-member':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --add-member. Usage: ${EDT_MODIFY_USAGE}`);
        }
        rawAddMembers.push(value);
        i += 1;
        break;
      case '--remove-member':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --remove-member. Usage: ${EDT_MODIFY_USAGE}`);
        }
        rawRemoveMembers.push(value);
        i += 1;
        break;
      case '--set-branch':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --set-branch. Usage: ${EDT_MODIFY_USAGE}`);
        }
        const eq = value.indexOf('=');
        if (eq === -1) {
          return err('invalid-argument', `--set-branch must be <path>=<branch> in modify mode, got "${value}"`);
        }
        const path = resolve(value.slice(0, eq));
        const name = value.slice(eq + 1);
        if (name.trim() === '') {
          return err('invalid-argument', `--set-branch "${value}" has an empty branch name`);
        }
        rawSetBranches.push({ repoPath: path, branch: name });
        i += 1;
        break;
      case '--rename-to':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --rename-to. Usage: ${EDT_MODIFY_USAGE}`);
        }
        renameTo = value;
        i += 1;
        break;
      default:
        return err('invalid-argument', `Unknown edt modify option: "${flag}". Usage: ${EDT_MODIFY_USAGE}`);
    }
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing --topic. Usage: ${EDT_MODIFY_USAGE}`);
  }

  // At least one operation required
  const hasOp = rawAddMembers.length > 0 || rawRemoveMembers.length > 0 || rawSetBranches.length > 0 || (renameTo !== undefined);
  if (!hasOp) {
    return err('invalid-argument', 'At least one operation required: --add-member, --remove-member, --set-branch, or --rename-to');
  }

  return modifyEdt({
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    registry: deps.registry,
    manifest: deps.manifest,
    git: deps.git,
    lock: deps.lock,
    topic,
    addMembers: rawAddMembers,
    removeMembers: rawRemoveMembers,
    setBranches: rawSetBranches,
    renameTo,
  });
}

// Hand-rolled flag parsing for `edt delete`: a positional <topic> (unlike modify/switch's
// --topic flag) plus repeated `--branches <repoPath>=<leave|delete>`. A member with no
// matching --branches entry defaults to 'leave' — deleteEdt itself treats an absent
// disposition that way.
async function runEdtDelete(
  deps: {
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    manifest: ManifestPort;
    git: GitPort;
    lock: LockPort;
    state: StatePort;
    edtsBaseDir: string;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  const dispositions: Record<string, MemberDisposition> = {};

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--branches') {
      const value = args[i + 1];
      if (value === undefined) {
        return err('invalid-argument', `Missing value for --branches. Usage: ${EDT_DELETE_USAGE}`);
      }
      const eq = value.indexOf('=');
      if (eq === -1) {
        return err('invalid-argument', `--branches must be <repoPath>=<leave|delete>, got "${value}"`);
      }
      const rawPath = value.slice(0, eq);
      // An empty repoPath before "=" (e.g. "--branches =delete") would resolve to
      // process.cwd() — reject it instead of guessing.
      if (rawPath.trim() === '') {
        return err('invalid-argument', `--branches "${value}" is missing a repoPath before "="`);
      }
      const path = resolve(rawPath);
      const disposition = value.slice(eq + 1);
      if (disposition !== 'leave' && disposition !== 'delete') {
        return err('invalid-argument', `--branches disposition must be "leave" or "delete", got "${disposition}"`);
      }
      // A --branches repeated for the same resolved repoPath is rejected rather than letting
      // the later value silently win.
      if (Object.prototype.hasOwnProperty.call(dispositions, path)) {
        return err('invalid-argument', `--branches "${rawPath}" was specified more than once`);
      }
      dispositions[path] = disposition;
      i += 1;
      continue;
    }
    if (flag !== undefined && !flag.startsWith('--') && topic === undefined) {
      topic = flag;
      continue;
    }
    return err('invalid-argument', `Unknown edt delete option: "${flag}". Usage: ${EDT_DELETE_USAGE}`);
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing <topic>. Usage: ${EDT_DELETE_USAGE}`);
  }

  // A --branches repoPath that isn't one of the target EDT's own members is rejected, naming
  // the unmatched path(s) — a typo deserves a loud failure, not a silent 'leave'. Skipped when
  // the topic itself isn't found: deleteEdt's own edt-not-found covers that, and there is no
  // real membership to validate --branches against.
  if (Object.keys(dispositions).length > 0) {
    const listed = await deps.edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    const target = listed.data.find((candidate) => candidate.topic === topic);
    if (target !== undefined) {
      const memberPaths = new Set(target.members.map((member) => resolve(member.repoPath)));
      const unmatched = Object.keys(dispositions).filter((path) => !memberPaths.has(path));
      if (unmatched.length > 0) {
        return err(
          'invalid-argument',
          `--branches repoPath(s) not found among EDT "${topic}"'s members: ${unmatched.join(', ')}`,
        );
      }
    }
  }

  return deleteEdt({
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    manifest: deps.manifest,
    git: deps.git,
    lock: deps.lock,
    state: deps.state,
    edtsBaseDir: deps.edtsBaseDir,
    topic,
    dispositions,
  });
}

// `registry clean` flag parsing + the interactive/scripted split. Scripted mode (--yes with at
// least one --path) never classifies — it removes exactly the given paths. A bare invocation
// always classifies first (so zero candidates is reported the same way regardless of TTY);
// with candidates, a non-TTY run is rejected with confirmation-required (like update's `--all`
// alone), and a TTY run lists every candidate (path + reason + memberOfEdts note) and prompts
// for one whole-list confirmation before removing.
async function runRegistryClean(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    edtRegistry: EdtRegistryPort;
    lock: LockPort;
    registryResourceKey: string;
    isTTY?: boolean;
  },
  args: string[],
): Promise<Result<unknown>> {
  let yes = false;
  const paths: string[] = [];
  // The same resolved path given via multiple --path flags is deduped so
  // removeStaleRegistryEntries never removes it twice or reports a duplicate row.
  const seenPaths = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--yes') {
      yes = true;
      continue;
    }
    if (flag === '--path') {
      const value = args[i + 1];
      if (value === undefined) {
        return err('invalid-argument', `Missing value for --path. Usage: ${REGISTRY_CLEAN_USAGE}`);
      }
      // A value that looks like another flag (e.g. `--path --yes`) is a missing value in
      // disguise, not a literal path.
      if (value.startsWith('--')) {
        return err(
          'invalid-argument',
          `--path value must not look like a flag: "${value}". Usage: ${REGISTRY_CLEAN_USAGE}`,
        );
      }
      // `--path ""` would resolve() to process.cwd() and could remove an unintended entry —
      // reject an empty/whitespace-only value instead of guessing.
      if (value.trim() === '') {
        return err('invalid-argument', `--path value must not be empty. Usage: ${REGISTRY_CLEAN_USAGE}`);
      }
      const resolved = resolve(value);
      if (!seenPaths.has(resolved)) {
        seenPaths.add(resolved);
        paths.push(resolved);
      }
      i += 1;
      continue;
    }
    return err('invalid-argument', `Unknown registry clean option: "${flag}". Usage: ${REGISTRY_CLEAN_USAGE}`);
  }

  if (yes || paths.length > 0) {
    if (!yes || paths.length === 0) {
      return err(
        'invalid-argument',
        `Scripted use requires --yes together with at least one --path <path>. Usage: ${REGISTRY_CLEAN_USAGE}`,
      );
    }
    return removeStaleRegistryEntries(
      { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
      paths,
    );
  }

  const classified = await classifyStaleRegistry({
    registry: deps.registry,
    manifest: deps.manifest,
    edtRegistry: deps.edtRegistry,
  });
  if (!classified.ok) {
    return classified;
  }
  if (classified.data.candidates.length === 0) {
    // Zero candidates is an explicit "no stale entries" result, reported the same way whether
    // or not the run is interactive. `errors` still surfaces any path that couldn't even be
    // checked, so a healthy-looking run never hides it.
    return ok({ candidates: [], errors: classified.data.errors, results: [] });
  }

  if (deps.isTTY !== true) {
    return err(
      'confirmation-required',
      `registry clean found ${classified.data.candidates.length} stale ` +
        `${classified.data.candidates.length === 1 ? 'entry' : 'entries'} — rerun with --yes --path <path>... to ` +
        `confirm removal. Usage: ${REGISTRY_CLEAN_USAGE}`,
      { candidates: classified.data.candidates, errors: classified.data.errors },
    );
  }

  process.stdout.write(`Stale registry entries (${classified.data.candidates.length}):\n`);
  for (const candidate of classified.data.candidates) {
    const note = candidate.memberOfEdts.length > 0 ? ` [member of EDT: ${candidate.memberOfEdts.join(', ')}]` : '';
    process.stdout.write(`  ${candidate.path} — ${candidate.reason}${note}\n`);
  }
  // A path that couldn't be checked at all is reported too, distinct from the removable
  // candidate list above.
  if (classified.data.errors.length > 0) {
    process.stdout.write(`Could not be checked (${classified.data.errors.length}, left alone):\n`);
    for (const error of classified.data.errors) {
      process.stdout.write(`  ${error.path} — ${error.code}: ${error.message}\n`);
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await rl.question(`Remove ${classified.data.candidates.length === 1 ? 'this entry' : 'these entries'}? [y/N] `);
  } finally {
    rl.close();
  }

  if (!/^y(es)?$/i.test(answer.trim())) {
    return ok({ candidates: classified.data.candidates, errors: classified.data.errors, results: [] });
  }

  const removed = await removeStaleRegistryEntries(
    { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
    classified.data.candidates.map((candidate) => candidate.path),
  );
  if (!removed.ok) {
    return removed;
  }
  return ok({ candidates: classified.data.candidates, errors: classified.data.errors, results: removed.data.results });
}

// `registry validate`: flagless read-only semantic validation over every
// registered path — zero args; any excess arg is an explicit invalid-argument rejection,
// never silently ignored (mirrors list-repos's own zero-flag arity pattern). No isTTY
// gate: read-only output has no prompt path, the envelope owns TTY/JSON rendering.
async function runRegistryValidate(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    git: GitPort;
  },
  args: string[],
): Promise<Result<unknown>> {
  if (args.length > 0) {
    return err('invalid-argument', `Usage: ${REGISTRY_VALIDATE_USAGE}`);
  }
  return validateRegistry({ registry: deps.registry, manifest: deps.manifest, git: deps.git });
}

export function assertUniqueSubcommandNames(subcommands: Subcommand[]): void {
  const seen = new Set<string>();
  for (const subcommand of subcommands) {
    if (seen.has(subcommand.name)) {
      throw new Error(`Duplicate subcommand name: ${subcommand.name}`);
    }
    seen.add(subcommand.name);
  }
}

// Loads settings.yaml for a command; a load failure or a corrupt-file warning goes to stderr
// (separate from the stdout JSON envelope) and the built-in defaults apply.
async function loadSettingsOrDefaults(port: SettingsPort): Promise<Settings> {
  const loaded = await port.load();
  if (!loaded.ok) {
    console.error(`tui-back: could not read settings, using defaults: ${loaded.error.message}`);
  } else if (loaded.data.warning !== null) {
    console.error(`tui-back: ${loaded.data.warning}`);
  }
  return loaded.ok ? loaded.data.settings : DEFAULT_SETTINGS;
}
