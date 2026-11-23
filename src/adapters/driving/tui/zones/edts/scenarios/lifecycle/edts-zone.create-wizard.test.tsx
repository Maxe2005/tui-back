// EdtsZone real-keypress tests: create wizard.
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { Result } from '../../../../../../../core/result.js';
import type { CreateEdtData } from '../../../../../../../core/edt/create.js';
import { createAppStore, type CreateEdtParams } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from '../../dialogs/create-wizard/create-wizard.js';
import { footerIdOf } from '../../../../shared/test-support/mount-for-test.js';
import { edt, press, pressEscape, type, readyBranches, settle, lastWizardFrame, step3Store, reachStep3, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone real-keypress interactions — create-wizard', () => {
  it('guards the create form submit against re-entrancy — a second Enter before the first resolves never double-calls createEdt', async () => {
    const store = createAppStore();
    let createCalls = 0;
    let release: (() => void) | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space); // select svc-a
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      await press(instance, stdin, KEYS.enter); // submit #1 — starts, awaits the pending promise
      expect(createCalls).toBe(1);

      await press(instance, stdin, KEYS.enter); // submit #2 — guarded by `submitting`
      expect(createCalls).toBe(1);

      // Every key is inert while the submit is in flight — Esc would otherwise request a quit
      // here (zero EDTs), and Ctrl+P would step back mid-submit.
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlP);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().quitRequested).toBe(false);
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
      expect(lastFrame).toContain('▶ 4. Activation ◀');
      expect(lastFrame).toContain('Creating…');

      release?.();
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(createCalls).toBe(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left/Backspace edit the topic field at the caret through a real keypress round-trip, not always at the end', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'abd'); // cursor trails at 3
      await press(instance, stdin, KEYS.left); // cursor -> 2
      // Mid-string insert: typing 'c' at cursor 2 in "abd" must produce "abcd" — a no-op Left
      // would append at the end instead, producing "abdc".
      await type(instance, stdin, 'c');
      expect(stdout.output).toContain('Name: abcd');
      expect(stdout.output).not.toContain('Name: abdc');

      await press(instance, stdin, KEYS.home); // cursor -> 0
      await press(instance, stdin, KEYS.backspace); // cursor:0 -> no-op
      expect(stdout.output).toContain('Name: abcd');

      await press(instance, stdin, KEYS.end); // cursor -> 4 (value.length)
      await press(instance, stdin, KEYS.backspace); // removes 'd' before cursor
      expect(stdout.output).toContain('Name: abc');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a zone dialog sets zoneInputCaptured so a typed "?" never opens global help while it is open', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // The create-prompt-auto-open effect and the zoneInputCaptured-sync effect both fire
      // as passive effects after the first commit — a second flush lets both settle before
      // asserting.
      await instance.waitUntilRenderFlush();
      // The create prompt auto-opened (zero EDTs) — zoneInputCaptured must already be true.
      expect(store.getState().zoneInputCaptured).toBe(true);

      // Typing "?" inside the captured topic field must not be swallowed as a global
      // shortcut anywhere else — it's appended to the topic like any other character.
      await press(instance, stdin, '?');
      // Still captured, dialog still open (no crash, no stray global dispatch).
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('create with a duplicate topic — createEdt\'s rejection is surfaced inline, form stays open', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        return { ok: false, error: { code: 'edt-topic-exists', message: 'An EDT with topic "demo" already exists' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Zero EDTs -> the create wizard auto-opens on Step 1, name-focused by default.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space); // select the one candidate member
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      // The loaded EDT list is empty, so Step 1's live check passed — only the core can still
      // reject the topic (e.g. an EDT created concurrently from the CLI).
      await press(instance, stdin, KEYS.enter); // submit -> rejected

      expect(createCalls).toHaveLength(1);
      expect(stdout.output).toContain('An EDT with topic "demo" already exists');
      // Still the create dialog, not silently torn down to a bare/empty list.
      expect(stdout.output).toContain(WIZARD_TITLE);

      // The rejection didn't wedge the form: a further submit attempt calls createEdt again.
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toHaveLength(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('zero services checked blocks leaving Step 2 — inline message, no createEdt call', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.enter); // no service checked -> blocked
      await press(instance, stdin, KEYS.ctrlN); // Ctrl+N is gated by the same check
      await press(instance, stdin, KEYS.ctrlRight); // and so is Ctrl+→

      expect(stdout.output).toContain('Select at least one service');
      const lastFrame = stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
      expect(lastFrame).toContain('▶ 2. Services ◀');
      expect(stdout.output).not.toContain('▶ 3. Branches ◀');
      expect(createCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // createEdt/switchEdt/modifyEdt are per-repo/per-member isolated — an overall ok:true result
  // can still carry `results` rows with `outcome: 'failed'` (e.g. a candidate on a
  // shared/protected branch). Every submit handler must look at `results` rather than treat
  // `result.ok` as full success and close the dialog.
  it('surfaces a per-member failure inline even though createEdt returned ok:true, instead of silently closing', async () => {
    const store = createAppStore();
    let loadCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'development', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {
        loadCalls += 1;
      },
      loadEdtsBranches: async () => {},
      listCreateBranches: readyBranches,
      createEdt: async (): Promise<Result<CreateEdtData>> => ({
        ok: true,
        data: {
          ulid: 'new-ulid',
          topic: 'demo',
          results: [
            { service: 'svc-a', outcome: 'created' },
            { service: 'svc-b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "development" is shared/protected' } },
          ],
        },
      }),
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Zero EDTs -> the create wizard auto-opens. Select both candidates.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2 (services)
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      await press(instance, stdin, KEYS.enter); // submit

      // The EDT was created (loadEdts ran) but the dialog stays open with the per-member
      // failure surfaced inline — it must never silently close as if every requested
      // member had actually been added.
      expect(loadCalls).toBeGreaterThan(0);
      expect(stdout.output).toContain(WIZARD_TITLE);
      expect(stdout.output).toContain('svc-b');
      expect(stdout.output).toContain('shared/protected');

      // The EDT already exists — nothing may re-submit or navigate away; the failure rows stay
      // until acknowledged, and Enter closes the wizard.
      await settle(instance);
      expect(footerIdOf(store)).toBe('close');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE))).toContain('shared/protected');
      const beforeClose = stdout.output.length;
      await press(instance, stdin, KEYS.enter);
      const afterClose = stdout.output.slice(beforeClose);
      expect(afterClose.length).toBeGreaterThan(0);
      expect(afterClose).not.toContain(WIZARD_TITLE);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Step 3 — global branch strategy & per-service overrides -------------------------------
  it('Step 3 opens on Panel A (placeholder base, slug name, every row global); the default submit sends memberPlans only', async () => {
    const { store, createCalls, listCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'Auth Flow', 2);
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ GLOBAL STRATEGY');
      expect(frame).toContain('› Default source branch: <shared-branch>');
      expect(frame).toContain('Global branch name: auth-flow');
      expect(frame).toContain('SUMMARY AND PER-SERVICE EXCEPTIONS');
      expect(frame).toContain('Service │ Mode');
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ auth-flow/);
      expect(frame).toMatch(/svc-b +│ \[Create \(Global\)\] │ development +│ auth-flow/);
      expect(footerIdOf(store)).toBe('wizard-branches-first');
      // Each service's lists are loaded exactly once for this entry.
      expect([...listCalls].sort()).toEqual(['/repos/a', '/repos/b']);

      await press(instance, stdin, KEYS.enter); // Panel A: Enter edits the base line — never advances
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');
      await pressEscape(instance, stdin); // leaves edit mode only
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      const recap = lastWizardFrame(stdout);
      expect(recap).toContain('▶ 4. Activation ◀');
      expect(recap).toContain('3. Branches: auth-flow');
      expect(recap).toContain('svc-a : [Create (Global)] main → auth-flow');
      await press(instance, stdin, KEYS.enter); // submit

      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.branchOptions).toBeUndefined();
      expect(createCalls[0]?.memberPlans).toEqual({
        '/repos/a': { kind: 'create', base: 'main', name: 'auth-flow' },
        '/repos/b': { kind: 'create', base: 'development', name: 'auth-flow' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a global base resolves live per service (local preferred, else origin/<x>); "not found" blocks Ctrl+N', async () => {
    const { store, createCalls } = step3Store({
      lists: { '/repos/a': { local: ['main', 'rel'], remote: ['origin/rel'] }, '/repos/b': { local: ['development'], remote: ['origin/rel'] } },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 2);
      await type(instance, stdin, 'nope'); // a printable key enters edit mode with that character typed
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Default source branch: nope');
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ ✖ branch not found/);
      await press(instance, stdin, KEYS.ctrlN); // blocked
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(frame).toContain('svc-a : branch not found');

      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      expect(lastWizardFrame(stdout)).toContain('Default source branch: <shared-branch>'); // placeholder restored
      await type(instance, stdin, 'rel');
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ rel +│ demo/);
      expect(frame).toMatch(/svc-b +│ \[Create \(Global\)\] │ origin\/rel +│ demo/);

      await press(instance, stdin, KEYS.enter); // commit the field
      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({
        '/repos/a': { kind: 'create', base: 'rel', name: 'demo' },
        '/repos/b': { kind: 'create', base: 'origin/rel', name: 'demo' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the global name tracks Step 1 until edited; Ctrl+← keeps every decision', async () => {
    const { store, createCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.ctrlLeft); // Step 3 -> Step 2
      await press(instance, stdin, KEYS.ctrlLeft); // Step 2 -> Step 1
      await type(instance, stdin, ' X Y');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (svc-a still checked)
      await settle(instance);
      expect(lastWizardFrame(stdout)).toContain('Global branch name: demo-x-y'); // untouched: tracks the slug

      await press(instance, stdin, KEYS.down); // Panel A: base -> name line
      await press(instance, stdin, KEYS.enter); // edit the name
      await type(instance, stdin, '-q');
      await press(instance, stdin, KEYS.enter); // commit
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo-x-y-q/);

      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, KEYS.ctrlLeft);
      await type(instance, stdin, 'Z');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastWizardFrame(stdout)).toContain('Global branch name: demo-x-y-q'); // touched: kept

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.members).toEqual(['/repos/a']);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'create', base: 'main', name: 'demo-x-y-q' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('"Configure" box — a Custom row ignores Panel A; Ctrl+R reverts it to the global rule', async () => {
    const { store, createCalls } = step3Store({ lists: { '/repos/a': { local: ['main'], remote: ['origin/dev'] }, '/repos/b': { local: ['development'], remote: [] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 2);
      await press(instance, stdin, KEYS.tab); // Panel A -> Panel B
      expect(lastWizardFrame(stdout)).toContain('▶ SUMMARY AND PER-SERVICE EXCEPTIONS');
      await press(instance, stdin, KEYS.enter); // open the box on svc-a
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('Mode: (•) Create new ( ) Choose existing');
      expect(frame).toContain('Base branch (source): main');
      expect(frame).toContain('Branch name: demo');

      await press(instance, stdin, KEYS.down); // base line
      await press(instance, stdin, KEYS.enter); // edit
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'origin/dev');
      await press(instance, stdin, KEYS.enter); // exact match: commits, focuses the name line
      await press(instance, stdin, KEYS.enter); // edit the name
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'q');
      await press(instance, stdin, KEYS.enter); // commit -> [ Apply ]
      await press(instance, stdin, KEYS.enter); // apply
      frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configure svc-a');
      expect(frame).toMatch(/svc-a +│ \[Create \(Custom\)\] +│ origin\/dev +│ q/);

      // Custom ignores Panel A: an unresolvable global base only blocks the global row.
      await press(instance, stdin, KEYS.tab);
      await type(instance, stdin, 'zzz');
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Create \(Custom\)\] +│ origin\/dev +│ q/);
      expect(frame).toMatch(/svc-b +│ \[Create \(Global\)\] +│ ✖ branch not found/);
      for (let i = 0; i < 3; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await pressEscape(instance, stdin); // leave Panel A's edit mode

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({
        '/repos/a': { kind: 'create', base: 'origin/dev', name: 'q' },
        '/repos/b': { kind: 'create', base: 'development', name: 'demo' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+R in the box puts the row back to [Create (Global)] and closes the box', async () => {
    const { store } = step3Store({ lists: { '/repos/a': { local: ['main', 'feat/z'], remote: [] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.space); // Mode -> Choose existing
      await press(instance, stdin, KEYS.down); // "Existing branch"
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'feat/z');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.down); // [ Apply ]
      await press(instance, stdin, KEYS.enter); // apply
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Existing\] +│ feat\/z +│ feat\/z/);

      await press(instance, stdin, KEYS.enter); // reopen: loaded back as "Choose existing"
      expect(lastWizardFrame(stdout)).toContain('Mode: ( ) Create new (•) Choose existing');
      await press(instance, stdin, KEYS.ctrlR);
      const frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configure svc-a');
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo/);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Existante / Renommer via the box — a remote pick with a rename reaches memberPlans as-is; protected names are refused inline', async () => {
    const { store, createCalls } = step3Store({ lists: { '/repos/a': { local: ['main', 'prod'], remote: ['origin/w'] } } });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.space); // Space on the Mode line toggles
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'prod');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // apply -> refused (protected, no rename)
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('“prod” is a local branch protected by the manifest of svc-a');

      await press(instance, stdin, KEYS.up); // rename checkbox
      await press(instance, stdin, KEYS.up); // "Existing branch"
      await press(instance, stdin, KEYS.enter);
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await type(instance, stdin, 'origin/w');
      await press(instance, stdin, KEYS.enter); // commit -> rename checkbox
      await press(instance, stdin, KEYS.space); // check it: "New name" appears
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'w2');
      await press(instance, stdin, KEYS.enter); // commit -> [ Apply ]
      await press(instance, stdin, KEYS.enter); // apply
      frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Rename\] +│ origin\/w +│ -> w2/);

      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'existing', branch: 'origin/w', renameTo: 'w2' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the innermost element first — box field, box, Panel A edit mode — then the wizard', async () => {
    const { store, createCalls } = step3Store({ edts: [edt({ ulid: 'other-ulid', topic: 'other' })] });
    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab); // Panel B
      await press(instance, stdin, KEYS.enter); // box
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // a field in edit
      await pressEscape(instance, stdin); // leaves the field
      expect(lastWizardFrame(stdout)).toContain('Configure svc-a');
      await pressEscape(instance, stdin); // closes the box
      let frame = lastWizardFrame(stdout);
      expect(frame).not.toContain('Configure svc-a');
      expect(frame).toContain('▶ SUMMARY AND PER-SERVICE EXCEPTIONS');

      await press(instance, stdin, KEYS.tab); // Panel A
      await press(instance, stdin, KEYS.enter); // edit mode
      await pressEscape(instance, stdin); // leaves edit mode — the wizard stays
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');

      const beforeCancel = stdout.output.length;
      await pressEscape(instance, stdin); // nothing left open -> cancels the whole creation
      // The cancel's side effect runs from an effect one commit after the Esc updater raised
      // `cancelRequested` — wait for that extra render instead of racing it under load.
      await vi.waitFor(() => {
        const afterCancel = stdout.output.slice(beforeCancel);
        expect(afterCancel).toContain('other');
        expect(afterCancel).not.toContain(WIZARD_TITLE);
      });
      expect(createCalls).toHaveLength(0);
      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('step navigation is inert while the box is open or a field is in edit — nothing unapplied is lost', async () => {
    const { store, createCalls } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the box
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down); // name line
      await press(instance, stdin, KEYS.enter); // edit
      await type(instance, stdin, '-x');
      for (const key of [KEYS.ctrlN, KEYS.ctrlRight, KEYS.ctrlP, KEYS.ctrlLeft]) {
        await press(instance, stdin, key); // inert inside a box field
      }
      let frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('Branch name: demo-x');

      await pressEscape(instance, stdin); // leave the field — the box is still open
      await press(instance, stdin, KEYS.ctrlN); // inert with the box open
      await press(instance, stdin, KEYS.ctrlP);
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('Configure svc-a');
      expect(frame).toContain('Branch name: demo-x');

      await pressEscape(instance, stdin); // close the box
      await press(instance, stdin, KEYS.tab); // Panel A
      await press(instance, stdin, KEYS.enter); // edit the base line
      await press(instance, stdin, KEYS.ctrlN); // inert while Panel A edits
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlN); // nothing open now: advances
      expect(lastWizardFrame(stdout)).toContain('▶ 4. Activation ◀');
      expect(createCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a Step 3 Esc-cancel decided in the state updater still reaches the zone — zero EDTs requests a quit', async () => {
    const { store } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.enter); // edit the base line
      await pressEscape(instance, stdin); // leaves edit mode only
      expect(store.getState().quitRequested).toBe(false);
      expect(lastWizardFrame(stdout)).toContain('▶ 3. Branches ◀');

      await pressEscape(instance, stdin); // nothing open: the zero-EDT wizard requests a quit
      // The quit runs from an effect one commit after the Esc updater (cancelRequested).
      await vi.waitFor(() => expect(store.getState().quitRequested).toBe(true));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('after a blocked Ctrl+N, editing the base clears the wizard message while the row keeps its own', async () => {
    const { store } = step3Store();
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await type(instance, stdin, 'nope');
      await press(instance, stdin, KEYS.enter); // commit the field
      await press(instance, stdin, KEYS.ctrlN); // blocked
      const count = (frame: string) => frame.split('svc-a : branch not found').length - 1;
      expect(count(lastWizardFrame(stdout))).toBe(2); // the detail line + the wizard's message
      await press(instance, stdin, KEYS.enter); // edit again
      await press(instance, stdin, KEYS.backspace); // 'nop': still not found
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(count(frame)).toBe(1); // only the row's own detail line is left
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
