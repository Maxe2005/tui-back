import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { err, ok, type Result } from '../../../core/result.js';
import type { Subcommand, SubcommandContext } from '../cli/dispatch.js';
import { createMcpServer } from './server.js';
import { buildToolRegistry, TOOL_DEFINITIONS } from './tool-registry.js';

type Handler = (args: string[], ctx?: SubcommandContext) => Promise<Result<unknown>>;

async function connect(opts: { elicit?: 'accept' | 'decline'; handlers?: Record<string, Handler> }) {
  const ran: string[][] = [];
  const names = [...new Set(TOOL_DEFINITIONS.map((d) => d.subcommand))];
  const subs: Subcommand[] = names.map((name) => ({
    name,
    usage: name,
    run: async (args, ctx) => {
      ran.push([name, ...args]);
      return opts.handlers?.[name] !== undefined ? opts.handlers[name](args, ctx) : ok({ ran: name });
    },
  }));
  const server = createMcpServer(buildToolRegistry(subs), '0.0.0', { authorizationTimeoutMs: 5000 });
  const client = new Client({ name: 't', version: '0' }, { capabilities: opts.elicit === undefined ? {} : { elicitation: {} } });
  const prompts: string[] = [];
  if (opts.elicit !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return { action: opts.elicit as 'accept' | 'decline' };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, ran, prompts };
}
const body = (res: unknown) => JSON.parse((res as { content: Array<{ text: string }> }).content[0].text);

const CASES: Array<[string, Record<string, unknown>, string[], string]> = [
  ['edt-delete', { topic: 'feat', branches: ['/r/a=delete', '/r/b=leave'] }, ['edt', 'delete', 'feat', '--branches', '/r/a=delete', '--branches', '/r/b=leave'], 'DELETES EDT feat'],
  ['edt-switch-discard', { to: 'feat', force: true, restart: 'simple' }, ['edt', 'switch', '--to', 'feat', '--discard-dirty', '--force', '--restart', 'simple'], 'DISCARDS uncommitted changes'],
  ['register-reset', { repoPath: '/r/a' }, ['register', '--reset', '/r/a'], '/r/a'],
  ['request-delete', { name: 'req1' }, ['request-delete', 'req1'], 'req1'],
  ['update', { mode: 'all', runMigrations: false, cleanRestart: true }, ['update', '--all', '--yes', '--no-migrations', '--clean-restart'], 'EVERY managed repo'],
  ['update', { mode: 'from-edt', fromEdt: 'feat' }, ['update', '--from-edt', 'feat'], 'EDT feat'],
];

describe('destructive tools', () => {
  it('advertises destructiveHint', async () => {
    const { client } = await connect({});
    const tools = (await client.listTools()).tools;
    for (const name of ['edt-delete', 'edt-switch-discard', 'register-reset', 'request-delete', 'update', 'registry-clean']) {
      expect(tools.find((t) => t.name === name)?.annotations?.destructiveHint).toBe(true);
    }
  });

  it.each(CASES)('%s prompts and runs only on accept with exact argv', async (name, args, argv, promptPart) => {
    const accepted = await connect({ elicit: 'accept' });
    expect((await accepted.client.callTool({ name, arguments: args })).isError).toBe(false);
    expect(accepted.ran).toEqual([argv]);
    expect(accepted.prompts[0]).toContain(promptPart);
    const declined = await connect({ elicit: 'decline' });
    expect(body(await declined.client.callTool({ name, arguments: args })).error.code).toBe('authorization-denied');
    expect(declined.ran).toEqual([]);
    const none = await connect({});
    expect(body(await none.client.callTool({ name, arguments: args })).error.code).toBe('authorization-unavailable');
    expect(none.ran).toEqual([]);
  });

  it('does not reuse approval across identical calls', async () => {
    const { client, prompts } = await connect({ elicit: 'accept' });
    await client.callTool({ name: 'request-delete', arguments: { name: 'x' } });
    await client.callTool({ name: 'request-delete', arguments: { name: 'x' } });
    expect(prompts).toHaveLength(2);
  });

  it('rejects flag-injection in string arguments', async () => {
    const { client, ran } = await connect({ elicit: 'accept' });
    for (const [name, args] of [['edt-delete', { topic: '--x' }], ['request-delete', { name: '--x' }], ['update', { mode: 'from-edt', fromEdt: '--all' }], ['register-reset', { repoPath: '--x' }]] as const) {
      const res = await client.callTool({ name, arguments: args }).catch(() => ({ isError: true }));
      expect(res.isError).toBe(true);
    }
    expect(ran).toEqual([]);
  });

  it('surfaces a held lock as an error envelope', async () => {
    const { client } = await connect({ elicit: 'accept', handlers: { update: async () => err('lock-held', 'held') } });
    const res = await client.callTool({ name: 'update', arguments: {} });
    expect(res.isError).toBe(true);
    expect(body(res).error.code).toBe('lock-held');
  });

  it('update emits strictly increasing progress when a token is sent, none otherwise', async () => {
    const handlers: Record<string, Handler> = {
      update: async (_a, ctx) => {
        ctx?.onPhase?.('svc-a', 'pulling');
        ctx?.onPhase?.('svc-a', 'restarting');
        return ok({});
      },
    };
    const { client } = await connect({ elicit: 'accept', handlers });
    const seen: Array<{ progress: number; message?: string }> = [];
    await client.callTool({ name: 'update', arguments: {} }, undefined, { onprogress: (p) => seen.push(p) });
    expect(seen.map((p) => p.message)).toEqual(['svc-a: pulling', 'svc-a: restarting']);
    expect(seen[1].progress).toBeGreaterThan(seen[0].progress);
    const plain = await connect({ elicit: 'accept', handlers });
    expect((await plain.client.callTool({ name: 'update', arguments: {} })).isError).toBe(false);
  });

  it('update receives an abort signal that fires on client cancel', async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const handlers: Record<string, Handler> = {
      update: async (_a, ctx) => {
        signal = ctx?.signal;
        started();
        await new Promise<void>((r) => setTimeout(r, 300));
        return ok({ cancelled: signal?.aborted === true });
      },
    };
    const { client } = await connect({ elicit: 'accept', handlers });
    const ac = new AbortController();
    const call = client.callTool({ name: 'update', arguments: {} }, undefined, { signal: ac.signal }).catch(() => undefined);
    await startedP;
    ac.abort();
    await call;
    await new Promise((r) => setTimeout(r, 50));
    expect(signal?.aborted).toBe(true);
  });
});

