import { describe, it, expect } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { KEYS } from './shared/test-support/fake-tty.js';
import { mount, press, pressEscape } from './app-shell.test-support.js';

describe('AppShell command-entry bar (:)', () => {
  it('opens on : with an empty focused input and no list/grid until Tab is pressed', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).toContain('COMMAND');
      expect(stdout.output).not.toContain('registry');

      // Tab on the still-empty input reveals the full grid immediately (no double-press
      // needed, nothing to complete).
      await press(instance, stdin, KEYS.tab);

      expect(stdout.output).toContain('registry');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the help overlay', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).not.toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a typed "?" never opens the global help modal while the command bar is open', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      expect(store.getState().helpOpen).toBe(false);

      await press(instance, stdin, '?');

      // "?" must land as a literal query character (the bar owns free-text capture) — it
      // must never also pop the global keybinding-help modal on top of the bar.
      expect(store.getState().helpOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the repo registry screen', async () => {
    const store = createAppStore();
    store.getState().openRegistryScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).not.toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never re-opens (no stacking) on a second : while already open — it types a literal ":" instead', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      expect(stdout.output).toContain('COMMAND');

      // A second ':' is captured as a literal query character by the bar's own free-text
      // input (it owns keystroke capture while open) rather than opening a second bar. Proven
      // by typing "registry" right after: the query becomes ":registry" (leading literal
      // colon), which is not an exact match on "registry" — Enter must show "unknown".
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('re-filters the visible grid live to a case-insensitive name-prefix match as text is typed', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      // Empty-input Tab reveals the full grid immediately.
      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('registry');

      // "ED" (uppercase) case-insensitively narrows to the 3 edt-* commands — still 2+
      // matches, so the grid stays visible rather than hiding (that only happens at exactly
      // one remaining match).
      await press(instance, stdin, 'ED');

      // stdout.output accumulates every rendered frame (it can't express "no longer
      // present"), so this proves the live re-filter narrowed to the 3 edt-* commands by
      // their all appearing only after "ED" was typed, not that "registry" stopped
      // rendering — command-bar.test.tsx's layoutCommandGrid/matchCommands unit coverage
      // is what actually proves the match set itself narrows.
      expect(stdout.output).toContain('edt-create');
      expect(stdout.output).toContain('edt-switch');
      expect(stdout.output).toContain('edt-modify');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('shows an explicit "no matching command" state once the live-visible grid narrows to zero — never a blank grid', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid first (nothing shows before Tab)

      await press(instance, stdin, 'zzz');

      expect(stdout.output).toContain('No matching command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab autocompletes a single match to its full name — proven by a subsequent exact-match Enter succeeding', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'reg'); // partial — not an exact match on its own

      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);

      // "reg" alone would show "unknown command" on Enter (not an exact match) — this only
      // succeeds if Tab actually completed the input to the full "registry" name first.
      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the :quit command requests a quit through the store — reachable regardless of the "q" shortcut setting', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...store.getState().settings, general: { quitShortcutEnabled: false, editorCommand: '' } } });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'quit');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().quitRequested).toBe(true);
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the :quit command is a no-op while a run is in progress', async () => {
    const store = createAppStore();
    store.setState({ runInProgress: true });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'quit');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab leaves the input unchanged on zero matches — never guesses at a command', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'zzz');

      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);

      // If Tab had wrongly filled in "registry" despite zero matches, this Enter would have
      // run it; it must not have.
      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an exact match runs the command and closes the bar', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      expect(stdout.output).toContain('COMMAND');

      await press(instance, stdin, KEYS.enter);

      // The command ran (store-verifiable proof it actually executed, not just closed).
      expect(store.getState().registryScreenOpen).toBe(true);
      // The bar itself closed too (commandBarOpen lives in the store so EdtsZone can read it).
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on a non-exact match keeps the bar open and shows "unknown command" — never executes', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'reg');

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
      expect(stdout.output).toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the bar without executing anything, discarding the typed text', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      expect(stdout.output).toContain('COMMAND');

      await pressEscape(instance, stdin);

      // Never executed, and the bar itself closed.
      expect(store.getState().registryScreenOpen).toBe(false);
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab is fully consumed by autocomplete — no zone-switching side effect while the bar is open', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).toBe('dashboard');
      await press(instance, stdin, ':');
      await press(instance, stdin, 'zzz');

      await press(instance, stdin, KEYS.tab);

      expect(store.getState().activeZone).toBe('dashboard');
      expect(stdout.output).toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter inside the bar never leaks into EdtsZone\'s own key.return handler underneath it', async () => {
    // Ink dispatches every keypress to every mounted useInput hook regardless of z-order —
    // with the EDTs zone active, a selected row, and pane-focus on its default 'edts' list,
    // EdtsZone's own key.return (openEdtAction(), which opens a dialog and flips
    // zoneInputCaptured true via its effect) would otherwise silently fire underneath the bar
    // the moment an exact-match Enter also runs a command. EdtsZone gates its useInput with
    // `{ isActive: !commandBarOpen }` to prevent this.
    //
    // Deliberately no Tab press in this test: EdtsZone's own key.tab toggles its local
    // paneFocus to 'services' (also leaked without the gate, per the same root cause) —
    // that pane has no key.return handling at all, so a Tab immediately before Enter would
    // incidentally mask the very leak this test exists to catch, regardless of the gate.
    // paneFocus itself has no store-observable footprint to assert against directly; the
    // isActive gate covers both leaks identically, and this test proves it via the one leak
    // (Enter -> openEdtAction -> zoneInputCaptured) that is store-observable.
    const store = createAppStore();
    store.setState({
      activeZone: 'edts',
      edts: [
        {
          ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
          topic: 'demo',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'inactive',
          members: [],
        },
      ],
      edtsStatus: 'idle',
      // A bare createAppStore() has no deps wired, so EdtsZone's real loadEdts()/
      // loadEdtsBranches() (called once on its own mount effect) would unconditionally
      // overwrite the seeded edts/edtsStatus above with an error state before this test's
      // keypresses even run. edts-zone.interaction.test.tsx's own suite stubs these the same
      // way for the same reason.
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');

      await press(instance, stdin, KEYS.enter);

      // The command actually ran...
      expect(store.getState().registryScreenOpen).toBe(true);
      // ...and EdtsZone's own Enter handler (openEdtAction) never fired underneath the bar —
      // if it had, its dialog-open effect would have flipped this true.
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a keypress meant for the settings overlay (already open) never leaks into EdtsZone underneath it', async () => {
    // Unlike the test above (which only checks the single Enter that *opens* an overlay), this
    // checks a *later*, separate keypress typed once the overlay is already open — e.g.
    // Tab/arrows cycling the settings screen's tab strip — which must not reach EdtsZone's
    // `useInput` and move its list selection/pane focus at the same time.
    const store = createAppStore();
    store.setState({
      activeZone: 'edts',
      edts: [
        {
          ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
          topic: 'demo',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'inactive',
          members: [],
        },
      ],
      edtsStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().settingsScreenOpen).toBe(true);

      // A later Enter, meant for the settings screen, must not reach EdtsZone's own
      // key.return (openEdtAction) underneath it.
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a keypress meant for the registry overlay (already open) never leaks into EdtsZone underneath it', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'edts',
      edts: [
        {
          ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
          topic: 'demo',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'inactive',
          members: [],
        },
      ],
      edtsStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().registryScreenOpen).toBe(true);

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Down from the input enters the grid at the top of the first column; Enter on the highlighted cell completes the query and returns focus to the input', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // empty-input Tab reveals the full grid

      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (registry)
      // Move to the second row (edt-create) before completing, proving the grid actually
      // tracks cursor movement rather than always completing to the first row.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // completes to the highlighted cell, focus -> input

      // Focus is back on the input and the query is the exact "edt-create" name — a second
      // Enter (only reachable from input focus) now runs it.
      await press(instance, stdin, KEYS.enter);

      // Started from the Dashboard zone (mount's default): running edt-create auto-switches to
      // EDTs (runCommand) and the zone's own currentEdtAction effect immediately consumes the
      // action and opens the create wizard — so the dialog itself, not the transient
      // currentEdtAction flag, is what proves the command actually ran.
      expect(store.getState().activeZone).toBe('edts');
      expect(stdout.output).toContain("CREATE EDT");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a printable character typed while the grid is focused returns focus to the input, appends it, and collapses the grid', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column

      await press(instance, stdin, 'x');

      // The grid must have collapsed and focus returned to the input rather than the
      // keypress being swallowed as grid navigation — proven by a subsequent Enter treating
      // "x" as an unknown command (from the input) instead of the grid's own Enter-on-cell
      // behavior completing to whichever cell was highlighted.
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('backspace while the grid is focused returns focus to the input and applies the backspace', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'edt-'); // 3 matches, already sitting at the maximal common prefix

      await press(instance, stdin, KEYS.tab); // 1st Tab: arms pending, no visible change
      await press(instance, stdin, KEYS.tab); // 2nd Tab, same query, within window: shows the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (edt-create)

      await press(instance, stdin, KEYS.backspace);

      // Backspace returned focus to the input (not the grid's own Enter-on-cell path) and
      // dropped the query to "edt" — a subsequent Enter shows "unknown command" because "edt"
      // isn't an exact match on its own; if focus had wrongly stayed in the grid, this same
      // Enter would instead silently complete to the highlighted cell without that message.
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the grid hides once live filtering narrows the match set to exactly one', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the full grid

      await press(instance, stdin, 'registry'); // live-narrows the match set to exactly one

      // The grid must have hidden (fallen back to the no-list state) rather than continuing
      // to show a stale multi-command grid — proven by Down (only meaningful while the grid
      // is visible) being a no-op, so the very next Enter runs the single exact match
      // directly from the input rather than the grid's own Enter-on-cell behavior firing.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc from grid focus closes the bar entirely without running anything', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column

      await pressEscape(instance, stdin);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab while the grid is focused is a no-op — it never leaks a literal tab character into the query', async () => {
    // Grid focus defines Up/Down/Left/Right/Enter/printable/Esc; unguarded, Tab would fall
    // through to the printable-character branch and land in the query as a literal '\t' (Ink
    // reports Tab's raw input as that byte), corrupting the query and dropping out of the grid.
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (registry)

      await press(instance, stdin, KEYS.tab);

      // Still in the grid, query untouched — completing from the still-highlighted first
      // cell and running it proves both: the query was never corrupted, and focus never left
      // the grid.
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a non-Tab key between two Tab presses discards the pending double-Tab state, so the grid does not open early', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'edt-'); // 3 matches, already at the maximal common prefix

      await press(instance, stdin, KEYS.tab); // 1st Tab: arms pending
      // An intervening key that isn't Tab and doesn't disturb the query (gridVisible is still
      // false at this point, so Down is a no-op) must discard the pending state.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.tab); // this Tab must be treated as a fresh 1st press

      // If pending had wrongly survived the intervening key, this Tab would be read as the
      // 2nd press and open the grid; Down would then enter it and Enter would only complete
      // the query (not run it). Since pending was correctly discarded, the grid never opened:
      // Down remains a no-op and Enter runs straight off the unfinished "edt-" query instead.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up at the top row leaves the grid and returns focus to the input (real-keypress wiring check)', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (row 0)

      await press(instance, stdin, KEYS.up); // row 0 -> back to the input

      // Back at the input: typing now appends to the (still-empty) query rather than being
      // swallowed as grid navigation — proven by a subsequent exact "registry" + Enter run.
      await press(instance, stdin, 'registry');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('gridMaxRows from the settings screen is live in the command bar\'s grid layout', async () => {
    // 6 registered commands (registry, edt-create, edt-switch, edt-modify, settings, quit),
    // grouped column-major with maxRows=2 -> 3 columns of [2, 2, 2] — directly observable in
    // the rendered COMMAND grid without needing to stub extra commands.
    const store = createAppStore();
    store.setState({
      settings: { general: { quitShortcutEnabled: true, editorCommand: '' }, commandPalette: { gridMaxRows: 2, historySize: 20, historyDedup: true }, edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false }, update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] } },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the full grid

      const lines = stdout.output.split('\n');
      // Columns are filled column-major with maxRows=2, so row 0 of the grid puts several
      // columns' first commands on the SAME terminal line, while a single-column layout would
      // put every command on its own line. Ink's flex layout squeezes column 1's label
      // ("edt-switc"), so the positive signal is column 2's row 0 ("edt-delete") sharing
      // registry's line — only possible with maxRows=2.
      const registryLine = lines.find((line) => line.includes('registry'));
      expect(registryLine).toBeDefined();
      expect(registryLine).toContain('edt-delete');
      expect(registryLine).not.toContain('edt-create');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
