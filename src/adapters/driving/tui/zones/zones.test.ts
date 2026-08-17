import { describe, it, expect } from 'vitest';
import { ZONES, isZoneId } from './zones.js';

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
