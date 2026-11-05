// tui/zones/logs: real-keypress interactions — renderToString's fake stdin never emits data, so
// Tab/Space/Enter/Escape/Ctrl+A's dispatch through a real `useInput` round-trip is only
// observable here (shared/test-support/fake-tty.ts).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
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
    protectedBranches: [],
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

describe('LogsZone real-keypress interactions', () => {
  it('mounting resolves container presence and polls the listed rows, unmount stops polling', async () => {
    const store = seedStore();
    const resolveLogsContainerPresence = vi.fn();
    const startLogsListedHealthPolling = vi.fn();
    const stopLogsListedHealthPolling = vi.fn();
    store.setState({ resolveLogsContainerPresence, startLogsListedHealthPolling, stopLogsListedHealthPolling });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(resolveLogsContainerPresence).toHaveBeenCalledWith(['/repos/api-gateway', '/repos/route-explorer']);
      expect(startLogsListedHealthPolling).toHaveBeenCalledWith(['/repos/api-gateway', '/repos/route-explorer']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    expect(stopLogsListedHealthPolling).toHaveBeenCalled();
  });
  it('Tab cycles focus edt-list -> other-list -> panes -> edt-list (Space toggles the currently-focused list)', async () => {
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

  it('Shift+Tab reverses focus edt-list -> panes -> other-list (Space then toggles the other list)', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.shiftTab); // edt-list -> panes (wraps back)
      await press(instance, stdin, KEYS.shiftTab); // panes -> other-list
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

  it('Enter on an unselected list row opens an ad hoc fullscreen preview without changing selection; Escape closes it, selection unchanged', async () => {
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
      // Escape stops that ad hoc stream and returns, selection unchanged.
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(unsubscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('deselecting a service stops its stream and removes its pane entry', async () => {
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

  // `/` opens the global-filter editor from any Logs-zone focus.
  it('"/" opens the global filter editor from list focus, and typed characters update the draft live', async () => {
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

  // `f` (bare, on a sub-focused grid pane or fullscreen pane) opens that pane's own filter
  // editor — never reachable from list focus.
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
      // The pane editor's title names which service it's editing, so it's never ambiguous which
      // pane a "PANE LOG FILTER" popup belongs to.
      expect(stdout.output).toContain('PANE LOG FILTER — api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // `i` toggles that one pane's engagement with the global filter — reflected back via the
  // pane's own "global filter: off" annotation.
  it('"i" toggles the sub-focused pane\'s engagement with the global filter', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await press(instance, stdin, 'i');
      expect(stdout.output).toContain('global filter: off');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Escape on a sub-focused pane with no own filter disengages it from the global filter.
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

  it('R retries the service load while it is in error and no pane is open', async () => {
    const loadEdtsBranches = vi.fn(async () => {});
    const store = seedStore({ edtsBranchesStatus: 'error', loadEdtsBranches });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const before = loadEdtsBranches.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadEdtsBranches.mock.calls.length).toBe(before + 1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('R does nothing to the loader while the services loaded fine', async () => {
    const loadEdtsBranches = vi.fn(async () => {});
    const store = seedStore({ loadEdtsBranches });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const before = loadEdtsBranches.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadEdtsBranches.mock.calls.length).toBe(before);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc in the global filter editor discards the draft and restores the previous filter', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, ' '); // select api-gateway so a pane shows the filter state
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, '/');
      await press(instance, stdin, 'apple');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output.slice(stdout.output.lastIndexOf('LOGS'))).toContain('global filter: text "apple"');

      await press(instance, stdin, '/');
      await press(instance, stdin, 'x');
      expect(stdout.output.slice(stdout.output.lastIndexOf('LOGS'))).toContain('global filter: text "applex"');
      await pressEscape(instance, stdin);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).toContain('global filter: text "apple"');
      expect(lastFrame).not.toContain('GLOBAL LOG FILTER');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Shift+Tab in the filter editor flips text and regex like Tab (two modes: both directions toggle)', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/');
      await press(instance, stdin, KEYS.shiftTab);
      expect(stdout.output).toContain('Regex:');
      await press(instance, stdin, KEYS.shiftTab);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text:');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The filter recompiles on every editor keystroke, so the inline regex error appears/clears
  // live — Tab switches the open editor into regex mode, then a malformed pattern surfaces the
  // inline error rather than throwing.
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

  // Ctrl+Left/Right cycle the editor's level restriction — Ctrl disambiguates it from a bare
  // arrow, which the text caret owns (see logs-zone.logic.ts's
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

      // Left cycles the same restriction backward (WARN -> ERROR).
      await press(instance, stdin, KEYS.ctrlLeft);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Level: ERROR');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Bare Left/Right are the TextInputLine caret (Ctrl+Left/Right above is the only binding for
  // the level restriction) and never touch it.
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

  // The filter editor's query field supports real caret navigation and mid-string insert/delete
  // (the shared TextInputLine/nextTextInputValue contract).
  it('Left/Home move the caret so a typed character inserts mid-string rather than appending', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, 'abd');
      await press(instance, stdin, KEYS.left); // caret after 'b', before 'd'
      await press(instance, stdin, 'c');

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: abcd');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Home then a typed character inserts at the start of the query', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, 'bcd');
      await press(instance, stdin, KEYS.home);
      await press(instance, stdin, 'a');

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: abcd');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Backspace removes the character before the caret, not always the last character', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, 'abcd');
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.left); // caret between 'b' and 'c'
      await press(instance, stdin, KEYS.backspace); // removes 'b'

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: acd');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('End then Left/Right/Home form no-ops at either boundary, and End restores caret to the end for further typing', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, 'abcd');
      await press(instance, stdin, KEYS.home);
      await press(instance, stdin, KEYS.left); // already at 0, no-op
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, 'e');

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: abcde');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // A pure caret move while browsing history must not snap the draft back — only typing/
  // Backspace does that.
  it('Left/Right while browsing a recalled history entry moves the caret without snapping back to the draft', async () => {
    const store = seedStore({ filterHistory: { 'global:text': ['recalled'] } });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      await press(instance, stdin, 'draft');
      await press(instance, stdin, KEYS.up); // now showing "recalled", saved draft "draft"
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.right);

      let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: recalled');

      // Typing still snaps back to the saved draft, appended — proving the caret move above
      // didn't silently clear `browsing`.
      await press(instance, stdin, 'X');
      lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: draftX');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The editor's text capture must never let '/', 'f', 'i' fall through to the global shortcuts
  // they'd otherwise trigger (open global editor / open pane editor / toggle global engagement).
  it('typing "/", "f", "i" while the editor is open appends them to the query rather than triggering global shortcuts', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('GLOBAL LOG FILTER');

      await press(instance, stdin, '/fi');
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      expect(lastFrame).toContain('Text: /fi');
      // Still just the one (global) editor open — none of '/', 'f', 'i' reopened a second
      // editor or toggled anything else while it was already open.
      expect(stdout.output).not.toContain('PANE LOG FILTER');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Escape while the editor is open is a true cancel — TextInputLine's own hint text
  // ("[Enter] confirm  [Esc] cancel") must mean what it says.
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

  // Enter is a true confirm — it keeps whatever was last committed while editing, unlike Escape
  // just above.
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

  // Escape/Enter close the modal and hand keystroke dispatch back to the rest of the zone.
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

  // The "pane filter: ..." annotation and resolveFilterClearTarget's hasOwnFilter check both key
  // off entry *presence* in paneFilters, not content — committing a vacuous draft (query
  // backspaced to empty) must remove the entry, not leave a no-op-but-present one behind.
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

  // The filter actually narrows what's rendered, not just its own draft text echo.
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
      // An engaged pane with an active global filter shows what that filter actually is, not
      // just a boolean — so a pane's own annotation and the editor draft never disagree.
      expect(lastFrame).toContain('global filter: text "banana"');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  describe('filter history recall', () => {
    it('Enter on a compiled, non-empty draft pushes the query onto the store\'s filterHistory', async () => {
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

    it('committing the same query as the current top entry moves it to front without duplicating', async () => {
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

        // Already at the oldest entry — a further ↑ is a no-op.
        await press(instance, stdin, KEYS.up);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: oldest');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('↓ while browsing walks back toward the draft, restoring it exactly one ↓ past the most-recent entry', async () => {
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

    it('a printable character while browsing snaps back to the draft with that keystroke applied on top', async () => {
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

    it('the snap-back also applies to Backspace while browsing', async () => {
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

    it('↓ on an untouched draft opens a grid listing the full history, then Esc closes the whole editor', async () => {
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

    it('the pane-scoped editor keys its own history separately from the global editor and other services (one independent list per exact scope+mode key)', async () => {
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

    // Text and regex are two distinct (scope, mode) history lists — Tab mid-recall must reset
    // `browsing`, or the next ↑/↓ reuses the old mode's stale index against the new mode's list.
    it('Tab mid-recall resets browsing, so the next ↑ recalls from the new mode\'s history rather than reusing the old mode\'s stale index', async () => {
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

        // A stale browsing state (index: 0) reused against the regex history would walk to its
        // *second* entry ("regex-older") instead of recalling fresh from the top.
        await press(instance, stdin, KEYS.up);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Regex: regex-newest');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // The grid-browser key block's unconditional `return` keeps typing/Tab/Backspace from
    // leaking into the query underneath while the grid is open.
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

    // History browsing is a pure editor-draft transform — it must never touch the Docker
    // subscription an already-active pane owns.
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

  // `R` on a sub-focused grid pane restarts that one pane's service.
  describe('inline service health & restart', () => {
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

    it('"R" on a sub-focused grid pane runs the registry restart shortcut for that pane only', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
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

        expect(runLogsPaneShortcut).toHaveBeenCalledTimes(1);
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'restart', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('a restarting pane renders its disabled restart control; `R` still defers to the registry and the slice guard', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { restarting: true }) },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        // The control renders its disabled state while a restart is in flight. The exact
        // wording is locked in the logic unit tests; the narrow row truncates it, so here assert
        // its distinctive leading words while the bare state is gone.
        const flat = stdout.output.replace(/\s+/g, ' ');
        expect(flat).toContain('restart requested');
        expect(flat).not.toContain('restarting');
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'R');

        // No availability rule in the zone: the registry/slice decide (the slice no-ops).
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'restart', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"R" on a fullscreen pane runs the registry restart shortcut for that pane\'s service', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { health: 'up' }) },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.enter); // ad hoc fullscreen preview on api-gateway
        expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');

        await press(instance, stdin, 'R');

        expect(runLogsPaneShortcut).toHaveBeenCalledTimes(1);
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'restart', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });

  describe('open-in-IDE key and restart mode hint', () => {
    function pane(path: string, overrides: Record<string, unknown> = {}) {
      return {
        repoPath: path,
        service: path.split('/').pop() ?? path,
        lines: [],
        streamError: null,
        noMoreHistory: false,
        scrollOffset: 0,
        health: 'up',
        restarting: false,
        ...overrides,
      };
    }

    it('"O" on a sub-focused grid pane runs the registry open-in-IDE shortcut, including a container-less one', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway', { health: 'no-container' }) },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, KEYS.tab);

        await press(instance, stdin, 'O');

        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'ide', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"O" in fullscreen opens the IDE while lowercase "o" still only toggles stdout', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway') },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');

        await press(instance, stdin, 'o');
        expect(runLogsPaneShortcut).not.toHaveBeenCalled();
        await press(instance, stdin, 'O');
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'ide', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('the pane hint names the active restart mode and the pane shows its notice dim', async () => {
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: {
          '/repos/api-gateway': pane('/repos/api-gateway', { notice: 'no clean-restart recipe — simple restart' }),
        },
      });
      const { instance, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        expect(stdout.output).toContain('restart');
        expect(stdout.output).not.toContain('restart (clean)');
        expect(stdout.output).toContain('no clean-restart recipe — simple restart');

        store.setState((state) => ({ settings: { ...state.settings, logs: { ...state.settings.logs, restartMode: 'clean' } } }));
        await instance.waitUntilRenderFlush();
        expect(stdout.output).toContain('restart (clean)');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });

  it('Ctrl+A selects every row currently in the EDT-members list, then a second press deselects all', async () => {
    // A `Ctrl+letter` combo is a single control byte at the wire level — it never carries shift
    // information (Ink's parser), so Ctrl+A and Ctrl+Shift+A are indistinguishable on virtually
    // every real terminal. One Ctrl+A toggles instead.
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

  it('Ctrl+A on the other-services list toggles only that list, then a second press deselects all', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected.sort()).toEqual(['/repos/api-gateway', '/repos/route-explorer']);

      await press(instance, stdin, '\x01');

      expect(store.getState().logsOtherSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+A is scoped to the focused list — each toggle leaves the other list untouched', async () => {
    const store = seedStore({
      edts: [
        {
          ulid: 'active-ulid',
          topic: 'active-edt',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
          members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }],
        },
      ],
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true }),
        service({ service: 'route-explorer', path: '/repos/route-explorer', isMember: false }),
      ],
      logsOtherSelected: ['/repos/route-explorer'],
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // paneFocus defaults to 'edt-list'.
      await press(instance, stdin, '\x01');
      expect(store.getState().logsEdtSelected).toEqual(['/repos/api-gateway']);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/route-explorer']);

      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(store.getState().logsEdtSelected).toEqual(['/repos/api-gateway']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the without-container section is never selectable — Space and Ctrl+A cannot reach it', async () => {
    const store = seedStore({
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway' }),
        service({ service: 'shared-types', path: '/repos/shared-types' }),
      ],
      logsNoContainer: { '/repos/shared-types': true },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list (only api-gateway is selectable)

      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);

      // Ctrl+A toggles the selectable list only — the info-only row is never affected.
      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected).toEqual([]);
      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);

      // Cursor movement across the selectable list never lands on the info-only row.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(store.getState().logsEdtSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Bounds the filter-history grid browser's vertical extent to the terminal's actual row count,
  // like its horizontal truncation/scroll, recomputed live off useWindowSize() on every resize.
  describe('history grid vertical pagination', () => {
    it('the grid gains a "more below" indicator once the terminal shrinks below its row count, and loses it again once the terminal grows back', async () => {
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

        // Shrinks to the 12-row minimum, still below what the 8-row (default) first column needs.
        stdout.rows = 12;
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

    // `GridCursor.row` is an absolute index into the *full* (unsliced) column — the lookup uses
    // `groupCommandsByColumn`, never the vertically-windowed `layoutCommandGrid` result (built
    // only for rendering) — so scrolling the grid down must never change which entry Enter
    // recalls. Exactly 8 entries keeps every one in a single column (default
    // filterHistoryGridMaxRows); shrinking the terminal forces rowScrollOffset > 0 partway.
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

    // A column's display width comes from the full column, so its widest entry scrolling out of
    // view must not shrink it or misalign the columns after it. Two columns of 5 rows each
    // (filterHistoryGridMaxRows: 5), the widest entry pinned to column 0's top row: scrolling
    // column 0 down past it must not move where column 1's entries start.
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

        stdout.rows = 12; // the 12-row minimum still forces vertical pagination on the 5-row-tall column 0
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

    // The editor renders as a sibling *below* the "LOGS" + list/grid block (Ink has no absolute
    // positioning), so its rows compete with the still-mounted service lists/hints/grid for the
    // same row budget. With enough services to overflow, opening the global filter editor must
    // keep the hints panel hidden and the service list behind the editor bounded.
    it('EDITOR_OPEN_BEHIND_CONTENT: opening the filter editor over an overflowing services list keeps the hints panel hidden and the list itself bounded', async () => {
      const store = seedStore({
        edtsBranches: Array.from({ length: 60 }, (_, i) => service({ service: `svc-${i}`, path: `/repos/svc-${i}` })),
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        // Before the editor opens: an overflowing OTHER SERVICES list already shows the
        // bounded-window indicator.
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).toContain('more below');

        await press(instance, stdin, '/');
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).toContain('GLOBAL LOG FILTER');

        // None of the services-list keybinding hints render while the editor owns input.
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

  describe('wrap keys', () => {
    function longPane(path: string, marker: string) {
      return {
        repoPath: path,
        service: path.split('/').pop() ?? path,
        lines: [{ timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout' as const, text: `${'word '.repeat(60)}${marker}` }],
        streamError: null,
        noMoreHistory: false,
        scrollOffset: 0,
        health: 'up',
        restarting: false,
      };
    }

    async function mountWithTwoPanes() {
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        logsOtherSelected: ['/repos/api-gateway', '/repos/route-explorer'],
        logsPanes: {
          '/repos/api-gateway': longPane('/repos/api-gateway', 'ENDAAA'),
          '/repos/route-explorer': longPane('/repos/route-explorer', 'ENDBBB'),
        },
      });
      const mounted = mount(store);
      await mounted.instance.waitUntilRenderFlush();
      await press(mounted.instance, mounted.stdin, KEYS.tab);
      await press(mounted.instance, mounted.stdin, KEYS.tab);
      return mounted;
    }

    function lastFrame(stdout: FakeTtyStdout, before: number): string {
      return stdout.contentFramesSince(before).at(-1) ?? '';
    }

    it('Ctrl+W wraps nothing, W wraps every pane, bare w flips only the focused pane', async () => {
      const { instance, stdin, stdout } = await mountWithTwoPanes();
      try {
        let mark = stdout.chunkCount;
        await press(instance, stdin, KEYS.ctrlW);
        let frame = lastFrame(stdout, mark);
        expect(frame).not.toContain('ENDAAA');
        expect(frame).not.toContain('ENDBBB');

        mark = stdout.chunkCount;
        await press(instance, stdin, 'W');
        frame = lastFrame(stdout, mark);
        expect(frame).toContain('ENDAAA');
        expect(frame).toContain('ENDBBB');

        // Bare w flips only the focused (first) pane back to truncated.
        mark = stdout.chunkCount;
        await press(instance, stdin, 'w');
        frame = lastFrame(stdout, mark);
        expect(frame).not.toContain('ENDAAA');
        expect(frame).toContain('ENDBBB');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });
});

// The `a` actions menu: the service-action registry's rows for the focused pane, in a MenuList.
describe('LogsZone actions menu (a)', () => {
  function pane(path: string, overrides: Record<string, unknown> = {}) {
    return {
      repoPath: path,
      service: path.split('/').pop() ?? path,
      lines: [],
      streamError: null,
      noMoreHistory: false,
      scrollOffset: 0,
      health: 'up',
      restarting: false,
      ...overrides,
    };
  }

  const AVAILABLE = { available: true as const };
  function registryActions(containerLess = false): ServiceAction[] {
    const blocked = containerLess ? { available: false as const, reason: 'no container' } : AVAILABLE;
    return [
      { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: AVAILABLE },
      { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: blocked },
      { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: blocked },
      { id: 'terminal-service', label: 'Terminal', key: 'Ctrl+T', availability: AVAILABLE },
      { id: 'terminal-container', label: 'Container terminal', key: 'Ctrl+X', availability: blocked },
    ];
  }

  function gridStore(overrides: Record<string, unknown> = {}) {
    return seedStore({
      subscribeLogsPane: vi.fn(async () => {}),
      unsubscribeLogsPane: vi.fn(),
      logsOtherSelected: ['/repos/api-gateway'],
      logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway') },
      ...overrides,
    });
  }

  async function focusPanes(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await press(instance, stdin, KEYS.tab); // edt-list -> other-list
    await press(instance, stdin, KEYS.tab); // other-list -> panes
  }

  it('`a` on a sub-focused pane lists the five registry actions with their keys, and captures input', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const store = gridStore({ listLogsPaneActions });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();

      expect(listLogsPaneActions).toHaveBeenCalledWith('/repos/api-gateway');
      expect(store.getState().zoneInputCaptured).toBe(true);
      const frame = stdout.output;
      expect(frame).toContain('SERVICE ACTIONS');
      for (const label of ['Open in IDE', 'Restart', 'Clean restart', 'Terminal', 'Container terminal']) {
        expect(frame).toContain(label);
      }
      expect(frame).toContain('Ctrl+L');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('`a` from the service lists never opens the menu', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const store = gridStore({ listLogsPaneActions });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'a');
      await press(instance, stdin, KEYS.tab); // other-list
      await press(instance, stdin, 'a');
      expect(listLogsPaneActions).not.toHaveBeenCalled();
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on Clean restart closes the menu and runs that registry action on the pane', async () => {
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => registryActions()), runLogsPaneAction });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(runLogsPaneAction).toHaveBeenCalledWith('/repos/api-gateway', 'restart-clean', 'api-gateway');
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on Terminal runs the terminal entry (End jumps to the last row, the container terminal)', async () => {
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => registryActions()), runLogsPaneAction });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.enter);

      expect(runLogsPaneAction).toHaveBeenCalledWith('/repos/api-gateway', 'terminal-service', 'api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a container-less pane shows the restarts and the container terminal disabled with `no container`; Enter on them is ignored', async () => {
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({
      listLogsPaneActions: vi.fn(async () => registryActions(true)),
      runLogsPaneAction,
      logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway', { health: 'no-container', noContainer: true }) },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('no container');

      await press(instance, stdin, KEYS.down); // Restart (disabled)
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.end); // Container terminal (disabled)
      await press(instance, stdin, KEYS.enter);

      expect(runLogsPaneAction).not.toHaveBeenCalled();
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a failed listing shows one error line and Esc closes the menu', async () => {
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => null) });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('The service actions could not be loaded.');

      await pressEscape(instance, stdin);
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while open, zone keys (c, f, R, O, /) do nothing and the menu stays open', async () => {
    const runLogsPaneShortcut = vi.fn(async () => {});
    const clearLogsPane = vi.fn();
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => registryActions()), runLogsPaneShortcut, clearLogsPane });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      for (const key of ['c', 'f', 'R', 'O', '/', 'q', ':', 'l']) {
        await press(instance, stdin, key);
      }
      expect(runLogsPaneShortcut).not.toHaveBeenCalled();
      expect(clearLogsPane).not.toHaveBeenCalled();
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('`a` in fullscreen opens the menu on the fullscreen pane', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({ listLogsPaneActions, runLogsPaneAction, logsOtherSelected: [] });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // ad hoc fullscreen preview on api-gateway
      expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      expect(listLogsPaneActions).toHaveBeenCalledWith('/repos/api-gateway');
      expect(stdout.output).toContain('SERVICE ACTIONS');

      await press(instance, stdin, KEYS.enter); // Open in IDE
      expect(runLogsPaneAction).toHaveBeenCalledWith('/repos/api-gateway', 'open-in-ide', 'api-gateway');
      // Closing the menu leaves fullscreen open.
      expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
