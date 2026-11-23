// EdtsZone real-keypress tests: create validation.
import { describe, it, expect, vi } from 'vitest';
import type { Result } from '../../../../../../../core/result.js';
import type { CreateEdtData } from '../../../../../../../core/edt/lifecycle/create.js';
import { createAppStore } from '../../../../store/app-store.js';
import { KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { edt, press, pressEscape, type, ListsResult, readyBranches, settle, lastWizardFrame, step3Store, reachStep3, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone real-keypress interactions — create-validation', () => {
  it('a list landing clears a stale "branches are loading" message', async () => {
    let release: (() => void) | undefined;
    const { store } = step3Store({
      listCreateBranches: () =>
        new Promise<ListsResult>((resolve) => {
          release = () => resolve({ ok: true, data: { local: ['main'], remote: [] } });
        }),
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      await press(instance, stdin, KEYS.ctrlN); // blocked while loading
      const count = (frame: string) => frame.split('branches are loading').length - 1;
      expect(count(lastWizardFrame(stdout))).toBe(2); // the row's detail line + the wizard's message
      release?.();
      await settle(instance);
      const frame = lastWizardFrame(stdout);
      expect(count(frame)).toBe(0);
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo/);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a rejected list load becomes a row error instead of loading forever', async () => {
    const { store } = step3Store({
      listCreateBranches: async () => {
        throw new Error('spawn git ENOENT');
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      expect(lastWizardFrame(stdout)).toContain('✖ svc-a : failed to load branches: spawn git ENOENT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a failed list load shows on the row, blocks Ctrl+N, and is retried on the next entry', async () => {
    let attempts = 0;
    const { store, createCalls } = step3Store({
      listCreateBranches: async () => {
        attempts += 1;
        return attempts === 1 ? { ok: false, error: { code: 'git-error', message: 'boom' } } : { ok: true, data: { local: ['main'], remote: [] } };
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await reachStep3(instance, stdin, 'demo', 1);
      let frame = lastWizardFrame(stdout);
      expect(frame).toMatch(/svc-a +│ \[Create \(Global\)\] │ ✖ failed to/);
      // The real cause, spelled out on the detail line under the table.
      expect(frame).toContain('✖ svc-a : failed to load branches: boom');
      await press(instance, stdin, KEYS.ctrlN);
      frame = lastWizardFrame(stdout);
      expect(frame).toContain('▶ 3. Branches ◀');
      expect(attempts).toBe(1);

      await press(instance, stdin, KEYS.ctrlLeft); // Step 2
      await press(instance, stdin, KEYS.ctrlN); // Step 3 again: retried
      await settle(instance);
      expect(attempts).toBe(2);
      expect(lastWizardFrame(stdout)).toMatch(/svc-a +│ \[Create \(Global\)\] │ main +│ demo/);
      await press(instance, stdin, KEYS.ctrlN);
      await press(instance, stdin, KEYS.enter);
      expect(createCalls).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a name taken by a loaded EDT (trimmed) shows "already taken" live and blocks Step 1; a case variant stays available', async () => {
    const store = createAppStore();
    let createCalls = 0;
    store.setState({
      edts: [edt({ ulid: 'demo-ulid', topic: 'demo' })],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      createEdt: async (): Promise<Result<CreateEdtData>> => {
        createCalls += 1;
        return { ok: true, data: { ulid: 'new-ulid', topic: 'Demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store, { initialDialogKind: 'create' });
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, ' demo ');
      expect(stdout.output).toContain('✖ already taken');
      await press(instance, stdin, KEYS.enter); // blocked
      await press(instance, stdin, KEYS.ctrlRight); // blocked too
      expect(stdout.output).toContain('This name is already taken by another EDT');
      expect(stdout.output).not.toContain('▶ 2. Services ◀');

      // Rewrite it as "Demo": case-sensitive, so available — checked on every keystroke.
      for (let i = 0; i < ' demo '.length; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      const beforeAvailable = stdout.output.length;
      await type(instance, stdin, 'Demo');
      expect(stdout.output.slice(beforeAvailable)).toContain('✔ available');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('▶ 2. Services ◀');
      expect(createCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Step 4 re-checks the name — a clash appearing after Step 1 blocks the submit with the wizard message', async () => {
    const store = createAppStore();
    let createCalls = 0;
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
        return { ok: true, data: { ulid: 'new-ulid', topic: 'demo', results: [] } };
      },
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'demo');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3 (branch lists load)
      await settle(instance);
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4 (Enter never advances Step 3)
      // Meanwhile an EDT named "demo" appears (e.g. created from the CLI).
      store.setState({ edts: [edt({ ulid: 'cli-ulid', topic: 'demo' })] });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // submit attempt

      expect(createCalls).toBe(0);
      expect(stdout.output).toContain('This name is already taken by another EDT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('an empty (or blank) name blocks Step 1 with an inline message', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, '   ');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).toContain('The name must not be empty');
      expect(stdout.output).not.toContain('▶ 2. Services ◀');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The forced zero-EDT create prompt has nothing to cancel back to, and `q` is blocked by
  // zoneInputCaptured — so Escape requests a quit, never leaving the user trapped short of
  // Ctrl+C (which skips onQuit's lock release).
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

      // The quit runs from an effect one commit after the Esc updater (cancelRequested).
      await vi.waitFor(() => expect(store.getState().quitRequested).toBe(true));
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
      edtsBranches: [{ service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] }],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    // `initialDialogKind: 'create'` (a test-only injection point, like the smoke tests' use of
    // it) forces the dialog open despite `edts` being non-empty — the only way to reach this
    // branch outside the partial-failure-after-create path above, since the populated view lacks
    // a "new EDT" affordance in this context.
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
