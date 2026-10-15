// tui/zones/dashboard: render tests for the empty-registry prompt (checked before any other
// Dashboard content) and the snapshot sections. checkRegistryEmpty is stubbed in tests
// that seed a registryEmpty/registryEmptyStatus combination: the mount effect always calls it,
// and on an unwired store the real call sets registryEmptyStatus to 'error', clobbering the
// seeded state (same reasoning as edts-zone.test.tsx's noopLoad).
import { createElement } from 'react';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { BoundsProvider } from '../../shared/bounds/bounds-context.js';
import { BANNER_LINES } from './launch-banner.js';
import {
  DashboardZone,
  EMPTY_REGISTRY_HINT,
  EMPTY_REGISTRY_MESSAGE,
  REGISTRY_CHECK_ERROR_MESSAGE,
} from './dashboard-zone.js';

const noopCheck = async () => {};

function fakeStdout(): NodeJS.WriteStream {
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  Object.assign(stdout, { columns: 120, rows: 40 });
  return stdout as unknown as NodeJS.WriteStream;
}

function fakeStdin(): NodeJS.ReadStream {
  const stdin = new Readable({
    read() {
      return null;
    },
  });
  Object.defineProperty(stdin, 'isTTY', { value: true });
  (stdin as unknown as Record<string, () => void>).setRawMode = () => {};
  (stdin as unknown as Record<string, () => void>).ref = () => {};
  (stdin as unknown as Record<string, () => void>).unref = () => {};
  return stdin as unknown as NodeJS.ReadStream;
}

