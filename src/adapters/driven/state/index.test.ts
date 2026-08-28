// adapters/driven/state: integration tests against real temp files (AD-13 driven layer).
// Mirrors adapters/driven/edt-registry/index.test.ts's shape, but JSON rather than YAML —
// story 2.4's Code Map calls this out explicitly.
import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatePort, resolveStateFile } from './index.js';
import type { XdgPaths } from '../xdg/index.js';

// Review-fix tests (story 2.21, findings 1/2) need to intercept `index.ts`'s own internal
// readFile/writeFile calls (to force a specific interleaving, or a genuine I/O failure) — a
// direct `vi.spyOn(fsPromisesNamespace, 'readFile')` can't redefine a real ESM module's
// (non-configurable) named exports, so this uses vi.mock's module-registry-level replacement
// instead. Every call defaults straight through to the real implementation (`actual.readFile`/
// `actual.writeFile`), so this is a no-op for every other test in this file unless a test
// explicitly layers a `mockImplementation`/`mockImplementationOnce` on top (always restored to
// the real implementation before the test ends).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    writeFile: vi.fn(actual.writeFile),
  };
});

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

  // Story 2.21: writeActiveEdt must read-merge-write, never clobber a sibling
  // splitterRatios already on disk.
  it('preserves a previously written splitterRatios when writing activeEdt', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    await port.writeSplitterRatios({ edts: [0.4, 0.5, 0.6] });

    await port.writeActiveEdt('01JXXXXX1AAAAAAAAAAAAAAAAA');

    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({
      activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      splitterRatios: { edts: [0.4, 0.5, 0.6] },
    });
  });
});

describe('state readSplitterRatios()', () => {
  it('reads null (nothing persisted yet) when the file does not exist (ENOENT)', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);

    expect(await port.readSplitterRatios()).toEqual({ ok: true, data: null });
  });

  it('reads null for a pre-2.21 state.json ({ activeEdt } only)', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA' }));
    const port = createStatePort(file);

    expect(await port.readSplitterRatios()).toEqual({ ok: true, data: null });
  });

  it('round-trips a written splitterRatios map', async () => {
    const file = await makeStateFile();
    await writeFile(
      file,
      JSON.stringify({ activeEdt: null, splitterRatios: { edts: [0.4, 0.5, 0.6], dashboard: [0.4] } }),
    );
    const port = createStatePort(file);

    expect(await port.readSplitterRatios()).toEqual({
      ok: true,
      data: { edts: [0.4, 0.5, 0.6], dashboard: [0.4] },
    });
  });

  it('rejects invalid JSON with state-invalid-json', async () => {
    const file = await makeStateFile();
    await writeFile(file, '{not json');
    const port = createStatePort(file);

    const result = await port.readSplitterRatios();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-invalid-json');
    }
  });

  it('rejects a schema-invalid shape with state-invalid-format', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: null, splitterRatios: { edts: 'nope' } }));
    const port = createStatePort(file);

    const result = await port.readSplitterRatios();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-invalid-format');
    }
  });
});

describe('state writeSplitterRatios()', () => {
  it('creates the state directory and file on first write, alongside activeEdt: null', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);

    const result = await port.writeSplitterRatios({ edts: [0.4, 0.5, 0.6] });

    expect(result).toEqual({ ok: true, data: undefined });
    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({ activeEdt: null, splitterRatios: { edts: [0.4, 0.5, 0.6] } });
  });

  it('overwrites a previously written splitterRatios map', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    await port.writeSplitterRatios({ edts: [0.4, 0.5, 0.6] });

    await port.writeSplitterRatios({ edts: [0.2, 0.2, 0.2] });

    expect(await port.readSplitterRatios()).toEqual({ ok: true, data: { edts: [0.2, 0.2, 0.2] } });
  });

  // Story 2.21: writeSplitterRatios must read-merge-write, never clobber a sibling activeEdt
  // already on disk.
  it('preserves a previously written activeEdt when writing splitterRatios', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    await port.writeActiveEdt('01JXXXXX1AAAAAAAAAAAAAAAAA');

    await port.writeSplitterRatios({ edts: [0.4, 0.5, 0.6] });

    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({
      activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      splitterRatios: { edts: [0.4, 0.5, 0.6] },
    });
  });
});

// Review fix (story 2.21, finding 1): writeActiveEdt/writeSplitterRatios each independently
// read-merge-write the same file — without serialization, a slower writer's read (taken
// *before* a faster concurrent writer's own write lands) would still win the final write,
// silently discarding the faster writer's field.
describe('state write serialization across fields (story 2.21 review fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a delayed writeActiveEdt write never clobbers a concurrent writeSplitterRatios write (or vice versa)', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    const original = vi.mocked(writeFile).getMockImplementation()!;
    let callCount = 0;
    vi.mocked(writeFile).mockImplementation(async (...args: Parameters<typeof writeFile>) => {
      callCount += 1;
      if (callCount === 1) {
        // Delay only the *first* write to land. Without a shared lock, the second call's own
        // read-merge-write would run to completion first (seeing nothing on disk yet), then
        // this delayed first write would finally land using the stale pre-second-write
        // snapshot it read at the very start, overwriting the second call's field.
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return original(...args);
    });

    try {
      await Promise.all([
        port.writeActiveEdt('ulid-A'),
        port.writeSplitterRatios({ edts: [0.4, 0.5, 0.6] }),
      ]);
    } finally {
      vi.mocked(writeFile).mockImplementation(original);
    }

    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({ activeEdt: 'ulid-A', splitterRatios: { edts: [0.4, 0.5, 0.6] } });
  });

  it('serializes 3 concurrent writeSplitterRatios calls without losing writeActiveEdt\'s own concurrent write', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);

    await Promise.all([
      port.writeSplitterRatios({ edts: [0.2, 0.2, 0.2] }),
      port.writeSplitterRatios({ edts: [0.3, 0.3, 0.3] }),
      port.writeActiveEdt('ulid-B'),
      port.writeSplitterRatios({ edts: [0.4, 0.4, 0.4] }),
    ]);

    const content = JSON.parse(await readFile(file, 'utf8'));
    // Whichever writeSplitterRatios call was serialized last wins its own field (last-write-
    // wins is expected/fine among calls to the *same* field) — the decisive assertion is that
    // activeEdt survived every splitterRatios write around it, never reverted to null.
    expect(content.activeEdt).toBe('ulid-B');
    expect('edts' in content.splitterRatios).toBe(true);
  });
});

