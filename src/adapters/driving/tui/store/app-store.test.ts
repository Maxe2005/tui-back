import { describe, it, expect } from 'vitest';
import { ZONES } from '../zones/zones.js';
import { DEFAULT_LIST_RATIO } from '../shared/components/list-detail-split.js';
import { createAppStore } from './app-store.js';

describe('app store', () => {
  it('scaffolds placeholder cross-zone state: dashboard active, empty events, 2:3 splitter ratios, no active EDT (AD-10)', () => {
    const store = createAppStore();
    const state = store.getState();
    expect(state.activeZone).toBe('dashboard');
    expect(state.activeEdt).toBeNull();
    for (const zone of ZONES) {
      expect(state.zoneEvents[zone.id]).toBe(0);
      expect(state.splitterRatios[zone.id]).toBe(DEFAULT_LIST_RATIO);
    }
  });

  it('covers exactly the six compiled-in zones — no duplicate copy per zone (AC5)', () => {
    const store = createAppStore();
    const state = store.getState();
    expect(ZONES).toHaveLength(6);
    const zoneIds = ZONES.map((zone) => zone.id);
    expect(Object.keys(state.zoneEvents).sort()).toEqual(
      [...zoneIds].sort(),
    );
    expect(Object.keys(state.splitterRatios).sort()).toEqual(
      [...zoneIds].sort(),
    );
  });

  it('switches the active zone and clears pending events for the visited zone (AC3)', () => {
    const store = createAppStore();
    store.getState().addZoneEvent('logs');
    store.getState().addZoneEvent('logs');
    expect(store.getState().zoneEvents.logs).toBe(2);
    store.getState().setActiveZone('logs');
    expect(store.getState().activeZone).toBe('logs');
    expect(store.getState().zoneEvents.logs).toBe(0);
  });

  it('adds pending background-event counts per zone independently (AC3)', () => {
    const store = createAppStore();
    store.getState().addZoneEvent('routes');
    store.getState().addZoneEvent('routes');
    store.getState().addZoneEvent('dashboard');
    expect(store.getState().zoneEvents.routes).toBe(2);
    expect(store.getState().zoneEvents.dashboard).toBe(1);
  });

  it('stores the splitter ratio per zone, clamped to keep both panes usable (AC4)', () => {
    const store = createAppStore();
    store.getState().setSplitterRatio('edts', 0.5);
    expect(store.getState().splitterRatios.edts).toBe(0.5);
    store.getState().setSplitterRatio('edts', 1);
    expect(store.getState().splitterRatios.edts).toBe(0.8);
    store.getState().setSplitterRatio('edts', 0);
    expect(store.getState().splitterRatios.edts).toBe(0.2);
    expect(store.getState().splitterRatios.dashboard).toBe(
      DEFAULT_LIST_RATIO,
    );
  });

  it('tracks the active EDT placeholder field (AD-10)', () => {
    const store = createAppStore();
    store.getState().setActiveEdt('edt-01hx2');
    expect(store.getState().activeEdt).toBe('edt-01hx2');
    store.getState().setActiveEdt(null);
    expect(store.getState().activeEdt).toBeNull();
  });
});

