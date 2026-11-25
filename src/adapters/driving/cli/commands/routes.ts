// cli/commands/routes: the `routes` verb-dispatch subcommand — `routes favorites list|add|remove`
// over the per-EDT favorite-route use-cases, and `routes smoke` (the favorites smoke run). Same
// use-cases and envelope as the TUI.
import { resolve } from 'node:path';
import { err, ok, type Result } from '../../../../core/result.js';
import { addFavoriteRoute, listFavoriteRoutes, removeFavoriteRoute } from '../../../../core/insight/routes/favorites.js';
import { DEFAULT_SETTINGS } from '../../../../core/ports/storage/settings.js';
import { DEFAULT_SMOKE_CONCURRENCY, smokeRunFailed, smokeRunFavorites } from '../../../../core/insight/routes/smoke-run.js';
import { Subcommand } from '../dispatch/dispatch.js';
import { SubcommandDeps } from './deps.js';

const LIST_USAGE = 'tui-back routes favorites list [--edt <topic>]';
const ADD_USAGE = 'tui-back routes favorites add --repo <path> --method <METHOD> --path <template> [--edt <topic>]';
const REMOVE_USAGE = 'tui-back routes favorites remove --repo <path> --method <METHOD> --path <template> [--edt <topic>]';
const SMOKE_USAGE = 'tui-back routes smoke [--edt <topic>] [--repo <path>] [--include-mutating]';
const ROUTES_USAGE = `${LIST_USAGE}\n${ADD_USAGE}\n${REMOVE_USAGE}\n${SMOKE_USAGE} (--edt defaults to the active EDT)`;

interface FavoriteFlags {
  edt?: string;
  repo?: string;
  method?: string;
  path?: string;
}

function parseFlags(args: string[], allowed: readonly string[], usage: string): Result<FavoriteFlags> {
  const flags: FavoriteFlags = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === undefined || !allowed.includes(flag)) {
      return err('invalid-argument', `Unknown argument ${flag}. Usage: ${usage}`);
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return err('invalid-argument', `Missing value for ${flag}. Usage: ${usage}`);
    }
    const key = flag.slice(2) as keyof FavoriteFlags;
    if (flags[key] !== undefined) {
      return err('invalid-argument', `${flag} may be given only once. Usage: ${usage}`);
    }
    flags[key] = value;
    i += 1;
  }
  return ok(flags);
}

interface SmokeFlags {
  edt?: string;
  repo?: string;
  includeMutating: boolean;
}

function parseSmokeFlags(args: string[]): Result<SmokeFlags> {
  const flags: SmokeFlags = { includeMutating: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--include-mutating') {
      if (flags.includeMutating) {
        return err('invalid-argument', `--include-mutating may be given only once. Usage: ${SMOKE_USAGE}`);
      }
      flags.includeMutating = true;
      continue;
    }
    if (flag !== '--edt' && flag !== '--repo') {
      return err('invalid-argument', `Unknown argument ${flag}. Usage: ${SMOKE_USAGE}`);
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return err('invalid-argument', `Missing value for ${flag}. Usage: ${SMOKE_USAGE}`);
    }
    const key = flag.slice(2) as 'edt' | 'repo';
    if (flags[key] !== undefined) {
      return err('invalid-argument', `${flag} may be given only once. Usage: ${SMOKE_USAGE}`);
    }
    if (value.trim() === '') {
      return err('invalid-argument', `${flag} must not be blank. Usage: ${SMOKE_USAGE}`);
    }
    flags[key] = value;
    i += 1;
  }
  return ok(flags);
}

export function routesSubcommand(deps: SubcommandDeps): Subcommand {
  const mutateDeps = {
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    lock: deps.lock,
    state: deps.state,
  };
  const mutation = async (
    args: string[],
    usage: string,
    action: typeof addFavoriteRoute,
  ): Promise<Result<unknown>> => {
    const parsed = parseFlags(args, ['--edt', '--repo', '--method', '--path'], usage);
    if (!parsed.ok) {
      return parsed;
    }
    const { edt, repo, method, path } = parsed.data;
    if (repo === undefined || method === undefined || path === undefined) {
      return err('missing-argument', `--repo, --method and --path are required. Usage: ${usage}`);
    }
    if (repo.trim() === '') {
      return err('missing-argument', `--repo must not be blank. Usage: ${usage}`);
    }
    return action(mutateDeps, { ...(edt === undefined ? {} : { edt }), repoPath: resolve(repo), method, path });
  };
  const smoke = async (args: string[]): Promise<Result<unknown>> => {
    const parsed = parseSmokeFlags(args);
    if (!parsed.ok) {
      return parsed;
    }
    const { edt, repo, includeMutating } = parsed.data;
    // Settings failure falls back to the built-in concurrency (same idiom as `update`).
    const loaded = await deps.settings.load();
    if (!loaded.ok) {
      console.error(`tui-back: could not read settings, using defaults: ${loaded.error.message}`);
    }
    const concurrency = (loaded.ok ? loaded.data.settings : DEFAULT_SETTINGS).update.concurrency ?? DEFAULT_SMOKE_CONCURRENCY;
    const result = await smokeRunFavorites(
      { edtRegistry: deps.edtRegistry, state: deps.state, manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth },
      { ...(edt === undefined ? {} : { edt }), ...(repo === undefined ? {} : { repo: resolve(repo) }), includeMutating, concurrency },
    );
    if (!result.ok || !smokeRunFailed(result.data)) {
      return result;
    }
    const failed = result.data.rows.filter((row) => row.outcome !== 'ok' && row.outcome !== 'skipped').length;
    return err('smoke-run-failed', `${failed} of ${result.data.rows.length} favorite routes did not respond ok`, result.data);
  };
  return {
    name: 'routes',
    usage: ROUTES_USAGE,
    run: async (args) => {
      if (args[0] === 'smoke') {
        return smoke(args.slice(1));
      }
      if (args[0] !== 'favorites') {
        const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
        return err('invalid-argument', `Unknown routes group: ${label}. Usage:\n${ROUTES_USAGE}`);
      }
      const verb = args[1];
      const rest = args.slice(2);
      if (verb === 'list') {
        const parsed = parseFlags(rest, ['--edt'], LIST_USAGE);
        if (!parsed.ok) {
          return parsed;
        }
        return listFavoriteRoutes(
          { edtRegistry: deps.edtRegistry, state: deps.state, manifest: deps.manifest, scanner: deps.scanner },
          parsed.data.edt === undefined ? {} : { edt: parsed.data.edt },
        );
      }
      if (verb === 'add') {
        return mutation(rest, ADD_USAGE, addFavoriteRoute);
      }
      if (verb === 'remove') {
        return mutation(rest, REMOVE_USAGE, removeFavoriteRoute);
      }
      const label = verb === undefined ? '(none)' : `"${verb}"`;
      return err('invalid-argument', `Unknown routes favorites action: ${label}. Usage:\n${ROUTES_USAGE}`);
    },
  };
}
