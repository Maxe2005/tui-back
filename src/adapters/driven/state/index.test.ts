// adapters/driven/state: integration tests against real temp files (AD-13 driven layer).
// Mirrors adapters/driven/edt-registry/index.test.ts's shape, but JSON rather than YAML —
// story 2.4's Code Map calls this out explicitly.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatePort, resolveStateFile } from './index.js';
import type { XdgPaths } from '../xdg/index.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeStateFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-state-'));
  tmpDirs.push(dir);
  return join(dir, 'state.json');
}

describe('resolveStateFile', () => {
  it('resolves to <stateDir>/state.json', () => {
    const xdg: XdgPaths = { configDir: '/cfg', dataDir: '/data', stateDir: '/state', cacheDir: '/cache' };
    expect(resolveStateFile(xdg)).toBe(join('/state', 'state.json'));
  });
});

describe('state readActiveEdt()', () => {
  it('reads null (no active EDT yet) when the file does not exist (ENOENT)', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);

    expect(await port.readActiveEdt()).toEqual({ ok: true, data: null });
  });

  it('reads null for an empty file', async () => {
    const file = await makeStateFile();
    await writeFile(file, '');
    const port = createStatePort(file);

    expect(await port.readActiveEdt()).toEqual({ ok: true, data: null });
  });

  it('round-trips a written activeEdt ulid', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA' }));
    const port = createStatePort(file);

    expect(await port.readActiveEdt()).toEqual({ ok: true, data: '01JXXXXX1AAAAAAAAAAAAAAAAA' });
  });

  it('reads an explicit null activeEdt', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: null }));
    const port = createStatePort(file);

    expect(await port.readActiveEdt()).toEqual({ ok: true, data: null });
  });

  it('rejects invalid JSON with state-invalid-json', async () => {
    const file = await makeStateFile();
    await writeFile(file, '{not json');
    const port = createStatePort(file);

    const result = await port.readActiveEdt();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-invalid-json');
    }
  });

  it('rejects a schema-invalid shape with state-invalid-format', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: 42 }));
    const port = createStatePort(file);

    const result = await port.readActiveEdt();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-invalid-format');
    }
  });
});

describe('state writeActiveEdt()', () => {
  it('creates the state directory and file on first write', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);

    const result = await port.writeActiveEdt('01JXXXXX1AAAAAAAAAAAAAAAAA');

    expect(result).toEqual({ ok: true, data: undefined });
    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({ activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA' });
  });

  it('overwrites a previously written activeEdt', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    await port.writeActiveEdt('01JXXXXX1AAAAAAAAAAAAAAAAA');

    await port.writeActiveEdt('01JYYYYY1BBBBBBBBBBBBBBBBB');

    expect(await port.readActiveEdt()).toEqual({ ok: true, data: '01JYYYYY1BBBBBBBBBBBBBBBBB' });
  });
});
