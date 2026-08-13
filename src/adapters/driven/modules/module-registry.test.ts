// adapters/driven/modules: unit tests for the compiled-in static registry (AD-5) — the
// empty production registry plus the pure helper functions that later modules/epics use.
// No real module implementations exist yet, so the registry and `knownModuleIds` are empty
// by design; helpers take a registry argument so tests can exercise a populated map while
// production stays empty (Design Notes decision D1).
import { describe, expect, it } from 'vitest';
import {
  isKnownModuleId,
  knownModuleIds,
  moduleRegistry,
  resolveModule,
  validateModules,
} from './module-registry.js';

describe('moduleRegistry (AD-5, AC1)', () => {
  it('production registry is empty by design this story', () => {
    expect(Object.keys(moduleRegistry)).toEqual([]);
  });

  it('knownModuleIds is derived from moduleRegistry and empty in production', () => {
    expect(knownModuleIds).toBeInstanceOf(Set);
    expect([...knownModuleIds]).toEqual([]);
  });

  it('isKnownModuleId is false for any id against the empty production registry', () => {
    expect(isKnownModuleId('route-explorer')).toBe(false);
    expect(isKnownModuleId('shared-types-consumer')).toBe(false);
  });
});

describe('validateModules (AC2/AC3 via injected registry, D1)', () => {
  const populated: Record<string, { kind?: string }> = { 'route-explorer': { kind: 'scanner' } };

  it('returns every key when the registry is empty', () => {
    expect(validateModules({ a: {}, b: {} })).toEqual(['a', 'b']);
  });

  it('returns only the unknown keys against a populated registry, in key order', () => {
    expect(validateModules({ 'route-explorer': {}, 'shared-types-consumer': {} }, populated)).toEqual([
      'shared-types-consumer',
    ]);
  });

  it('returns an empty list when every key is known', () => {
    expect(validateModules({ 'route-explorer': {} }, populated)).toEqual([]);
  });

  it('returns an empty list for an empty modules map (AC2 baseline)', () => {
    expect(validateModules({}, populated)).toEqual([]);
  });
});

describe('resolveModule (D1)', () => {
  it('returns the implementation for a known id and undefined for an unknown one', () => {
    const registry: Record<string, string> = { known: 'impl' };
    expect(resolveModule(registry, 'known')).toBe('impl');
    expect(resolveModule(registry, 'missing')).toBeUndefined();
  });

  it('returns undefined for any id against the empty production registry', () => {
    expect(resolveModule(moduleRegistry, 'anything')).toBeUndefined();
  });
});
