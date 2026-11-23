// tui/zones/logs: real-keypress stackable filter rules.
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../../store/app-store.js';
import { FakeTtyStdout, KEYS } from '../../../shared/test-support/fake-tty.js';
import { LogsZone } from '../logs-zone.js';
import { service, press, pressEscape, openRuleEditor, mount, seedStore } from '../logs-zone.test-support.js';

describe('LogsZone real-keypress interactions — filter rules', () => {
  describe('stackable filter rules', () => {
    const ctrlUp = '\x1b[1;5A';
    const ctrlDown = '\x1b[1;5B';
    const queries = (store: ReturnType<typeof createAppStore>) => store.getState().logsGlobalFilter.rules.map((r) => r.query);
    async function addRules(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, names: string[]): Promise<void> {
      await press(instance, stdin, '/');
      for (const name of names) {
        await press(instance, stdin, 'a');
        await press(instance, stdin, name);
        await press(instance, stdin, KEYS.enter);
      }
    }

    it('lists the rules, edits one in place, toggles it off and deletes it, each applied immediately', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['one', 'two']);
        expect(queries(store)).toEqual(['one', 'two']);
        expect(stdout.output).toContain('1. [x] show line text "one"');
        expect(stdout.output).toContain('2. [x] show line text "two"');

        await press(instance, stdin, KEYS.up);
        await press(instance, stdin, KEYS.enter); // edit "one"
        await press(instance, stdin, '!');
        await press(instance, stdin, KEYS.enter);
        expect(queries(store)).toEqual(['one!', 'two']);

        await press(instance, stdin, ' ');
        expect(store.getState().logsGlobalFilter.rules[0].enabled).toBe(false);
        expect(stdout.output).toContain('[ ] show line text "one!"');

        await press(instance, stdin, 'd');
        expect(queries(store)).toEqual(['two']);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('Ctrl+Up / Ctrl+Down move the highlighted rule, the cursor following it', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['a', 'b', 'c']); // cursor on "c"
        await press(instance, stdin, ctrlUp);
        expect(queries(store)).toEqual(['a', 'c', 'b']);
        await press(instance, stdin, ctrlUp);
        expect(queries(store)).toEqual(['c', 'a', 'b']);
        await press(instance, stdin, ctrlUp); // already first
        expect(queries(store)).toEqual(['c', 'a', 'b']);
        await press(instance, stdin, ctrlDown);
        expect(queries(store)).toEqual(['a', 'c', 'b']);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('Ctrl+Left/Right cycle the scope level from the list', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, '/');
        await press(instance, stdin, KEYS.ctrlRight);
        expect(store.getState().logsGlobalFilter.level).toBe('ERROR');
        await press(instance, stdin, KEYS.ctrlLeft);
        expect(store.getState().logsGlobalFilter.level).toBeNull();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('an invalid regex is refused inline on Enter and never enters the list', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.tab); // regex
        await press(instance, stdin, '(');
        await press(instance, stdin, KEYS.enter);
        expect(stdout.output).toContain('Invalid regular expression');
        expect(stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'))).toContain('NEW RULE');
        expect(store.getState().logsGlobalFilter.rules).toEqual([]);
        expect(store.getState().filterHistory['global:regex']).toBeUndefined();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('an empty draft is refused and never enters the list', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.enter);
        expect(stdout.output).toContain('Enter a query for this rule.');
        expect(store.getState().logsGlobalFilter.rules).toEqual([]);
        expect(store.getState().filterHistory['global:text']).toBeUndefined();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('refuses an 11th rule with a visible message and leaves the list unchanged', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, Array.from({ length: 10 }, (_, i) => `r${i}`));
        expect(store.getState().logsGlobalFilter.rules).toHaveLength(10);
        await press(instance, stdin, 'a');
        expect(stdout.output).toContain('Rule limit reached');
        expect(stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'))).not.toContain('NEW RULE');
        expect(store.getState().logsGlobalFilter.rules).toHaveLength(10);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"X" asks for confirmation: Esc keeps the rules, y clears them all; Esc alone never clears', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['a', 'b']);
        await press(instance, stdin, 'X');
        expect(stdout.output).toContain('Clear all 2 rules?');
        await pressEscape(instance, stdin);
        expect(queries(store)).toEqual(['a', 'b']);
        expect(stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'))).not.toContain('Clear all');

        await press(instance, stdin, 'X');
        await press(instance, stdin, 'y');
        expect(queries(store)).toEqual([]);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('shows the stored-rules warning on the title row and drops it once a filter editor opens (/ or f)', async () => {
      for (const key of ['/', 'f']) {
        const store = seedStore({
          logsRulesWarning: 'Saved filter rules: logRules.global[1]: bad — rule dropped',
          ...(key === 'f' ? { logsFullscreenTarget: '/repos/api-gateway', logsFullscreenServiceName: 'api-gateway' } : {}),
        });
        const { instance, stdin, stdout } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          if (key === '/') {
            expect(stdout.output).toContain('logRules.global[1]');
          }
          expect(store.getState().logsRulesWarning).not.toBeNull();
          await press(instance, stdin, key);
          expect(store.getState().logsRulesWarning).toBeNull();
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
        }
      }
    });

    describe('named rule sets', () => {
      const lastView = (stdout: FakeTtyStdout) => stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
      const setNames = (store: ReturnType<typeof createAppStore>) => store.getState().logsRuleSets.map((set) => set.name);

      it('s asks for a name: empty is refused, a new name saves a snapshot, an existing one asks before overwriting', async () => {
        const store = seedStore();
        const { instance, stdin, stdout } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          await addRules(instance, stdin, ['a', 'b']);
          await press(instance, stdin, 's');
          await press(instance, stdin, KEYS.enter);
          expect(lastView(stdout)).toContain('Enter a name for this set.');
          expect(setNames(store)).toEqual([]);

          await press(instance, stdin, 'n');
          await press(instance, stdin, 'x');
          await press(instance, stdin, KEYS.enter);
          expect(setNames(store)).toEqual(['nx']);
          expect(lastView(stdout)).toContain('Saved set "nx".');

          // The set is a snapshot: later edits to the active list never reach it.
          await press(instance, stdin, 'd');
          expect(store.getState().logsRuleSets[0].rules.map((r) => r.query)).toEqual(['a', 'b']);

          await press(instance, stdin, 's');
          for (const ch of 'nx') {
            await press(instance, stdin, ch);
          }
          await press(instance, stdin, KEYS.enter);
          expect(lastView(stdout)).toContain('Overwrite set "nx"?');
          await pressEscape(instance, stdin);
          expect(store.getState().logsRuleSets[0].rules).toHaveLength(2);
          await press(instance, stdin, KEYS.enter);
          await press(instance, stdin, 'y');
          expect(store.getState().logsRuleSets[0].rules.map((r) => r.query)).toEqual(['a']);
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
        }
      });

      it('refuses a new set visibly once the library holds 20', async () => {
        const store = seedStore();
        store.setState({ logsRuleSets: Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, rules: [] })) });
        const { instance, stdin, stdout } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          await addRules(instance, stdin, ['a']);
          await press(instance, stdin, 's');
          await press(instance, stdin, 'z');
          await press(instance, stdin, KEYS.enter);
          expect(lastView(stdout)).toContain('library is full');
          expect(store.getState().logsRuleSets).toHaveLength(20);
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
        }
      });

      it('l opens the library: Enter applies directly on an empty list, replaces after confirmation otherwise', async () => {
        const rules = [{ mode: 'text' as const, query: 'from-set', action: 'hide' as const, target: 'line' as const, enabled: true }];
        const store = seedStore();
        store.setState({ logsRuleSets: [{ name: 'noise', rules }] });
        const { instance, stdin, stdout } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          await press(instance, stdin, '/');
          await press(instance, stdin, 'l');
          expect(lastView(stdout)).toContain('noise (1 rule)');
          await press(instance, stdin, KEYS.enter);
          expect(queries(store)).toEqual(['from-set']);
          // Applied as a copy: toggling the active rule never alters the stored set.
          await press(instance, stdin, ' ');
          expect(store.getState().logsGlobalFilter.rules[0].enabled).toBe(false);
          expect(store.getState().logsRuleSets[0].rules[0].enabled).toBe(true);

          await press(instance, stdin, 'l');
          await press(instance, stdin, KEYS.enter);
          expect(lastView(stdout)).toContain('Replace the 1 active rule with set "noise"?');
          await pressEscape(instance, stdin);
          expect(store.getState().logsGlobalFilter.rules[0].enabled).toBe(false);
          await press(instance, stdin, KEYS.enter);
          await press(instance, stdin, 'y');
          expect(store.getState().logsGlobalFilter.rules[0].enabled).toBe(true);
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
        }
      });

      it('renames and deletes only the targeted set (delete confirmed), never touching the active list', async () => {
        const rule = (query: string) => ({ mode: 'text' as const, query, action: 'hide' as const, target: 'line' as const, enabled: true });
        const store = seedStore();
        store.setState({
          logsRuleSets: [{ name: 'one', rules: [rule('1')] }, { name: 'two', rules: [rule('2')] }],
          logsGlobalFilter: { level: null, rules: [rule('active')] },
        });
        const { instance, stdin, stdout } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          await press(instance, stdin, '/');
          await press(instance, stdin, 'l');
          await press(instance, stdin, 'r');
          await press(instance, stdin, '!');
          await press(instance, stdin, KEYS.enter);
          expect(setNames(store)).toEqual(['one!', 'two']);
          // A name already used by another set is refused.
          await press(instance, stdin, 'r');
          await press(instance, stdin, KEYS.backspace);
          await press(instance, stdin, KEYS.backspace);
          await press(instance, stdin, KEYS.backspace);
          await press(instance, stdin, KEYS.backspace);
          for (const ch of 'two') {
            await press(instance, stdin, ch);
          }
          await press(instance, stdin, KEYS.enter);
          expect(lastView(stdout)).toContain('already exists');
          await pressEscape(instance, stdin);

          await press(instance, stdin, 'd');
          expect(lastView(stdout)).toContain('Delete set "one!"?');
          await pressEscape(instance, stdin);
          expect(setNames(store)).toEqual(['one!', 'two']);
          await press(instance, stdin, 'd');
          await press(instance, stdin, 'y');
          expect(setNames(store)).toEqual(['two']);
          expect(queries(store)).toEqual(['active']);
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
        }
      });
    });

    it('Esc from the list closes the editor and keeps every rule', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['a', 'b']);
        await pressEscape(instance, stdin);
        expect(queries(store)).toEqual(['a', 'b']);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('stacked rules apply in order to the rendered lines, without interrupting the stream', async () => {
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
              { timestamp: 't0', stream: 'stdout', text: 'WARN Affectation ok' },
              { timestamp: 't1', stream: 'stdout', text: 'WARN Aucun service ici' },
              { timestamp: 't2', stream: 'stdout', text: 'INFO Affectation fine' },
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
        const subscribed = subscribeLogsPane.mock.calls.length;
        await addRules(instance, stdin, ['WARN', 'Affectation']);
        const frame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(frame).toContain('WARN Affectation ok');
        expect(frame).not.toContain('WARN Aucun service ici');
        expect(frame).not.toContain('INFO Affectation fine');

        await press(instance, stdin, ' '); // disable the second rule
        const relaxed = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(relaxed).toContain('WARN Aucun service ici');
        expect(subscribeLogsPane.mock.calls.length).toBe(subscribed);
        expect(unsubscribeLogsPane).not.toHaveBeenCalled();
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
    it('Ctrl+D, Ctrl+A and other modified letters do not delete, add or toggle', async () => {
      const store = seedStore();
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['keep']);
        await press(instance, stdin, '\x04'); // Ctrl+D
        await press(instance, stdin, '\x01'); // Ctrl+A
        expect(queries(store)).toEqual(['keep']);
        expect(stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'))).not.toContain('NEW RULE');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('Enter confirms clear-all, like y', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['a', 'b']);
        await press(instance, stdin, 'X');
        await press(instance, stdin, KEYS.enter);
        expect(queries(store)).toEqual([]);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('the pane scope level cycle creates, then removes, the pane\'s filter entry', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, ' ');
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, 'f');
        await press(instance, stdin, KEYS.ctrlRight);
        expect(store.getState().logsPaneFilters['/repos/api-gateway']).toEqual({ level: 'ERROR', rules: [] });
        await press(instance, stdin, KEYS.ctrlLeft);
        expect(store.getState().logsPaneFilters).toEqual({});
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('the footer shows the rules list hints, then the clear-all confirmation hints', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      const footer = () => store.getState().footerContexts.at(-1)?.id;
      try {
        await instance.waitUntilRenderFlush();
        await addRules(instance, stdin, ['a']);
        expect(footer()).toBe('logs-filter-rules');
        await press(instance, stdin, 'X');
        expect(footer()).toBe('logs-filter-rules-confirm');
        await pressEscape(instance, stdin);
        expect(footer()).toBe('logs-filter-rules');
        await press(instance, stdin, 'a');
        expect(footer()).toBe('logs-filter-edit');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('closes the editor instead of recreating a pane entry when the pane was deselected', async () => {
      const store = seedStore();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, ' ');
        await press(instance, stdin, KEYS.tab);
        await openRuleEditor(instance, stdin, 'f');
        await press(instance, stdin, 'boom');
        store.getState().toggleLogsOtherSelection('/repos/api-gateway');
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().logsPaneFilters).toEqual({});
        expect(store.getState().zoneInputCaptured).toBe(false);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });
});
