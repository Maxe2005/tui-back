import { describe, it, expect } from 'vitest';
import { ZONES } from '../../zones/zones.js';
import { colors } from '../theme/theme.js';
import { resolveZoneTabState } from './zone-tab-bar.js';
import { renderToString } from './render-to-string.js';
import { ZoneTabBar } from './zone-tab-bar.js';

describe('resolveZoneTabState', () => {
  it('resolves the active zone: accent fill, bold, background-colored text (AC2)', () => {
    const zone = ZONES[0];
    const state = resolveZoneTabState(zone, 'dashboard', 0);
    expect(state).toEqual({
      active: true,
      labelColor: colors.background,
      backgroundColor: colors.accent,
      bold: true,
      badge: null,
    });
  });

  it('resolves an inactive zone: text-dim on background, no badge (AC2)', () => {
    const zone = ZONES[1];
    const state = resolveZoneTabState(zone, 'dashboard', 0);
    expect(state).toEqual({
      active: false,
      labelColor: colors['text-dim'],
      backgroundColor: colors.background,
      bold: false,
      badge: null,
    });
  });

  it('shows a glyph+counter badge in the zone status color when a background event is pending (AC3)', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, 'dashboard', 3);
    expect(state.badge).toEqual({
      text: '●3',
      color: colors[zone.statusColor],
    });
    expect(state.active).toBe(false);
  });

  it('hides the badge once the zone is active (AC3)', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, 'routes', 3);
    expect(state.active).toBe(true);
    expect(state.badge).toBeNull();
  });
});

describe('ZoneTabBar', () => {
  it('renders all six zone tabs simultaneously (AC1)', async () => {
    const output = await renderToString(
      <ZoneTabBar activeZone="dashboard" events={{ dashboard: 0, edts: 0, update: 0, logs: 0, routes: 0, 'shared-types': 0 }} />,
    );
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
  });

  it('renders a pending-event badge on a non-active tab (AC3)', async () => {
    const output = await renderToString(
      <ZoneTabBar
        activeZone="dashboard"
        events={{ dashboard: 0, edts: 0, update: 0, logs: 2, routes: 0, 'shared-types': 0 }}
      />,
    );
    expect(output).toContain('●2');
  });
});
