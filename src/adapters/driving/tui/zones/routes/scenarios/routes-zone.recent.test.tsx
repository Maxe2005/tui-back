// tui/zones/routes: Recent routes section and Ctrl+R quick re-fire (real keypresses, fake fire port).
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../../store/app-store.js';
import type { RecentRoute } from '../../../store/slices/workspace/routes-slice.js';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { mount, press, lastFrame } from '../routes-zone.test-support.js';

const REPO = '/repos/gateway';
const TALL = 40;

const recent = (method: string, path: string, outcome: RecentRoute['outcome'] = { kind: 'status', status: 200, durationMs: 42 }): RecentRoute => ({
  repoPath: REPO,
  method,
  path,
  outcome,
});

function seedRecent(options: { recents?: RecentRoute[]; fired?: string[]; favorites?: Array<{ method: string; path: string; stale: boolean }> } = {}) {
  const fireRoute = vi.fn(async () => {});
  const store = createAppStore();
  store.setState({
    routesStatus: 'ready',
    routesRepoPath: REPO,
    routes: [
      { method: 'GET', path: '/health', summary: 'Health' },
      { method: 'GET', path: '/users/{id}', summary: 'One user' },
    ],
    routesError: null,
    loadRoutes: async () => {},
    refreshFavoriteRoutes: async () => {},
    favoriteRoutes: (options.favorites ?? []).map((f) => ({ repoPath: REPO, ...f })),
    recentRoutes: options.recents ?? [],
    responses: Object.fromEntries((options.fired ?? []).map((key) => [key, { status: 'fired' as const, result: { status: 200, durationMs: 1, body: '{}' } }])),
    fireRoute: fireRoute as unknown as () => Promise<void>,
  });
  return { store, fireRoute };
}

describe('RoutesZone recent routes', () => {
  it('renders the Recent section with status, duration and error code, hidden when empty', async () => {
    const empty = seedRecent();
    const first = mount(empty.store, TALL);
    try {
      await first.instance.waitUntilRenderFlush();
      expect(lastFrame(first.stdout)).not.toContain('RECENT');
    } finally {
      first.instance.unmount();
    }
    const { store } = seedRecent({
      recents: [recent('GET', '/health'), recent('GET', '/users/{id}', { kind: 'error', code: 'auth-error' })],
    });
    const { instance, stdout } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout);
      expect(frame).toContain('RECENT (2)');
      expect(frame).toContain('GET /health');
      expect(frame).toContain('200 · 42ms');
      expect(frame).toContain('auth-error');
    } finally {
      instance.unmount();
    }
  });

  it('Tab cycles list -> favorites -> recent -> list', async () => {
    const { store } = seedRecent({ recents: [recent('GET', '/health')] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('favorites');
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('recent');
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('list');
      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().routesPaneFocus).toBe('recent');
      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });

  it('Enter on a Recent row selects the route and opens Request without firing', async () => {
    const { store, fireRoute } = seedRecent({ recents: [recent('GET', '/users/{id}')] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().routesSelected).toBe(1);
      expect(fireRoute).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('Enter on a Recent row of an undiscovered route shows a notice', async () => {
    const { store, fireRoute } = seedRecent({ recents: [recent('GET', '/gone')] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneFocus).toBe('recent');
      expect(lastFrame(stdout)).toContain('not in the');
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on the list re-fires a fired route with its draft', async () => {
    const { store, fireRoute } = seedRecent({ fired: ['GET /health'] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /health', 'GET', '/health', undefined);
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on a never-fired route opens Request and sends nothing', async () => {
    const { store, fireRoute } = seedRecent();
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R with missing required params opens Request listing them, nothing sent', async () => {
    const { store, fireRoute } = seedRecent({ recents: [recent('GET', '/users/{id}')] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(lastFrame(stdout)).toContain('Missing required: id — nothing sent');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on a Recent row re-fires that route', async () => {
    const { store, fireRoute } = seedRecent({ recents: [recent('GET', '/health')] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /health', 'GET', '/health', undefined);
      expect(store.getState().routesSelected).toBe(0);
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on a stale favorite is refused with a notice', async () => {
    const { store, fireRoute } = seedRecent({ fired: ['GET /health'], favorites: [{ method: 'GET', path: '/gone', stale: true }] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(lastFrame(stdout)).toContain('stale: no longer');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on the Response tab re-fires in place', async () => {
    const { store, fireRoute } = seedRecent({ fired: ['GET /health'] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      store.setState({ routesPaneTab: 'response' });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledTimes(1);
      expect(store.getState().routesPaneFocus).toBe('detail');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on a live favorite re-fires it', async () => {
    const { store, fireRoute } = seedRecent({ fired: ['GET /health'], favorites: [{ method: 'GET', path: '/health', stale: false }] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /health', 'GET', '/health', undefined);
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R on a favorite hidden by the filter clears the filter and selects it', async () => {
    const { store, fireRoute } = seedRecent({ fired: ['GET /health'], favorites: [{ method: 'GET', path: '/health', stale: false }] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      for (const char of 'users') {
        await press(instance, stdin, char);
      }
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesFilter.value).toBe('users');
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /health', 'GET', '/health', undefined);
      expect(store.getState().routesFilter.value).toBe('');
      expect(store.getState().routesSelected).toBe(0);
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R with missing params from a Favorites row opens Request listing them, nothing sent', async () => {
    const { store, fireRoute } = seedRecent({ fired: ['GET /users/{id}'], favorites: [{ method: 'GET', path: '/users/{id}', stale: false }] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(lastFrame(stdout)).toContain('Missing required: id — nothing sent');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+R with missing params from a Recent row opens Request listing them, nothing sent', async () => {
    const { store, fireRoute } = seedRecent({ recents: [recent('GET', '/users/{id}')] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(lastFrame(stdout)).toContain('Missing required: id — nothing sent');
    } finally {
      instance.unmount();
    }
  });

  it('hands the focus back to the list when the Recent section empties', async () => {
    const { store } = seedRecent({ recents: [recent('GET', '/health')] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('recent');
      store.setState({ recentRoutes: [] });
      await instance.waitUntilRenderFlush();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });
});
