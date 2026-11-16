// cli/commands/request: list-routes, fire-request and the saved-request commands (usage strings, flag parsers, runners).
import { resolve } from 'node:path';
import { err, ok, type Result } from '../../../../core/result.js';
import { listRoutes } from '../../../../core/routes/list-routes.js';
import { fireRequest, type FireRequestOptions } from '../../../../core/routes/fire-request.js';
import { deleteSavedRequest, fireSavedRequest, listSavedRequests, saveRequest } from '../../../../core/routes/saved-requests.js';
import { Subcommand } from '../dispatch.js';
import { SubcommandDeps } from './deps.js';

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

export function listRoutesSubcommand(deps: SubcommandDeps): Subcommand {
  return {
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
  };
}

export function fireRequestSubcommand(deps: SubcommandDeps): Subcommand {
  return {
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
  };
}

export function requestListSubcommand(deps: SubcommandDeps): Subcommand {
  return {
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
  };
}

export function requestFireSubcommand(deps: SubcommandDeps): Subcommand {
  return {
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
  };
}

export function requestDeleteSubcommand(deps: SubcommandDeps): Subcommand {
  return {
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
  };
}
