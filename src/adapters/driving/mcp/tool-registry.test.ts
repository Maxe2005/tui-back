import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ok } from '../../../core/result.js';
import type { Subcommand } from '../cli/dispatch.js';
import { buildToolRegistry, TOOL_DEFINITIONS, type ToolDefinition } from './tool-registry.js';

function fake(name: string, seen: string[][] = []): Subcommand {
  return { name, usage: name, run: async (args) => { seen.push(args); return ok({ name }); } };
}

describe('buildToolRegistry', () => {
  it('registers every tool with its class', () => {
    const subs = [...new Set(TOOL_DEFINITIONS.map((d) => d.subcommand))].map((n) => fake(n));
    const tools = buildToolRegistry(subs);
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_DEFINITIONS.map((d) => d.name).sort());
    expect(tools.every((t) => ['read', 'write', 'destructive'].includes(t.safety))).toBe(true);
    expect(tools.filter((t) => t.safety === 'read')).toHaveLength(TOOL_DEFINITIONS.filter((d) => d.safety === 'read').length);
  });

  it('throws when a tool has no safety class', () => {
    const def: ToolDefinition = { name: 'x', description: 'x', inputSchema: {}, subcommand: 'ping' };
    expect(() => buildToolRegistry([fake('ping')], [def])).toThrow(/safety class/);
  });

  it('throws on a duplicate tool name', () => {
    const def: ToolDefinition = { name: 'x', description: 'x', inputSchema: {}, subcommand: 'ping', safety: 'read' };
    expect(() => buildToolRegistry([fake('ping')], [def, def])).toThrow(/Duplicate MCP tool name/);
  });

  it('throws on an invalid safety value', () => {
    const def = { name: 'x', description: 'x', inputSchema: {}, subcommand: 'ping', safety: 'dangerous' } as unknown as ToolDefinition;
    expect(() => buildToolRegistry([fake('ping')], [def])).toThrow(/safety class/);
  });

  it('rejects empty or dash-leading repoPath in the zod schema', () => {
    for (const name of ['list-routes', 'request-list']) {
      const schema = z.object(TOOL_DEFINITIONS.find((d) => d.name === name)!.inputSchema);
      for (const bad of ['', '-x', '--repo']) expect(schema.safeParse({ repoPath: bad }).success).toBe(false);
      expect(schema.safeParse({ repoPath: '/ok' }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(true);
    }
  });

  it('throws on an unknown wrapped subcommand', () => {
    const def: ToolDefinition = { name: 'x', description: 'x', inputSchema: {}, subcommand: 'nope', safety: 'read' };
    expect(() => buildToolRegistry([], [def])).toThrow(/unknown subcommand/);
  });

  it('maps inputs to argv', async () => {
    const seen: string[][] = [];
    const subs = TOOL_DEFINITIONS.map((d) => fake(d.subcommand, seen));
    const tools = buildToolRegistry(subs);
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    await byName('list-routes').run({ repoPath: '/r' });
    await byName('request-list').run({ repoPath: '/r' });
    await byName('request-list').run({});
    await byName('registry-validate').run({});
    expect(seen).toEqual([['/r'], ['--repo', '/r'], [], ['validate']]);
  });

  it('turns a throwing run into an internal-error result', async () => {
    const boom: Subcommand = { name: 'ping', usage: 'ping', run: async () => { throw new Error('boom'); } };
    const def: ToolDefinition = { name: 'ping', description: 'p', inputSchema: {}, subcommand: 'ping', safety: 'read' };
    const [tool] = buildToolRegistry([boom], [def]);
    const result = await tool.run({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal-error');
  });
});

describe('README MCP section', () => {
  it('lists exactly the registry tools under their own safety-class heading', () => {
    const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const section = readme.split(/^## MCP server$/m)[1]?.split(/^## (?!#)/m)[0] ?? '';
    expect(section).not.toBe('');
    for (const safety of ['read', 'write', 'destructive'] as const) {
      const body = section.split(new RegExp(`^#### ${safety}\\b.*$`, 'm'))[1]?.split(/^###/m)[0] ?? '';
      const toolLine = body.split('\n').find((line) => line.startsWith('`')) ?? '';
      const documented = [...toolLine.matchAll(/`([a-z][a-z0-9_-]*)`/g)].map((m) => m[1]).sort();
      const expected = TOOL_DEFINITIONS.filter((d) => d.safety === safety).map((d) => d.name).sort();
      expect(expected.length).toBeGreaterThan(0);
      expect(documented, `tools under ${safety}`).toEqual(expected);
    }
  });
});
