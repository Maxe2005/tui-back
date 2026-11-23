// tui/zones/logs: real-keypress filter history recall.
import { describe, it, expect, vi } from 'vitest';
import { KEYS } from '../../../shared/test-support/fake-tty.js';
import { LogsZone } from '../logs-zone.js';
import { service, press, pressEscape, openRuleEditor, mount, seedStore } from '../logs-zone.test-support.js';

describe('LogsZone real-keypress interactions — filter history', () => {
  describe('filter history recall', () => {
    it('Enter on a compiled, non-empty draft pushes the query onto the store\'s filterHistory', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, 'boom');
        await press(instance, stdin, KEYS.enter);
        await openRuleEditor(instance, stdin, '/');
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
        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().filterHistory['global:text']).toBeUndefined();

        // Non-compiling regex draft.
        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
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

    it('↓ on an untouched draft opens a grid listing the full history, then Esc goes back to the rule list', async () => {
      const store = seedStore({ filterHistory: { 'global:text': ['alpha', 'beta'] } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.down);
        expect(stdout.output).toContain('alpha');
        expect(stdout.output).toContain('beta');

        await pressEscape(instance, stdin);
        const lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('RULES');
        expect(lastFrame).not.toContain('NEW RULE');
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

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, 'f'); // pane's own filter editor
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

        await openRuleEditor(instance, stdin, '/');
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

        await openRuleEditor(instance, stdin, '/');
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
        await openRuleEditor(instance, stdin, 'f'); // pane's own filter editor
        await press(instance, stdin, KEYS.up); // arrow-recall
        await press(instance, stdin, KEYS.up); // walk further back
        await press(instance, stdin, KEYS.down); // browse back down
        await pressEscape(instance, stdin); // cancel, close editor
        await openRuleEditor(instance, stdin, 'f');
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
});
