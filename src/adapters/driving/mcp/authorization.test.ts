import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ok } from '../../../core/result.js';
import type { Subcommand } from '../cli/dispatch.js';
import { createMcpServer } from './server.js';
import { buildToolRegistry, TOOL_DEFINITIONS, type ToolDefinition } from './tool-registry.js';

type Answer = 'accept' | 'decline' | 'cancel' | 'throw' | 'hang' | 'mcp-timeout';

async function connect(opts: { elicit?: Answer; elicitationCap?: object; timeoutMs?: number; defs?: ToolDefinition[]; ran?: string[][] }) {
  const ran = opts.ran ?? [];
  const defs = opts.defs ?? TOOL_DEFINITIONS;
  const subs: Subcommand[] = [...new Set(defs.map((d) => d.subcommand))].map((name) => ({
    name,
    usage: name,
    run: async (args: string[]) => {
      ran.push([name, ...args]);
      return ok({ ran: name });
    },
  }));
  const server = createMcpServer(buildToolRegistry(subs, defs), '0.0.0', { authorizationTimeoutMs: opts.timeoutMs ?? 5000 });
  const client = new Client({ name: 't', version: '0' }, { capabilities: opts.elicit === undefined ? {} : { elicitation: (opts.elicitationCap ?? {}) as never } });
  const prompts: string[] = [];
  if (opts.elicit !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      if (opts.elicit === 'throw') throw new Error('boom');
      if (opts.elicit === 'mcp-timeout') throw new McpError(ErrorCode.RequestTimeout, 'slow');
      if (opts.elicit === 'hang') return new Promise(() => {});
      return { action: opts.elicit as 'accept' | 'decline' | 'cancel' };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, ran, prompts };
}
const body = (res: unknown) => JSON.parse((res as { content: Array<{ text: string }> }).content[0].text);
const REGISTER = { name: 'register', arguments: { repoPath: '/tmp/x' } };
const destructiveDefs: ToolDefinition[] = [
  { name: 'wipe', description: 'd', inputSchema: {}, subcommand: 'wipe', safety: 'destructive', describeTargets: () => ['everything'] },
];