// Review fix (story 2.21, finding 2): a genuine I/O error reading the existing file inside a
// write's read-merge-write step must never be silently treated as "nothing there yet" —
// unlike real corruption (state-invalid-json/state-invalid-format), a transient read failure
// says nothing about whether good data still exists on disk.
describe('state write propagates a genuine read I/O error rather than writing blind (story 2.21 review fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writeActiveEdt surfaces a state-read-error instead of proceeding to write', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    // Seed a file so a would-be blind overwrite is observable.
    await writeFile(file, JSON.stringify({ activeEdt: null, splitterRatios: { edts: [0.7, 0.7, 0.7] } }));

    const readError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    vi.mocked(readFile).mockRejectedValueOnce(readError);

    const result = await port.writeActiveEdt('ulid-should-not-land');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-read-error');
    }
    // The file on disk is untouched — no blind overwrite happened.
    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({ activeEdt: null, splitterRatios: { edts: [0.7, 0.7, 0.7] } });
  });

  it('writeSplitterRatios surfaces a state-read-error instead of proceeding to write', async () => {
    const file = await makeStateFile();
    const port = createStatePort(file);
    await writeFile(file, JSON.stringify({ activeEdt: 'ulid-existing', splitterRatios: { edts: [0.7, 0.7, 0.7] } }));

    const readError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    vi.mocked(readFile).mockRejectedValueOnce(readError);

    const result = await port.writeSplitterRatios({ edts: [0.1, 0.1, 0.1] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-read-error');
    }
    const content = JSON.parse(await readFile(file, 'utf8'));
    expect(content).toEqual({ activeEdt: 'ulid-existing', splitterRatios: { edts: [0.7, 0.7, 0.7] } });
  });
});

// Review fix (story 2.21, finding 3): a shape-invalid `splitterRatios` (a UI-only preference)
// must never break reading `activeEdt`, and vice versa — core use-cases (switch.ts, list.ts,
// resolve-tab-visibility.ts) only ever call readActiveEdt and have nothing to do with layout
// state.
describe('state per-field read isolation on a sibling-field validation failure (story 2.21 review fix)', () => {
  it('readActiveEdt still succeeds when splitterRatios alone is shape-invalid', async () => {
    const file = await makeStateFile();
    await writeFile(
      file,
      JSON.stringify({ activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA', splitterRatios: { edts: 'not-an-array' } }),
    );
    const port = createStatePort(file);

    expect(await port.readActiveEdt()).toEqual({ ok: true, data: '01JXXXXX1AAAAAAAAAAAAAAAAA' });
  });

  it('readSplitterRatios still succeeds when activeEdt alone is shape-invalid', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: 42, splitterRatios: { edts: [0.4, 0.5, 0.6] } }));
    const port = createStatePort(file);

    expect(await port.readSplitterRatios()).toEqual({ ok: true, data: { edts: [0.4, 0.5, 0.6] } });
  });

  it('readActiveEdt still fails with state-invalid-format when activeEdt itself is the invalid field', async () => {
    const file = await makeStateFile();
    await writeFile(file, JSON.stringify({ activeEdt: 42, splitterRatios: { edts: [0.4, 0.5, 0.6] } }));
    const port = createStatePort(file);

    const result = await port.readActiveEdt();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-invalid-format');
    }
  });

  it('readSplitterRatios still fails with state-invalid-format when splitterRatios itself is the invalid field', async () => {
    const file = await makeStateFile();
    await writeFile(
      file,
      JSON.stringify({ activeEdt: '01JXXXXX1AAAAAAAAAAAAAAAAA', splitterRatios: { edts: 'not-an-array' } }),
    );
    const port = createStatePort(file);

    const result = await port.readSplitterRatios();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('state-invalid-format');
    }
  });

  it('both fields still fail together when the file is not even valid JSON (document-level corruption is never isolable)', async () => {
    const file = await makeStateFile();
    await writeFile(file, '{not json');
    const port = createStatePort(file);

    const activeEdtResult = await port.readActiveEdt();
    const ratiosResult = await port.readSplitterRatios();
    expect(activeEdtResult.ok).toBe(false);
    expect(ratiosResult.ok).toBe(false);
    if (!activeEdtResult.ok) {
      expect(activeEdtResult.error.code).toBe('state-invalid-json');
    }
    if (!ratiosResult.ok) {
      expect(ratiosResult.error.code).toBe('state-invalid-json');
    }
  });
});
