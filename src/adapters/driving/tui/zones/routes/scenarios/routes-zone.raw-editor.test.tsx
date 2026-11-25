// tui/zones/routes: the raw body editor as a full multi-line editor, driven through the zone with real keypresses.
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../../store/app-store.js';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { mount, press, lastFrame } from '../routes-zone.test-support.js';

const CTRL = { a: '\x01', k: '\x0b', f: '\x06', z: '\x1a', y: '\x19' };
const SHIFT_RIGHT = '\x1b[1;2C';
const CTRL_HOME = '\x1b[1;5H';
const DELETE = '\x1b[3~';
const EDITOR_KEY = 'POST /users';

function seedEditor() {
  const store = createAppStore();
  store.setState({
    routesStatus: 'ready',
    routesRepoPath: '/repos/gateway',
    routes: [
      {
        method: 'POST',
        path: '/users',
        summary: 'Create a user',
        bodyExample: { name: 'ada', age: 36 },
        bodyContentType: 'application/json',
      },
    ],
    routesError: null,
    loadRoutes: async () => {},
    fireRoute: async () => {},
  });
  return store;
}

const draftOf = (store: ReturnType<typeof createAppStore>): unknown => (store.getState().bodyDrafts as Record<string, unknown>)[EDITOR_KEY];