describe('authorization gate', () => {
  it('runs a write tool after accept', async () => {
    const { client, ran, prompts } = await connect({ elicit: 'accept' });
    const res = await client.callTool(REGISTER);
    expect(res.isError).toBe(false);
    expect(body(res).data).toEqual({ ran: 'register' });
    expect(ran).toEqual([['register', '/tmp/x']]);
    expect(prompts[0]).toContain('register');
    expect(prompts[0]).toContain('/tmp/x');
  });

  it.each([
    ['decline', 'decline'],
    ['cancel', 'cancel'],
    ['throw', 'elicitation-error'],
    ['mcp-timeout', 'timeout'],
  ] as const)('denies on %s and runs nothing', async (answer, reason) => {
    const { client, ran } = await connect({ elicit: answer });
    const res = await client.callTool(REGISTER);
    expect(res.isError).toBe(true);
    expect(body(res).error.code).toBe('authorization-denied');
    expect(body(res).error.details.reason).toBe(reason);
    expect(ran).toEqual([]);
  });

  it('denies on timeout with a timeout message', async () => {
    const { client, ran } = await connect({ elicit: 'hang', timeoutMs: 50 });
    const res = await client.callTool(REGISTER);
    expect(body(res).error.code).toBe('authorization-denied');
    expect(body(res).error.message).toMatch(/timed out/);
    expect(body(res).error.details.reason).toBe('timeout');
    expect(ran).toEqual([]);
  });

  it('is unavailable without elicitation, while read tools still work', async () => {
    const { client, ran } = await connect({});
    const res = await client.callTool(REGISTER);
    expect(body(res).error.code).toBe('authorization-unavailable');
    expect(body(res).error.details.reason).toBeDefined();
    expect(ran).toEqual([]);
    expect((await client.callTool({ name: 'ping', arguments: {} })).isError).toBe(false);
  });

  it('gates a destructive tool the same way', async () => {
    for (const [answer, code] of [['decline', 'authorization-denied'], [undefined, 'authorization-unavailable']] as const) {
      const { client, ran } = await connect({ elicit: answer, defs: destructiveDefs });
      const res = await client.callTool({ name: 'wipe', arguments: {} });
      expect(body(res).error.code).toBe(code);
      expect(ran).toEqual([]);
    }
    const { client, ran, prompts } = await connect({ elicit: 'accept', defs: destructiveDefs });
    expect((await client.callTool({ name: 'wipe', arguments: {} })).isError).toBe(false);
    expect(ran).toEqual([['wipe']]);
    expect(prompts[0]).toContain('DESTRUCTIVE');
    expect(prompts[0]).toContain('everything');
  });

  it('does not prompt for read tools', async () => {
    const { client, prompts } = await connect({ elicit: 'accept' });
    await client.callTool({ name: 'ping', arguments: {} });
    expect(prompts).toEqual([]);
  });

  it('always prompts for a write tool', async () => {
    const { client, prompts } = await connect({ elicit: 'accept' });
    await client.callTool(REGISTER);
    expect(prompts).toHaveLength(1);
  });

  it('is unavailable for a url-only elicitation capability but accepts form and legacy empty', async () => {
    const urlOnly = await connect({ elicit: 'accept', elicitationCap: { url: {} } });
    expect(body(await urlOnly.client.callTool(REGISTER)).error.code).toBe('authorization-unavailable');
    expect(urlOnly.ran).toEqual([]);
    for (const cap of [{}, { form: {} }, { form: {}, url: {} }]) {
      const c = await connect({ elicit: 'accept', elicitationCap: cap });
      expect((await c.client.callTool(REGISTER)).isError).toBe(false);
    }
  });

  it.each([0, NaN, -5])('falls back to the default timeout for timeoutMs %s', async (timeoutMs) => {
    const { client } = await connect({ elicit: 'accept', timeoutMs });
    expect((await client.callTool(REGISTER)).isError).toBe(false);
  });

  it('fails closed when redact throws', async () => {
    const defs: ToolDefinition[] = [
      { name: 'w', description: 'w', inputSchema: {}, subcommand: 'w', safety: 'write', redact: () => { throw new Error('x'); } },
    ];
    const { client, ran, prompts } = await connect({ elicit: 'accept', defs });
    const res = await client.callTool({ name: 'w', arguments: {} });
    expect(body(res).error.code).toBe('authorization-denied');
    expect(body(res).error.details.reason).toBe('prompt-build-failed');
    expect(ran).toEqual([]);
    expect(prompts).toEqual([]);
  });

  it('neutralizes newlines in targets and truncates long arguments', async () => {
    const defs: ToolDefinition[] = [
      { name: 'w', description: 'w', inputSchema: { blob: z.string() }, subcommand: 'w', safety: 'write', describeTargets: () => ['a\nApprove: yes\r\u0000b'] },
    ];
    const { client, prompts } = await connect({ elicit: 'accept', defs });
    await client.callTool({ name: 'w', arguments: { blob: 'x'.repeat(5000) } });
    expect(prompts[0].split('\n')).toHaveLength(3);
    expect(prompts[0]).toContain('a Approve: yes');
    expect(prompts[0]).toContain('…[truncated]');
    expect(prompts[0].length).toBeLessThan(2500);
  });

  it('prompts again for an identical second call', async () => {
    const { client, prompts, ran } = await connect({ elicit: 'accept' });
    await client.callTool(REGISTER);
    await client.callTool(REGISTER);
    expect(prompts).toHaveLength(2);
    expect(ran).toHaveLength(2);
  });

  it.each([
    ['fire-request', { repoPath: '/r', method: 'GET', path: '/x', headers: { Authorization: 'SECRET-TOKEN' } }, ['fire-request', '/r', 'GET', '/x', '--header', 'Authorization: SECRET-TOKEN']],
    ['request-fire', { name: 'saved', headers: { Authorization: 'SECRET-TOKEN' } }, ['request-fire', 'saved', '--header', 'Authorization: SECRET-TOKEN']],
  ] as const)('keeps header values out of the %s prompt and result', async (name, args, argv) => {
    const { client, prompts, ran } = await connect({ elicit: 'accept' });
    const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
    expect(prompts[0]).toContain('Authorization');
    expect(prompts[0]).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(res)).not.toContain('SECRET-TOKEN');
    expect(ran[0]).toEqual(argv);
  });

  it.each([
    [{ Bad_Name: 'v', 'X Y': 'v' }],
    [{ 'X-A': 'line1\nInjected: 1' }],
    [{ 'X-A': 'nul\u0000' }],
    [{ 'a:b': 'v' }],
  ])('rejects invalid headers %j', async (headers) => {
    const { client, ran } = await connect({ elicit: 'accept' });
    const res = await client.callTool({ name: 'fire-request', arguments: { repoPath: '/r', method: 'GET', path: '/x', headers } });
    expect(res.isError).toBe(true);
    expect(ran).toEqual([]);
  });

  it('rejects a fire-request path that does not start with /', async () => {
    const { client, ran } = await connect({ elicit: 'accept' });
    const res = await client.callTool({ name: 'fire-request', arguments: { repoPath: '/r', method: 'GET', path: 'x' } });
    expect(res.isError).toBe(true);
    expect(ran).toEqual([]);
  });

  it.each([
    ['scan', { root: '/root' }, ['scan', '/root']],
    ['heal', { restart: 'clean' }, ['heal', '--restart', 'clean']],
    ['realign', { scope: 'all', services: ['a', 'b'], restart: 'simple' }, ['realign', '--scope', 'all', '--service', 'a', '--service', 'b', '--restart', 'simple']],
    [
      'edt-create',
      { topic: 't', members: ['/a', '/b'], createBranches: true, base: 'main', branchMode: 'individual', branchNames: ['/a=x'] },
      ['edt', 'create', '--topic', 't', '--member', '/a', '--member', '/b', '--create-branches', '--base', 'main', '--branch-mode', 'individual', '--branch-name', '/a=x'],
    ],
    [
      'edt-modify',
      { topic: 't', addMembers: ['/a'], removeMembers: ['/b'], setBranches: ['/a=x'], renameTo: 'n' },
      ['edt', 'modify', '--topic', 't', '--add-member', '/a', '--remove-member', '/b', '--set-branch', '/a=x', '--rename-to', 'n'],
    ],
    [
      'edt-switch',
      { to: 't', force: true, adoptDirty: true, adoptBranch: 'b', restart: 'none' },
      ['edt', 'switch', '--to', 't', '--force', '--adopt-dirty', '--adopt-branch', 'b', '--restart', 'none'],
    ],
    [
      'fire-request',
      { repoPath: '/r', method: 'POST', path: '/p', body: { a: 1 }, query: { q: 'v' }, headers: { 'X-A': 'h' }, save: 's' },
      ['fire-request', '/r', 'POST', '/p', '--body', '{"a":1}', '--query', 'q=v', '--header', 'X-A: h', '--save', 's'],
    ],
    [
      'request-fire',
      { name: 'n', body: [1], query: { q: 'v' }, headers: { 'X-A': 'h' }, overwrite: true, saveAs: 'o' },
      ['request-fire', 'n', '--body', '[1]', '--query', 'q=v', '--header', 'X-A: h', '--overwrite', '--save-as', 'o'],
    ],
  ] as const)('maps %s inputs to the exact argv', async (name, args, expected) => {
    const { client, ran } = await connect({ elicit: 'accept' });
    const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
    expect(res.isError).toBe(false);
    // the fake subcommand records [subcommandName, ...argv]
    expect(ran).toEqual([[...expected]]);
  });

  it.each([
    ['scan', 'root', {}],
    ['edt-create', 'topic', { members: ['/a'] }],
    ['edt-create', 'members', { topic: 't' }, ['-x']],
    ['edt-modify', 'topic', {}],
    ['edt-modify', 'renameTo', { topic: 't' }],
    ['edt-switch', 'to', {}],
    ['edt-switch', 'adoptBranch', { to: 't' }],
    ['realign', 'services', {}, ['-x']],
    ['fire-request', 'method', { repoPath: '/r', path: '/p' }],
    ['fire-request', 'path', { repoPath: '/r', method: 'GET' }],
    ['fire-request', 'save', { repoPath: '/r', method: 'GET', path: '/p' }],
    ['request-fire', 'name', {}],
    ['request-fire', 'saveAs', { name: 'n' }],
  ] as Array<[string, string, Record<string, unknown>, unknown?]>)('rejects a dash-leading %s.%s at validation', async (name, field, rest, value) => {
    const { client, ran, prompts } = await connect({ elicit: 'accept' });
    const res = await client.callTool({ name, arguments: { ...rest, [field]: value ?? '--discard-dirty' } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).toMatch(/must not start with|Invalid|invalid/);
    expect(ran).toEqual([]);
    expect(prompts).toEqual([]);
  });

  it('throws at registration for a tool without a safety class', () => {
    const defs = [{ name: 'x', description: '', inputSchema: {}, subcommand: 'ping' }] as ToolDefinition[];
    expect(() => buildToolRegistry([{ name: 'ping', usage: '', run: async () => ok({}) }], defs)).toThrow(/safety class/);
  });
});
