// tui/zones/logs: real-keypress interactions (story 5.1) — `renderToString`'s fake stdin
// never emits data (see logs-zone.test.tsx), so Tab/Space/Enter/Escape/Ctrl+A's actual
// dispatch through a real `useInput` round-trip is only observable here, reusing
// edts-zone.interaction.test.tsx's own fake-tty technique (shared/test-support/fake-tty.ts).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';

function service(overrides: Partial<ServiceBranchDivergence> = {}): ServiceBranchDivergence {
  return {
    service: 'route-explorer',
    path: '/repos/route-explorer',
    isMember: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    sharedBranch: 'development',
    ...overrides,
  };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// Mirrors edts-zone.interaction.test.tsx's own pressEscape: a lone ESC byte is ambiguous on
// the wire until Ink's internal flush-delay timer fires.
async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(LogsZone, { useStore: store }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

function seedStore(overrides: Record<string, unknown> = {}) {
  const store = createAppStore();
  store.setState({
    edts: [],
    edtsStatus: 'idle',
    activeEdt: null,
    edtsBranches: [
      service({ service: 'api-gateway', path: '/repos/api-gateway' }),
      service({ service: 'route-explorer', path: '/repos/route-explorer' }),
    ],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    ...overrides,
  });
  return store;
}

describe('LogsZone real-keypress interactions (story 5.1)', () => {
  it('AC: Tab cycles focus edt-list -> other-list -> panes -> edt-list (Space toggles the currently-focused list)', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // Both services land in OTHER SERVICES (no active EDT) — Tab once to reach that list.
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space toggles a selection on and back off', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);

      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('AC: Enter on an unselected list row opens an ad hoc fullscreen preview without changing selection; Escape closes it, selection unchanged', async () => {
    const subscribeLogsPane = vi.fn(async () => {});
    const unsubscribeLogsPane = vi.fn();
    const store = seedStore({ subscribeLogsPane, unsubscribeLogsPane });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');
      expect(store.getState().logsOtherSelected).toEqual([]);
      // "stream started ad hoc" — the reconciliation effect subscribes the preview target even
      // though it was never added to either selection list.
      expect(subscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway', 'api-gateway');

      await pressEscape(instance, stdin);
      expect(store.getState().logsFullscreenTarget).toBeNull();
      // I/O matrix FULLSCREEN_PREVIEW: "Escape stops that ad hoc stream and returns, selection
      // unchanged".
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(unsubscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('I/O matrix SELECTION_CHANGE: deselecting a service stops its stream and removes its pane entry', async () => {
    const subscribeLogsPane = vi.fn(async () => {});
    const unsubscribeLogsPane = vi.fn();
    const store = seedStore({ subscribeLogsPane, unsubscribeLogsPane });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      // Select both other-list services.
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected.sort()).toEqual(['/repos/api-gateway', '/repos/route-explorer']);
      expect(subscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway', 'api-gateway');
      expect(subscribeLogsPane).toHaveBeenCalledWith('/repos/route-explorer', 'route-explorer');

      // Deselect route-explorer (cursor is still on it) — its stream stops.
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);
      expect(unsubscribeLogsPane).toHaveBeenCalledWith('/repos/route-explorer');
      expect(unsubscribeLogsPane).not.toHaveBeenCalledWith('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2: `/` opens the global-filter editor from any Logs-zone focus (Boundaries).
  it('AC: "/" opens the global filter editor from list focus, and typed characters update the draft live', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('GLOBAL LOG FILTER');

      await press(instance, stdin, 'boom');
      expect(stdout.output).toContain('boom');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (Boundaries): "f (bare, sub-focused grid pane or fullscreen pane) opens a
  // filter-editor modal for that pane's own filter" — never reachable from list focus.
  it('"f" opens a pane\'s own filter editor only once a pane is sub-focused in the grid — never from list focus', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      // Not sub-focused on a pane yet — "f" must be a no-op (bare 'f' is otherwise free text
      // that no other list-focus binding claims).
      await press(instance, stdin, 'f');
      expect(stdout.output).not.toContain('PANE LOG FILTER');

      // Select a service and move focus into the pane grid.
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await press(instance, stdin, 'f');
      expect(stdout.output).toContain('PANE LOG FILTER');
      // User-reported: the pane editor's title names which service it's editing, so it's
      // never ambiguous which pane a "PANE LOG FILTER" popup belongs to.
      expect(stdout.output).toContain('PANE LOG FILTER — api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (Boundaries): "g ... toggles that one pane's engagement with the global
  // filter" — reflected back via the pane's own "global filter: off" annotation.
  it('"g" toggles the sub-focused pane\'s engagement with the global filter', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await press(instance, stdin, 'g');
      expect(stdout.output).toContain('global filter: off');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (Boundaries): "Escape ... if a pane is sub-focused in the grid ... else
  // disengages it from the global filter" (I/O matrix ESCAPE_PANE, no-own-filter branch).
  it('Escape disengages the sub-focused pane from the global filter when it has no own filter set', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await pressEscape(instance, stdin);
      expect(stdout.output).toContain('global filter: off');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (Design Notes): "compileLogFilter recomputes on every editor keystroke ... so
  // the inline regex error appears/clears live" — Tab switches the open editor into regex
  // mode, then a malformed pattern surfaces the inline error rather than throwing.
  it('the filter editor switches to regex mode via Tab, and a malformed pattern shows an inline error instead of throwing', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('Regex:');

      await press(instance, stdin, '(');
      expect(stdout.output).toContain('Invalid regular expression');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2: Left/Right cycle the editor's level restriction (no dedicated Boundaries key
  // binding is named for this — see logs-zone.logic.ts's cycleFilterLevel/LOG_FILTER_LEVEL_CYCLE).
  it('the filter editor cycles its level restriction with Right/Left', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('Level: ALL');

      await press(instance, stdin, KEYS.right);
      expect(stdout.output).toContain('Level: ERROR');

      await press(instance, stdin, KEYS.right);
      expect(stdout.output).toContain('Level: WARN');

      // Review fix: this test's own name promised Right *and* Left, but only ever pressed
      // Right — Left must cycle the same restriction backward (WARN -> ERROR).
      await press(instance, stdin, KEYS.left);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Level: ERROR');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (Design Notes): "Both editors share one component and validation" — the editor's
  // own text-capture must never let '/', 'f', 'g' fall through to the global shortcuts they'd
  // otherwise trigger (open global editor / open pane editor / toggle global engagement)
  // (review fix: no existing test proved this).
  it('typing "/", "f", "g" while the editor is open appends them to the query rather than triggering global shortcuts', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('GLOBAL LOG FILTER');

      await press(instance, stdin, '/fg');
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: /fg');
      // Still just the one (global) editor open — none of '/', 'f', 'g' reopened a second
      // editor or toggled anything else while it was already open.
      expect(stdout.output).not.toContain('PANE LOG FILTER');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2: Escape while the editor is open is a true cancel — TextInputLine's own hint
  // text ("[Enter] confirm  [Esc] cancel") must actually mean what it says (review fix: Escape
  // and Enter used to be handled identically, so neither ever reverted anything).
  it('Escape while the filter editor is open reverts the pane filter to what it was before the edit', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      // No own filter yet — open the pane's editor and type a query that compiles cleanly.
      await press(instance, stdin, 'f');
      await press(instance, stdin, 'boom');
      expect(stdout.output).toContain('pane filter: text "boom"');

      await pressEscape(instance, stdin);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).not.toContain('pane filter:');
      expect(lastFrame).not.toContain('PANE LOG FILTER');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2: Enter is a true confirm — it must keep whatever was last committed while
  // editing, unlike Escape just above.
  it('Enter while the filter editor is open keeps the edit and closes the editor', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await press(instance, stdin, 'f');
      await press(instance, stdin, 'boom');
      expect(stdout.output).toContain('pane filter: text "boom"');

      await press(instance, stdin, KEYS.enter);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).toContain('pane filter: text "boom"');
      expect(lastFrame).not.toContain('PANE LOG FILTER');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2: no test previously proved Escape/Enter actually closes the modal and hands
  // keystroke dispatch back to the rest of the zone (review fix).
  it('Escape closes the open filter editor and normal zone dispatch resumes', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('GLOBAL LOG FILTER');

      await pressEscape(instance, stdin);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).not.toContain('GLOBAL LOG FILTER');

      // Tab now cycles pane focus again rather than being swallowed by the (closed) editor.
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (review fix): the "pane filter: ..." annotation and resolveFilterClearTarget's
  // hasOwnFilter check both key off entry *presence* in paneFilters, not content — committing a
  // vacuous draft (query backspaced to empty) must remove the entry, not leave a no-op-but-
  // present one behind.
  it('backspacing a pane filter\'s query back to empty removes the "pane filter: ..." annotation', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await press(instance, stdin, 'f');
      await press(instance, stdin, 'boom');
      await press(instance, stdin, KEYS.enter); // confirm, close the editor
      expect(stdout.output).toContain('pane filter: text "boom"');

      // Reopen the same pane's editor and backspace the query back to empty.
      await press(instance, stdin, 'f');
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, KEYS.enter); // confirm the now-empty draft, close

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).not.toContain('pane filter:');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2: proves the filter actually narrows what's rendered, not just its own draft
  // text echo (review fix — the only existing test that types into the editor only ever
  // checked TextInputLine's own value echo, never pane content).
  it('the global filter editor narrows rendered log lines end-to-end', async () => {
    const subscribeLogsPane = vi.fn(async () => {});
    const unsubscribeLogsPane = vi.fn();
    const store = seedStore({
      subscribeLogsPane,
      unsubscribeLogsPane,
      logsOtherSelected: ['/repos/api-gateway'],
      logsPanes: {
        '/repos/api-gateway': {
          repoPath: '/repos/api-gateway',
          service: 'api-gateway',
          lines: [
            { timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'apple line' },
            { timestamp: '2026-01-01T00:00:01.000Z', stream: 'stdout', text: 'banana line' },
            { timestamp: '2026-01-01T00:00:02.000Z', stream: 'stdout', text: 'cherry line' },
          ],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
        },
      },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('apple line');
      expect(stdout.output).toContain('banana line');
      expect(stdout.output).toContain('cherry line');

      await press(instance, stdin, '/');
      await press(instance, stdin, 'banana');

      // The grid (with the log lines) renders *above* the filter-editor modal in the same
      // frame — slice from the frame's own top marker ('LOGS'), not from 'GLOBAL LOG FILTER'
      // itself, so the slice still includes the grid content that comes before it.
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).toContain('banana line');
      expect(lastFrame).not.toContain('apple line');
      expect(lastFrame).not.toContain('cherry line');
      // User-reported: an engaged pane with an active global filter shows what that filter
      // actually is, not just a boolean — so a pane's own annotation and the editor draft
      // never disagree about what's being applied.
      expect(lastFrame).toContain('global filter: text "banana"');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+A selects every row currently in the EDT-members list, then a second press deselects all (review fix: replaces the unreachable Ctrl+Shift+A)', async () => {
    // A `Ctrl+letter` combo is a single control byte at the wire level — it never carries
    // shift information (confirmed against Ink's own parser), so Ctrl+A and Ctrl+Shift+A were
    // indistinguishable on virtually every real terminal, making the old, separate
    // deselect-all shortcut unreachable in practice (user-reported). Ctrl+A now toggles.
    const store = seedStore({
      edts: [
        {
          ulid: 'active-ulid',
          topic: 'active-edt',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
          members: [
            { service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' },
            { service: 'route-explorer', repoPath: '/repos/route-explorer', branch: 'main' },
          ],
        },
      ],
      activeEdt: 'active-ulid',
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // paneFocus already defaults to 'edt-list' — Ctrl+A is byte 0x01.
      await press(instance, stdin, '\x01');
      expect(store.getState().logsEdtSelected.sort()).toEqual(['/repos/api-gateway', '/repos/route-explorer']);

      await press(instance, stdin, '\x01');

      expect(store.getState().logsEdtSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
