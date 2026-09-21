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

  // Story 5.2 (user-reported): Ctrl+Left/Right cycle the editor's level restriction — Ctrl
  // disambiguates it from a bare arrow, which a text cursor would otherwise claim (no
  // dedicated Boundaries key binding is named for this — see logs-zone.logic.ts's
  // cycleFilterLevel/LOG_FILTER_LEVEL_CYCLE).
  it('the filter editor cycles its level restriction with Ctrl+Right/Ctrl+Left', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('Level: ALL');

      await press(instance, stdin, KEYS.ctrlRight);
      expect(stdout.output).toContain('Level: ERROR');

      await press(instance, stdin, KEYS.ctrlRight);
      expect(stdout.output).toContain('Level: WARN');

      // Review fix: this test's own name promised Right *and* Left, but only ever pressed
      // Right — Left must cycle the same restriction backward (WARN -> ERROR).
      await press(instance, stdin, KEYS.ctrlLeft);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Level: ERROR');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // User-reported: bare Left/Right used to cycle the level restriction, colliding with where a
  // text cursor would naturally live — now they're inert (Ctrl+Left/Right above is the only
  // binding), and since arrow-key input carries no printable character, they don't leak into
  // the query text either.
  it('bare Left/Right no longer cycle the level restriction or alter the query', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, 'boom');
      await press(instance, stdin, KEYS.right);
      await press(instance, stdin, KEYS.left);

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Level: ALL');
      expect(lastFrame).toContain('Text: boom');
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
          health: 'up',
          restarting: false,
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

  // Story 5.4: filter history recall.
  describe('filter history recall (story 5.4)', () => {
    it('I/O matrix HISTORY_PUSH: Enter on a compiled, non-empty draft pushes the query onto the store\'s filterHistory', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, 'boom');
        await press(instance, stdin, KEYS.enter);

        expect(store.getState().filterHistory['global:text']).toEqual(['boom']);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('I/O matrix DEDUP_TOP: committing the same query as the current top entry moves it to front without duplicating', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, 'boom');
        await press(instance, stdin, KEYS.enter);
        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.enter); // re-commit the same, already-applied query

        expect(store.getState().filterHistory['global:text']).toEqual(['boom']);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('never pushes an empty or non-compiling draft onto history', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        // Empty draft.
        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().filterHistory['global:text']).toBeUndefined();

        // Non-compiling regex draft.
        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.tab); // text -> regex
        await press(instance, stdin, '(');
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().filterHistory['global:regex']).toBeUndefined();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('↑ on an untouched draft recalls the most-recent entry, preserving the draft; further ↑ walks older entries; ↑ at the oldest is a no-op', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['newest', 'older', 'oldest'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.up);
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: newest');

        await press(instance, stdin, KEYS.up);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: older');

        await press(instance, stdin, KEYS.up);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: oldest');

        // I/O matrix ARROW_UP_OLDEST: already at the oldest entry — a further ↑ is a no-op.
        await press(instance, stdin, KEYS.up);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: oldest');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('I/O matrix ARROW_DOWN_PAST_RECENT: ↓ while browsing walks back toward the draft, restoring it exactly one ↓ past the most-recent entry', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['newest', 'older'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, 'unsaved-draft');
        await press(instance, stdin, KEYS.up); // -> "newest", saving "unsaved-draft"
        await press(instance, stdin, KEYS.up); // -> "older"

        await press(instance, stdin, KEYS.down); // back to "newest"
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: newest');

        await press(instance, stdin, KEYS.down); // one more ↓ past the most-recent entry
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: unsaved-draft');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('I/O matrix SNAP_BACK_TYPE: a printable character while browsing snaps back to the draft with that keystroke applied on top', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['recalled'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, 'draft');
        await press(instance, stdin, KEYS.up); // now showing "recalled", saved draft "draft"

        await press(instance, stdin, 'X');
        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: draftX');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('SNAP_BACK_TYPE also applies to Backspace while browsing', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['recalled'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, 'draft');
        await press(instance, stdin, KEYS.up); // now showing "recalled", saved draft "draft"

        await press(instance, stdin, KEYS.backspace);
        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: draf');
        expect(lastFrame).not.toContain('Text: draft\n');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('I/O matrix GRID_OPEN_ESC: ↓ on an untouched draft opens a grid listing the full history, then Esc closes the whole editor', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['alpha', 'beta'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down);
        expect(stdout.output).toContain('alpha');
        expect(stdout.output).toContain('beta');

        await pressEscape(instance, stdin);
        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).not.toContain('GLOBAL LOG FILTER');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('↓ on an untouched draft is a no-op when there is no history to browse', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down);
        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).not.toContain('No history');
        expect(lastFrame).not.toContain('alpha');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('Enter inside the grid recalls the highlighted entry into the draft and closes just the grid, leaving the editor open', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['alpha', 'beta'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor on the top (most-recent) entry
        await press(instance, stdin, KEYS.enter);

        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: alpha');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('the pane-scoped editor keys its own history separately from the global editor and other services (Boundaries: one independent list per exact scope+mode key)', async () => {
      const store = seedStore({
        filterHistory: {
          'global:text': ['global-entry'],
          'service:/repos/api-gateway:text': ['pane-entry'],
        },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, ' '); // select api-gateway
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'f'); // pane's own filter editor
        await press(instance, stdin, KEYS.up);

        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('PANE LOG FILTER'));
        expect(lastFrame).toContain('Text: pane-entry');
        expect(lastFrame).not.toContain('global-entry');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // Review fix: text/regex are two distinct (scope, mode) history lists — Tab mid-recall
    // must reset `browsing`, or the next ↑/↓ reuses the old mode's stale index against the new
    // mode's (different) history list.
    it('review fix: Tab mid-recall resets browsing, so the next ↑ recalls from the new mode\'s history rather than reusing the old mode\'s stale index', async () => {
      const store = seedStore({
        filterHistory: {
          'global:text': ['text-newest', 'text-older'],
          'global:regex': ['regex-newest', 'regex-older'],
        },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.up); // browsing text history, now showing "text-newest"
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: text-newest');

        await press(instance, stdin, KEYS.tab); // text -> regex; must drop the stale browsing state
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Regex:');

        // Without the fix, this ↑ would reuse the old (index: 0) browsing state against the
        // regex history, walking to its *second* entry ("regex-older") instead of recalling
        // fresh from the top.
        await press(instance, stdin, KEYS.up);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Regex: regex-newest');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // Review fix: proves the grid-browser key block's unconditional `return` actually keeps
    // typing/Tab/Backspace from leaking into the query underneath while the grid is open.
    it('typing, Tab, or Backspace while the history grid is open is a no-op — the draft and open grid stay unchanged', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['alpha', 'beta'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid on an untouched (empty) draft

        await press(instance, stdin, 'z');
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, KEYS.backspace);

        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        // The draft is still empty (no stray "z" appended, no mode flip to Regex) and the grid
        // is still open with both entries still listed.
        expect(lastFrame).toContain('Text:');
        expect(lastFrame).not.toContain('Text: z');
        expect(lastFrame).not.toContain('Regex:');
        expect(lastFrame).toContain('alpha');
        expect(lastFrame).toContain('beta');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // Review fix (Acceptance Criteria): history browsing is a pure editor-draft transform —
    // it must never touch the Docker subscription an already-active pane owns.
    it('arrow-recall and grid-browse never call subscribeLogsPane/unsubscribeLogsPane again for an already-open pane', async () => {
      const subscribeLogsPane = vi.fn(async () => {});
      const unsubscribeLogsPane = vi.fn();
      const store = seedStore({
        subscribeLogsPane,
        unsubscribeLogsPane,
        logsOtherSelected: ['/repos/api-gateway'],
        filterHistory: { 'service:/repos/api-gateway:text': ['alpha', 'beta'] },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        const callsBefore = subscribeLogsPane.mock.calls.length;

        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes
        await press(instance, stdin, 'f'); // pane's own filter editor
        await press(instance, stdin, KEYS.up); // arrow-recall
        await press(instance, stdin, KEYS.up); // walk further back
        await press(instance, stdin, KEYS.down); // browse back down
        await pressEscape(instance, stdin); // cancel, close editor
        await press(instance, stdin, 'f');
        await press(instance, stdin, KEYS.down); // open the grid
        await press(instance, stdin, KEYS.enter); // recall highlighted entry

        expect(subscribeLogsPane.mock.calls.length).toBe(callsBefore);
        expect(unsubscribeLogsPane).not.toHaveBeenCalled();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });

  // Story 5.3: `R` on a sub-focused grid pane restarts that one pane's service.
  describe('inline service health & restart (story 5.3)', () => {
    function paneFor(path: string, overrides: Record<string, unknown> = {}) {
      const name = path.split('/').pop() ?? path;
      return {
        repoPath: path,
        service: name,
        lines: [],
        streamError: null,
        noMoreHistory: false,
        scrollOffset: 0,
        health: 'down',
        restarting: false,
        ...overrides,
      };
    }

    it('"R" on a sub-focused grid pane triggers restartLogsPane for that pane only', async () => {
      const restartLogsPane = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        restartLogsPane,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway') },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        // The pane header renders the inline health badge next to the service's logs.
        expect(stdout.output).toContain('down');
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'R');

        expect(restartLogsPane).toHaveBeenCalledTimes(1);
        expect(restartLogsPane).toHaveBeenCalledWith('/repos/api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"R" is a no-op while that pane is already restarting (disabled control, I/O matrix RESTART_NOOP)', async () => {
      const restartLogsPane = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        restartLogsPane,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { restarting: true }) },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        // The control renders its disabled state while a restart is in flight.
        expect(stdout.output).toContain('restarting…');
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'R');

        expect(restartLogsPane).not.toHaveBeenCalled();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"R" is a no-op while docker reports the pane as restarting (HEALTH_RESTARTING disables the control)', async () => {
      const restartLogsPane = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        restartLogsPane,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { health: 'restarting' }) },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'R');

        expect(restartLogsPane).not.toHaveBeenCalled();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"R" on a fullscreen pane restarts that pane\'s service', async () => {
      const restartLogsPane = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        restartLogsPane,
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { health: 'up' }) },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.enter); // ad hoc fullscreen preview on api-gateway
        expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');

        await press(instance, stdin, 'R');

        expect(restartLogsPane).toHaveBeenCalledTimes(1);
        expect(restartLogsPane).toHaveBeenCalledWith('/repos/api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
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

  // Story 5.5: bounds the filter-history grid browser's own vertical extent to the terminal's
  // actual row count (I/O matrix OVERFLOW_HISTORY_GRID/RESIZE_LIVE) — mirrors the grid's
  // existing horizontal truncation/scroll, recomputed live off useWindowSize() on every resize
  // rather than a value fixed at mount.
  describe('history grid vertical pagination (story 5.5)', () => {
    it('OVERFLOW_HISTORY_GRID & RESIZE_LIVE: the grid gains a "more below" indicator once the terminal shrinks below its row count, and loses it again once the terminal grows back', async () => {
      const history = Array.from({ length: 10 }, (_, i) => `entry-${i}`);
      const store = seedStore({ filterHistory: { 'global:text': history } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor at column 0 row 0
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('entry-0');
        expect(lastFrame).not.toContain('more below');
        expect(lastFrame).not.toContain('more above');

        // Shrinks well below what the 8-row (default) first column needs.
        stdout.rows = 10;
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('more below');
        expect(lastFrame).not.toContain('more above');

        // Grows back to the original size — the grid un-paginates, no visible regression.
        stdout.rows = 24;
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).not.toContain('more below');
        expect(lastFrame).not.toContain('more above');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // Review fix: `GridCursor.row` is an absolute index into the *full* (unsliced) column —
    // `historyGridCursor` and `commandAtGridCursor`'s own lookup both use the full
    // `groupCommandsByColumn` output, never the vertically-windowed `layoutCommandGrid` result
    // (that's only ever built for rendering) — so scrolling the grid down must never change
    // which entry Enter actually recalls. Exactly 8 entries keeps every one of them in a single
    // column (default filterHistoryGridMaxRows), so ↓ presses move the cursor within that one
    // column; shrinking the terminal forces rowScrollOffset > 0 partway through.
    it('recalls the correct entry after scrolling the grid past rowScrollOffset > 0, not an off-by-rowScrollOffset one', async () => {
      const history = Array.from({ length: 8 }, (_, i) => `entry-${i}`);
      const store = seedStore({ filterHistory: { 'global:text': history } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor at column 0 row 0

        // Shrinks enough that the 8-row column can't fit without vertical pagination.
        stdout.rows = 11;
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();

        // Walks the cursor down to row 5 — past where the window must have scrolled
        // (rowScrollOffset > 0) to keep it visible under the shrunk budget.
        for (let i = 0; i < 5; i += 1) {
          await press(instance, stdin, KEYS.down);
        }
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('more above'); // proves rowScrollOffset > 0 at this point

        await press(instance, stdin, KEYS.enter);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: entry-5');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // Review fix: a column's display width used to be computed from `gridLayout.columns` —
    // already vertically sliced — so its widest entry scrolling out of view (via the second
    // column's own row navigation) shrank the column and misaligned every column after it. Two
    // columns of 5 rows each (filterHistoryGridMaxRows: 5), the widest entry pinned to column
    // 0's own top row: scrolling column 0 down until that entry is no longer visible must not
    // move where column 1's entries start.
    it('keeps a column\'s display width stable as its own vertical scroll changes (column 1 never shifts)', async () => {
      const history = ['LONGLONGLONGLONGLONGLONG', 'e1', 'e2', 'e3', 'e4', 'f5', 'f6', 'f7', 'f8', 'f9'];
      const store = seedStore({ filterHistory: { 'global:text': history } });
      store.setState({
        settings: { ...store.getState().settings, logs: { ...store.getState().settings.logs, filterHistoryGridMaxRows: 5 } },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor at column 0 row 0 — the wide entry is visible here

        stdout.rows = 10; // forces vertical pagination on the 5-row-tall column 0
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();

        let frame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        const wideEntryLine = frame.split('\n').find((line) => line.includes('LONGLONGLONGLONGLONGLONG'));
        const column1StartWithWideEntryVisible = wideEntryLine?.indexOf('f5');
        expect(column1StartWithWideEntryVisible).toBeGreaterThan(0);

        // Scrolls column 0 down past the wide entry (row 0) to row 4 — it's no longer rendered.
        for (let i = 0; i < 4; i += 1) {
          await press(instance, stdin, KEYS.down);
        }
        frame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(frame).not.toContain('LONGLONGLONGLONGLONGLONG');
        const shortEntryLine = frame.split('\n').find((line) => line.includes('e3'));
        const column1StartWithWideEntryHidden = shortEntryLine?.indexOf('f8');

        expect(column1StartWithWideEntryHidden).toBe(column1StartWithWideEntryVisible);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // I/O matrix EDITOR_OPEN_BEHIND_CONTENT: the editor renders as a sibling *below* the
    // "LOGS" + list/grid block (Ink has no absolute positioning), so its own rows compete with
    // the still-mounted service lists/hints panel/pane grid for the same terminal-row budget.
    // Seeds enough services that the lists would overflow on their own, then opens the global
    // filter editor and asserts the combined frame still respects both halves of story 5.4's
    // and this story's own contracts: the hints panel stays hidden (5.4's focus-fix, not
    // undone) and the service list behind the editor is still bounded rather than dumping
    // every row now that the editor's own body is also competing for rows.
    it('EDITOR_OPEN_BEHIND_CONTENT: opening the filter editor over an overflowing services list keeps the hints panel hidden and the list itself bounded', async () => {
      const store = seedStore({
        edtsBranches: Array.from({ length: 60 }, (_, i) => service({ service: `svc-${i}`, path: `/repos/svc-${i}` })),
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        // Before the editor opens: an overflowing OTHER SERVICES list already shows the
        // story's own bounded-window indicator (regression guard for the scenario the editor
        // is about to be opened on top of).
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).toContain('more below');

        await press(instance, stdin, '/');
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).toContain('GLOBAL LOG FILTER');

        // 5.4's existing focus-hidden-while-editing fix survives this story's changes: none of
        // the services-list keybinding hints render while the editor owns input.
        expect(lastFrame).not.toContain('[Space] toggle');
        expect(lastFrame).not.toContain('[Ctrl+A] toggle all');

        // The service list mounted behind the editor is still present but bounded, not an
        // unconditional dump of all 60 rows now that the editor's own body also needs rows.
        expect(lastFrame).toContain('svc-0');
        expect(lastFrame).not.toContain('svc-59');
        expect(lastFrame).toContain('more below');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });
});
