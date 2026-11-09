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
  // Write/destructive subcommands arrive later behind the authorization gate.
  register: 'write tool, deferred (MCP write tools)',
  scan: 'write tool, deferred (MCP write tools)',
  edt: 'write tool, deferred (MCP write tools)',
  update: 'write tool, deferred (MCP write tools)',
  realign: 'write tool, deferred (MCP write tools)',
  heal: 'write tool, deferred (MCP write tools)',
  'fire-request': 'hits real endpoints; deferred (MCP write tools)',
  'request-fire': 'hits real endpoints; deferred (MCP write tools)',
  'request-delete': 'destructive tool, deferred (MCP write tools)',
  // `registry` is exposed only through its read verb `registry-validate`; `registry clean`
  // prompts on stdin and writes, so it is never a tool.
};

// A leading '-' would be parsed as a flag by the wrapped CLI (argument injection).
export const repoPathArg = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('-'), 'repoPath must not start with "-"')
  .describe('Path to a repository directory.');

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
