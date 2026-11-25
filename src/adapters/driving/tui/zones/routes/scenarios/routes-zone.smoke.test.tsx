// tui/zones/routes: the smoke run in the Routes zone (real keypresses; the store's run actions are replaced by
// recording fakes that write the table state, so the I/O matrix is exercised end to end through the UI).
import { describe, it, expect } from 'vitest';
import { ok, err } from '../../../../../../core/result.js';
import type { FavoriteWithStale } from '../../../../../../core/insight/routes/favorites.js';
import type { SmokeState } from '../../../store/slices/workspace/routes-slice.js';
import type { SmokeTableRow } from '../logic/routes-smoke.logic.js';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { seed, mount, press, lastFrame } from '../routes-zone.test-support.js';

const REPO = '/repos/gateway';
const TALL = 40;
const GET0: FavoriteWithStale = { repoPath: REPO, method: 'GET', path: '/resource-0/{id}', stale: false };
const POST1: FavoriteWithStale = { repoPath: REPO, method: 'POST', path: '/resource-1/{id}', stale: false };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function setup(favorites: FavoriteWithStale[]) {
  const store = seed();
  const calls: boolean[] = [];
  let cancels = 0;
  store.setState({
    favoriteRoutes: favorites,
    refreshFavoriteRoutes: async () => {},
    startSmokeRun: async (includeMutating: boolean) => {
      if (store.getState().smoke?.running === true) {
        return err('smoke-run-in-progress', 'smoke run already in progress');
      }
      calls.push(includeMutating);
      return ok(undefined);
    },
    cancelSmokeRun: () => {
      cancels += 1;
    },
    keepSmokeResponse: () => true,
  });
  return { store, calls, cancels: () => cancels };
}

const row = (fav: FavoriteWithStale, extra: Partial<SmokeTableRow>): SmokeTableRow => ({
  repoPath: fav.repoPath,
  method: fav.method,
  path: fav.path,
  phase: 'pending',
  ...extra,
});

function setSmoke(store: ReturnType<typeof seed>, smoke: SmokeState | null) {
  store.setState({ smoke });
}

