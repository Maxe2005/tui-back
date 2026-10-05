// tui/zones/dashboard: render tests for the empty-registry prompt (checked before any other
// Dashboard content) and the ZonePlaceholder fallback. checkRegistryEmpty is stubbed in tests
// that seed a registryEmpty/registryEmptyStatus combination: the mount effect always calls it,
// and on an unwired store the real call sets registryEmptyStatus to 'error', clobbering the
// seeded state (same reasoning as edts-zone.test.tsx's noopLoad).
import { createElement } from 'react';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
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

  it('shows the existing (unchanged) placeholder content when the registry is non-empty — no registry prompt', async () => {
    const store = createAppStore();
    store.setState({ registryEmpty: false, checkRegistryEmpty: noopCheck });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).not.toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).toContain('DASHBOARD');
    // The banner is permanent — shows above the placeholder content too, not just the
    // empty-registry prompt.
    for (const line of BANNER_LINES) {
      expect(output).toContain(line);
    }
  });

  it('shows the existing placeholder content (never assumes empty) before the registry check resolves', async () => {
    const store = createAppStore();
    store.setState({ registryEmpty: null, checkRegistryEmpty: noopCheck });
    const output = await renderToString(<DashboardZone useStore={store} />);
    expect(output).not.toContain(EMPTY_REGISTRY_MESSAGE);
    expect(output).toContain('DASHBOARD');
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
    expect(output).not.toContain('DASHBOARD');
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
