// tui/zones/routes: render tests (AD-13 — Ink smoke coverage) for story 2.13's `disabled`
// explanatory message, plus the unaffected `enabled`/`omitted` fallthrough to the existing
// ZonePlaceholder stub (module-registry.ts stays empty in real usage — `disabled` is only
// ever exercised here via a directly-seeded store fixture, per the spec's Boundaries).
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { RoutesZone, formatRoutesDisabledMessage } from './routes-zone.js';

describe('formatRoutesDisabledMessage', () => {
  it('names every carrying service', () => {
    const message = formatRoutesDisabledMessage(['api-gateway', 'orders-api']);
    expect(message).toContain('api-gateway');
    expect(message).toContain('orders-api');
  });
});

describe('RoutesZone (story 2.13)', () => {
  it('shows the explanatory message naming the carrying services when disabled', async () => {
    const store = createAppStore();
    store.setState({
      tabVisibility: {
        routes: { status: 'disabled', carryingServices: ['api-gateway', 'orders-api'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('api-gateway');
    expect(output).toContain('orders-api');
    expect(output).not.toContain('ROUTES');
  });

  it('falls through to the normal ZonePlaceholder content when enabled', async () => {
    const store = createAppStore();
    store.setState({
      tabVisibility: {
        routes: { status: 'enabled', carryingServices: ['api-gateway'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('ROUTES');
    expect(output).toContain('list pane');
  });

  it('falls through to the normal ZonePlaceholder content by default (pre-load / omitted state)', async () => {
    const store = createAppStore();
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('ROUTES');
  });
});
