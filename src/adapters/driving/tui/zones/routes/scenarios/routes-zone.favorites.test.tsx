// tui/zones/routes: Favorites pane above the route list and the `*` toggle (real keypresses, in-memory favorites port).
import { describe, it, expect } from 'vitest';
import { ok, err } from '../../../../../../core/result.js';
import type { FavoriteWithStale } from '../../../../../../core/insight/routes/favorites.js';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { seed, mount, press, lastFrame } from '../routes-zone.test-support.js';

const REPO = '/repos/gateway';
const TALL = 40;

function seedWithFavorites(initial: FavoriteWithStale[], failToggle = false) {
  const store = seed();
  let favorites = [...initial];
  store.setState({
    favoriteRoutes: favorites,
    refreshFavoriteRoutes: async () => {},
    toggleFavoriteRoute: async (method: string, path: string, repoPath?: string) => {
      if (failToggle) {
        return err('io-error', 'disk full');
      }
      const repo = repoPath ?? REPO;
      const present = favorites.some((f) => f.repoPath === repo && f.method === method && f.path === path);
      favorites = present
        ? favorites.filter((f) => !(f.repoPath === repo && f.method === method && f.path === path))
        : [...favorites, { repoPath: repo, method, path, stale: false }];
      store.setState({ favoriteRoutes: favorites });
      return ok({ favorite: !present });
    },
  });
  return store;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('RoutesZone favorites pane', () => {
  it('renders the pane above the list with a teaching line when empty', async () => {
    const store = seedWithFavorites([]);
    const { instance, stdout } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout);
      expect(frame).toContain('FAVORITES (0)');
      expect(frame).toContain('press * on a route to add it');
      expect(frame.indexOf('FAVORITES')).toBeLessThan(frame.indexOf('ROUTES ('));
    } finally {
      instance.unmount();
    }
  });

  it('lists only the displayed repo favorites with METHOD path and summary, dim stale suffix', async () => {
    const store = seedWithFavorites([
      { repoPath: REPO, method: 'POST', path: '/resource-1/{id}', stale: false },
      { repoPath: REPO, method: 'GET', path: '/gone', stale: true },
      { repoPath: '/repos/other', method: 'GET', path: '/elsewhere', stale: false },
    ]);
    const { instance, stdout } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout);
      expect(frame).toContain('FAVORITES (2)');
      expect(frame).toContain('POST /resource-1/{id}  SUMMARY-1');
      expect(frame).toContain('GET /gone');
      expect(frame).toContain('stale');
      expect(frame).not.toContain('/elsewhere');
    } finally {
      instance.unmount();
    }
  });

  it('`*` on the list toggles the cursor route and the pane updates at once', async () => {
    const store = seedWithFavorites([]);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '*');
      await settle();
      await instance.waitUntilRenderFlush();
      expect(store.getState().favoriteRoutes).toEqual([{ repoPath: REPO, method: 'GET', path: '/resource-0/{id}', stale: false }]);
      expect(lastFrame(stdout)).toContain('FAVORITES (1)');
      await press(instance, stdin, '*');
      await settle();
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('FAVORITES (0)');
    } finally {
      instance.unmount();
    }
  });

  it('`*` types a literal star in the filter and does not toggle', async () => {
    const store = seedWithFavorites([]);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      await press(instance, stdin, '*');
      await settle();
      expect(store.getState().favoriteRoutes).toEqual([]);
      expect(lastFrame(stdout)).toContain('Filter: *');
    } finally {
      instance.unmount();
    }
  });

  it('`*` in the open pane toggles the open route', async () => {
    const store = seedWithFavorites([]);
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneFocus).toBe('detail');
      await press(instance, stdin, '*');
      await settle();
      expect(store.getState().favoriteRoutes).toEqual([{ repoPath: REPO, method: 'GET', path: '/resource-0/{id}', stale: false }]);
    } finally {
      instance.unmount();
    }
  });

  it('shows a notice and leaves the state unchanged when the toggle fails', async () => {
    const store = seedWithFavorites([], true);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '*');
      await settle();
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('— not saved');
      expect(store.getState().favoriteRoutes).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('Tab focuses the pane, arrows move, Enter opens the route without firing, Esc/Tab go back', async () => {
    let fired = 0;
    const store = seedWithFavorites([
      { repoPath: REPO, method: 'GET', path: '/resource-0/{id}', stale: false },
      { repoPath: REPO, method: 'POST', path: '/resource-3/{id}', stale: false },
    ]);
    store.setState({ fireRoute: async () => { fired += 1; } });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('favorites');
      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesSelected).toBe(3);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(fired).toBe(0);
      await press(instance, stdin, KEYS.escape);
      await settle();
      expect(store.getState().routesPaneFocus).toBe('list');
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('favorites');
      await press(instance, stdin, KEYS.escape);
      await settle();
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });

  it('Enter clears a filter that hides the favorite, selecting it in the full list', async () => {
    const store = seedWithFavorites([{ repoPath: REPO, method: 'POST', path: '/resource-3/{id}', stale: false }]);
    store.setState({ routesFilter: { value: 'resource-0', cursor: 10 } });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesFilter.value).toBe('');
      expect(store.getState().routesSelected).toBe(3);
      expect(store.getState().routesPaneFocus).toBe('detail');
    } finally {
      instance.unmount();
    }
  });

  it('refuses Enter on a stale favorite and removes it with `*` or `d`', async () => {
    const store = seedWithFavorites([
      { repoPath: REPO, method: 'GET', path: '/gone', stale: true },
      { repoPath: REPO, method: 'GET', path: '/gone2', stale: true },
    ]);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);
      await instance.waitUntilRenderFlush();
      expect(store.getState().routesPaneFocus).toBe('favorites');
      expect(lastFrame(stdout)).toContain('stale: no longer');
      await press(instance, stdin, 'd');
      await settle();
      expect(store.getState().favoriteRoutes).toEqual([{ repoPath: REPO, method: 'GET', path: '/gone2', stale: true }]);
      await press(instance, stdin, '*');
      await settle();
      expect(store.getState().favoriteRoutes).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('keeps the list rows on a small terminal: the pane shrinks to its header', async () => {
    const store = seedWithFavorites([{ repoPath: REPO, method: 'GET', path: '/resource-0/{id}', stale: false }]);
    const { instance, stdout } = mount(store, 14);
    try {
      await instance.waitUntilRenderFlush();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const frame = lastFrame(stdout);
      expect(frame.split('\n').length).toBeLessThanOrEqual(14);
      expect(frame).toContain('FAVORITES (1)');
      expect(frame).toContain('GET /resource-0/{id}');
      expect(frame).toContain('FOOTER-ROW');
    } finally {
      instance.unmount();
    }
  });
});
