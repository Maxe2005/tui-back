// core/scripts/scan: unit tests against a fake RegistryPort (AD-13). The real directory
// walk (sorting, skipping dot-dirs/node_modules, symlinks, unreadable-subtree reporting)
// is covered in adapters/driven/registry/index.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';
import { scanRepos } from './scan.js';

const EMPTY_SCAN = { candidates: [], skipped: [] };

function fakeRegistry(overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: async () => ok([]),
    add: async () => ok(undefined),
    exists: async () => ok(false),
    scan: vi.fn(async () => ok(EMPTY_SCAN)),
    reset: async () => ok({ path: '/x', backupPath: null }),
    ...overrides,
  };
}

describe('scanRepos', () => {
  it('rejects a missing root with missing-argument and usage in the message', async () => {
    const registry = fakeRegistry();

    const result = await scanRepos(registry, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    if (!result.ok) {
      expect(result.error.message).toContain('Usage');
    }
    expect(registry.scan).not.toHaveBeenCalled();
  });

  it('proposes candidates under the root without ever auto-registering (AD-6)', async () => {
    const scan = vi.fn(async () => ok({ candidates: ['/root/a-repo', '/root/b-repo'], skipped: [] }));
    const registry = fakeRegistry({ scan });

    const result = await scanRepos(registry, '/root');

    expect(scan).toHaveBeenCalledWith('/root');
    expect(result).toEqual({
      ok: true,
      data: { candidates: ['/root/a-repo', '/root/b-repo'], skipped: [] },
    });
  });

  it('returns ok with empty candidates for a manifest-less root', async () => {
    const registry = fakeRegistry({ scan: async () => ok(EMPTY_SCAN) });

    await expect(scanRepos(registry, '/root')).resolves.toEqual({
      ok: true,
      data: { candidates: [], skipped: [] },
    });
  });

  it('surfaces unreadable subtrees via skipped instead of hiding them', async () => {
    const registry = fakeRegistry({ scan: async () => ok({ candidates: ['/root/a'], skipped: ['/root/locked'] }) });

    await expect(scanRepos(registry, '/root')).resolves.toEqual({
      ok: true,
      data: { candidates: ['/root/a'], skipped: ['/root/locked'] },
    });
  });

  it('propagates a scan-root-not-found failure instead of crashing', async () => {
    const registry = fakeRegistry({ scan: async () => err('scan-root-not-found', 'no such root') });

    await expect(scanRepos(registry, '/does/not/exist')).resolves.toMatchObject({
      ok: false,
      error: { code: 'scan-root-not-found' },
    });
  });
});
