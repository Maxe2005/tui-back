// adapters/driven/edt-registry: integration tests against real temp files (AD-13 driven
// layer). The schema is strict on purpose — story 2.2 evolved the entry shape in place
// (AD-7), replacing the 2.1 single `branch` placeholder with `topic` + per-member
// `members: [...]`. No real 2.1-shape data exists (verified at review time), so a legacy
// 2.1 entry is intentionally rejected as edt-registry-invalid-format rather than migrated;
// a migration decision is tracked separately.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { createEdtRegistryPort } from './index.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeRegistryFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-edt-registry-'));
  tmpDirs.push(dir);
  return join(dir, 'edts.yaml');
}

describe('edt-registry list()', () => {
  it('round-trips a new-shape registry file ({ulid, topic, createdAt, status, members})', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));

    const port = createEdtRegistryPort(file);

    expect(await port.list()).toEqual({ ok: true, data: [entry] });
  });

  it('round-trips per-member entries including their branches', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));

    const port = createEdtRegistryPort(file);

    expect(await port.list()).toEqual({ ok: true, data: [entry] });
    expect(await readFile(file, 'utf8')).toBe(stringify({ edts: [entry] }));
  });

  it('rejects a legacy 2.1-shape entry (ulid/branch, no topic/members) as edt-registry-invalid-format', async () => {
    const file = await makeRegistryFile();
    await writeFile(
      file,
      stringify({ edts: [{ ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA', branch: 'edt-01JXXXXX1AAAAAAAAAAAAAAAAA', createdAt: '2026-08-18T00:00:00.000Z', status: 'active' }] }),
    );

    const port = createEdtRegistryPort(file);

    const result = await port.list();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('edt-registry-invalid-format');
    }
  });
});

// Story 2.4: setStatus is a read/find/replace/write, mirroring addEdtRegistryEntry's shape.
describe('edt-registry setStatus()', () => {
  it('updates only the matching entry, leaving others and their fields untouched', async () => {
    const file = await makeRegistryFile();
    const entryA = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    const entryB = {
      ulid: '01JXXXXX2BBBBBBBBBBBBBBBBB',
      topic: 'b',
      createdAt: '2026-08-18T01:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entryA, entryB] }));
    const port = createEdtRegistryPort(file);

    const result = await port.setStatus(entryA.ulid, 'inactive');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entryA, status: 'inactive' }, entryB],
    });
  });

  it('fails with edt-not-found for an unregistered ulid, without writing anything', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file);

    const result = await port.setStatus('01JNOTFOUND0000000000000', 'inactive');

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    expect(await port.list()).toEqual({ ok: true, data: [entry] });
  });

  it('creates the registry directory when it does not exist yet, on an empty registry', async () => {
    const file = await makeRegistryFile();
    const port = createEdtRegistryPort(file);

    const result = await port.setStatus('01JXXXXX1AAAAAAAAAAAAAAAAA', 'inactive');

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });
});

// Story 2.5: update() is a read/find/replace/write, mirroring setStatus's shape.
describe('edt-registry update()', () => {
  it('updates only the topic', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'original',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file);

    const result = await port.update(entry.ulid, { topic: 'renamed' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entry, topic: 'renamed' }],
    });
  });

  it('updates only the members', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file);

    const result = await port.update(entry.ulid, {
      members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entry, members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }] }],
    });
  });

  it('updates both topic and members', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'original',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file);

    const result = await port.update(entry.ulid, {
      topic: 'renamed',
      members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ topic: 'renamed', members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }] }],
    });
  });

  it('fails with edt-not-found for an unregistered ulid', async () => {
    const file = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file);

    const result = await port.update('01JNOTFOUND0000000000000', {
      topic: 'new-topic',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    // Registry file should be unchanged
    expect(await readFile(file, 'utf8')).toEqual(
      stringify({ edts: [entry] }),
    );
  });

  it('leaves sibling entries untouched', async () => {
    const file = await makeRegistryFile();
    const entryA = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    const entryB = {
      ulid: '01JXXXXX2BBBBBBBBBBBBBBBBB',
      topic: 'b',
      createdAt: '2026-08-18T01:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entryA, entryB] }));
    const port = createEdtRegistryPort(file);

    const result = await port.update(entryA.ulid, { topic: 'renamed-a' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entryA, topic: 'renamed-a' }, entryB],
    });
  });
});
