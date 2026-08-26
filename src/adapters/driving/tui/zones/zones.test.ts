import { describe, it, expect } from 'vitest';
import type { ResolveTabVisibilityData } from '../../../../core/edt/resolve-tab-visibility.js';
import { ZONES, isZoneId, nextZoneId, zoneGatedStatus, resolveReachableZones, ALL_ZONE_IDS } from './zones.js';

describe('zones metadata', () => {
  it('defines exactly the six navigation zones (AC6)', () => {
    expect(ZONES.map((zone) => zone.id)).toEqual([
      'dashboard',
      'edts',
      'update',
      'logs',
      'routes',
      'shared-types',
    ]);
  });

  it('assigns a unique mnemonic to each zone (AC1)', () => {
    const mnemonics = ZONES.map((zone) => zone.mnemonic);
    expect(new Set(mnemonics).size).toBe(ZONES.length);
  });

  it('keeps a human label and a keyboard mnemonic per zone', () => {
    for (const zone of ZONES) {
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.mnemonic.length).toBe(1);
    }
  });

  it('recognizes every compiled-in zone id and rejects others', () => {
    for (const zone of ZONES) {
      expect(isZoneId(zone.id)).toBe(true);
    }
    expect(isZoneId('bogus')).toBe(false);
  });
});

describe('nextZoneId (story 2.12)', () => {
  it('moves forward to the next zone in ZONES order', () => {
    expect(nextZoneId('dashboard', 1)).toBe('edts');
    expect(nextZoneId('edts', 1)).toBe('update');
    expect(nextZoneId('update', 1)).toBe('logs');
    expect(nextZoneId('logs', 1)).toBe('routes');
    expect(nextZoneId('routes', 1)).toBe('shared-types');
  });

  it('moves backward to the previous zone in ZONES order', () => {
    expect(nextZoneId('shared-types', -1)).toBe('routes');
    expect(nextZoneId('routes', -1)).toBe('logs');
    expect(nextZoneId('logs', -1)).toBe('update');
    expect(nextZoneId('update', -1)).toBe('edts');
    expect(nextZoneId('edts', -1)).toBe('dashboard');
  });

  it('wraps forward from the last zone to the first', () => {
    expect(nextZoneId('shared-types', 1)).toBe('dashboard');
  });

  it('wraps backward from the first zone to the last', () => {
    expect(nextZoneId('dashboard', -1)).toBe('shared-types');
  });
});

function tabVisibility(overrides: Partial<ResolveTabVisibilityData> = {}): ResolveTabVisibilityData {
  return {
    routes: { status: 'enabled', carryingServices: [] },
    sharedTypes: { status: 'enabled', carryingServices: [] },
    ...overrides,
  };
}

describe('zoneGatedStatus (story 2.13)', () => {
  it('reads routes/shared-types status straight from tabVisibility', () => {
    const visibility = tabVisibility({
      routes: { status: 'disabled', carryingServices: ['api-gateway'] },
      sharedTypes: { status: 'omitted', carryingServices: [] },
    });
    expect(zoneGatedStatus('routes', visibility)).toBe('disabled');
    expect(zoneGatedStatus('shared-types', visibility)).toBe('omitted');
  });

  it('reports every non-gated zone as always enabled', () => {
    const visibility = tabVisibility({
      routes: { status: 'omitted', carryingServices: [] },
      sharedTypes: { status: 'omitted', carryingServices: [] },
    });
    for (const zoneId of ['dashboard', 'edts', 'update', 'logs'] as const) {
      expect(zoneGatedStatus(zoneId, visibility)).toBe('enabled');
    }
  });
});

describe('resolveReachableZones (story 2.13)', () => {
  it('includes every zone when nothing is omitted', () => {
    expect(resolveReachableZones(tabVisibility())).toEqual(ALL_ZONE_IDS);
  });

  it('excludes an omitted gated tab but keeps a disabled one', () => {
    const visibility = tabVisibility({
      routes: { status: 'omitted', carryingServices: [] },
      sharedTypes: { status: 'disabled', carryingServices: ['shared-types'] },
    });
    const reachable = resolveReachableZones(visibility);
    expect(reachable.has('routes')).toBe(false);
    expect(reachable.has('shared-types')).toBe(true);
  });
});

describe('nextZoneId reachable-set param (story 2.13)', () => {
  it('skips an omitted tab entirely during wrap traversal', () => {
    const reachable = new Set<(typeof ZONES)[number]['id']>(['dashboard', 'edts', 'update', 'logs', 'shared-types']);
    expect(nextZoneId('logs', 1, reachable)).toBe('shared-types');
    expect(nextZoneId('shared-types', 1, reachable)).toBe('dashboard');
  });

  it('lands on a disabled tab (still in the reachable set) rather than skipping it', () => {
    const reachable = new Set<(typeof ZONES)[number]['id']>(['dashboard', 'edts', 'update', 'logs', 'routes']);
    expect(nextZoneId('logs', 1, reachable)).toBe('routes');
  });

  it('defaults to every zone when no reachable set is passed, unchanged from story 2.12', () => {
    expect(nextZoneId('dashboard', 1)).toBe('edts');
    expect(nextZoneId('dashboard', -1)).toBe('shared-types');
  });

  it('falls back to the first reachable zone (in ZONES order) when current is excluded from reachable', () => {
    const reachable = new Set<(typeof ZONES)[number]['id']>(['edts', 'update', 'logs']);
    expect(nextZoneId('routes', 1, reachable)).toBe('edts');
    expect(nextZoneId('routes', -1, reachable)).toBe('edts');
  });
});
