// adapters/driven/modules: unit tests for the compiled-in static registry (AD-5) — the
// production registry and the pure helper functions. Helpers stay generic so tests can
// exercise populated maps without importing production module implementations.
import { describe, expect, it } from 'vitest';
import {
  isKnownModuleId,
  knownModuleIds,
  moduleRegistry,
  resolveModule,
  validateModules,
} from './module-registry.js';

describe('moduleRegistry (AD-5)', () => {
  it('production registry carries the route-explorer module', () => {
    expect(Object.keys(moduleRegistry)).toEqual(['route-explorer']);
    expect(moduleRegistry['route-explorer']?.kind).toBe('route-explorer');
  });

  it('knownModuleIds is derived from moduleRegistry', () => {
    expect(knownModuleIds).toBeInstanceOf(Set);
    expect([...knownModuleIds]).toEqual(['route-explorer']);
  });

  it('isKnownModuleId recognizes route-explorer and rejects anything else', () => {
    expect(isKnownModuleId('route-explorer')).toBe(true);
    expect(isKnownModuleId('shared-types-consumer')).toBe(false);
    expect(isKnownModuleId('bogus-module')).toBe(false);
  });
});

describe('validateModules (injected registry)', () => {
  const populated: Record<string, { kind?: string }> = { 'route-explorer': { kind: 'scanner' } };

  it('returns unknown keys against the production registry, sorted (FR-1)', () => {
    expect(validateModules({ 'z-mod': {}, 'route-explorer': {}, 'a-mod': {} })).toEqual(['a-mod', 'z-mod']);
  });

  it('returns an empty list when every key is known to production', () => {
    expect(validateModules({ 'route-explorer': {} })).toEqual([]);
  });

  it('returns an empty list for an empty modules map', () => {
    expect(validateModules({}, populated)).toEqual([]);
  });

  it('returns only the unknown keys against a populated registry, sorted', () => {
    expect(validateModules({ 'route-explorer': {}, 'shared-types-consumer': {} }, populated)).toEqual([
      'shared-types-consumer',
    ]);
  });
});

describe('resolveModule (D1)', () => {
  it('returns the implementation for a known id and undefined for an unknown one', () => {
    const registry: Record<string, string> = { known: 'impl' };
    expect(resolveModule(registry, 'known')).toBe('impl');
    expect(resolveModule(registry, 'missing')).toBeUndefined();
  });

  it('resolves the production route-explorer module with a working scanner', async () => {
    const module = resolveModule(moduleRegistry, 'route-explorer');
    expect(module).toBeDefined();
    const scanned = await module?.scanner.scan('/repos/gateway', {});
    expect(scanned).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('returns undefined for inherited prototype members, never mistaking them for modules', () => {
    const registry: Record<string, string> = { known: 'impl' };
    expect(resolveModule(registry, 'toString')).toBeUndefined();
    expect(resolveModule(registry, 'constructor')).toBeUndefined();
    expect(resolveModule(registry, 'hasOwnProperty')).toBeUndefined();
  });
});
