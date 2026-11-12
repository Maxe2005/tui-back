// adapters/driving/mcp/tool-registry: declarative MCP tool table. Each entry wraps one CLI
// subcommand (name + argv mapping) and MUST declare a safety class; registering a tool without
// one throws at startup (fail fast). The class here is authoritative — MCP annotations derived
// from it are advisory hints for clients only.
import { z } from 'zod';
import { err, ok, type Result } from '../../../core/result.js';
import type { Subcommand, SubcommandContext } from '../cli/dispatch.js';

export type SafetyClass = 'read' | 'write' | 'destructive';
const SAFETY_CLASSES: readonly string[] = ['read', 'write', 'destructive'];

export interface ToolDefinition {
  name: string;
  description: string;
  /** zod raw shape of the tool's input object. */
  inputSchema: z.ZodRawShape;
  /** Name of the wrapped registry subcommand. */
  subcommand: string;
  /** Fixed argv placed before the mapped input args, as the subcommand's own args (e.g. ['validate'] for `registry`; the subcommand name is not repeated). */
  baseArgs?: string[];
  /** Maps the validated input to argv for the wrapped subcommand. */
  toArgs?: (input: Record<string, unknown>) => string[];
  safety?: SafetyClass;
  /** Cross-field input check; returns an error message when the input is invalid (the server rejects before any prompt). */
  validateInput?: (input: Record<string, unknown>) => string | undefined;
  /** Repos / EDTs this call affects, shown in the authorization prompt. */
  describeTargets?: (input: Record<string, unknown>) => string[];
  /** Returns the input as shown to the human: secrets (header values) removed. */
  redact?: (input: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Read-only step run BEFORE the authorization gate (e.g. previewing what would be removed).
   * `exec` runs a wrapped-subcommand argv. It may finish the call early or fix the exact argv
   * and targets that the human approves.
   */
  prepare?: (input: Record<string, unknown>, exec: (argv: string[]) => Promise<Result<unknown>>) => Promise<Result<PreparedCall>>;
}

/** Per-call context supplied by the MCP server. */
export interface ToolRunContext {
  signal?: AbortSignal;
  /** Progress message sink (the server turns it into notifications/progress). */
  onProgress?: (message: string) => void;
  /** Overrides the argv built from the input (set by `prepare`). */
  argv?: string[];
}

/** What `prepare` decided before the gate: either an early result, or the exact call to approve. */
export type PreparedCall = { done: Result<unknown> } | { targets: string[]; argv: string[] };

export interface RegisteredTool extends Omit<ToolDefinition, 'prepare'> {
  safety: SafetyClass;
  run: (input: Record<string, unknown>, ctx?: ToolRunContext) => Promise<Result<unknown>>;
  prepare?: (input: Record<string, unknown>, ctx?: ToolRunContext) => Promise<Result<PreparedCall>>;
}

/** Subcommands deliberately not exposed as tools, with the reason (checked by the e2e guard). */
export const EXCLUDED_SUBCOMMANDS: Record<string, string> = {
  tui: 'interactive terminal UI, not scriptable',
  mcp: 'the MCP server itself',
  completion: 'shell completion script, meaningless to an agent',
  install: 'installer; handled outside MCP (registration commands are printed, not served)',
  // `edt` is wrapped by edt-create / edt-modify / edt-switch / edt-switch-discard / edt-delete.
};

// A leading '-' would be parsed as a flag by the wrapped CLI (argument injection).
export const repoPathArg = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('-'), 'repoPath must not start with "-"')
  .describe('Path to a repository directory.');

// Every free-form string argument is checked for a leading '-' (flag injection into the CLI).
const safeString = (description: string) =>
  z.string().min(1).refine((value) => !value.startsWith('-'), 'must not start with "-"').describe(description);
const headersArg = z.record(
  z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, 'invalid header name'),
  z.string().refine((v) => !/[\r\n\u0000]/.test(v), 'header value must not contain CR, LF or NUL'),
)
  .describe('HTTP headers as name -> value. Values are never shown in the approval prompt.');
const queryArg = z.record(safeString('query name').refine((n) => !n.includes('='), 'must not contain "="'), z.string()).describe('Query parameters as name -> value.');
const bodyArg = z.unknown().describe('JSON request body.');
const REDACTED = '[redacted]';

