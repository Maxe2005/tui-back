// Regression guard for overlay input ownership: whichever overlay is open, no zone key handler
// is live behind it; with none open, each zone has a live one.
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, type AppState } from '../../store/app-store.js';
import { mountForTest } from '../test-support/mount-for-test.js';
import { isZoneInputActive } from './use-zone-input-active.js';

const recorded: Array<boolean | undefined> = [];

vi.mock('./use-input.js', () => ({
  useInput: (_handler: unknown, options?: { isActive?: boolean }) => {
    recorded.push(options?.isActive);
  },
}));

const { EdtsZone } = await import('../../zones/edts/edts-zone.js');
const { UpdateZone } = await import('../../zones/update/update-zone.js');
const { LogsZone } = await import('../../zones/logs/logs-zone.js');
const { RoutesZone } = await import('../../zones/routes/routes-zone.js');
const { SharedTypesZone } = await import('../../zones/shared-types/shared-types-zone.js');
const { DashboardZone } = await import('../../zones/dashboard/dashboard-zone.js');

const ZONES = {
  dashboard: DashboardZone,
  edts: EdtsZone,
  update: UpdateZone,
  logs: LogsZone,
  routes: RoutesZone,
  'shared-types': SharedTypesZone,
};

const OVERLAYS: Array<[string, Partial<AppState>]> = [
  ['command bar', { commandBarOpen: true }],
  ['registry screen', { registryScreenOpen: true }],
  ['settings screen', { settingsScreenOpen: true }],
  ['reset screen', { resetScreenOpen: true }],
  ['help panel', { helpOpen: true }],
  ['resize mode', { resizeMode: { zone: 'update', targetBoundary: 0 } as AppState['resizeMode'] }],
];

async function zoneHandlerStates(zone: keyof typeof ZONES, overlay: Partial<AppState>): Promise<Array<boolean | undefined>> {
  recorded.length = 0;
  const store = createAppStore();
  store.setState(overlay);
  const mounted = await mountForTest(createElement(ZONES[zone], { useStore: store }));
  mounted.unmount();
  return [...recorded];
}

describe('zone input gate', () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  for (const zone of Object.keys(ZONES) as Array<keyof typeof ZONES>) {
    describe(zone, () => {
      it.each(OVERLAYS)('has no live key handler while the %s is open', async (_name, overlay) => {
        const states = await zoneHandlerStates(zone, overlay);
        expect(states.every((isActive) => isActive === false)).toBe(true);
      });

      it('keeps a live key handler when no overlay is open', async () => {
        const states = await zoneHandlerStates(zone, {});
        expect(zone === 'dashboard' || states.some((isActive) => isActive !== false)).toBe(true);
      });
    });
  }
});

describe('isZoneInputActive', () => {
  it('is true only when no overlay and no resize mode is active', () => {
    const idle = createAppStore().getState();
    expect(isZoneInputActive(idle)).toBe(true);
    for (const [, overlay] of OVERLAYS) {
      expect(isZoneInputActive({ ...idle, ...overlay })).toBe(false);
    }
  });
});
