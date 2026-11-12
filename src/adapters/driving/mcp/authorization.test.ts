import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ok } from '../../../core/result.js';
import type { Subcommand } from '../cli/dispatch.js';
import { createMcpServer } from './server.js';
import { buildToolRegistry, TOOL_DEFINITIONS, type ToolDefinition } from './tool-registry.js';

type Answer = 'accept' | 'decline' | 'cancel' | 'throw' | 'hang';

async function connect(opts: { elicit?: Answer; timeoutMs?: number; defs?: ToolDefinition[]; ran?: string[][] }) {
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
  const client = new Client({ name: 't', version: '0' }, { capabilities: opts.elicit === undefined ? {} : { elicitation: {} } });
  const prompts: string[] = [];
  if (opts.elicit !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      if (opts.elicit === 'throw') throw new Error('boom');
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

  it.each(['decline', 'cancel', 'throw'] as const)('denies on %s and runs nothing', async (answer) => {
    const { client, ran } = await connect({ elicit: answer });
    const res = await client.callTool(REGISTER);
    expect(res.isError).toBe(true);
    expect(body(res).error.code).toBe('authorization-denied');
    expect(ran).toEqual([]);
  });

  it('denies on timeout with a timeout message', async () => {
    const { client, ran } = await connect({ elicit: 'hang', timeoutMs: 50 });
    const res = await client.callTool(REGISTER);
    expect(body(res).error.code).toBe('authorization-denied');
    expect(body(res).error.message).toMatch(/timed out/);
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

  it('does not bypass the gate for read tools and never skips it', async () => {
    const { client, prompts } = await connect({ elicit: 'accept' });
    await client.callTool({ name: 'ping', arguments: {} });
    expect(prompts).toEqual([]);
  });

  it('prompts again for an identical second call', async () => {
    const { client, prompts, ran } = await connect({ elicit: 'accept' });
    await client.callTool(REGISTER);
    await client.callTool(REGISTER);
    expect(prompts).toHaveLength(2);
    expect(ran).toHaveLength(2);
  });

  it('keeps header values out of the prompt and result', async () => {
    const { client, prompts, ran } = await connect({ elicit: 'accept' });
    const res = await client.callTool({
      name: 'fire-request',
      arguments: { repoPath: '/r', method: 'GET', path: '/x', headers: { Authorization: 'SECRET-TOKEN' } },
    });
    expect(prompts[0]).toContain('Authorization');
    expect(prompts[0]).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(res)).not.toContain('SECRET-TOKEN');
    expect(ran[0]).toEqual(['fire-request', '/r', 'GET', '/x', '--header', 'Authorization: SECRET-TOKEN']);
  });

  it('rejects flag-like string arguments', async () => {
    const { client, ran } = await connect({ elicit: 'accept' });
    const res = await client.callTool({ name: 'edt-switch', arguments: { to: '--discard-dirty' } }).catch(() => ({ isError: true }));
    expect(res.isError).toBe(true);
    expect(ran).toEqual([]);
  });

  it('throws at registration for a tool without a safety class', () => {
    const defs = [{ name: 'x', description: '', inputSchema: {}, subcommand: 'ping' }] as ToolDefinition[];
    expect(() => buildToolRegistry([{ name: 'ping', usage: '', run: async () => ok({}) }], defs)).toThrow(/safety class/);
  });
});