function requestFlags(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (input.body !== undefined) out.push('--body', JSON.stringify(input.body));
  for (const [name, value] of Object.entries((input.query ?? {}) as Record<string, string>)) out.push('--query', `${name}=${value}`);
  for (const [name, value] of Object.entries((input.headers ?? {}) as Record<string, string>)) out.push('--header', `${name}: ${value}`);
  return out;
}
function redactHeaders(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.headers !== 'object' || input.headers === null) return input;
  return { ...input, headers: Object.fromEntries(Object.keys(input.headers).map((name) => [name, REDACTED])) };
}
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const str = (value: unknown): string[] => (typeof value === 'string' ? [value] : []);
const restartArg = z.enum(['none', 'simple', 'clean']);

const WRITE_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'register',
    description: 'Register a repository (or register the current directory when no path is given).',
    inputSchema: { repoPath: repoPathArg.optional() },
    subcommand: 'register',
    toArgs: (i) => str(i.repoPath),
    describeTargets: (i) => str(i.repoPath),
    safety: 'write',
  },
  {
    name: 'scan',
    description: 'Scan a root directory for repositories and register them.',
    inputSchema: { root: safeString('Root directory to scan.').optional() },
    subcommand: 'scan',
    toArgs: (i) => str(i.root),
    describeTargets: (i) => str(i.root),
    safety: 'write',
  },
  {
    name: 'edt-create',
    description: 'Create an EDT (multi-repo working set) from member repositories.',
    inputSchema: {
      topic: safeString('EDT topic.'),
      members: z.array(repoPathArg).min(1),
      createBranches: z.boolean().optional(),
      base: safeString('Base branch.').optional(),
      branchMode: z.enum(['grouped', 'individual']).optional(),
      branchNames: z.array(safeString('<name> or <path>=<name>')).optional(),
    },
    subcommand: 'edt',
    baseArgs: ['create'],
    toArgs: (i) => [
      '--topic', String(i.topic),
      ...strings(i.members).flatMap((m) => ['--member', m]),
      ...(i.createBranches === true ? ['--create-branches'] : []),
      ...(typeof i.base === 'string' ? ['--base', i.base] : []),
      ...(typeof i.branchMode === 'string' ? ['--branch-mode', i.branchMode] : []),
      ...strings(i.branchNames).flatMap((n) => ['--branch-name', n]),
    ],
    describeTargets: (i) => [`EDT ${String(i.topic)}`, ...strings(i.members)],
    safety: 'write',
  },
  {
    name: 'edt-modify',
    description: 'Modify an EDT: add/remove members, set branches, rename.',
    inputSchema: {
      topic: safeString('EDT topic.'),
      addMembers: z.array(repoPathArg).optional(),
      removeMembers: z.array(repoPathArg).optional(),
      setBranches: z.array(safeString('<path>=<branch>')).optional(),
      renameTo: safeString('New topic.').optional(),
    },
    subcommand: 'edt',
    baseArgs: ['modify'],
    toArgs: (i) => [
      '--topic', String(i.topic),
      ...strings(i.addMembers).flatMap((m) => ['--add-member', m]),
      ...strings(i.removeMembers).flatMap((m) => ['--remove-member', m]),
      ...strings(i.setBranches).flatMap((b) => ['--set-branch', b]),
      ...(typeof i.renameTo === 'string' ? ['--rename-to', i.renameTo] : []),
    ],
    describeTargets: (i) => [`EDT ${String(i.topic)}`, ...strings(i.addMembers), ...strings(i.removeMembers)],
    safety: 'write',
  },
  {
    name: 'edt-switch',
    description: 'Switch the active EDT (checks out its branches). Discarding dirty changes is not available through MCP.',
    inputSchema: {
      to: safeString('Target EDT topic.'),
      force: z.boolean().optional(),
      adoptDirty: z.boolean().optional(),
      adoptBranch: safeString('Branch to adopt dirty changes onto.').optional(),
      restart: restartArg.optional(),
    },
    subcommand: 'edt',
    baseArgs: ['switch'],
    toArgs: (i) => [
      '--to', String(i.to),
      ...(i.force === true ? ['--force'] : []),
      ...(i.adoptDirty === true ? ['--adopt-dirty'] : []),
      ...(typeof i.adoptBranch === 'string' ? ['--adopt-branch', i.adoptBranch] : []),
      ...(typeof i.restart === 'string' ? ['--restart', i.restart] : []),
    ],
    describeTargets: (i) => [`EDT ${String(i.to)}`],
    safety: 'write',
  },
  {
    name: 'realign',
    description: 'Realign drifted services with their EDT branches, optionally restarting them.',
    inputSchema: {
      scope: z.enum(['none', 'edt', 'all']).optional(),
      services: z.array(safeString('service name')).optional(),
      restart: restartArg.optional(),
    },
    subcommand: 'realign',
    toArgs: (i) => [
      ...(typeof i.scope === 'string' ? ['--scope', i.scope] : []),
      ...strings(i.services).flatMap((s) => ['--service', s]),
      ...(typeof i.restart === 'string' ? ['--restart', i.restart] : []),
    ],
    describeTargets: (i) => [`scope ${typeof i.scope === 'string' ? i.scope : 'default'}`, ...strings(i.services)],
    safety: 'write',
  },
  {
    name: 'heal',
    description: 'Restart every active-EDT service that is down or unhealthy.',
    inputSchema: { restart: z.enum(['simple', 'clean']).optional() },
    subcommand: 'heal',
    toArgs: (i) => (typeof i.restart === 'string' ? ['--restart', i.restart] : []),
    describeTargets: () => ['active EDT services that are down or unhealthy'],
    safety: 'write',
  },
  {
    name: 'fire-request',
    description:
      'Fire a real HTTP request at a route of a running service (hits real endpoints with a dev-auth session) and optionally save it.',
    inputSchema: {
      repoPath: repoPathArg,
      method: safeString('HTTP method.'),
      path: safeString('Route path.').refine((v) => v.startsWith('/'), 'path must start with "/"'),
      body: bodyArg.optional(),
      query: queryArg.optional(),
      headers: headersArg.optional(),
      save: safeString('Save the request under this name after a successful fire.').optional(),
    },
    subcommand: 'fire-request',
    toArgs: (i) => [
      String(i.repoPath), String(i.method), String(i.path),
      ...requestFlags(i),
      ...(typeof i.save === 'string' ? ['--save', i.save] : []),
    ],
    redact: redactHeaders,
    describeTargets: (i) => [`${String(i.method)} ${String(i.path)} on ${String(i.repoPath)}`],
    safety: 'write',
  },
  {
    name: 'request-fire',
    description: 'Re-fire a saved request by name (hits real endpoints), optionally overriding or saving the overrides.',
    inputSchema: {
      name: safeString('Saved request name.'),
      body: bodyArg.optional(),
      query: queryArg.optional(),
      headers: headersArg.optional(),
      overwrite: z.boolean().optional(),
      saveAs: safeString('Store the overrides as a new saved request.').optional(),
    },
    subcommand: 'request-fire',
    toArgs: (i) => [
      String(i.name),
      ...requestFlags(i),
      ...(i.overwrite === true ? ['--overwrite'] : []),
      ...(typeof i.saveAs === 'string' ? ['--save-as', i.saveAs] : []),
    ],
    redact: redactHeaders,
    describeTargets: (i) => [`saved request ${String(i.name)}`, ...(i.overwrite === true ? ['(overwrites it)'] : []), ...(typeof i.saveAs === 'string' ? [`(new: ${i.saveAs})`] : [])],
    safety: 'write',
  },
];

