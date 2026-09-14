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
  extraProps: {
    initialDialogKind?: 'create' | 'switch-confirm' | 'switch-blocked' | 'modify' | 'service-actions' | 'add-to-edt';
  } = {},
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

  // Story 2.22: the mandatory branch-setup step -----------------------------------------
  it('Tab past the checklist (>=1 member selected) reveals the branch-setup step, pre-filled from the topic', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'Fix Auth Bug');
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // select the one candidate
      await press(instance, stdin, KEYS.tab); // members -> branch-setup step (>=1 member selected)

      expect(stdout.output).toContain('Base branch: development');
      expect(stdout.output).toContain('Naming: Grouped');
      // suggestBranchNameFromTopic('Fix Auth Bug') -> 'fix-auth-bug', pre-filled without ever
      // typing into the field.
      expect(stdout.output).toContain('Branch name: fix-auth-bug');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('zero members selected never reaches the branch-setup step: Tab from the checklist loops straight back to topic', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // topic -> members (no member ever checked)
      await press(instance, stdin, KEYS.tab); // members -> topic (Boundaries: "no branch step")

      expect(stdout.output).not.toContain('Base branch:');
      expect(stdout.output).not.toContain('Naming:');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('grouped mode submit sends the identical branch name for every selected member', async () => {
    const store = createAppStore();
    let createParams: CreateEdtParams | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createParams = params;
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // select svc-a
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space); // select svc-b
      await press(instance, stdin, KEYS.tab); // members -> branch-setup step
      await press(instance, stdin, KEYS.enter); // confirm — pre-filled grouped name still applies

      expect(createParams?.branchOptions).toEqual({
        create: true,
        base: 'development',
        mode: 'grouped',
        names: { '/repos/a': 'demo', '/repos/b': 'demo' },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('individual mode submit sends a per-repoPath name map; a per-member failure is reported without aborting others', async () => {
    const store = createAppStore();
    let createParams: CreateEdtParams | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createParams = params;
        return {
          ok: true,
          data: {
            ulid: 'new-ulid',
            topic: 'demo',
            results: [
              { service: 'svc-a', outcome: 'created' },
              { service: 'svc-b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "demo-b" is shared/protected' } },
            ],
          },
        };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // select svc-a
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space); // select svc-b
      await press(instance, stdin, KEYS.tab); // members -> branch-base
      await press(instance, stdin, KEYS.tab); // branch-base -> branch-mode
      await press(instance, stdin, KEYS.space); // toggle grouped -> individual
      await press(instance, stdin, KEYS.tab); // branch-mode -> branch-name (svc-a's field, pre-filled "demo")
      await type(instance, stdin, '-a');
      await press(instance, stdin, KEYS.tab); // svc-a's field -> svc-b's field (pre-filled "demo")
      await type(instance, stdin, '-b');
      await press(instance, stdin, KEYS.enter); // confirm
      // submitCreate's own continuation (loadEdts -> failedSummary -> setDialog) commits over
      // several microtask hops beyond the single flush `press` already awaited.
      await instance.waitUntilRenderFlush();

      expect(createParams?.branchOptions).toEqual({
        create: true,
        base: 'development',
        mode: 'individual',
        names: { '/repos/a': 'demo-a', '/repos/b': 'demo-b' },
      });
      // Per-member failure surfaced inline via the existing summarizeFailedResults convention
      // (Boundaries: "no new failure-display code") — others unaffected.
      expect(stdout.output).toContain('svc-b');
      expect(stdout.output).toContain('shared/protected');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('an emptied required branch-name field blocks confirm — no core call, dialog stays open', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // select svc-a (pre-fills the grouped field to "demo")
      await press(instance, stdin, KEYS.tab); // members -> branch-base
      await press(instance, stdin, KEYS.tab); // branch-base -> branch-mode
      await press(instance, stdin, KEYS.tab); // branch-mode -> branch-name ("demo")
      for (let i = 0; i < 'demo'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, KEYS.enter); // confirm attempted on the now-emptied field

      expect(createCalls).toBe(0);
      expect(stdout.output).toContain('Branch name must not be empty');
      // Still the create dialog, never silently torn down.
      expect(stdout.output).toContain('CREATE EDT');

      // The rejection didn't wedge the field: typing a valid value and confirming now works.
      await type(instance, stdin, 'feature-y');
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toBe(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('zero members selected still passes a real (NO_BRANCH_CREATION) branchOptions through to createEdtAction', async () => {
    const store = createAppStore();
    let createParams: CreateEdtParams | undefined;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (params): Promise<Result<CreateEdtData>> => {
        createParams = params;
        return { ok: false, error: { code: 'invalid-member', message: 'At least one member service is required to create an EDT' } };
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // submit directly — zero members ever selected

      expect(createParams?.branchOptions).toEqual({ create: false, base: 'development', mode: 'grouped', names: {} });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape from inside the branch-setup step steps back to the member checklist rather than closing the dialog', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.tab); // topic -> members
      await press(instance, stdin, KEYS.space); // select svc-a
      await press(instance, stdin, KEYS.tab); // members -> branch-setup step
      expect(stdout.output).toContain('Base branch:');

      await pressEscape(instance, stdin);

      // Back on the member checklist — the checkbox selection survived, and the dialog
      // itself never closed (createCalls still 0, no submit happened).
      expect(stdout.output).toContain('CREATE EDT');
      expect(createCalls).toBe(0);
      // Space here still toggles the (already-checked) candidate rather than doing nothing —
      // proof formFocus really is back on 'members', not stuck in the branch step.
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // now zero members selected -> submits directly
      expect(createCalls).toBe(1);
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

// ==========================================================================================
// Story 2.18 — active highlight, 3-way pane cycle, EDT SERVICES/OTHER SERVICES contextual
// actions (real-keypress coverage: the Tab cycle, dialog opens, and async submits below are
// only exercisable through a real Ink useInput round-trip — see the file header).
// ==========================================================================================

describe('EdtsZone real-keypress interactions (story 2.18)', () => {
  it('Tab cycles edts -> edt-services -> other-services -> edts (AC: 3-way base-view cycle)', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current' },
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Default focus: the EDT selector — its detail-pane hint is [Enter] Modify (row 0 is
      // the active EDT).
      expect(stdout.output).toContain('[Enter] Modify');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('[Enter] Remove / Change branch');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('[Enter] Add to EDT');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('[Enter] Modify');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an EDT SERVICES row -> Remove from EDT calls modifyEdt with removeMembers and logs the outcome', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    let loggedOutcome: string | undefined;
    const store = createAppStore();
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
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu on the one row
      expect(stdout.output).toContain('SERVICE ACTIONS');
      expect(stdout.output).toContain('Remove from EDT');

      await press(instance, stdin, KEYS.enter); // cursor 0 (Remove from EDT) -> confirm

      expect(modifyParams).toEqual({ topic: 'active-edt', addMembers: [], removeMembers: ['/repos/a'], setBranches: [] });
      expect(loggedOutcome).toBe('success');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an EDT SERVICES row -> Change branch for this EDT calls modifyEdt with setBranches', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyParams: ModifyEdtParams | undefined;
    let loggedOutcome: string | undefined;
    const store = createAppStore();
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
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-edit sub-dialog
      await type(instance, stdin, '-y'); // pre-filled with "main" -> "main-y"
      await press(instance, stdin, KEYS.enter); // confirm

      expect(modifyParams).toEqual({
        topic: 'active-edt',
        addMembers: [],
        removeMembers: [],
        setBranches: [{ repoPath: '/repos/a', branch: 'main-y' }],
      });
      expect(loggedOutcome).toBe('success');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('matrix: Change branch, empty value -> inline rejection, never reaches modifyEdt', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    const store = createAppStore();
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
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // open branch-edit, pre-filled "main"
      for (let i = 0; i < 'main'.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, KEYS.enter); // submit empty

      expect(stdout.output).toContain('Branch name must not be empty');
      expect(modifyCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the Restart row is visibly disabled and Enter on it is a no-op — never dispatches', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    const store = createAppStore();
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
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // -> Change branch
      await press(instance, stdin, KEYS.down); // -> Restart (disabled)
      await press(instance, stdin, KEYS.enter); // no-op

      expect(modifyCalls).toBe(0);
      // Still the same contextual menu — never torn down by the no-op Enter.
      expect(stdout.output).toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an OTHER SERVICES row -> Add to EDT (pre-filled branch, confirmed) calls modifyEdt with addMembers+setBranches in one call', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let modifyParams: ModifyEdtParams | undefined;
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (params): Promise<Result<ModifyEdtData>> => {
        modifyParams = params;
        return { ok: true, data: { ulid: 'active-ulid', topic: 'active-edt', results: [] } };
      },
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.tab); // edt-services -> other-services
      await press(instance, stdin, KEYS.enter); // open Add to EDT on the one row
      expect(stdout.output).toContain('ADD TO EDT');
      expect(stdout.output).toContain('feature-y'); // pre-filled with the row's current branch

      await press(instance, stdin, KEYS.enter); // confirm, branch left as pre-filled

      expect(modifyParams).toEqual({
        topic: 'active-edt',
        addMembers: ['/repos/b'],
        removeMembers: [],
        setBranches: [{ repoPath: '/repos/b', branch: 'feature-y' }],
      });
      expect(loggedOutcome).toBe('success');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('matrix: Add-to-EDT partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: {
          ulid: 'active-ulid',
          topic: 'active-edt',
          results: [
            { service: 'svc-b', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "feature-y" is shared/protected' } },
          ],
        },
      }),
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open Add to EDT
      await press(instance, stdin, KEYS.enter); // confirm

      expect(stdout.output).toContain('shared/protected');
      expect(loggedOutcome).toBe('failed');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review fix: submitRemoveFromEdt implements the same per-repo summarizeFailedResults
  // partial-failure handling as submitAddToEdt above — this was previously only covered for
  // Add-to-EDT.
  it('matrix: Remove-from-EDT partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
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
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: {
          ulid: 'active-ulid',
          topic: 'active-edt',
          results: [
            { service: 'svc-a', outcome: 'failed', detail: { code: 'git-checkout-failed', message: 'Working tree has uncommitted changes' } },
          ],
        },
      }),
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.enter); // cursor 0 (Remove from EDT) -> confirm
      // A second flush: unlike a full-success confirm (one setDialog after the awaited
      // modifyEdt call), the partial-failure path runs one more microtask hop
      // (summarizeFailedResults's setDialog, then the awaited logEdtAction call) before the
      // error text actually lands in a committed render.
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('uncommitted changes');
      expect(loggedOutcome).toBe('failed');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review fix: submitServiceActionsBranchChange implements the same partial-failure
  // handling too — previously only covered for Add-to-EDT.
  it('matrix: Change-branch partial failure surfaces inline via summarizeFailedResults, logged failed', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let loggedOutcome: string | undefined;
    const store = createAppStore();
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
      modifyEdt: async (): Promise<Result<ModifyEdtData>> => ({
        ok: true,
        data: {
          ulid: 'active-ulid',
          topic: 'active-edt',
          results: [
            { service: 'svc-a', outcome: 'failed', detail: { code: 'shared-branch-rejected', message: 'Branch "main-y" is shared/protected' } },
          ],
        },
      }),
      logEdtAction: async (_ulid, _actionType, outcome) => {
        loggedOutcome = outcome;
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // cursor -> "Change branch for this EDT"
      await press(instance, stdin, KEYS.enter); // open the branch-edit sub-dialog
      await type(instance, stdin, '-y');
      await press(instance, stdin, KEYS.enter); // confirm
      // A second flush — same reason as the Remove-from-EDT partial-failure test above.
      await instance.waitUntilRenderFlush();

      expect(stdout.output).toContain('shared/protected');
      expect(loggedOutcome).toBe('failed');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review fix: no test previously exercised Escape/cancel for either new dialog, or backing
  // out of the branch-edit sub-view via Escape.
  it('Escape cancels the EDT SERVICES contextual menu without calling modifyEdt', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    const store = createAppStore();
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
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      expect(stdout.output).toContain('SERVICE ACTIONS');

      // `stdout.output` accumulates every frame ever written, so a `.not.toContain` against
      // the whole log would vacuously pass even if Escape did nothing — the menu's own
      // now-stale frame is still in there. Only the output *written since* Escape proves the
      // dialog is actually gone from the current render (same technique as the
      // "rejects an empty branch-edit value inline" test in the story 2.9 suite above).
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      expect(modifyCalls).toBe(0);
      expect(outputSinceEscape).not.toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape backs out of the branch-edit sub-view to the contextual menu, without closing it entirely', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    let modifyCalls = 0;
    const store = createAppStore();
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
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open the contextual menu
      await press(instance, stdin, KEYS.down); // -> Change branch
      await press(instance, stdin, KEYS.enter); // open the branch-edit sub-dialog
      expect(stdout.output).toContain('Branch for svc-a');

      // Only the output *written since* Escape proves the menu is back in the *current*
      // render, not merely present somewhere earlier in the accumulated log (same technique
      // as the story 2.9 suite's "rejects an empty branch-edit value inline" test above).
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      // Back at the contextual menu (still open), never fully torn down, never submitted.
      expect(modifyCalls).toBe(0);
      expect(outputSinceEscape).toContain('SERVICE ACTIONS');
      expect(outputSinceEscape).toContain('Remove from EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Escape cancels the Add-to-EDT dialog without calling modifyEdt', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    let modifyCalls = 0;
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current' },
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
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // open Add to EDT
      expect(stdout.output).toContain('ADD TO EDT');

      // Only the output *written since* Escape proves the dialog is gone from the *current*
      // render (same technique as the two tests above and the story 2.9 suite's own
      // "rejects an empty branch-edit value inline" test).
      const outputLengthBeforeEscape = stdout.output.length;
      await pressEscape(instance, stdin);
      const outputSinceEscape = stdout.output.slice(outputLengthBeforeEscape);

      expect(modifyCalls).toBe(0);
      expect(outputSinceEscape).not.toContain('ADD TO EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Review fix: the `undefined` guards in the base-view Enter dispatch for EDT
  // SERVICES/OTHER SERVICES (protecting against opening a dialog for a row that doesn't
  // exist) were previously unverified — Enter on an empty pane must be a no-op.
  it('Enter on an empty EDT SERVICES pane is a no-op — never opens the contextual menu', async () => {
    const active = edt({ ulid: 'active-ulid', topic: 'active-edt', status: 'active', members: [] });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      // No members -> EDT SERVICES is empty; the one service is a non-member, so it lands in
      // OTHER SERVICES instead.
      edtsBranches: [
        { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'feature-y', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services (empty)
      expect(stdout.output).toContain('No services in this EDT.');

      await press(instance, stdin, KEYS.enter); // no-op: nothing to open a menu for

      expect(stdout.output).not.toContain('SERVICE ACTIONS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an empty OTHER SERVICES pane is a no-op — never opens Add to EDT', async () => {
    const active = edt({
      ulid: 'active-ulid',
      topic: 'active-edt',
      status: 'active',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });
    const store = createAppStore();
    store.setState({
      edts: [active],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      // The one service is a member of the selected EDT -> OTHER SERVICES is empty.
      edtsBranches: [
        { service: 'svc-a', path: '/repos/a', isMember: true, branch: 'main', ahead: 0, behind: 0, status: 'current' },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edts -> edt-services
      await press(instance, stdin, KEYS.tab); // edt-services -> other-services (empty)
      expect(stdout.output).toContain('No managed services found.');

      await press(instance, stdin, KEYS.enter); // no-op: nothing to open Add to EDT for

      expect(stdout.output).not.toContain('ADD TO EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
