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
