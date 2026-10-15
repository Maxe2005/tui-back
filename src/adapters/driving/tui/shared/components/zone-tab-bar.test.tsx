import { describe, it, expect } from 'vitest';
import type { ResolveTabVisibilityData } from '../../../../../core/edt/resolve-tab-visibility.js';
import { ZONES } from '../../zones/zones.js';
import { colors } from '../theme/theme.js';
import { resolveZoneTabState } from './zone-tab-bar.js';
import { renderToString } from './render-to-string.js';
import { ZoneTabBar } from './zone-tab-bar.js';

const ZERO_EVENTS = { dashboard: 0, edts: 0, update: 0, logs: 0, routes: 0, 'shared-types': 0 };

describe('resolveZoneTabState — busy', () => {
  const updateZone = ZONES.find((zone) => zone.id === 'update')!;

  it('a busy tab carries the updating badge whether or not it is active', () => {
    expect(resolveZoneTabState(updateZone, 'dashboard', 0, 'enabled', true).badge).toEqual({ text: '⇄ updating', color: colors.info });
    expect(resolveZoneTabState(updateZone, 'update', 0, 'enabled', true).badge).toEqual({ text: '⇄ updating', color: colors.background });
  });

  it('pending incidents turn the busy badge into an awaiting-you count, falling back at zero', () => {
    expect(resolveZoneTabState(updateZone, 'dashboard', 0, 'enabled', true, 2).badge).toEqual({ text: '◐ 2 awaiting you', color: colors.warning });
    expect(resolveZoneTabState(updateZone, 'update', 0, 'enabled', true, 2).badge).toEqual({ text: '◐ 2 awaiting you', color: colors.background });
    expect(resolveZoneTabState(updateZone, 'dashboard', 0, 'enabled', true, 0).badge?.text).toBe('⇄ updating');
  });

  it('the rendered bar shows the awaiting count', async () => {
    const output = await renderToString(<ZoneTabBar activeZone="dashboard" events={ZERO_EVENTS} busy={{ update: { incidents: 3 } }} />);
    expect(output).toContain('3 awaiting you');
  });

  it('the badge shows in the rendered bar only when the update runs', async () => {
    const running = await renderToString(<ZoneTabBar activeZone="dashboard" events={ZERO_EVENTS} busy={{ update: { incidents: 0 } }} />);
    const idle = await renderToString(<ZoneTabBar activeZone="dashboard" events={ZERO_EVENTS} />);
    expect(running).toContain('⇄ updating');
    expect(idle).not.toContain('⇄ updating');
  });
});

describe('ZoneTabBar — st tab busy', () => {
  it('shows the updating badge on the st tab from another zone and while st is active', async () => {
    const other = await renderToString(<ZoneTabBar activeZone="dashboard" events={ZERO_EVENTS} busy={{ 'shared-types': { incidents: 0 } }} />);
    const active = await renderToString(<ZoneTabBar activeZone="shared-types" events={ZERO_EVENTS} busy={{ 'shared-types': { incidents: 0 } }} />);
    expect(other).toContain('⇄ updating');
    expect(active).toContain('⇄ updating');
  });

  it('shows the awaiting badge when blocked and nothing for another zone when idle', async () => {
    const blocked = await renderToString(<ZoneTabBar activeZone="dashboard" events={ZERO_EVENTS} busy={{ 'shared-types': { incidents: 1 } }} />);
    expect(blocked).toContain('1 awaiting you');
    expect(await renderToString(<ZoneTabBar activeZone="dashboard" events={ZERO_EVENTS} />)).not.toContain('updating');
  });
});