describe('DashboardZone', () => {
  it('shows the "no repos registered yet" prompt when the registry is confirmed empty', async () => {
    const store = createAppStore();
    store.setState({ registryEmpty: true, checkRegistryEmpty: noopCheck });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).toContain(EMPTY_REGISTRY_HINT);
  });

  it('shows the snapshot sections when the registry is non-empty — no registry prompt', async () => {
    const store = createAppStore();
    store.setState({ registryEmpty: false, checkRegistryEmpty: noopCheck });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).not.toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).toContain('services');
    // The banner is permanent — shows above the placeholder content too, not just the
    // empty-registry prompt.
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
  });

  it('shows the snapshot sections (never assumes empty) before the registry check resolves', async () => {
    const store = createAppStore();
    store.setState({ registryEmpty: null, checkRegistryEmpty: noopCheck });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).not.toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).toContain('services');
    // The banner is permanent — shows above the placeholder content too, even before the
    // registry check has resolved.
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
  });

  // A registry.list() failure must render its own error branch, never stay invisible.
  it('shows an explicit error message when the registry check itself fails — never silently falls back to the placeholder or a stale prompt', async () => {
    const store = createAppStore();
    store.setState({
      registryEmpty: true, // stale value from a prior successful check — must not still show
      registryEmptyStatus: 'error',
      checkRegistryEmpty: noopCheck,
    });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain(REGISTRY_CHECK_ERROR_MESSAGE);
    expect(output).not.toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).not.toContain('services');
    // The banner is permanent — shows above the error message too.
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
  });

  it('checks the registry emptiness on mount', async () => {
    let called = false;
    const store = createAppStore();
    store.setState({
      checkRegistryEmpty: async () => {
        called = true;
      },
    });
    await renderToString(<DashboardZone useStore={store} />);
    expect(called).toBe(true);
  });

  it('always shows the launch banner, above the empty-registry prompt', async () => {
    const store = createAppStore();
    store.setState({ registryEmpty: true, checkRegistryEmpty: noopCheck });
    const output = await renderToString(<DashboardZone useStore={store} />);
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(output).toContain(EMPTY_REGISTRY_MESSAGE);
  });

  // Every test above mounts a fresh instance, which would still pass with a mount-only effect.
  // The common flow — opening the registry screen from Dashboard and closing it without
  // switching zones — never remounts DashboardZone, so this keeps one Ink instance mounted
  // across a registryScreenOpen flip.
  it('re-checks the registry emptiness whenever registryScreenOpen flips, on the same mounted instance, without a remount', async () => {
    let calls = 0;
    const store = createAppStore();
    store.setState({
      checkRegistryEmpty: async () => {
        calls += 1;
      },
    });

    const instance = render(createElement(DashboardZone, { useStore: store }), {
      stdout: fakeStdout(),
      stdin: fakeStdin(),
      interactive: false,
      exitOnCtrlC: false,
      patchConsole: false,
    });

    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(calls).toBe(1);

      store.setState({ registryScreenOpen: true });
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(calls).toBe(2);

      store.setState({ registryScreenOpen: false });
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(calls).toBe(3);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('DashboardZone snapshot sections', () => {
  const load = async () => {};
  const ACTIVE = {
    status: 'active' as const,
    edt: { ulid: 'e1', topic: 'topic-a', serviceCount: 2 },
    services: [
      {
        service: 'svc-a',
        path: '/r/a',
        manifest: { ok: true, value: { sharedBranch: 'development', protectedBranches: [] } },
        container: { ok: true, value: 'up' },
        branch: 'feat/x',
        divergence: { status: 'current', ahead: 0, behind: 0 },
        workingTree: { ok: true, value: { uncommitted: true, mergeInProgress: false, rebaseInProgress: false } },
        protectedBranch: false,
        usedByEdts: [],
      },
      {
        service: 'svc-b',
        path: '/r/b',
        manifest: { ok: true, value: { sharedBranch: 'development', protectedBranches: [] } },
        container: { ok: false, error: { code: 'docker-error', message: 'boom' } },
        branch: 'feat/x',
        divergence: { status: 'current', ahead: 0, behind: 0 },
        workingTree: { ok: false, error: { code: 'git-error', message: 'boom' } },
        protectedBranch: false,
        usedByEdts: [],
      },
    ],
  };
  const REGISTRY = { repoCount: 3, invalidManifests: 1, unreachable: 0, listingIssues: 0 };

  function seed(extra: Record<string, unknown>) {
    const store = createAppStore();
    store.setState({ registryEmpty: false, checkRegistryEmpty: noopCheck, loadDashboard: load, ...extra });
    return store;
  }

  it('gives each section its own spinner while loading', async () => {
    const store = seed({ dashboardServicesStatus: 'loading', dashboardRegistryStatus: 'loading' });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('Loading services');
    expect(output).toContain('Loading repo health');
  });

  it('fills one section while the other still loads', async () => {
    const store = seed({ dashboardServicesStatus: 'loading', dashboardRegistryStatus: 'ready', dashboardRegistry: REGISTRY });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('Loading services');
    expect(output).toContain('3 repos');
  });

  it('shows the populated view with per-field error markers and the updated line', async () => {
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: ACTIVE,
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: REGISTRY,
      dashboardUpdatedAt: Date.now(),
    });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('EDT topic-a · 2 services');
    expect(output).toContain('svc-a up feat/x ↑0 ↓0');
    expect(output).toContain('svc-b container error feat/x ↑0 ↓0');
    // The focused (first) row explains its anomaly and lists the actions' absence while unloaded.
    expect(output).toContain('uncommitted changes');
    expect(output).toContain('Actions unavailable.');
    expect(output).toContain('1 invalid manifests');
    expect(output).toContain('updated 0s ago');
  });

  it('shows the focused row actions with their unavailable reasons, and the running progress', async () => {
    const actions = [
      { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: { available: true as const } },
      { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: { available: false as const, reason: 'no container' } },
      { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: { available: false as const, reason: 'no clean recipe' } },
    ];
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: ACTIVE,
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: REGISTRY,
      dashboardServiceActions: { '/r/a': actions },
    });
    const idle = await renderToString(<DashboardZone useStore={store} />);
    expect(idle).toContain('[Ctrl+O]');
    expect(idle).toContain('(no container)');
    expect(idle).toContain('Ctrl+L: no clean recipe');
    store.setState({ dashboardActionState: { '/r/a': { running: { actionId: 'restart-clean', text: 'Clean restart — recipe step 2/3' }, result: null } } });
    const running = await renderToString(<DashboardZone useStore={store} />);
    expect(running).toContain('Clean restart — recipe step 2/3');
    expect(running).toContain('Ctrl+R: operation in progress');
  });

  it('lists attention lines with a count, and the registry hint with its counts', async () => {
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: ACTIVE,
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: REGISTRY,
    });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('Attention (1)');
    expect(output).toContain('svc-a · uncommitted changes');
    expect(output).toContain('[:registry]');
  });

  it('shows single success lines when nothing needs attention and the registry is clear', async () => {
    const clean = { ...ACTIVE, services: [{ ...ACTIVE.services[0]!, workingTree: { ok: true, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } } }] };
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: clean,
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: { repoCount: 3, invalidManifests: 0, unreachable: 0, listingIssues: 0 },
    });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('Attention (0)');
    expect(output).toContain('Nothing needs attention.');
    expect(output).toContain('Registry healthy.');
  });

  it('prompts to create or choose an EDT when none is active, keeping the registry section', async () => {
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: { status: 'no-active-edt', edt: null, services: [] },
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: REGISTRY,
    });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('No active EDT.');
    expect(output).toContain('[e]');
    expect(output).toContain('3 repos');
  });

  it('shows [R] retry on a failed section without touching the other one', async () => {
    const store = seed({ dashboardServicesStatus: 'error', dashboardRegistryStatus: 'ready', dashboardRegistry: REGISTRY });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('Failed to load services.');
    expect(output).toContain('[R] retry');
    expect(output).toContain('3 repos');
  });

  it('does not render the sections behind the empty-registry prompt', async () => {
    const store = seed({ registryEmpty: true, dashboardServicesStatus: 'ready', dashboardServices: ACTIVE });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).not.toContain('svc-a');
  });

  it('says so when the active EDT has no services', async () => {
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: { status: 'active', edt: { ulid: 'e1', topic: 'topic-a', serviceCount: 0 }, services: [] },
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: REGISTRY,
    });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).toContain('This EDT has no services.');
  });

  it('keeps the banner and clips the service list at the minimum terminal height', async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ ...ACTIVE.services[0], service: `svc-${index}`, path: `/r/${index}` }));
    const store = seed({
      dashboardServicesStatus: 'ready',
      dashboardServices: { ...ACTIVE, edt: { ulid: 'e1', topic: 'topic-a', serviceCount: 20 }, services: many },
      dashboardRegistryStatus: 'ready',
      dashboardRegistry: REGISTRY,
      dashboardUpdatedAt: Date.now(),
    });
    const output = await renderToString(
      <BoundsProvider columns={80} rows={9}>
        <DashboardZone useStore={store} />
      </BoundsProvider>,
    );
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
    expect(output).toContain('svc-0');
    expect(output).not.toContain('svc-19');
    expect(output).toContain('more below');
  });

  it('probes nothing behind the empty-registry prompt', async () => {
    const calls: string[] = [];
    const store = createAppStore();
    store.setState({ registryEmpty: true, checkRegistryEmpty: noopCheck, loadDashboard: async () => void calls.push('load') });
    await renderToString(<DashboardZone useStore={store} />);
    expect(calls).toEqual([]);
  });
});
