// EdtsZone real-keypress tests: quick pick.
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { footerIdOf } from '../../../../shared/test-support/mount-for-test.js';
import { edt, press, pressEscape, type, mount } from '../../edts-zone.test-support.js';

// ==========================================================================================
// EDT quick-pick: edt-switch/edt-modify/edt-delete with no argument open a shared filterable,
// arrow-navigable list instead of guessing a target. Driven like the real command bar drives it —
// setting `currentEdtAction` with the `target: 'select EDT'` sentinel the store's openEdt*Dialog
// actions produce — so the zone's own `currentEdtAction` effect is the thing under test, not a
// seeded dialog state.
// ==========================================================================================

describe('EdtsZone quick-pick dialog', () => {
  it('edt-switch with no argument opens quick-pick(switch), excluding the active EDT from the candidate pool', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-work', status: 'active' });
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [active, other],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');
      // The quick-pick dialog's own title ("SELECT EDT TO SWITCH") legitimately contains the
      // substring "SWITCH EDT" — assert against the switch-confirm dialog's distinguishing
      // confirm prompt instead, which only switch-dialog.tsx itself ever renders.
      expect(stdout.output).not.toContain('Switch to "');

      // Boundary regression: `active` sorts first in `edts`, so a default row cursor of 0
      // landing on it here would prove the active EDT was wrongly left in the pool.
      // `other-work` is the only reachable row instead.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('Switch to "other-work"');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('edt-modify with no argument opens quick-pick(modify), filtering over every EDT (active included)', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-work', status: 'active' });
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [active, other],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');
      expect(stdout.output).toContain('active-work');
      expect(stdout.output).toContain('other-work');

      // Unlike switch, the active EDT is a reachable row here — the default cursor (0, the
      // pool's first entry) lands on it.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: active-work');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('edt-delete with no argument opens quick-pick(delete); selecting the active EDT surfaces the existing rejection message', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-work', status: 'active' });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'delete', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');

      await press(instance, stdin, KEYS.enter);
      // `stdout.output` accumulates every frame ever written, including the quick-pick's own
      // filter field (whose focused TextInputLine always renders a "[Enter] confirm" hint) —
      // scope the "no confirm affordance" assertion to the last-rendered frame (found from the
      // last occurrence of the DELETE EDT title, which the rejected dialog's own frame is the
      // most recent one to render), the same technique this file's other real-keypress tests
      // already use for a "this chrome is gone now" assertion.
      const rejectedFrame = stdout.output.slice(stdout.output.lastIndexOf('DELETE EDT'));
      expect(rejectedFrame).toContain('DELETE EDT');
      // The existing delete rejection message, reached via the picker.
      expect(rejectedFrame).toContain('active EDT');
      expect(footerIdOf(store)).toBe('dismiss');
      expect(rejectedFrame).not.toContain('confirm');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the quick-pick from any mode with no dialog opened', async () => {
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [other],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Filter');

      // `stdout.output` accumulates every frame ever written, so a `.not.toContain` against
      // the whole log would vacuously pass even if Escape did nothing — only the output
      // *written since* Escape proves the dialog is actually gone from the current render.
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      expect(outputSinceEscape).not.toContain('Filter');
      expect(outputSinceEscape).not.toContain('SELECT EDT TO SWITCH');
      // The base EDT-list hint line — hidden while any dialog is open — is back.
      expect(outputSinceEscape).toContain('[Enter] switch/modify');
      expect(store.getState().currentEdtAction).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a real-keypress filter narrows the matches and Enter opens the exact pre-targeted dialog the topic-supplied path would', async () => {
    const alpha = edt({ ulid: 'alpha-ulid', topic: 'alpha' });
    const alphabet = edt({ ulid: 'alphabet-ulid', topic: 'alphabet' });
    const beta = edt({ ulid: 'beta-ulid', topic: 'beta' });
    const store = createAppStore();
    store.setState({
      edts: [alpha, alphabet, beta],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'alpha');
      // The base EDTS list (always rendered underneath the dialog, regardless of quick-pick
      // filtering) also lists 'beta' by topic — a whole-output `.not.toContain('beta')` would
      // therefore be meaningless. Scope the "filtered out of the picker's own row list"
      // assertion to the dialog box's own last-rendered frame (from its most recent "╔"
      // border onward) instead.
      const dialogFrame = stdout.output.slice(stdout.output.lastIndexOf('╔'));
      expect(dialogFrame).toContain('alpha');
      expect(dialogFrame).toContain('alphabet');
      expect(dialogFrame).not.toContain('beta');

      // Down moves the row cursor onto 'alphabet' (the filtered pool's second match) — the
      // decisive proof the filter actually narrowed the *navigable* pool, not just the text
      // shown: if 'beta' had stayed in the pool ahead of 'alphabet', or filtering hadn't
      // applied at all, this Enter would target a different EDT than 'alphabet'.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: alphabet');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the filter matches by substring, not prefix: typing the end of a topic still finds it', async () => {
    const billing = edt({ ulid: 'billing-ulid', topic: 'billing-api' });
    const front = edt({ ulid: 'front-ulid', topic: 'storefront' });
    const store = createAppStore();
    store.setState({
      edts: [front, billing],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'api');
      const dialogFrame = stdout.output.slice(stdout.output.lastIndexOf('╔'));
      expect(dialogFrame).toContain('billing-api');
      expect(dialogFrame).not.toContain('storefront');

      // Decisive proof: 'storefront' sorts first in the pool, so Enter landing on
      // 'billing-api' means the substring filter narrowed the navigable list.
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: billing-api');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a filter matching zero EDTs shows an explicit "No matching EDT" state, never a silently-empty list', async () => {
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [other],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'zzz');

      expect(stdout.output).toContain('No matching EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a pure caret move on the filter field leaves the row cursor unchanged, even after it was moved off the top match', async () => {
    const alpha = edt({ ulid: 'alpha-ulid', topic: 'alpha' });
    const alphabet = edt({ ulid: 'alphabet-ulid', topic: 'alphabet' });
    const store = createAppStore();
    store.setState({
      edts: [alpha, alphabet],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'modify', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // Narrow to 2 matches, then move the row cursor off the top match onto 'alphabet'.
      await type(instance, stdin, 'alpha');
      await press(instance, stdin, KEYS.down);

      // A pure caret move (Left, then Home) on the filter text: `edited.value` stays
      // 'alpha' throughout, so per the `nextCursor = edited.value === current.query ?
      // current.cursor : 0` branch, the row cursor must survive both — never reset to 0.
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.home);

      // Decisive proof: Enter still targets 'alphabet' (the row the cursor was moved to),
      // not 'alpha' (what a wrongly-reset cursor of 0 would target).
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('MODIFY EDT');
      expect(stdout.output).toContain('Topic: alphabet');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter while the filter matches zero EDTs is a safe no-op: dialog stays open on "No matching EDT"', async () => {
    const other = edt({ ulid: 'other-ulid', topic: 'other-work' });
    const store = createAppStore();
    store.setState({
      edts: [other],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'select EDT', startedAt: new Date().toISOString() },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await type(instance, stdin, 'zzz');
      expect(stdout.output).toContain('No matching EDT');

      await press(instance, stdin, KEYS.enter);

      // No dialog transition, no crash: the quick-pick stays open on its own "No matching
      // EDT" state — the switch-confirm dialog's distinguishing prompt never appears, and
      // the picker's own filter field ("Filter") is still what's rendered.
      expect(stdout.output).not.toContain('Switch to "');
      expect(stdout.output).toContain('No matching EDT');
      expect(stdout.output).toContain('Filter');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('edt-switch/modify/delete with a topic supplied stay unchanged: pre-targeted dialog opens directly, no quick-pick', async () => {
    const target = edt({ ulid: 'target-ulid', topic: 'demo' });
    const store = createAppStore();
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      currentEdtAction: { type: 'switch', target: 'demo', startedAt: new Date().toISOString() },
    });

    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('SWITCH EDT');
      expect(stdout.output).not.toContain('Filter');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