interface StaleCandidate { path: string; reason: string; memberOfEdts: string[] }

// Validates the candidates of a `confirmation-required` preview; null when any is malformed
// (never silently dropped, since the human would approve an incomplete list). Paths are deduped.
function staleCandidates(details: unknown): StaleCandidate[] | null {
  const list = (details as { candidates?: unknown } | undefined)?.candidates;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out: StaleCandidate[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) return null;
    const c = raw as { path?: unknown; reason?: unknown; memberOfEdts?: unknown };
    if (typeof c.path !== 'string' || c.path === '' || typeof c.reason !== 'string') return null;
    if (c.memberOfEdts !== undefined && (!Array.isArray(c.memberOfEdts) || !c.memberOfEdts.every((m) => typeof m === 'string'))) return null;
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    out.push({ path: c.path, reason: c.reason, memberOfEdts: (c.memberOfEdts as string[] | undefined) ?? [] });
  }
  return out;
}

const DESTRUCTIVE_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'edt-delete',
    description: 'Delete an EDT and its stored state; per member repo, leave or delete its branch.',
    inputSchema: {
      topic: safeString('EDT topic.'),
      branches: z.array(safeString('<repoPath>=<leave|delete>').refine((v) => /^.+=(leave|delete)$/.test(v) && v.slice(0, v.lastIndexOf('=')).trim() !== '', 'must be <repoPath>=leave or <repoPath>=delete with a non-empty repoPath')).optional(),
    },
    subcommand: 'edt',
    baseArgs: ['delete'],
    toArgs: (i) => [String(i.topic), ...strings(i.branches).flatMap((b) => ['--branches', b])],
    describeTargets: (i) => [
      `DELETES EDT ${String(i.topic)} and its stored state`,
      ...(strings(i.branches).length > 0 ? [`branch dispositions: ${strings(i.branches).join(', ')} (=delete DELETES that branch)`] : ['branches: left in place unless specified']),
    ],
    safety: 'destructive',
  },
  {
    name: 'edt-switch-discard',
    description: 'Switch the active EDT and DISCARD uncommitted changes in every member repo.',
    inputSchema: {
      to: safeString('Target EDT topic.'),
      force: z.boolean().optional(),
      restart: restartArg.optional(),
    },
    subcommand: 'edt',
    baseArgs: ['switch'],
    toArgs: (i) => [
      '--to', String(i.to),
      '--discard-dirty',
      ...(i.force === true ? ['--force'] : []),
      ...(typeof i.restart === 'string' ? ['--restart', i.restart] : []),
    ],
    describeTargets: (i) => [`DISCARDS uncommitted changes in every member repo of EDT ${String(i.to)} (and the one being left)`],
    safety: 'destructive',
  },
  {
    name: 'register-reset',
    description: 'Reset a repository registration (discards its registry state).',
    inputSchema: { repoPath: repoPathArg },
    subcommand: 'register',
    baseArgs: ['--reset'],
    toArgs: (i) => [String(i.repoPath)],
    describeTargets: (i) => [`RESETS the registration of ${String(i.repoPath)}`],
    safety: 'destructive',
  },
  {
    name: 'request-delete',
    description: 'Delete a saved request by name.',
    inputSchema: { name: safeString('Saved request name.') },
    subcommand: 'request-delete',
    toArgs: (i) => [String(i.name)],
    describeTargets: (i) => [`DELETES saved request ${String(i.name)}`],
    safety: 'destructive',
  },
  {
    name: 'update',
    description:
      'Pull/merge/migrate/restart services (long-running; reports progress, stops cooperatively on cancel). mode "all" updates every managed repo.',
    inputSchema: {
      mode: z.enum(['edt', 'all', 'from-edt']).optional(),
      fromEdt: safeString('EDT topic to take the selection from (mode from-edt).').optional(),
      runMigrations: z.boolean().optional(),
      cleanRestart: z.boolean().optional(),
    },
    // fromEdt is required for (and only valid with) mode "from-edt".
    validateInput: (i) => {
      if (i.mode === 'from-edt' && (typeof i.fromEdt !== 'string' || i.fromEdt.trim() === '')) return 'fromEdt is required when mode is "from-edt"';
      if (i.mode !== 'from-edt' && i.fromEdt !== undefined) return 'fromEdt is only allowed when mode is "from-edt"';
      return undefined;
    },
    subcommand: 'update',
    toArgs: (i) => [
      ...(i.mode === 'all' ? ['--all', '--yes'] : []),
      ...(i.mode === 'from-edt' ? ['--from-edt', typeof i.fromEdt === 'string' ? i.fromEdt : ''] : []),
      ...(i.runMigrations === undefined ? [] : [i.runMigrations === true ? '--migrations' : '--no-migrations']),
      ...(i.cleanRestart === undefined ? [] : [i.cleanRestart === true ? '--clean-restart' : '--no-clean-restart']),
    ],
    describeTargets: (i) => [
      i.mode === 'all'
        ? 'UPDATES EVERY managed repo (merges upstream, may run migrations and restart services)'
        : i.mode === 'from-edt'
          ? `UPDATES the services of EDT ${String(i.fromEdt)} (merges upstream, may run migrations and restart services)`
          : 'UPDATES the active EDT services (merges upstream, may run migrations and restart services)',
      ...(i.runMigrations === false ? ['migrations skipped'] : []),
      ...(i.cleanRestart === true ? ['clean restart'] : []),
    ],
    safety: 'destructive',
  },
  {
    name: 'registry-clean',
    description: 'Remove stale registry entries. The stale entries are previewed in the approval prompt; only those are removed.',
    inputSchema: {},
    subcommand: 'registry',
    baseArgs: ['clean'],
    prepare: async (_input, exec) => {
      const preview = await exec(['clean']);
      if (preview.ok) {
        // No stale entries: the usual envelope, nothing to approve.
        return ok({ done: preview });
      }
      if (preview.error.code !== 'confirmation-required') {
        return ok({ done: preview });
      }
      const candidates = staleCandidates(preview.error.details);
      if (candidates === null) {
        return err('internal-error', 'registry clean returned malformed stale-entry candidates; nothing was removed.');
      }
      if (candidates.length === 0) {
        return ok({ done: preview });
      }
      return ok({
        targets: candidates.map(
          (c) => `REMOVES registry entry ${c.path} — ${c.reason}${c.memberOfEdts.length > 0 ? ` [member of EDT: ${c.memberOfEdts.join(', ')}]` : ''}`,
        ),
        argv: ['clean', '--yes', ...candidates.flatMap((c) => ['--path', c.path])],
      });
    },
    safety: 'destructive',
  },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'dashboard',
    description: 'Snapshot of the active EDT services with their health-first status and registry health.',
    inputSchema: {},
    subcommand: 'dashboard',
    safety: 'read',
  },
  {
    name: 'edts',
    description: "Every managed service's current branch and ahead/behind divergence from its upstream.",
    inputSchema: {},
    subcommand: 'edts',
    safety: 'read',
  },
  {
    name: 'list-repos',
    description: 'List the registered repositories.',
    inputSchema: {},
    subcommand: 'list-repos',
    safety: 'read',
  },
  {
    name: 'list-routes',
    description: "List the HTTP routes found in a repository (requires its manifest's routes module).",
    inputSchema: { repoPath: repoPathArg.optional() },
    subcommand: 'list-routes',
    toArgs: (input) => (typeof input.repoPath === 'string' ? [input.repoPath] : []),
    safety: 'read',
  },
  {
    name: 'request-list',
    description: 'List saved requests, optionally narrowed to one repository.',
    inputSchema: { repoPath: repoPathArg.optional() },
    subcommand: 'request-list',
    toArgs: (input) => (typeof input.repoPath === 'string' ? ['--repo', input.repoPath] : []),
    safety: 'read',
  },
  {
    name: 'ping',
    description: 'Liveness check of the tui-back workspace.',
    inputSchema: {},
    subcommand: 'ping',
    safety: 'read',
  },
  {
    name: 'registry-validate',
    description: 'Validate the repository registry (read-only).',
    inputSchema: {},
    subcommand: 'registry',
    baseArgs: ['validate'],
    safety: 'read',
  },
  ...WRITE_DEFINITIONS,
  ...DESTRUCTIVE_DEFINITIONS,
];