async function settle(instance: ReturnType<typeof render>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

async function openRaw(store: ReturnType<typeof createAppStore>) {
  const mounted = mount(store, 30);
  await mounted.instance.waitUntilRenderFlush();
  await press(mounted.instance, mounted.stdin, 'e');
  await press(mounted.instance, mounted.stdin, 'r');
  return mounted;
}

async function typeText(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string) {
  for (const char of text) {
    await press(instance, stdin, char === '\n' ? KEYS.enter : char);
  }
}

async function clearBuffer(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream) {
  await press(instance, stdin, CTRL.a);
  await press(instance, stdin, KEYS.backspace);
}

describe('RoutesZone raw body editor', () => {
  it('renders numbered lines with the Ln/Col status and a pretty-printed body', async () => {
    const { instance, stdout } = await openRaw(seedEditor());
    try {
      const frame = lastFrame(stdout);
      expect(frame).toContain('Raw JSON');
      expect(frame).toContain('Ln 4, Col 2');
      expect(frame).toContain('4 lines');
      expect(frame).toMatch(/1 \{/);
      expect(frame).toContain('"name": "ada"');
    } finally {
      instance.unmount();
    }
  });

  it('Enter after { indents one level and keeps it on the next line', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      await press(instance, stdin, '{');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('Ln 2, Col 3');
      await typeText(instance, stdin, 'x');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('Ln 3, Col 3');
    } finally {
      instance.unmount();
    }
  });

  it('remembers the column across a shorter line and Shift+→ then typing replaces the selection', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      await typeText(instance, stdin, 'a'.repeat(10));
      await press(instance, stdin, KEYS.enter);
      await typeText(instance, stdin, 'bb');
      await press(instance, stdin, KEYS.enter);
      await typeText(instance, stdin, 'c'.repeat(10));
      await press(instance, stdin, KEYS.up);
      expect(lastFrame(stdout)).toContain('Ln 2, Col 3');
      await press(instance, stdin, KEYS.down);
      expect(lastFrame(stdout)).toContain('Ln 3, Col 11');
      await press(instance, stdin, CTRL_HOME);
      expect(lastFrame(stdout)).toContain('Ln 1, Col 1');
      for (let i = 0; i < 3; i += 1) {
        await press(instance, stdin, SHIFT_RIGHT);
      }
      await press(instance, stdin, 'x');
      expect(lastFrame(stdout)).toContain('xaaaaaaa');
      expect(lastFrame(stdout)).not.toContain('aaaaaaaaaa');
    } finally {
      instance.unmount();
    }
  });

  it('inserts a bracketed paste (CRLF, control chars) as one undo step', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      const payload = Array.from({ length: 50 }, (_, i) => `{"n":${i}}`).join('\r\n');
      await press(instance, stdin, `\x1b[200~${payload}\x01\x1b[201~`);
      expect(lastFrame(stdout)).toContain('50 lines');
      await press(instance, stdin, CTRL.z);
      expect(lastFrame(stdout)).toContain('1 line');
      expect(lastFrame(stdout)).not.toContain('{"n":0}');
      await press(instance, stdin, CTRL.y);
      expect(lastFrame(stdout)).toContain('50 lines');
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+F formats valid JSON; invalid JSON is refused with the buffer unchanged', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      await typeText(instance, stdin, '{"a":1}');
      await press(instance, stdin, CTRL.f);
      expect(lastFrame(stdout)).toContain('3 lines');
      expect(lastFrame(stdout)).toContain('"a": 1');
      await clearBuffer(instance, stdin);
      await typeText(instance, stdin, '{"a":');
      await press(instance, stdin, CTRL.f);
      expect(lastFrame(stdout)).toContain('✖');
      expect(lastFrame(stdout)).toContain('(line 1, column');
      expect(lastFrame(stdout)).toContain('{"a":');
    } finally {
      instance.unmount();
    }
  });

  it('Esc on invalid JSON stays at the error position and keeps the previous body', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = await openRaw(store);
    try {
      await clearBuffer(instance, stdin);
      await typeText(instance, stdin, '{"a":');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      const frame = lastFrame(stdout);
      expect(frame).toContain('Raw JSON');
      expect(frame).toContain('✖ (line 1, column');
      expect(draftOf(store)).toEqual({ name: 'ada', age: 36 });
      await typeText(instance, stdin, '1}');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Raw JSON');
      expect(draftOf(store)).toEqual({ a: 1 });
    } finally {
      instance.unmount();
    }
  });

  it('Ctrl+←/→ moves by word inside the editor and switches sub-tabs again after leaving', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = await openRaw(store);
    try {
      const tabBefore = store.getState().routesPaneTab;
      await clearBuffer(instance, stdin);
      await typeText(instance, stdin, '"foo bar"');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(lastFrame(stdout)).toContain('Col 6');
      await press(instance, stdin, KEYS.ctrlP);
      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.ctrlR);
      expect(store.getState().routesPaneTab).toBe(tabBefore);
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Raw JSON');
      await press(instance, stdin, KEYS.ctrlRight);
      await settle(instance);
      expect(store.getState().routesPaneTab).not.toBe(tabBefore);
    } finally {
      instance.unmount();
    }
  });

  it('scrolls a 300-char line horizontally so the caret stays visible', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      await press(instance, stdin, `\x1b[200~${'a'.repeat(280)}END\x1b[201~`);
      const frame = lastFrame(stdout);
      expect(frame).toContain('Col 284');
      expect(frame).toContain('aEND');
      expect(frame).not.toContain('a'.repeat(200));
    } finally {
      instance.unmount();
    }
  });

  it('Backspace deletes the character before the caret', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      await typeText(instance, stdin, 'abc');
      await press(instance, stdin, KEYS.backspace);
      expect(lastFrame(stdout)).toContain('Col 3');
      expect(lastFrame(stdout)).toMatch(/1 ab[^c]/);
    } finally {
      instance.unmount();
    }
  });

  it('PgDn/PgUp page by the rendered line window', async () => {
    const { instance, stdout, stdin } = await openRaw(seedEditor());
    try {
      await clearBuffer(instance, stdin);
      const payload = Array.from({ length: 60 }, (_, i) => `L${i + 1}`).join('\n');
      await press(instance, stdin, `\x1b[200~${payload}\x1b[201~`);
      expect(lastFrame(stdout)).toContain('Ln 60');
      await press(instance, stdin, CTRL_HOME);
      await press(instance, stdin, KEYS.pageDown);
      const down = /Ln (\d+),/.exec(lastFrame(stdout));
      const line = Number(down?.[1]);
      expect(line).toBeGreaterThan(5);
      expect(line).toBeLessThan(40);
      expect(lastFrame(stdout)).toContain(`L${line}`);
      await press(instance, stdin, KEYS.pageUp);
      expect(lastFrame(stdout)).toContain('Ln 1,');
    } finally {
      instance.unmount();
    }
  });

  it('validates the latest buffer when keys arrive before a re-render', async () => {
    const store = seedEditor();
    const { instance, stdout, stdin } = await openRaw(store);
    try {
      await clearBuffer(instance, stdin);
      const raw = stdin as unknown as { write: (chunk: string) => void };
      raw.write('{');
      raw.write('}');
      raw.write(KEYS.escape);
      await instance.waitUntilRenderFlush();
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Raw JSON');
      expect(draftOf(store)).toEqual({});
    } finally {
      instance.unmount();
    }
  });
});
