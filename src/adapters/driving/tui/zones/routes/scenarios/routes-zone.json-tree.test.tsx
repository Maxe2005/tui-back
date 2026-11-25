// tui/zones/routes: JsonTree, its body editor and panel cursor (real keypresses).
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../../store/app-store.js';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { RoutesZone } from '../routes-zone.js';
import { footerIdOf } from '../../../shared/test-support/mount-for-test.js';
import { mount, press, lastFrame } from '../routes-zone.test-support.js';

describe('RoutesZone JsonTree', () => {
  // Tree tests render tall (30 rows): the response tree + filter panel + both hint
  // lines need room — the shared 14-row stress viewport clips detail content, which is
  // correct bounded behavior but makes frame assertions meaningless.
  const BODY = '{"id":1,"tags":["a","b"],"nested":{"x":true}}';

  function seedTree(fireRoute: () => Promise<void> = async () => {}) {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'GET', path: '/users', summary: 'List users' },
        { method: 'POST', path: '/users', summary: 'Create a user' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: fireRoute as unknown as () => Promise<void>,
      responses: { 'GET /users': { status: 'fired', result: { status: 200, durationMs: 42, body: BODY } } },
      routesPaneFocus: 'detail',
      routesPaneTab: 'response',
    });
    return store;
  }

  function setBody(store: ReturnType<typeof createAppStore>, body: string) {
    store.setState({ responses: { 'GET /users': { status: 'fired', result: { status: 200, durationMs: 42, body } } } });
  }

  function treeSelected(store: ReturnType<typeof createAppStore>): number {
    return store.getState().jsonTreeStates['GET /users']?.selected ?? 0;
  }

  async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await press(instance, stdin, KEYS.escape);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await instance.waitUntilRenderFlush();
  }

  it('moves the tree cursor with arrows/Home/End without moving the list cursor', async () => {
    const store = seedTree();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      expect(treeSelected(store)).toBe(1);
      expect(store.getState().routesSelected).toBe(0);
      await press(instance, stdin, KEYS.end);
      expect(treeSelected(store)).toBe(6);
      expect(lastFrame(stdout)).toContain('x');
      await press(instance, stdin, KEYS.home);
      expect(treeSelected(store)).toBe(0);
      await press(instance, stdin, KEYS.up);
      expect(treeSelected(store)).toBe(0);
    } finally {
      instance.unmount();
    }
  });

  it('folds with ← (jumping to the parent when already folded) and unfolds with →', async () => {
    const store = seedTree();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      expect(treeSelected(store)).toBe(2);
      await press(instance, stdin, KEYS.left);
      expect(store.getState().jsonTreeStates['GET /users']?.foldedPaths).toEqual(['tags']);
      expect(lastFrame(stdout)).not.toContain('"a"');
      // ← on the already-folded container jumps to its parent (the root).
      await press(instance, stdin, KEYS.left);
      expect(treeSelected(store)).toBe(0);
      // → on an unfolded container is a no-op; on the folded one it reopens.
      await press(instance, stdin, KEYS.right);
      expect(store.getState().jsonTreeStates['GET /users']?.foldedPaths).toEqual(['tags']);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.right);
      expect(store.getState().jsonTreeStates['GET /users']?.foldedPaths).toEqual([]);
      expect(lastFrame(stdout)).toContain('"a"');
    } finally {
      instance.unmount();
    }
  });

  it('hides a key globally with h and allow-lists with H', async () => {
    const store = seedTree();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'h');
      expect(store.getState().jsonTreeStates['GET /users']?.hiddenKeys).toEqual(['id']);
      expect(lastFrame(stdout)).toContain('1 hidden · 1 rule');
      // The cursor already sits on `tags` (the row that slid into the hidden row's place).
      await press(instance, stdin, 'H');
      expect(store.getState().jsonTreeStates['GET /users']?.onlyKeys).toEqual(['tags']);
      expect(lastFrame(stdout)).not.toContain('nested');
    } finally {
      instance.unmount();
    }
  });

  it('opens the filter panel with f, removes per digit, toggles nulls, closes with Esc', async () => {
    const store = seedTree();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'h');
      await press(instance, stdin, 'f');
      expect(lastFrame(stdout)).toContain('[1] hide "id"');
      await press(instance, stdin, '1');
      expect(store.getState().jsonTreeStates['GET /users']?.hiddenKeys).toEqual([]);
      await press(instance, stdin, 'n');
      expect(store.getState().jsonTreeStates['GET /users']?.hideNulls).toBe(true);
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).not.toContain('[n] hide nulls');
      expect(store.getState().routesPaneTab).toBe('response');
      // Esc on Response returns to the Request tab, not to the list.
      await pressEscape(instance, stdin);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().routesPaneFocus).toBe('detail');
    } finally {
      instance.unmount();
    }
  });

  it('returns focus to the list on Esc (via Request) with every list key working as before', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedTree(fireRoute);
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await pressEscape(instance, stdin);
      await pressEscape(instance, stdin);
      expect(store.getState().routesPaneFocus).toBe('list');
      expect(store.getState().zoneInputCaptured).toBe(false);
      await press(instance, stdin, KEYS.down);
      expect(store.getState().routesSelected).toBe(1);
      // Enter opens the Request tab — it never fires; Ctrl+R does.
      await press(instance, stdin, KEYS.enter);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('POST /users', 'POST', '/users', undefined);
    } finally {
      instance.unmount();
    }
  });

  it('folds/unfolds whole depth levels with -/+ through the zone', async () => {
    const store = seedTree();
    setBody(store, '{"a":{"b":{"c":1}},"d":2}');
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      const folds = () => store.getState().jsonTreeStates['GET /users']?.foldedPaths ?? [];
      expect(folds()).toEqual([]);
      await press(instance, stdin, '-');
      expect(folds()).toEqual(['a.b']);
      await press(instance, stdin, '-');
      expect(folds()).toEqual(['a.b', 'a']);
      await press(instance, stdin, '+');
      expect(folds()).toEqual(['a.b']);
      await press(instance, stdin, '+');
      expect(folds()).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('clears all rules with c and closes the panel with f without unfocusing', async () => {
    const store = seedTree();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'h');
      await press(instance, stdin, 'f');
      expect(lastFrame(stdout)).toContain('[1] hide "id"');
      await press(instance, stdin, 'c');
      expect(store.getState().jsonTreeStates['GET /users']?.hiddenKeys).toEqual([]);
      expect(lastFrame(stdout)).toContain('Filters — 0 rules');
      await press(instance, stdin, 'f');
      expect(lastFrame(stdout)).not.toContain('Filters —');
      expect(store.getState().routesPaneTab).toBe('response');
    } finally {
      instance.unmount();
    }
  });

  it('scrolls a raw fallback with arrows and shows the selected line', async () => {
    const store = seedTree();
    setBody(store, Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n'));
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('not JSON');
      await press(instance, stdin, KEYS.end);
      expect(treeSelected(store)).toBe(29);
      expect(lastFrame(stdout)).toContain('› line-29');
      await press(instance, stdin, KEYS.pageUp);
      expect(treeSelected(store)).toBeLessThan(29);
      await press(instance, stdin, KEYS.home);
      expect(treeSelected(store)).toBe(0);
      expect(lastFrame(stdout)).toContain('› line-0');
    } finally {
      instance.unmount();
    }
  });