describe('resolveZoneTabState', () => {
  it('resolves the active zone: accent fill, bold, background-colored text', () => {
    const zone = ZONES[0];
    const state = resolveZoneTabState(zone, 'dashboard', 0);
    expect(state).toEqual({
      active: true,
      labelColor: colors.background,
      backgroundColor: colors.accent,
      bold: true,
      strikethrough: false,
      badge: null,
    });
  });

  it('resolves an inactive zone: text-dim on background, no badge', () => {
    const zone = ZONES[1];
    const state = resolveZoneTabState(zone, 'dashboard', 0);
    expect(state).toEqual({
      active: false,
      labelColor: colors['text-dim'],
      backgroundColor: colors.background,
      bold: false,
      strikethrough: false,
      badge: null,
    });
  });

  it('resolves a disabled tab: text-dim + strikethrough, never accent, never bold', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, 'dashboard', 0, 'disabled');
    expect(state).toEqual({
      active: false,
      labelColor: colors['text-dim'],
      backgroundColor: colors.background,
      bold: false,
      strikethrough: true,
      badge: null,
    });
  });

  it('resolves a disabled tab that is also the active zone: still no accent fill', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, zone.id, 0, 'disabled');
    expect(state.active).toBe(true);
    expect(state.backgroundColor).toBe(colors.background);
    expect(state.labelColor).toBe(colors['text-dim']);
    expect(state.strikethrough).toBe(true);
  });

  it('never shows a badge on a disabled tab, even with pending events', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, 'dashboard', 3, 'disabled');
    expect(state.badge).toBeNull();
  });

  it('shows a glyph+counter badge in the zone status color when a background event is pending', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, 'dashboard', 3);
    expect(state.badge).toEqual({
      text: '●3',
      color: colors[zone.statusColor],
    });
    expect(state.active).toBe(false);
  });

  it('hides the badge once the zone is active', () => {
    const zone = ZONES[4];
    const state = resolveZoneTabState(zone, 'routes', 3);
    expect(state.active).toBe(true);
    expect(state.badge).toBeNull();
  });
});

describe('ZoneTabBar', () => {
  it('renders all six zone tabs simultaneously', async () => {
    const output = await renderToString(
      <ZoneTabBar activeZone="dashboard" events={{ dashboard: 0, edts: 0, update: 0, logs: 0, routes: 0, 'shared-types': 0 }} />,
    );
    for (const zone of ZONES) {
      expect(output).toContain(`[${zone.mnemonic}] ${zone.label}`);
    }
  });

  it('renders a pending-event badge on a non-active tab', async () => {
    const output = await renderToString(
      <ZoneTabBar
        activeZone="dashboard"
        events={{ dashboard: 0, edts: 0, update: 0, logs: 2, routes: 0, 'shared-types': 0 }}
      />,
    );
    expect(output).toContain('●2');
  });

  const events = { dashboard: 0, edts: 0, update: 0, logs: 0, routes: 0, 'shared-types': 0 };

  it('never renders an omitted tab', async () => {
    const tabVisibility: ResolveTabVisibilityData = {
      routes: { status: 'omitted', carryingServices: [] },
      sharedTypes: { status: 'enabled', carryingServices: [] },
    };
    const output = await renderToString(
      <ZoneTabBar activeZone="dashboard" events={events} tabVisibility={tabVisibility} />,
    );
    expect(output).not.toContain('[r] Routes');
    expect(output).toContain('[s] Shared types');
  });

  it('omits both gated tabs when both are omitted', async () => {
    const tabVisibility: ResolveTabVisibilityData = {
      routes: { status: 'omitted', carryingServices: [] },
      sharedTypes: { status: 'omitted', carryingServices: [] },
    };
    const output = await renderToString(
      <ZoneTabBar activeZone="dashboard" events={events} tabVisibility={tabVisibility} />,
    );
    expect(output).not.toContain('[r] Routes');
    expect(output).not.toContain('[s] Shared types');
    expect(output).toContain('[d] Dashboard');
  });

  it('still renders a disabled tab label (dimmed/strikethrough, not omitted)', async () => {
    const tabVisibility: ResolveTabVisibilityData = {
      routes: { status: 'enabled', carryingServices: [] },
      sharedTypes: { status: 'disabled', carryingServices: ['shared-types'] },
    };
    const output = await renderToString(
      <ZoneTabBar activeZone="dashboard" events={events} tabVisibility={tabVisibility} />,
    );
    expect(output).toContain('[s] Shared types');
  });
});