export function buildToolRegistry(
  subcommands: Subcommand[],
  definitions: ToolDefinition[] = TOOL_DEFINITIONS,
): RegisteredTool[] {
  const seen = new Set<string>();
  return definitions.map((definition) => {
    if (definition.safety === undefined || !SAFETY_CLASSES.includes(definition.safety)) {
      throw new Error(`MCP tool "${definition.name}" has no valid safety class (read | write | destructive)`);
    }
    if (seen.has(definition.name)) {
      throw new Error(`Duplicate MCP tool name "${definition.name}"`);
    }
    seen.add(definition.name);
    const target = subcommands.find((candidate) => candidate.name === definition.subcommand);
    if (target === undefined) {
      throw new Error(`MCP tool "${definition.name}" wraps unknown subcommand "${definition.subcommand}"`);
    }
    const safety = definition.safety;
    const exec = (argv: string[], ctx?: ToolRunContext): Promise<Result<unknown>> => {
      const subCtx: SubcommandContext = {
        ...(ctx?.signal === undefined ? {} : { signal: ctx.signal }),
        ...(ctx?.onProgress === undefined ? {} : { onPhase: (service: string, phase: string) => ctx.onProgress?.(`${service}: ${phase}`) }),
      };
      return Object.keys(subCtx).length === 0 ? target.run(argv) : target.run(argv, subCtx);
    };
    const { prepare: definitionPrepare, ...rest } = definition;
    return {
      ...rest,
      safety,
      ...(definitionPrepare === undefined
        ? {}
        : {
            prepare: async (input: Record<string, unknown>, ctx?: ToolRunContext) => {
              try {
                return await definitionPrepare(input, (argv) => exec(argv, ctx));
              } catch (error) {
                console.error(error);
                return err('internal-error', String(error));
              }
            },
          }),
      run: async (input, ctx) => {
        try {
          return await exec(ctx?.argv ?? [...(definition.baseArgs ?? []), ...(definition.toArgs?.(input) ?? [])], ctx);
        } catch (error) {
          console.error(error);
          return err('internal-error', String(error));
        }
      },
    };
  });
}