describe('RoutesZone body editor', () => {
  const EDITOR_KEY = 'POST /users';

  function seedEditor(fireRoute: () => Promise<void> = async () => {}) {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        {
          method: 'POST',
          path: '/users',
          summary: 'Create a user',
          bodyExample: { name: 'ada', age: 36, tags: ['x'] },
          bodyContentType: 'application/json',
        },
        { method: 'GET', path: '/users', summary: 'List users' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: fireRoute as unknown as () => Promise<void>,
    });
    return store;
  }

  function draftOf(store: ReturnType<typeof createAppStore>): unknown {
    return (store.getState().bodyDrafts as Record<string, unknown>)[EDITOR_KEY];
  }

  function errorsOf(store: ReturnType<typeof createAppStore>): Record<string, { reason: string; kind: string }> {
    return store.getState().bodyEditErrors[EDITOR_KEY] ?? {};
  }

  async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await press(instance, stdin, KEYS.escape);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await instance.waitUntilRenderFlush();
  }

  it('opens the editor with e on a route carrying a body, seeded from the example', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      const frame = lastFrame(stdout);
      expect(frame).toContain('▸ BODY');
      expect(frame).toContain('POST /users');
      expect(frame).toContain('name');
      expect(frame).toContain('"ada"');
      expect(frame).toContain('0 lines hidden — still sent');
      expect(footerIdOf(store)).toBe('routes-body-tree-add');
      expect(draftOf(store)).toEqual({ name: 'ada', age: 36, tags: ['x'] });
    } finally {
      instance.unmount();
    }
  });

  it('leaves e inert with no hint on a route with neither example nor content type', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      expect(footerIdOf(store)).toBe('routes-list');
      await press(instance, stdin, 'e');
      expect(store.getState().routesPaneFocus).toBe('list');
      expect(store.getState().bodyDrafts).toEqual({});
    } finally {
      instance.unmount();
    }
  });

  it('edits a scalar validly and keeps an invalid number in error without coercing', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('Edit name');
      await press(instance, stdin, 'X');
      await press(instance, stdin, KEYS.enter);
      expect(draftOf(store)).toMatchObject({ name: 'adaX' });
      expect(errorsOf(store)).toEqual({});
      expect(lastFrame(stdout)).toContain('"adaX"');

      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 'x');
      await press(instance, stdin, KEYS.enter);
      expect(draftOf(store)).toMatchObject({ age: '36x' });
      expect(errorsOf(store)['age']?.reason).toContain('expected a number');
      const frame = lastFrame(stdout);
      expect(frame).toContain('✖');
      expect(frame).toContain('expected a number');
    } finally {
      instance.unmount();
    }
  });

  it('re-validates a fixed entry against its pre-error kind (number stays a number)', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 'x');
      await press(instance, stdin, KEYS.enter);
      expect(errorsOf(store)['age']?.kind).toBe('number');
      // Re-open the errored row: the stored text re-validates as a number, so fixing
      // it writes a number (not a string) and clears the entry.
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, '7');
      await press(instance, stdin, KEYS.enter);
      expect(draftOf(store)).toMatchObject({ age: 37 });
      expect(errorsOf(store)).toEqual({});
      expect(lastFrame(stdout)).not.toContain('✖');
    } finally {
      instance.unmount();
    }
  });

  it('cancels an inline edit on Esc and closes the editor on a second Esc', async () => {    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 'X');
      await pressEscape(instance, stdin);
      expect(draftOf(store)).toMatchObject({ name: 'ada' });
      expect(lastFrame(stdout)).toContain('▸ BODY');
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).not.toContain('▸ BODY');
      expect(footerIdOf(store)).toBe('routes-list-editable');
    } finally {
      instance.unmount();
    }
  });

  it('prompts for an object key, rejects duplicates, and appends array items directly', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, 'a');
      expect(lastFrame(stdout)).toContain('Key name');
      await press(instance, stdin, 'i');
      await press(instance, stdin, 'd');
      await press(instance, stdin, KEYS.enter);
      expect(draftOf(store)).toMatchObject({ id: '' });

      await press(instance, stdin, 'a');
      await press(instance, stdin, 'i');
      await press(instance, stdin, 'd');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('duplicate key');
      expect(lastFrame(stdout)).toContain('Key name');
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).toContain('▸ BODY');

      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'a');
      expect(draftOf(store)).toMatchObject({ tags: ['x', ''] });
    } finally {
      instance.unmount();
    }
  });

  it('d / D leave the body untouched on any line', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'd');
      await press(instance, stdin, 'D');
      expect(draftOf(store)).toEqual({ name: 'ada', age: 36, tags: ['x'] });
      expect(lastFrame(stdout)).toContain('"x"');
    } finally {
      instance.unmount();
    }
  });

  it('cycles scalar types with t, falling back to string when the text does not re-parse', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 't');
      // 'ada' is not a number: no error state, the value visibly stays a string.
      expect(draftOf(store)).toMatchObject({ name: 'ada' });
      expect(errorsOf(store)).toEqual({});
      expect(lastFrame(stdout)).not.toContain('✖');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 't');
      expect(draftOf(store)).toMatchObject({ age: true });
      expect(errorsOf(store)['age']).toBeUndefined();
    } finally {
      instance.unmount();
    }
  });

  it('keeps an invalid raw buffer open with line/column and preserves the previous body', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, 'r');
      expect(lastFrame(stdout)).toContain('Raw JSON');
      await press(instance, stdin, 'x');
      await pressEscape(instance, stdin);
      const frame = lastFrame(stdout);
      expect(frame).toContain('Raw JSON');
      expect(frame).toContain('✖');
      expect(frame).toContain('line ');
      expect(frame).toContain('column');
      expect(draftOf(store)).toEqual({ name: 'ada', age: 36, tags: ['x'] });
      await press(instance, stdin, '\x1b[3~');
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).not.toContain('Raw JSON');
      expect(lastFrame(stdout)).toContain('▸ BODY');
      expect(draftOf(store)).toEqual({ name: 'ada', age: 36, tags: ['x'] });
    } finally {
      instance.unmount();
    }
  });

  it('restores the last body plus folds and filters on revisit', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 'X');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 'h');
      expect(lastFrame(stdout)).toContain('1 line hidden — still sent');
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).not.toContain('▸ BODY');
      await press(instance, stdin, 'e');
      const frame = lastFrame(stdout);
      // The edited body is restored but stays hidden by the surviving filter — the
      // draft (not the hidden row) proves the body survived the revisit.
      expect(frame).not.toContain('"adaX"');
      expect(frame).toContain('1 line hidden — still sent');
      expect(draftOf(store)).toMatchObject({ name: 'adaX' });
      // The body tree keeps its own state, apart from the response tree.
      expect(store.getState().jsonTreeStates[`${EDITOR_KEY} #body`]).toMatchObject({ hiddenKeys: ['name'] });
      expect(store.getState().jsonTreeStates[EDITOR_KEY]).toBeUndefined();
    } finally {
      instance.unmount();
    }
  });

  it('starts a non-JSON body empty with the r hint', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [{ method: 'POST', path: '/upload', summary: 'Upload', bodyContentType: 'multipart/form-data' }],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      const frame = lastFrame(stdout);
      expect(frame).toContain('▸ BODY');
      expect(frame).toContain('Empty body');
      expect(frame).toContain('press r');
    } finally {
      instance.unmount();
    }
  });

  it('never fires on Enter; Ctrl+R sends the edited body draft', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedEditor(fireRoute);
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.enter);
      expect(fireRoute).not.toHaveBeenCalled();
      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(fireRoute).not.toHaveBeenCalled();
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledTimes(1);
      expect(fireRoute).toHaveBeenCalledWith('POST /users', 'POST', '/users', { body: { name: 'ada', age: 36, tags: ['x'] } });
    } finally {
      instance.unmount();
    }
  });

  it('T1: preserves errors on append and leaves them untouched when d is pressed', async () => {
    const store = seedEditor();
    store.getState().ensureBodyDraft(EDITOR_KEY, { name: 'ada', scores: [1, 2, 3] });
    const scoresError = { reason: 'expected a number, got "x"', kind: 'number' as const };
    store.getState().setBodyEditErrors(EDITOR_KEY, {
      name: { reason: 'expected a number, got "ada"', kind: 'number' },
      'scores[2]': scoresError,
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      // Rows: root, name, scores, [0], [1], [2] — `d` on `name` does nothing.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'd');
      expect(draftOf(store)).toMatchObject({ name: 'ada', scores: [1, 2, 3] });
      expect(Object.keys(errorsOf(store)).sort()).toEqual(['name', 'scores[2]']);
      // Append to `scores`: shifts no indices, so the sibling error is preserved.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'a');
      expect(draftOf(store)).toMatchObject({ scores: [1, 2, 3, ''] });
      expect(errorsOf(store)['scores[2]']).toEqual(scoresError);
      expect(lastFrame(stdout)).toContain('✖');
    } finally {
      instance.unmount();
    }
  });

  it('T2: clears the error map when raw mode replaces the body with valid JSON', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 'x');
      await press(instance, stdin, KEYS.enter);
      expect(errorsOf(store)['age']).toBeDefined();
      await press(instance, stdin, 'r');
      expect(lastFrame(stdout)).toContain('Raw JSON');
      await press(instance, stdin, ' ');
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).not.toContain('Raw JSON');
      expect(lastFrame(stdout)).not.toContain('✖');
      expect(errorsOf(store)).toEqual({});
    } finally {
      instance.unmount();
    }
  });

  it('T3: builds a content-type-only body from an empty raw buffer', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [{ method: 'POST', path: '/upload', summary: 'Upload', bodyContentType: 'multipart/form-data' }],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      expect(lastFrame(stdout)).toContain('Empty body');
      expect(lastFrame(stdout)).not.toContain('[a] add');
      // Esc on the empty buffer cancels instead of trapping on a parse error.
      await press(instance, stdin, 'r');
      expect(lastFrame(stdout)).toContain('Raw JSON');
      await pressEscape(instance, stdin);
      expect(lastFrame(stdout)).not.toContain('Raw JSON');
      expect(lastFrame(stdout)).toContain('Empty body');
      expect(store.getState().bodyDrafts['POST /upload']).toBeUndefined();
      // Typing a valid object then leaving writes it as the draft.
      await press(instance, stdin, 'r');
      for (const char of ['{', '"', 'a', '"', ':', '1', '}']) {
        await press(instance, stdin, char);
      }
      await pressEscape(instance, stdin);
      expect(store.getState().bodyDrafts['POST /upload']).toEqual({ a: 1 });
      expect(lastFrame(stdout)).toContain('{1}');
      expect(lastFrame(stdout)).not.toContain('Empty body');
    } finally {
      instance.unmount();
    }
  });

  it('T4: opens null and scalar-root seeds as editable rows, never the empty state', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'POST', path: '/maybe', summary: 'Maybe', bodyExample: null, bodyContentType: 'application/json' },
        { method: 'POST', path: '/count', summary: 'Count', bodyExample: 42, bodyContentType: 'application/json' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      let frame = lastFrame(stdout);
      expect(frame).toContain('▸ BODY');
      expect(frame).toContain('null');
      expect(frame).not.toContain('Empty body');
      expect(store.getState().bodyDrafts['POST /maybe']).toBeNull();
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'e');
      frame = lastFrame(stdout);
      expect(frame).toContain('42');
      expect(frame).not.toContain('Empty body');
      expect(store.getState().bodyDrafts['POST /count']).toBe(42);
    } finally {
      instance.unmount();
    }
  });
});

describe('RoutesZone JsonTree panel cursor', () => {
  it('navigates panel rules with a cursor and removes the highlighted one with Space', async () => {
    const store = seedTree();
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      // Two rules: hide "id" (cursor starts on it) + allow "tags".
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'h');
      await press(instance, stdin, 'H');
      await press(instance, stdin, 'f');
      expect(lastFrame(stdout)).toContain('› [1] hide "id"');
      await press(instance, stdin, KEYS.down);
      expect(lastFrame(stdout)).toContain('› [2] only "tags"');
      await press(instance, stdin, KEYS.home);
      expect(lastFrame(stdout)).toContain('› [1] hide "id"');
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, ' ');
      expect(store.getState().jsonTreeStates['GET /users']?.onlyKeys).toEqual([]);
      expect(store.getState().jsonTreeStates['GET /users']?.hiddenKeys).toEqual(['id']);
      expect(store.getState().routesPaneTab).toBe('response');
    } finally {
      instance.unmount();
    }
  });
});
// Closes describe('RoutesZone JsonTree') — the body editor block above is nested inside it and
// shares its seedTree/mount helpers.
});
