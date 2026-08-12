// core/scripts/register: unit tests against a fake RegistryPort (AD-13). The registry
// adapter's real temp-dir behavior is covered in adapters/driven/registry/index.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';
import { registerRepo } from './register.js';

function fakeRegistry(overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: async () => ok([]),
    add: vi.fn(async () => ok(undefined)),
    exists: async () => ok(false),
    scan: async () => ok([]),
    ...overrides,
  };
}

describe('registerRepo', () => {
  it('rejects a missing argument with missing-argument and usage in the message', async () => {
    const registry = fakeRegistry();

    const result = await registerRepo(registry, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    if (!result.ok) {
      expect(result.error.message).toContain('Usage');
    }
    expect(registry.add).not.toHaveBeenCalled();
  });

  it('rejects a relative path with invalid-argument and never calls add', async () => {
    const registry = fakeRegistry();

    const result = await registerRepo(registry, './relative');

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(registry.add).not.toHaveBeenCalled();
  });

  it('persists an absolute path through registry.add and returns ok with the path', async () => {
    const registry = fakeRegistry();

    const result = await registerRepo(registry, '/abs/repo');

    expect(registry.add).toHaveBeenCalledWith('/abs/repo');
    expect(result).toEqual({ ok: true, data: { path: '/abs/repo' } });
  });

  it('propagates a registry failure instead of masking it', async () => {
    const registry = fakeRegistry({ add: async () => err('registry-write-error', 'disk full') });

    const result = await registerRepo(registry, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-write-error' } });
  });
});
