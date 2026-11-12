// adapters/driving/mcp/tool-registry: declarative MCP tool table. Each entry wraps one CLI
// subcommand (name + argv mapping) and MUST declare a safety class; registering a tool without
// one throws at startup (fail fast). The class here is authoritative — MCP annotations derived
// from it are advisory hints for clients only.
import { z } from 'zod';
import { err, type Result } from '../../../core/result.js';
import type { Subcommand } from '../cli/dispatch.js';

export type SafetyClass = 'read' | 'write' | 'destructive';
const SAFETY_CLASSES: readonly string[] = ['read', 'write', 'destructive'];

export interface ToolDefinition {
  name: string;
  description: string;
  /** zod raw shape of the tool's input object. */
  inputSchema: z.ZodRawShape;
  /** Name of the wrapped registry subcommand. */
  subcommand: string;
  /** Fixed argv prefix placed before the mapped input args (e.g. ['registry', 'validate']). */
  baseArgs?: string[];
  /** Maps the validated input to argv for the wrapped subcommand. */
  toArgs?: (input: Record<string, unknown>) => string[];
  safety?: SafetyClass;
  /** Repos / EDTs this call affects, shown in the authorization prompt. */
  describeTargets?: (input: Record<string, unknown>) => string[];
  /** Returns the input as shown to the human: secrets (header values) removed. */
  redact?: (input: Record<string, unknown>) => Record<string, unknown>;
}

export interface RegisteredTool extends ToolDefinition {
  safety: SafetyClass;
  run: (input: Record<string, unknown>) => Promise<Result<unknown>>;
}

/** Subcommands deliberately not exposed as tools, with the reason (checked by the e2e guard). */
export const EXCLUDED_SUBCOMMANDS: Record<string, string> = {
  tui: 'interactive terminal UI, not scriptable',
  mcp: 'the MCP server itself',
  completion: 'shell completion script, meaningless to an agent',
  install: 'installer; handled outside MCP (registration commands are printed, not served)',
  // `edt` is wrapped by edt-create / edt-modify / edt-switch; `edt delete` (destructive) is not a tool yet.
  // Destructive tools and the long-running update arrive later, behind the same gate.
  update: 'long-running destructive tool, deferred',
  'request-delete': 'destructive tool, deferred',
  // `registry` is exposed only through its read verb `registry-validate`; `registry clean`
  // prompts on stdin and writes, so it is never a tool.
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
const headersArg = z.record(z.string().min(1).refine((n) => !n.startsWith('-') && !n.includes(':'), 'invalid header name'), z.string())
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
    baseArgs: ['edt', 'create'],
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
    baseArgs: ['edt', 'modify'],
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
    baseArgs: ['edt', 'switch'],
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
      path: safeString('Route path.'),
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
    baseArgs: ['registry', 'validate'],
    safety: 'read',
  },
  ...WRITE_DEFINITIONS,
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
    return {
      ...definition,
      safety,
      run: async (input) => {
        try {
          return await target.run([...(definition.baseArgs ?? []), ...(definition.toArgs?.(input) ?? [])]);
        } catch (error) {
          console.error(error);
          return err('internal-error', String(error));
        }
      },
    };
  });
}
