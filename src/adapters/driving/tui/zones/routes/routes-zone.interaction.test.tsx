// tui/zones/routes: bounded list + route filter (real keypresses via the fake-tty technique
// shared with logs-zone.interaction.test.tsx).
import { createElement } from 'react';
import { Box, Text, render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { RoutesZone } from './routes-zone.js';

const ROWS = 14;

function seed() {
  const store = createAppStore();
  store.setState({
    routesStatus: 'ready',
    routesRepoPath: '/repos/gateway',
    routes: Array.from({ length: 40 }, (_, i) => ({
      method: i % 2 === 0 ? 'GET' : 'POST',
      path: `/resource-${i}/{id}`,
      summary: `SUMMARY-${i} a rather long description that must only show in the detail pane`,
    })),
    routesError: null,
    loadRoutes: async () => {},
    fireRoute: async () => {},
  });
  return store;
}

function mount(store: ReturnType<typeof createAppStore>, rows = ROWS) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 100, rows });
  const stdin = fakeInteractiveTtyStdin();
  // Mirrors AppShell: a fixed-height column with fixed sibling rows above and below the zone.
  const instance = render(
    createElement(
      Box,
      { flexDirection: 'column', height: rows, overflow: 'hidden' },
      createElement(Text, {}, 'TABS-ROW'),
      createElement(RoutesZone, { useStore: store }),
      createElement(Text, {}, 'FOOTER-ROW'),
    ),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return { instance, stdout, stdin };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

function footerId(store: ReturnType<typeof createAppStore>): string | undefined {
  return store.getState().footerContexts.at(-1)?.id;
}

function lastFrame(stdout: FakeTtyStdout): string {
  // Every Ink render writes the whole frame in one chunk; the newest chunk carrying the
  // sibling row is the current screen.
  const chunks = (stdout as unknown as { chunks: string[] }).chunks;
  return [...chunks].reverse().find((chunk) => chunk.includes('TABS-ROW')) ?? '';
}

describe('RoutesZone bounded list', () => {
  it('keeps the list inside its area: sibling rows stay visible, indicators never overlap rows, no summary in the list', async () => {
    const store = seed();
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const frame = lastFrame(stdout);
      const lines = frame.split('\n');
      expect(lines.length).toBeLessThanOrEqual(ROWS);
      expect(lines[0]).toContain('TABS-ROW');
      expect(frame).toContain('FOOTER-ROW');
      expect(frame).toContain('▼ more below');
      // Only the focused route's summary (detail pane) is ever rendered.
      expect(frame).toContain('SUMMARY-0');
      expect(frame).not.toContain('SUMMARY-1 ');
      expect(frame).not.toContain('SUMMARY-2');
    } finally {
      instance.unmount();
    }
  });
});

