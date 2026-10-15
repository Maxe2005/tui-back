// tui/zones/shared-types: render tests for the `disabled` explanatory message, the empty state,
// the form and a blocked run (`disabled` is only reachable here through a directly-seeded store
// fixture).
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { SHARED_TYPES_NO_MEMBERS, SharedTypesZone, formatSharedTypesDisabledMessage } from './shared-types-zone.js';

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

describe('SharedTypesZone', () => {
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

  it('shows the explicit empty state when the active EDT has no consuming service', async () => {
    const store = createAppStore();
    store.setState({
      tabVisibility: {
        routes: { status: 'omitted', carryingServices: [] },
        sharedTypes: { status: 'enabled', carryingServices: ['shared-types'] },
      },
      sharedTypesConsumersStatus: 'ready',
      sharedTypesConsumers: [],
      loadSharedTypesConsumers: async () => {},
    });
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toContain(SHARED_TYPES_NO_MEMBERS);
  });

  it('shows the version field pre-filled 0.1. followed by the consumer checklist and options', async () => {
    const store = createAppStore();
    store.setState({
      sharedTypesConsumersStatus: 'ready',
      sharedTypesConsumers: [
        { service: 'api', repoPath: '/r/api', branch: 'feat/x', dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
      ],
      loadSharedTypesConsumers: async () => {},
    });
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toContain('Version');
    expect(output).toContain('0.1.');
    expect(output).toContain('[x] api');
    expect(output).toContain('Run npm i');
    expect(output).toContain('Clean restart');
    expect(output).toContain('Commit');
  });

  it('pre-sets the option toggles from the saved settings', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...store.getState().settings, sharedTypes: { install: false, cleanRestart: true, commit: false, historyDepth: 20, maxCommitsScanned: 1000 } },
      sharedTypesConsumersStatus: 'ready',
      sharedTypesConsumers: [
        { service: 'api', repoPath: '/r/api', branch: 'feat/x', dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
      ],
      loadSharedTypesConsumers: async () => {},
    });
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toMatch(/\[ \] Run npm i/);
    expect(output).toMatch(/\[x\] Clean restart/);
    expect(output).toMatch(/\[ \] Commit/);
  });

  it('shows a blocked run with its explicit message', async () => {
    const store = createAppStore();
    store.setState({
      sharedTypesConsumersStatus: 'ready',
      sharedTypesRun: {
        status: 'blocked',
        version: '0.1.9',
        options: { install: true, cleanRestart: false, commit: true },
        blocked: { code: 'version-not-published', message: 'x@0.1.9 is not published on the registry. Nothing was written.' },
        results: [],
        live: null,
      },
      loadSharedTypesConsumers: async () => {},
    });
    const output = await renderToString(<SharedTypesZone useStore={store} />);
    expect(output).toContain('not published');
  });
});
