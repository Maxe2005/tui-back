// tui/zones/edts: story 2.9's async submit/confirm/force-switch paths and the
// zoneInputCaptured gate are behavior only a real keypress can exercise — `renderToString`'s
// fake stdin never emits data (see edts-zone.test.tsx and Design Notes). This file reuses
// app-shell.alternate-screen.test.tsx's real-Ink-input technique (via
// shared/test-support/fake-tty.ts) to drive genuine `useInput` round-trips through Ink's own
// keypress parser — no pty required.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { Result } from '../../../../../core/result.js';
import type { CreateEdtData } from '../../../../../core/edt/create.js';
import type { SwitchActiveEdtData } from '../../../../../core/edt/switch.js';
import type { ModifyEdtData } from '../../../../../core/edt/modify.js';
import { createAppStore, type CreateEdtParams, type ModifyEdtParams } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';

function edt(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
  return {
    ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
    topic: 'demo',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [],
    ...overrides,
  };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// A lone ESC byte is ambiguous on the wire — Ink's input parser can't tell it apart from the
// first byte of a CSI sequence (e.g. an arrow key) until either more bytes arrive or its own
// internal `pendingInputFlushDelayMilliseconds` (20ms, ink/build/components/App.js) real
// timer fires to flush it as a standalone Escape keypress. `waitUntilRenderFlush()` only
// waits for React's own commit, not that timer, so a bare `press(..., KEYS.escape)` can
// resolve before Ink has actually delivered `key.escape: true` to `useInput` at all —
// asserting immediately after risks a vacuous pass (nothing ran, but the assertion happened
// to hold anyway). Every Escape press in this file goes through this instead.
async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
  for (const char of text) {
    await press(instance, stdin, char);
  }
}

