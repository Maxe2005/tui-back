// tui/zones/shared-types: render tests (AD-13 — Ink smoke coverage) for story 2.13's
// `disabled` explanatory message, plus the unaffected `enabled`/`omitted` fallthrough to the
// existing ZonePlaceholder stub (module-registry.ts stays empty in real usage — `disabled`
// is only ever exercised here via a directly-seeded store fixture, per the spec's
// Boundaries).
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { SharedTypesZone, formatSharedTypesDisabledMessage } from './shared-types-zone.js';

describe('formatSharedTypesDisabledMessage', () => {
  it('names the single carrying repo (singular phrasing)', () => {
    const message = formatSharedTypesDisabledMessage(['shared-types']);
    expect(message).toContain('shared-types');
    expect(message).toContain('is not part of your active EDT');
  });

  it('names every carrying repo when there is more than one', () => {
    const message = formatSharedTypesDisabledMessage(['shared-types', 'other-consumer']);
    expect(message).toContain('shared-types');
    expect(message).toContain('other-consumer');
  });
});

describe('SharedTypesZone (story 2.13)', () => {
  it('shows the explanatory message naming the carrying repo when disabled', async () => {
    const store = createAppStore();
    store.setState({
      tabVisibility: {
        routes: { status: 'omitted', carryingServices: [] },
        sharedTypes: { status: 'disabled', carryingServices: ['shared-types'] },
      },
    });
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toContain('shared-types');
    expect(output).not.toContain('SHARED TYPES');
  });

  it('falls through to the normal ZonePlaceholder content when enabled', async () => {
    const store = createAppStore();
    store.setState({
      tabVisibility: {
        routes: { status: 'omitted', carryingServices: [] },
        sharedTypes: { status: 'enabled', carryingServices: ['shared-types'] },
      },
    });
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toContain('list pane');
  });

  it('falls through to the normal ZonePlaceholder content by default (pre-load / omitted state)', async () => {
    const store = createAppStore();
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toContain('list pane');
  });
});
