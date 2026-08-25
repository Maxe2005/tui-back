import { describe, it, expect } from 'vitest';
import { ZONES, isZoneId, nextZoneId } from './zones.js';

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

