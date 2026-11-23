// EdtsZone real-keypress tests: create from.
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../../../core/result.js';
import type { CreateEdtData } from '../../../../../../../core/edt/lifecycle/create.js';
import type { SwitchActiveEdtData } from '../../../../../../../core/edt/switch.js';
import { FakeTtyStdout, KEYS } from '../../../../shared/test-support/fake-tty.js';
import { EdtsZone } from '../../edts-zone.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from '../../dialogs/create-wizard/create-wizard.js';
import { edt, press, pressEscape, type, settle, lastWizardFrame, step3Store, mount } from '../../edts-zone.test-support.js';

describe('EdtsZone edt-create-from', () => {
  const ROOT = edt({
    ulid: 'root-ulid',
    topic: 'feat-a',
    status: 'active',
    members: [
      { service: 'svc-a', repoPath: '/repos/a', branch: 'feat/a-api' },
      { service: 'svc-gone', repoPath: '/repos/gone', branch: 'feat/x' },
    ],
  });
  const OTHER = edt({ ulid: 'other-ulid', topic: 'other-work' });
  const PICK_TITLE = 'SELECT EDT TO COPY';

  function createFromStore(target: string) {
    const { store, createCalls } = step3Store({ edts: [ROOT, OTHER] });
    const logged: string[] = [];
    store.setState({
      activeEdt: 'root-ulid',
      currentEdtAction: { type: 'create-from', target, startedAt: new Date().toISOString() },
      logEdtAction: async (_ulid, _actionType, _outcome, detail) => {
        logged.push(detail);
      },
    });
    return { store, createCalls, logged };
  }

  function lastPickFrame(stdout: FakeTtyStdout): string {
    return stdout.output.slice(stdout.output.lastIndexOf(PICK_TITLE));
  }

  it('no argument: opens quick-pick(create-from) over every EDT (active included); Enter opens the seeded wizard', async () => {
    const { store } = createFromStore('select EDT');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain(PICK_TITLE);
      expect(lastPickFrame(stdout)).toContain('feat-a');
      expect(lastPickFrame(stdout)).toContain('other-work');

      await press(instance, stdin, KEYS.enter); // the active root, first in the pool
      const frame = lastWizardFrame(stdout);
      expect(frame).toContain("From EDT: feat-a");
      // The topic is never derived from the root: Step 1 starts empty, so Enter is blocked.
      await press(instance, stdin, KEYS.enter);
      expect(lastWizardFrame(stdout)).toContain('The name must not be empty');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('no argument: Esc closes the quick-pick with nothing opened', async () => {
    const { store } = createFromStore('select EDT');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await pressEscape(instance, stdin);
      expect(stdout.output).not.toContain(WIZARD_TITLE);
      expect(store.getState().currentEdtAction).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('unknown topic: opens quick-pick(create-from) with an inline not-found error, cleared on the first filter edit', async () => {
    const { store } = createFromStore('nope');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastPickFrame(stdout)).toContain('EDT not found: "nope"');

      await press(instance, stdin, KEYS.down); // not a filter edit: the error stays
      expect(lastPickFrame(stdout)).toContain('EDT not found: "nope"');

      await type(instance, stdin, 'o');
      expect(lastPickFrame(stdout)).not.toContain('EDT not found');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('known topic: seeded wizard — inherited row Custom on the root branch, added row Global; submit sends the root bases', async () => {
    const { store, createCalls, logged } = createFromStore('feat-a');
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastWizardFrame(stdout)).toContain("From EDT: feat-a");

      await type(instance, stdin, 'next');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      // svc-gone is no longer a registered service: named in a dim note.
      expect(lastWizardFrame(stdout)).toContain('svc-gone');

      // svc-a is pre-checked (root member); also check svc-b (not in the root).
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
      await settle(instance);

      const step3 = lastWizardFrame(stdout);
      expect(step3).toContain('[Create (Custom)]');
      expect(step3).toContain('feat/a-api');
      expect(step3).toContain('[Create (Global)]');

      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      await press(instance, stdin, KEYS.space); // "Create without switching"
      await press(instance, stdin, KEYS.enter);
      await settle(instance);

      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]).toMatchObject({
        topic: 'next',
        members: ['/repos/a', '/repos/b'],
        memberPlans: {
          '/repos/a': { kind: 'create', base: 'feat/a-api', name: 'next' },
          '/repos/b': { kind: 'create', base: 'development', name: 'next' },
        },
      });
      expect(logged[0]).toContain('Created EDT "next" from "feat-a" with 2 member(s)');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Steps 1-3 of a seeded create (svc-a inherited, nothing added), landing on Step 4.
  async function reachSeededStep4(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await instance.waitUntilRenderFlush();
    await type(instance, stdin, 'next');
    await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
    await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
    await settle(instance);
    await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
  }

  it('switch choice: the logged create detail names the root EDT', async () => {
    const { store, createCalls, logged } = createFromStore('feat-a');
    store.setState({
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => ({
        ok: true,
        data: { ulid: 'new-ulid', topic: params.topic, results: [], wasInterrupted: false },
      }),
    });
    const { instance, stdin } = mount(store);
    try {
      await reachSeededStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter); // default choice: switch now
      await settle(instance);
      expect(createCalls).toHaveLength(1);
      expect(logged[0]).toContain('Created EDT "next" from "feat-a" with 1 member(s) (switch requested)');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('switch now from the wizard never inherits switch.restartMode: no selector, no restart phase', async () => {
    const { store } = createFromStore('feat-a');
    let restartCalls = 0;
    store.setState({
      settings: { ...store.getState().settings, switch: { restartMode: 'simple' } },
      switchEdt: async (params): Promise<Result<SwitchActiveEdtData>> => ({
        ok: true,
        data: { ulid: 'new-ulid', topic: params.topic, results: [{ service: 'svc-a', outcome: 'switched' }], wasInterrupted: false },
      }),
      runSwitchRestart: async () => {
        restartCalls += 1;
        return { ok: false, error: { code: 'x', message: 'x' } };
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await reachSeededStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter); // default choice: switch now
      await settle(instance);
      expect(restartCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('partial create: the not-activated log detail names the root EDT', async () => {
    const { store, logged } = createFromStore('feat-a');
    store.setState({
      createEdt: async (params): Promise<Result<CreateEdtData>> => ({
        ok: true,
        data: { ulid: 'new-ulid', topic: params.topic, results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-error', message: 'boom' } }] },
      }),
    });
    const { instance, stdin } = mount(store);
    try {
      await reachSeededStep4(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(logged[0]).toContain('Created EDT "next" from "feat-a" with 1 member(s) — not activated');
      expect(logged[0]).toContain('boom');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('editing the global name in Step 3 carries the untouched inherited row along', async () => {
    const { store, createCalls } = createFromStore('feat-a');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await type(instance, stdin, 'next');
      await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
      await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
      await settle(instance);
      await press(instance, stdin, KEYS.down); // Panel A: base -> name line
      await press(instance, stdin, KEYS.enter); // edit the global name
      await type(instance, stdin, '-2');
      await press(instance, stdin, KEYS.enter); // leave edit mode
      await press(instance, stdin, KEYS.ctrlN); // Step 3 -> Step 4
      await press(instance, stdin, KEYS.space); // "Create without switching"
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(createCalls[0]?.memberPlans).toEqual({ '/repos/a': { kind: 'create', base: 'feat/a-api', name: 'next-2' } });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
