import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { err, ok } from '../../../core/result.js';
import type { Subcommand } from '../cli/dispatch.js';
import { createMcpServer } from './server.js';
import { buildToolRegistry, TOOL_DEFINITIONS } from './tool-registry.js';

async function connect(subs: Subcommand[]) {
  const server = createMcpServer(buildToolRegistry(subs), "0.0.0");
  const client = new Client({ name: 't', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const names = TOOL_DEFINITIONS.map((d) => d.subcommand).filter((n, i, a) => a.indexOf(n) === i);

describe('createMcpServer', () => {
  it('lists the read tools with readOnlyHint and a safety class', async () => {
    const client = await connect(names.map((n) => ({ name: n, usage: n, run: async () => ok({}) })));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_DEFINITIONS.length);
    for (const tool of tools) {
      const safety = TOOL_DEFINITIONS.find((d) => d.name === tool.name)?.safety;
      expect(tool._meta?.safety).toBe(safety);
      expect(tool.annotations?.readOnlyHint).toBe(safety === 'read');
    }
    expect(tools.some((t) => t._meta?.safety === 'write')).toBe(true);
  });

  it('returns the envelope as JSON text, isError false on success', async () => {
    const client = await connect(allSubs({ 'list-repos': async () => ok([{ id: 1 }]) }));
    const res = await client.callTool({ name: 'list-repos', arguments: {} });
    expect(res.isError).toBe(false);
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toEqual({ ok: true, data: [{ id: 1 }] });
  });

  it('passes a command error envelope through with isError true', async () => {
    const client = await connect(allSubs({ 'list-routes': async () => err('missing-argument', 'Usage') }));
    const res = await client.callTool({ name: 'list-routes', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text).error.code).toBe('missing-argument');
  });

  it('survives a throwing handler with an internal-error envelope', async () => {
    const client = await connect(allSubs({ ping: async () => { throw new Error('boom'); } }));
    const res = await client.callTool({ name: 'ping', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text).error.code).toBe('internal-error');
    expect((await client.callTool({ name: 'edts', arguments: {} })).isError).toBe(false);
  });
});

describe('createMcpServer robustness', () => {
  it.each([[null], [undefined], [{ data: 1 }]])('maps a non-Result value %j to internal-error', async (value) => {
    const client = await connect(allSubs({ ping: (async () => value) as never }));
    const res = await client.callTool({ name: 'ping', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text).error.code).toBe('internal-error');
  });

  it('maps an unserializable result to a generic internal-error without detail', async () => {
    const client = await connect(allSubs({ ping: async () => ok(10n) }));
    const res = await client.callTool({ name: 'ping', arguments: {} });
    const body = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(res.isError).toBe(true);
    expect(body.error.code).toBe('internal-error');
    expect(body.error.message).not.toMatch(/BigInt/);
  });

  it.each(['', '-rf', '--repo'])('rejects repoPath %j at the schema level', async (repoPath) => {
    const client = await connect(allSubs({}));
    for (const name of ['list-routes', 'request-list']) {
      const res = await client.callTool({ name, arguments: { repoPath } }).catch(() => ({ isError: true }));
      expect(res.isError).toBe(true);
    }
  });
});

function allSubs(overrides: Record<string, Subcommand['run']>): Subcommand[] {
  return names.map((n) => ({
    name: n,
    usage: n,
    run: overrides[n] ?? (async () => ok({})),
  }));
}
