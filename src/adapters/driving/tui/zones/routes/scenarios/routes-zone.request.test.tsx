// tui/zones/routes: request step and sub-tabs (real keypresses).
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../../store/app-store.js';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { RoutesZone } from '../routes-zone.js';
import { footerIdOf } from '../../../shared/test-support/mount-for-test.js';
import { mount, press, lastFrame } from '../routes-zone.test-support.js';

describe('RoutesZone request step & sub-tabs', () => {
  function seedWorkbench(fireRoute: (...args: unknown[]) => Promise<void> = async () => {}) {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'GET', path: '/health', summary: 'Health' },
        {
          method: 'GET',
          path: '/users/{id}',
          summary: 'One user',
          parameters: [{ name: 'verbose', in: 'query', required: false }],
        },
        { method: 'POST', path: '/users', summary: 'Create', bodyExample: { name: 'ada' }, bodyContentType: 'application/json' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: fireRoute as unknown as () => Promise<void>,
    });
    return store;
  }

  async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await press(instance, stdin, KEYS.escape);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await instance.waitUntilRenderFlush();
  }

  async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
    for (const char of text) {
      await press(instance, stdin, char);
    }
  }

  it('Enter opens the Request tab with captured input, never fires; Esc returns to the list', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().zoneInputCaptured).toBe(true);
      expect(footerIdOf(store)).toMatch(/^routes-(section|rows)/);
      await pressEscape(instance, stdin);
      expect(store.getState().routesPaneFocus).toBe('list');
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
    }
  });

  it('fires a plain GET in two keypresses (Enter, Ctrl+R)', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /health', 'GET', '/health', undefined);
    } finally {
      instance.unmount();
    }
  });

  it('blocks a fire with missing required params, then fires the substituted path with query', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('id* = —');
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(lastFrame(stdout)).toContain('Missing required: id — nothing sent');

      // Fill `id` inline, then the optional `verbose` query row (Tab → Query).
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, '4 2');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.tab);
      expect(lastFrame(stdout)).toContain('▸ QUERY');
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'yes');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /users/{id}', 'GET', '/users/4%202', { query: { verbose: 'yes' } });
      expect(lastFrame(stdout)).not.toContain('Missing required');
    } finally {
      instance.unmount();
    }
  });

  it('adds and edits header rows, duplicates are rejected, d never deletes a row', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      expect(lastFrame(stdout)).toContain('▸ HEADERS');
      await press(instance, stdin, 'a');
      await type(instance, stdin, 'X-T');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, '1');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().requestDrafts['GET /health']?.headers).toEqual([{ name: 'X-T', value: '1', required: false }]);
      await press(instance, stdin, 'a');
      await type(instance, stdin, 'x-t');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('already exists');
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenLastCalledWith('GET /health', 'GET', '/health', { headers: { 'X-T': '1' } });
      await press(instance, stdin, 'd');
      await press(instance, stdin, 'D');
      expect(store.getState().requestDrafts['GET /health']?.headers).toEqual([{ name: 'X-T', value: '1', required: false }]);
    } finally {
      instance.unmount();
    }
  });

  it('blocks a fire while the body has validation errors', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    store.getState().ensureBodyDraft('POST /users', { name: 'x' });
    store.getState().setBodyEditError('POST /users', 'name', { reason: 'expected a number, got "x"', kind: 'number' });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(lastFrame(stdout)).toContain('Fix the body first');
    } finally {
      instance.unmount();
    }
  });

  it('switches sub-tabs with Ctrl+→/← and Ctrl+N/P without wrapping', async () => {
    const store = seedWorkbench();
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.ctrlRight);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlRight);
      expect(store.getState().routesPaneTab).toBe('response');
      await press(instance, stdin, KEYS.ctrlN);
      expect(store.getState().routesPaneTab).toBe('response');
      await press(instance, stdin, KEYS.ctrlP);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlP);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.ctrlN);
      expect(store.getState().routesPaneTab).toBe('request');
      // Number keys and [ ] never switch tabs.
      await press(instance, stdin, '1');
      await press(instance, stdin, '[');
      expect(store.getState().routesPaneTab).toBe('request');
    } finally {
      instance.unmount();
    }
  });

  it('keeps each route’s draft and last response, and returns to an intact draft after a fire', async () => {
    const store = seedWorkbench();
    store.setState({
      fireRoute: async (routeKey: string) => {
        store.setState({
          routesPaneTab: 'response',
          responses: { ...store.getState().responses, [routeKey]: { status: 'fired', result: { status: 204, durationMs: 3, body: '' } } },
        });
      },
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 'a');
      await type(instance, stdin, 'X-A');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(store.getState().routesPaneTab).toBe('response');
      expect(lastFrame(stdout)).toContain('204 · 3ms · 0 B');
      // Esc on Response → Request: the draft is intact and can be re-fired in place.
      await pressEscape(instance, stdin);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(lastFrame(stdout)).toContain('X-A = —');
      // Leave, visit another route, come back: draft and response both survive.
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.down);
      expect(lastFrame(stdout)).not.toContain('X-A');
      await press(instance, stdin, KEYS.up);
      expect(lastFrame(stdout)).toContain('X-A = —');
      store.getState().setRoutesPaneTab('response');
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('204 · 3ms');
    } finally {
      instance.unmount();
    }
  });
});
