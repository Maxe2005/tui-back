// tui/zones/logs: real-keypress global and pane filter editor interactions.
import { encodeFilterHistoryEntry } from '../logic/logs-zone.logic.js';
import { describe, it, expect, vi } from 'vitest';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { LogsZone } from '../logs-zone.js';
import { service, press, pressEscape, openRuleEditor, mount, seedStore } from '../logs-zone.test-support.js';

describe('LogsZone real-keypress interactions — filter editor', () => {
  // `/` opens the global-filter editor from any Logs-zone focus.
  it('"/" opens the global filter editor on its rule list from list focus; "a" starts a new rule whose typed characters show in the draft', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');
      expect(stdout.output).toContain('GLOBAL LOG FILTER');
      expect(stdout.output).toContain('No rules');

      await press(instance, stdin, 'a');
      expect(stdout.output).toContain('NEW RULE');
      await press(instance, stdin, 'boom');
      expect(stdout.output).toContain('boom');
      // Nothing is applied until Enter.
      expect(store.getState().logsGlobalFilter.rules).toEqual([]);
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

  it('Esc in the rule editor discards the draft and returns to the list; Esc in the list closes the editor keeping every rule', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, ' '); // select api-gateway so a pane shows the filter state
      await press(instance, stdin, KEYS.tab);
      await openRuleEditor(instance, stdin, '/');
      await press(instance, stdin, 'apple');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().logsGlobalFilter.rules).toMatchObject([{ query: 'apple', enabled: true }]);
      expect(stdout.output).toContain('[x] show line text "apple"');

      await press(instance, stdin, 'a');
      await press(instance, stdin, 'x');
      await pressEscape(instance, stdin); // back to the list, draft discarded
      expect(stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'))).toContain('RULES');
      expect(store.getState().logsGlobalFilter.rules).toHaveLength(1);

      await pressEscape(instance, stdin); // closes the editor
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).toContain('global filter: 1 rule');
      expect(lastFrame).not.toContain('GLOBAL LOG FILTER');
      expect(store.getState().logsGlobalFilter.rules).toHaveLength(1);
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
      await openRuleEditor(instance, stdin, '/');
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

      await openRuleEditor(instance, stdin, '/');
      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('Regex:');

      await press(instance, stdin, '(');
      expect(stdout.output).toContain('Invalid regular expression');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Ctrl+Left/Right cycle the scope's level restriction on the rule list (see logs-zone.logic.ts's
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

  // Bare Left/Right are the TextInputLine caret and never touch the query.
  it('bare Left/Right only move the caret and never alter the query or the level', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await openRuleEditor(instance, stdin, '/');
      await press(instance, stdin, 'boom');
      await press(instance, stdin, KEYS.right);
      await press(instance, stdin, KEYS.left);

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
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

      await openRuleEditor(instance, stdin, '/');
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

      await openRuleEditor(instance, stdin, '/');
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

      await openRuleEditor(instance, stdin, '/');
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

      await openRuleEditor(instance, stdin, '/');
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

  it('Ctrl+X / Ctrl+T switch action and target, Enter saves the rule and records history, and recall restores all three', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    const lastFrame = () => stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
    try {
      await instance.waitUntilRenderFlush();

      await openRuleEditor(instance, stdin, '/');
      expect(lastFrame()).toContain('Filter: show line');
      await press(instance, stdin, 'noise');
      await press(instance, stdin, '\x18');
      expect(lastFrame()).toContain('Filter: hide line');
      await press(instance, stdin, '\x14');
      expect(lastFrame()).toContain('Filter: hide match');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().logsGlobalFilter.rules).toMatchObject([{ query: 'noise', action: 'hide', target: 'match', enabled: true }]);

      const history = store.getState().filterHistory['global:text'];
      expect(history).toHaveLength(1);

      await press(instance, stdin, 'a');
      expect(lastFrame()).toContain('Filter: show line');
      await press(instance, stdin, KEYS.up);
      expect(lastFrame()).toContain('Text: noise');
      expect(lastFrame()).toContain('Filter: hide match');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  describe('action/target in the filter editor', () => {
    const hidden = encodeFilterHistoryEntry({ query: 'recalled', action: 'hide', target: 'match' });
    const lastGlobalFrame = (out: string) => out.slice(out.lastIndexOf('GLOBAL LOG FILTER'));

    it('after recalling a hide/match entry, typing, Backspace or Tab restores the draft own action and target', async () => {
      for (const keystroke of ['X', KEYS.backspace, KEYS.tab]) {
        const store = seedStore({ filterHistory: { 'global:text': [hidden] } });
        const { instance, stdin, stdout } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          await openRuleEditor(instance, stdin, '/');
          await press(instance, stdin, 'draft');
          await press(instance, stdin, KEYS.up);
          expect(lastGlobalFrame(stdout.output)).toContain('Filter: hide match');
          await press(instance, stdin, keystroke);
          expect(lastGlobalFrame(stdout.output)).toContain('Filter: show line');
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
        }
      }
    });

    it('Enter on a hide/match grid entry recalls its query, action and target into the draft', async () => {
      const store = seedStore({ filterHistory: { 'global:text': [hidden] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.down);
        await press(instance, stdin, KEYS.enter); // recall into the draft
        expect(lastGlobalFrame(stdout.output)).toContain('Filter: hide match');
        await press(instance, stdin, KEYS.enter); // save the rule
        expect(store.getState().logsGlobalFilter.rules).toMatchObject([{ query: 'recalled', action: 'hide', target: 'match' }]);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('the pane editor stores action/target, annotates the pane and shows them again when the rule is edited', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, ' ');
        await press(instance, stdin, KEYS.tab);
        await openRuleEditor(instance, stdin, 'f');
        await press(instance, stdin, 'boom');
        await press(instance, stdin, '\x18');
        await press(instance, stdin, '\x14');
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().logsPaneFilters['/repos/api-gateway'].rules).toMatchObject([{ query: 'boom', action: 'hide', target: 'match' }]);
        expect(stdout.output.slice(stdout.output.lastIndexOf('PANE LOG FILTER'))).toContain('[x] hide match text "boom"');
        await pressEscape(instance, stdin);
        expect(stdout.output.slice(stdout.output.lastIndexOf('LOGS'))).toContain('pane filter: 1 rule');
        await press(instance, stdin, 'f');
        await press(instance, stdin, KEYS.enter); // edit the rule again
        expect(stdout.output.slice(stdout.output.lastIndexOf('PANE LOG FILTER'))).toContain('Filter: hide match');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('Escape after Ctrl+X / Ctrl+T discards the draft: no rule is added', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, 'boom');
        await press(instance, stdin, '\x18');
        await press(instance, stdin, '\x14');
        await pressEscape(instance, stdin);
        expect(store.getState().logsGlobalFilter.rules).toEqual([]);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });

  // A pure caret move while browsing history must not snap the draft back — only typing/
  // Backspace does that.
  it('Left/Right while browsing a recalled history entry moves the caret without snapping back to the draft', async () => {
    const store = seedStore({ filterHistory: { 'global:text': ['recalled'] } });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await openRuleEditor(instance, stdin, '/');
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

      await openRuleEditor(instance, stdin, '/');
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

  // Esc in the rule editor is a true cancel of the draft: nothing enters the list.
  it('Escape in the pane rule editor leaves the pane without a filter', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await openRuleEditor(instance, stdin, 'f');
      await press(instance, stdin, 'boom');
      expect(stdout.output).not.toContain('pane filter: 1 rule');

      await pressEscape(instance, stdin); // draft discarded, back on the list
      await pressEscape(instance, stdin); // editor closed
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).not.toContain('pane filter:');
      expect(lastFrame).not.toContain('PANE LOG FILTER');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Enter saves the rule into the list and returns to it; Esc then closes, keeping the rule.
  it('Enter in the rule editor saves the rule and returns to the list; Esc closes keeping it', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await openRuleEditor(instance, stdin, 'f');
      await press(instance, stdin, 'boom');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output.slice(stdout.output.lastIndexOf('PANE LOG FILTER'))).toContain('[x] show line text "boom"');

      await pressEscape(instance, stdin);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).toContain('pane filter: 1 rule');
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

  // The "pane filter: ..." annotation and resolveFilterClearTarget's hasOwnFilter check key off
  // entry *presence* in paneFilters — deleting the last rule must remove the entry.
  it('deleting a pane\'s last rule removes the "pane filter: ..." annotation', async () => {
    const store = seedStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, ' '); // select api-gateway
      await press(instance, stdin, KEYS.tab); // other-list -> panes

      await openRuleEditor(instance, stdin, 'f');
      await press(instance, stdin, 'boom');
      await press(instance, stdin, KEYS.enter);
      await pressEscape(instance, stdin);
      expect(stdout.output).toContain('pane filter: 1 rule');
      expect(Object.keys(store.getState().logsPaneFilters)).toEqual(['/repos/api-gateway']);

      await press(instance, stdin, 'f');
      await press(instance, stdin, 'd'); // delete the rule under the cursor
      expect(store.getState().logsPaneFilters).toEqual({});
      await pressEscape(instance, stdin);

      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).not.toContain('pane filter:');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The filter actually narrows what's rendered, not just its own draft text echo.
  it('a saved global rule narrows rendered log lines end-to-end', async () => {
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

      await openRuleEditor(instance, stdin, '/');
      await press(instance, stdin, 'banana');
      await press(instance, stdin, KEYS.enter);

      // The grid (with the log lines) renders *above* the filter-editor modal in the same
      // frame — slice from the frame's own top marker ('LOGS'), not from 'GLOBAL LOG FILTER'
      // itself, so the slice still includes the grid content that comes before it.
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
      expect(lastFrame).toContain('banana line');
      expect(lastFrame).not.toContain('apple line');
      expect(lastFrame).not.toContain('cherry line');
      // An engaged pane with an active global filter shows what that filter actually is, not
      // just a boolean — so a pane's own annotation and the editor draft never disagree.
      expect(lastFrame).toContain('global filter: 1 rule');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
