// core/scripts/reset: unit tests against a fake RegistryPort (AD-13). The adapter's real
// backup/re-init behavior is covered in adapters/driven/registry/index.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';
import { resetRepo } from './reset.js';

function fakeRegistry(overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: async () => ok([]),
    add: async () => ok(undefined),
    exists: async () => ok(false),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: vi.fn(async () => ok({ path: '/abs/repo', backupPath: null })),
    ...overrides,
  };
}

describe('resetRepo', () => {
  it('rejects a missing argument with missing-argument and usage in the message', async () => {
    const registry = fakeRegistry();

    const result = await resetRepo(registry, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    if (!result.ok) {
      expect(result.error.message).toContain('Usage');
    }
    expect(registry.reset).not.toHaveBeenCalled();
  });

  it('rejects a relative path with invalid-argument and never calls reset', async () => {
    const registry = fakeRegistry();

    const result = await resetRepo(registry, './relative');

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(registry.reset).not.toHaveBeenCalled();
  });

  it('delegates an absolute path to registry.reset and returns its data', async () => {
    const registry = fakeRegistry({
      reset: vi.fn(async () => ok({ path: '/abs/repo', backupPath: '/cfg/registry.yaml.bak-1' })),
    });

    const result = await resetRepo(registry, '/abs/repo/');

    expect(registry.reset).toHaveBeenCalledWith('/abs/repo');
    expect(result).toEqual({
      ok: true,
      data: { path: '/abs/repo', backupPath: '/cfg/registry.yaml.bak-1' },
    });
  });

  it('propagates a registry-not-corrupt refusal without masking it', async () => {
    const registry = fakeRegistry({ reset: async () => err('registry-not-corrupt', 'nothing to reset') });

    const result = await resetRepo(registry, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-not-corrupt' } });
  });
});