describe('input validation and cancellation', () => {
  it('update requires fromEdt for from-edt and rejects it otherwise', async () => {
    const { client, ran } = await connect({ elicit: 'accept' });
    for (const args of [{ mode: 'from-edt' }, { mode: 'from-edt', fromEdt: ' ' }, { mode: 'all', fromEdt: 'x' }, { fromEdt: 'x' }]) {
      const res = await client.callTool({ name: 'update', arguments: args });
      expect(res.isError).toBe(true);
      expect(body(res).error.code).toBe('invalid-argument');
    }
    expect(ran).toEqual([]);
  });

  it('edt-delete rejects a branches entry with an empty path', async () => {
    const { client, ran } = await connect({ elicit: 'accept' });
    for (const b of ['=delete', ' =leave']) {
      const res = await client.callTool({ name: 'edt-delete', arguments: { topic: 't', branches: [b] } }).catch(() => ({ isError: true }));
      expect(res.isError).toBe(true);
    }
    expect(ran).toEqual([]);
  });

  it('returns a cancelled envelope without running when aborted during the approval', async () => {
    const ran: string[][] = [];
    const subs: Subcommand[] = [...new Set(TOOL_DEFINITIONS.map((d) => d.subcommand))].map((name) => ({
      name, usage: name, run: async (args: string[]) => { ran.push([name, ...args]); return ok({}); },
    }));
    const server = createMcpServer(buildToolRegistry(subs), '0.0.0', {
      gate: { authorize: async () => { await new Promise((r) => setTimeout(r, 150)); return ok(undefined); } },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' }, { capabilities: {} });
    await Promise.all([server.connect(a), client.connect(b)]);
    const gateAbort = new AbortController();
    const call = client.callTool({ name: 'request-delete', arguments: { name: 'x' } }, undefined, { signal: gateAbort.signal }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    gateAbort.abort();
    await call;
    await new Promise((r) => setTimeout(r, 250));
    expect(ran).toEqual([]);
  });
});

describe('registry-clean', () => {
  const candidates = [
    { path: '/r/gone', reason: 'path missing', memberOfEdts: ['feat'] },
    { path: '/r/old', reason: 'no manifest', memberOfEdts: [] },
  ];
  const preview: Handler = async (args) =>
    args.includes('--yes') ? ok({ results: [] }) : err('confirmation-required', 'stale', { candidates, errors: [] });

  it('lists candidates in the prompt and removes exactly those paths', async () => {
    const { client, ran, prompts } = await connect({ elicit: 'accept', handlers: { registry: preview } });
    const res = await client.callTool({ name: 'registry-clean', arguments: {} });
    expect(res.isError).toBe(false);
    expect(prompts[0]).toContain('/r/gone');
    expect(prompts[0]).toContain('path missing');
    expect(prompts[0]).toContain('[member of EDT: feat]');
    expect(prompts[0]).toContain('/r/old');
    expect(ran).toEqual([['registry', 'clean'], ['registry', 'clean', '--yes', '--path', '/r/gone', '--path', '/r/old']]);
  });

  it('fails with an error when a candidate is malformed, and dedupes paths', async () => {
    const bad = await connect({ elicit: 'accept', handlers: { registry: async () => err('confirmation-required', 's', { candidates: [{ path: '/r/a' }], errors: [] }) } });
    const res = await bad.client.callTool({ name: 'registry-clean', arguments: {} });
    expect(res.isError).toBe(true);
    expect(body(res).error.code).toBe('internal-error');
    expect(bad.prompts).toEqual([]);
    const dup = await connect({
      elicit: 'accept',
      handlers: { registry: async (args) => (args.includes('--yes') ? ok({}) : err('confirmation-required', 's', { candidates: [candidates[0], candidates[0]], errors: [] })) },
    });
    await dup.client.callTool({ name: 'registry-clean', arguments: {} });
    expect(dup.ran[1]).toEqual(['registry', 'clean', '--yes', '--path', '/r/gone']);
  });

  it('removes nothing when declined', async () => {
    const { client, ran } = await connect({ elicit: 'decline', handlers: { registry: preview } });
    expect(body(await client.callTool({ name: 'registry-clean', arguments: {} })).error.code).toBe('authorization-denied');
    expect(ran.some((r) => r.includes('--yes'))).toBe(false);
  });

  it('returns the no-stale envelope without prompting', async () => {
    const { client, prompts, ran } = await connect({
      elicit: 'accept',
      handlers: { registry: async () => ok({ candidates: [], errors: [], results: [] }) },
    });
    const res = await client.callTool({ name: 'registry-clean', arguments: {} });
    expect(res.isError).toBe(false);
    expect(body(res).data.candidates).toEqual([]);
    expect(prompts).toEqual([]);
    expect(ran).toHaveLength(1);
  });
});