function mount(
  store: ReturnType<typeof createAppStore>,
  extraProps: { initialDialogKind?: 'create' | 'switch-confirm' | 'switch-blocked' | 'modify' } = {},
) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(EdtsZone, { useStore: store, ...extraProps }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

describe('EdtsZone real-keypress interactions (story 2.9)', () => {
  it('a switch failure that is not the lock-block code stays in switch-confirm — never a silent return to the list', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let switchCalls = 0;
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls += 1;
        return { ok: false, error: { code: 'some-other-failure', message: 'Disk is full' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Base view, default pane focus 'edts', default row 0 (the only EDT, not active) —
      // Enter opens the switch-confirm dialog.
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('SWITCH EDT');

      // Enter again confirms the switch — it fails with a non-block error.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toBe(1);
      expect(stdout.output).toContain('Disk is full');

      // The decisive check: if the dialog had silently reverted to the base EDT list, this
      // third Enter would call openEdtAction() (opening a *fresh* dialog) instead of
      // re-invoking switchEdt directly — so switchCalls would stay at 1 here, only reaching
      // 2 after a *fourth* press. Reaching 2 here proves the dialog never left
      // switch-confirm.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toBe(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('switch-blocked-action-in-progress surfaces an explicit force-or-cancel prompt, and Escape cancels without forcing', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    let switchCalls: Array<{ force?: boolean }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls.push({ force: params.force });
        return { ok: false, error: { code: 'switch-blocked-action-in-progress', message: 'An action is in progress' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // attempt switch -> blocked
      expect(switchCalls).toEqual([{ force: false }]);
      expect(stdout.output).toContain('force switch');

      // Escape cancels the blocked prompt without ever forcing.
      await pressEscape(instance, stdin);
      expect(switchCalls).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a second Enter on the blocked prompt forces the switch (force: true) and succeeds', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    const switchCalls: Array<{ force?: boolean }> = [];
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => {
        switchCalls.push({ force: params.force });
        if (!params.force) {
          return { ok: false, error: { code: 'switch-blocked-action-in-progress', message: 'An action is in progress' } };
        }
        return { ok: true, data: { ulid: target.ulid, topic: target.topic, results: [], wasInterrupted: false } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open switch-confirm
      await press(instance, stdin, KEYS.enter); // attempt switch -> blocked
      expect(switchCalls).toEqual([{ force: false }]);

      await press(instance, stdin, KEYS.enter); // second Enter on the blocked prompt -> force
      expect(switchCalls).toEqual([{ force: false }, { force: true }]);

      // Success closes the dialog — a third Enter now falls through to the base view's
      // openEdtAction() (a fresh dialog), not another direct switchEdt call.
      await press(instance, stdin, KEYS.enter);
      expect(switchCalls).toHaveLength(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('drops a staged branch-edit for a member unchecked before submit — never sent to modifyEdt', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Row 0 is the active EDT -> Enter opens the modify form (not switch-confirm).
      await press(instance, stdin, KEYS.enter);
      // Tab: topic-input -> member-checklist.
      await press(instance, stdin, KEYS.tab);
      // Enter on the one member row (existing + checked) opens its branch-edit dialog.
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter); // commit the branch edit, back to the form

      // Space unchecks that same member — the branch edit just staged for it must be
      // dropped before it ever reaches modifyEdt (a real `git checkout` on a repo the
      // developer just told the form to drop).
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // submit

      expect(modifyParams).toBeDefined();
      expect(modifyParams?.setBranches).toEqual([]);
      expect(modifyParams?.removeMembers).toEqual(['/repos/a']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('rejects an empty branch-edit value inline and keeps the dialog open — never reaches modifyEdt unvalidated', async () => {
    const store = createAppStore();
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => {
        modifyCalls += 1;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // open modify
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.enter); // open branch-edit for the one member (pre-filled with "main")
      // Clear the pre-filled value down to empty.
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, KEYS.enter); // submit the empty branch-edit value

      expect(stdout.output).toContain('Branch name must not be empty');
      // Still in the branch-edit sub-dialog, not back at the form and not submitted.
      expect(modifyCalls).toBe(0);

      // Typing a valid value now and confirming still works — the rejection didn't wedge
      // the dialog: the same Enter that failed on an empty value now commits successfully.
      const outputLengthBeforeRetry = stdout.output.length;
      await type(instance, stdin, 'feature-z');
      await press(instance, stdin, KEYS.enter); // commit the branch edit, back to the form
      expect(stdout.output.slice(outputLengthBeforeRetry)).not.toContain('Branch name must not be empty');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('guards the create form submit against re-entrancy — a second Enter before the first resolves never double-calls createEdt', async () => {
    const store = createAppStore();
    let createCalls = 0;
    let release: (() => void) | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create prompt auto-opens, topic-focused by default.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // submit #1 — starts, awaits the pending promise
      expect(createCalls).toBe(1);

      await press(instance, stdin, KEYS.enter); // submit #2 — guarded by `submitting`
      expect(createCalls).toBe(1);

      release?.();
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(createCalls).toBe(1);
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

  it('matrix: create with a duplicate topic — createEdt\'s rejection is surfaced inline, form stays open', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        return { ok: false, error: { code: 'edt-topic-exists', message: 'An EDT with topic "demo" already exists' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create prompt auto-opens, topic-focused by default.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // select the one candidate member
      await press(instance, stdin, KEYS.enter); // submit -> rejected

      expect(createCalls).toHaveLength(1);
      expect(stdout.output).toContain('An EDT with topic "demo" already exists');
      // Still the create dialog, not silently torn down to a bare/empty list.
      expect(stdout.output).toContain('CREATE EDT');

      // The rejection didn't wedge the form: a further submit attempt calls createEdt again.
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toHaveLength(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('matrix: create with zero members selected — rejected before any write, inline message, form stays open', async () => {
    const store = createAppStore();
    const createCalls: CreateEdtParams[] = [];
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createCalls.push(params);
        return { ok: false, error: { code: 'invalid-member', message: 'At least one member service is required to create an EDT' } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // AC1: zero EDTs -> the create prompt auto-opens, topic-focused by default. Submit with
      // no member ever checked.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // submit -> rejected, zero members

      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.members).toEqual([]);
      expect(stdout.output).toContain('At least one member service is required to create an EDT');
      // Still the create dialog, not silently torn down to a bare/empty list.
      expect(stdout.output).toContain('CREATE EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review patch (story 2.9): createEdt/switchEdt/modifyEdt are per-repo/per-member
  // isolated — an overall ok:true result can still carry `results` rows with
  // `outcome: 'failed'` (e.g. a candidate on a shared/protected branch). Every submit
  // handler used to treat `result.ok` as unconditional full success and silently close the
  // dialog without ever looking at `results`.
  it('surfaces a per-member failure inline even though createEdt returned ok:true, instead of silently closing', async () => {
    const store = createAppStore();
    let loadCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'development', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {
        loadCalls += 1;
      },
      loadEdtsBranches: async () => {},
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
      // AC1: zero EDTs -> the create prompt auto-opens. Select both candidates.
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // submit

      // The EDT was created (loadEdts ran) but the dialog stays open with the per-member
      // failure surfaced inline — it must never silently close as if every requested
      // member had actually been added.
      expect(loadCalls).toBeGreaterThan(0);
      expect(stdout.output).toContain('CREATE EDT');
      expect(stdout.output).toContain('svc-b');
      expect(stdout.output).toContain('shared/protected');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review patch (story 2.9): the create prompt's Escape used to be unconditionally inert,
  // reasoning the forced zero-EDT state has nothing to cancel to — but that also meant `q`
  // (blocked by zoneInputCaptured) and Escape both did nothing, trapping the user with no
  // way to quit short of Ctrl+C (which skips onQuit's lock release).
  it('Escape requests a quit when the create prompt is the forced, genuinely-empty-registry state', async () => {
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
      // The create-prompt-auto-open effect fires as a passive effect after the first
      // commit — a second flush lets it settle (same precedent as the zoneInputCaptured
      // test above) before Escape is meant to land inside the create dialog.
      await instance.waitUntilRenderFlush();
      expect(store.getState().quitRequested).toBe(false);

      await pressEscape(instance, stdin);

      expect(store.getState().quitRequested).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape cancels back to the list (never requests a quit) once an EDT list actually exists', async () => {
    const store = createAppStore();
    const target = edt({ ulid: 'target-ulid', topic: 'other' });
    store.setState({
      edts: [target],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    // `initialDialogKind: 'create'` (a test-only injection point, mirroring the smoke tests'
    // own use of it) forces the dialog open despite `edts` being non-empty — the only way to
    // reach this branch outside the partial-failure-after-create path covered above, since
    // production never gives the populated view its own "new EDT" affordance yet
    // (deferred-work.md).
    const { instance, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().quitRequested).toBe(false);

      await pressEscape(instance, stdin);

      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