describe('RoutesZone route filter', () => {
  it('narrows the list as you type, keeps it on Enter, and clears on Esc', async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, 'p');
      await press(instance, stdin, 'o');
      await press(instance, stdin, 's');
      await press(instance, stdin, 't');
      let frame = lastFrame(stdout);
      expect(frame).toContain('Filter: post');
      expect(frame).toContain('POST /resource-1/{id}');
      expect(frame).not.toContain('GET /resource-0/{id}');
      expect(frame).toContain('(20/40)');

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().zoneInputCaptured).toBe(false);
      frame = lastFrame(stdout);
      expect(frame).toContain('Filter: post');
      expect(frame).not.toContain('GET /resource-0/{id}');

      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      frame = lastFrame(stdout);
      expect(frame).toContain('GET /resource-0/{id}');
      expect(frame).not.toContain('Filter:');
    } finally {
      instance.unmount();
    }
  });

  it("'f' opens the route filter exactly like '/' and types literally once editing", async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'f');
      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, 'p');
      let frame = lastFrame(stdout);
      expect(frame).toContain('Filter: p');
      expect(frame).not.toContain('GET /resource-0/{id}');
      // A second 'f' lands as text in the open editor, it does not reopen anything.
      await press(instance, stdin, 'f');
      frame = lastFrame(stdout);
      expect(frame).toContain('Filter: pf');
      await press(instance, stdin, KEYS.escape);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).not.toContain('Filter:');
    } finally {
      instance.unmount();
    }
  });

  it('shows a distinct message when nothing matches', async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      await press(instance, stdin, 'z');
      await press(instance, stdin, 'z');
      expect(lastFrame(stdout)).toContain('No routes match the filter.');
    } finally {
      instance.unmount();
    }
  });

  it('keeps the filter across an unmount/remount (tab switch)', async () => {
    const store = seed();
    const first = mount(store);
    await first.instance.waitUntilRenderFlush();
    await press(first.instance, first.stdin, '/');
    await press(first.instance, first.stdin, 'p');
    await press(first.instance, first.stdin, KEYS.enter);
    first.instance.unmount();

    const second = mount(store);
    try {
      await second.instance.waitUntilRenderFlush();
      const frame = lastFrame(second.stdout);
      expect(frame).toContain('Filter: p');
      expect(frame).not.toContain('GET /resource-0/{id}');
    } finally {
      second.instance.unmount();
    }
  });

  it('jumps with Home/End and keeps the cursor across a remount', async () => {
    const store = seed();
    const first = mount(store);
    await first.instance.waitUntilRenderFlush();
    await press(first.instance, first.stdin, KEYS.end);
    expect(store.getState().routesSelected).toBe(39);
    expect(lastFrame(first.stdout)).toContain('/resource-39/{id}');
    await press(first.instance, first.stdin, KEYS.home);
    expect(store.getState().routesSelected).toBe(0);
    await press(first.instance, first.stdin, KEYS.down);
    await press(first.instance, first.stdin, KEYS.down);
    first.instance.unmount();

    const second = mount(store);
    try {
      await second.instance.waitUntilRenderFlush();
      expect(store.getState().routesSelected).toBe(2);
      expect(lastFrame(second.stdout)).toContain('SUMMARY-2');
    } finally {
      second.instance.unmount();
    }
  });
});

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
      expect(footerId(store)).toBe('routes-body-tree-add');
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
      expect(footerId(store)).toBe('routes-list');
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
      expect(footerId(store)).toBe('routes-list-editable');
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

  it('deletes the selected entry and clamps the selection', async () => {
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
      expect(draftOf(store)).toEqual({ name: 'ada', age: 36, tags: [] });
      expect(lastFrame(stdout)).not.toContain('"x"');
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
      await press(instance, stdin, KEYS.backspace);
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

  it('T1: drops deleted-subtree errors, preserves errors on append, remaps shifted siblings', async () => {
    const store = seedEditor();
    store.getState().ensureBodyDraft(EDITOR_KEY, { name: 'ada', scores: [1, 2, 3] });
    store.getState().setBodyEditErrors(EDITOR_KEY, {
      name: { reason: 'expected a number, got "ada"', kind: 'number' },
      'scores[2]': { reason: 'expected a number, got "x"', kind: 'number' },
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'e');
      // Rows: root, name, scores, [0], [1], [2] — delete `name`.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'd');
      expect(errorsOf(store)).toEqual({ 'scores[2]': { reason: 'expected a number, got "x"', kind: 'number' } });
      // Append to `scores`: shifts no indices, so the sibling error is preserved.
      await press(instance, stdin, 'a');
      expect(draftOf(store)).toMatchObject({ scores: [1, 2, 3, ''] });
      expect(errorsOf(store)).toEqual({ 'scores[2]': { reason: 'expected a number, got "x"', kind: 'number' } });
      // Delete `scores[0]`: the later sibling error remaps down to `scores[1]`.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'd');
      expect(draftOf(store)).toMatchObject({ scores: [2, 3, ''] });
      expect(errorsOf(store)).toEqual({ 'scores[1]': { reason: 'expected a number, got "x"', kind: 'number' } });
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
      expect(footerId(store)).toMatch(/^routes-(section|rows)/);
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

  it('adds, edits and deletes header rows; duplicates are rejected', async () => {
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
      expect(store.getState().requestDrafts['GET /health']?.headers).toEqual([]);
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
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlRight);
      expect(store.getState().routesPaneTab).toBe('response');
      await press(instance, stdin, KEYS.ctrlN);
      expect(store.getState().routesPaneTab).toBe('response');
      await press(instance, stdin, KEYS.ctrlP);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlN);
      expect(store.getState().routesPaneTab).toBe('response');
      // Number keys and [ ] never switch tabs.
      await press(instance, stdin, '1');
      await press(instance, stdin, '[');
      expect(store.getState().routesPaneTab).toBe('response');
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