describe('RoutesZone smoke run', () => {
  it('`t` from the Favorites pane starts a safe run and the table shows glyph, status and the summary', async () => {
    const { store, calls } = setup([GET0]);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 't');
      await settle();
      expect(calls).toEqual([false]);
      setSmoke(store, {
        running: false,
        error: null,
        visible: true,
        rows: [row(GET0, { phase: 'done', row: { repoPath: REPO, method: 'GET', path: GET0.path, outcome: 'ok', status: 200, durationMs: 12 } })],
      });
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout);
      expect(frame).toContain('SMOKE RUN 1/1 — done');
      expect(frame).toContain('› ✔ 200 · 12ms  GET /resource');
      expect(frame).toContain('ok 1 · client-error 0');
      expect(frame).toContain('server-error 0 · auth-error 0');
      expect(frame).toContain('network-error 0 · skipped 0');
    } finally {
      instance.unmount();
    }
  });

  it('shows pending and firing rows with their own glyphs', async () => {
    const { store } = setup([GET0, POST1]);
    setSmoke(store, { running: true, error: null, visible: true, rows: [row(GET0, { phase: 'firing' }), row(POST1, { phase: 'pending' })] });
    const { instance, stdout } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout);
      expect(frame).toContain('SMOKE RUN 0/2 — running');
      expect(frame).toContain('firing…');
      expect(frame).toContain('pending');
    } finally {
      instance.unmount();
    }
  });

  it('asks before firing mutating favorites: Enter includes them, Esc runs the safe ones only', async () => {
    const { store, calls } = setup([GET0, POST1]);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 't');
      expect(lastFrame(stdout)).toContain('POST /resource-1/{id}');
      expect(calls).toEqual([]);
      await press(instance, stdin, KEYS.enter);
      await settle();
      expect(calls).toEqual([true]);
      await press(instance, stdin, 't');
      await press(instance, stdin, KEYS.escape);
      await settle();
      await settle();
      expect(calls).toEqual([true, false]);
    } finally {
      instance.unmount();
    }
  });

  it('shows a notice and starts nothing with no favorites', async () => {
    const { store, calls } = setup([]);
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 't');
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('no favorites');
      expect(calls).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('rejects `t` during a run with a notice, and Esc cancels the run in flight', async () => {
    const { store, calls, cancels } = setup([GET0]);
    setSmoke(store, { running: true, error: null, visible: true, rows: [row(GET0, { phase: 'firing' })] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 't');
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('smoke run already in progress');
      expect(calls).toEqual([]);
      await press(instance, stdin, KEYS.escape);
      await settle();
      expect(cancels()).toBe(1);
      expect(store.getState().smoke?.visible).toBe(true);
    } finally {
      instance.unmount();
    }
  });

  it('shows cancelled rows as skipped and Esc on a finished table closes it', async () => {
    const { store } = setup([GET0]);
    setSmoke(store, {
      running: false,
      error: null,
      visible: true,
      rows: [row(GET0, { phase: 'done', row: { repoPath: REPO, method: 'GET', path: GET0.path, outcome: 'skipped', reason: 'cancelled' } })],
    });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('– skipped (cancelled)');
      expect(lastFrame(stdout)).toContain('skipped 1');
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.escape);
      await settle();
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('FAVORITES (1)');
    } finally {
      instance.unmount();
    }
  });

  it('Enter on a fired row opens the route on Response; on a skipped row it opens Request with a notice', async () => {
    const { store } = setup([GET0, POST1]);
    const response = { status: 200, durationMs: 5, body: '{"x":1}' };
    setSmoke(store, {
      running: false,
      error: null,
      visible: true,
      rows: [
        row(GET0, { phase: 'done', response, row: { repoPath: REPO, method: 'GET', path: GET0.path, outcome: 'ok', status: 200, durationMs: 5 } }),
        row(POST1, { phase: 'done', row: { repoPath: REPO, method: 'POST', path: POST1.path, outcome: 'skipped', reason: 'skipped (mutating)' } }),
      ],
    });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneTab).toBe('response');
      expect(store.getState().routesPaneFocus).toBe('detail');
      await press(instance, stdin, KEYS.escape);
      await settle();
      await press(instance, stdin, KEYS.escape);
      await settle();
      await press(instance, stdin, KEYS.escape);
      await settle();
      expect(store.getState().routesPaneFocus).toBe('list');
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(lastFrame(stdout)).toContain('no response: skipped (mutating)');
    } finally {
      instance.unmount();
    }
  });

  it('keeps the table intact when the zone is left and re-entered', async () => {
    const { store } = setup([GET0]);
    setSmoke(store, { running: true, error: null, visible: true, rows: [row(GET0, { phase: 'firing' })] });
    const first = mount(store, TALL);
    await first.instance.waitUntilRenderFlush();
    first.instance.unmount();
    const second = mount(store, TALL);
    try {
      await second.instance.waitUntilRenderFlush();
      expect(lastFrame(second.stdout)).toContain('SMOKE RUN 0/1 — running');
    } finally {
      second.instance.unmount();
    }
  });

  it('Tab and Shift+Tab leave the smoke table (no focus trap)', async () => {
    const { store } = setup([GET0]);
    setSmoke(store, { running: false, error: null, visible: true, rows: [row(GET0, { phase: 'firing' })] });
    const { instance, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).toBe('favorites');
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().routesPaneFocus).not.toBe('favorites');
      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().routesPaneFocus).toBe('favorites');
      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().routesPaneFocus).not.toBe('favorites');
    } finally {
      instance.unmount();
    }
  });

  it('keeps the progress header visible next to a notice', async () => {
    const { store } = setup([GET0]);
    setSmoke(store, { running: true, error: null, visible: true, rows: [row(GET0, { phase: 'firing' })] });
    const { instance, stdout, stdin } = mount(store, TALL);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 't');
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout);
      expect(frame).toContain('SMOKE RUN 0/1 — running');
      expect(frame).toContain('smoke run already in progress');
    } finally {
      instance.unmount();
    }
  });
});
