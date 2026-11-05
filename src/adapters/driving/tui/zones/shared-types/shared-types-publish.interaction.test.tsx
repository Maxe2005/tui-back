// Publish interactions: source gating, coarse running state, the action bar, the post-publish
// choice screens (done / failed) with their shortcuts, and quit confirmation while publishing.
import { createElement } from 'react';
import { Box, render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { SharedTypesZone } from './shared-types-zone.js';

const CONSUMERS = [
  { service: 'api', repoPath: '/r/api', branch: 'feat/x', dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
];

const SOURCE = { service: 'source', repoPath: '/r/source', branch: 'feat/x', publishCommand: 'npm run v', packageName: '@ianord/shared-types' };

function seed(extra: Record<string, unknown> = {}) {
  const store = createAppStore();
  store.setState({
    sharedTypesConsumersStatus: 'ready',
    sharedTypesConsumers: CONSUMERS,
    loadSharedTypesConsumers: async () => {},
    runSharedTypesPropagation: vi.fn(async () => {}),
    retrySharedTypesService: vi.fn(async () => {}),
    resetSharedTypesRun: vi.fn(),
    sharedTypesSourcesStatus: 'ready',
    sharedTypesSources: [SOURCE],
    sharedTypesSourceIssues: [],
    sharedTypesSourcesError: null,
    loadSharedTypesSource: async () => {},
    runSharedTypesPublish: vi.fn(async () => {}),
    retrySharedTypesPublish: vi.fn(async () => {}),
    resetSharedTypesPublish: vi.fn(),
    sharedTypesPublish: { status: 'idle', version: null, output: null, error: null, notice: null },
    ...extra,
  });
  return store;
}

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 100, rows: 30 });
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(Box, { flexDirection: 'column', height: 30 }, createElement(SharedTypesZone, { useStore: store })), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

// Ink repaints the whole zone each render: the text after the last title is the current frame.
function lastFrame(output: string): string {
  return output.slice(output.lastIndexOf('SHARED TYPES'));
}

const IDLE_PUBLISH = { status: 'idle', version: null, output: null, error: null, notice: null } as const;
const DONE_PUBLISH = { status: 'done', version: '0.1.9999', output: 'ok', error: null, notice: null } as const;
const FAILED_PUBLISH = { status: 'blocked', version: null, output: null, error: { code: 'publish-failed', message: 'npm ERR boom' }, notice: null } as const;

// A store whose reset really returns the publish to idle, so the form view comes back.
function seedWithReset(publish: Record<string, unknown>) {
  const store = seed({ sharedTypesPublish: publish });
  const resetSharedTypesPublish = vi.fn(() => store.setState({ sharedTypesPublish: IDLE_PUBLISH }));
  const retrySharedTypesPublish = vi.fn(async () => {});
  store.setState({ resetSharedTypesPublish, retrySharedTypesPublish });
  return { store, resetSharedTypesPublish, retrySharedTypesPublish };
}

// Types a version into the form's version field (row 0): Enter edits, Enter leaves.
async function typeVersion(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, suffix: string): Promise<void> {
  await press(instance, stdin, KEYS.enter);
  for (const char of suffix) {
    await press(instance, stdin, char);
  }
  await press(instance, stdin, KEYS.enter);
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, sequence === KEYS.escape ? 80 : 10));
}

describe('SharedTypesZone publish', () => {
  it('offers publish when exactly one source is present', async () => {
    const store = seed();
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('PUBLISH');
      expect(stdout.output).toContain('source');
    } finally {
      instance.unmount();
    }
  });

  it('does not offer publish when no source is present', async () => {
    const store = seed({ sharedTypesSources: [], sharedTypesSourcesStatus: 'ready' });
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).not.toContain('PUBLISH');
    } finally {
      instance.unmount();
    }
  });

  it('blocks with ambiguous-source when several sources share the EDT', async () => {
    const store = seed({
      sharedTypesSources: [SOURCE, { ...SOURCE, service: 'other', repoPath: '/r/other' }],
      sharedTypesSourcesStatus: 'error',
      sharedTypesSourcesError: { code: 'ambiguous-source', message: 'Several source repos (source, other) — publish is blocked.' },
    });
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('ambiguous-source');
    } finally {
      instance.unmount();
    }
  });

  it('starts a publish with p and shows a coarse running state without naming a sub-step', async () => {
    const runSharedTypesPublish = vi.fn(async () => {});
    const store = seed({ runSharedTypesPublish });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'p');
      expect(runSharedTypesPublish).toHaveBeenCalledTimes(1);

      store.setState({ sharedTypesPublish: { status: 'running', version: null, output: null, error: null, notice: null } });
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Publishing');
      expect(stdout.output).not.toContain('dirty-check');
      expect(stdout.output).not.toContain('rewriting the dependency line');
    } finally {
      instance.unmount();
    }
  });

  it('relaunches the whole command with R on failure', async () => {
    const retrySharedTypesPublish = vi.fn(async () => {});
    const store = seed({
      retrySharedTypesPublish,
      sharedTypesPublish: { status: 'blocked', version: null, output: null, error: { code: 'publish-failed', message: 'npm ERR boom' }, notice: null },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'R');
      expect(retrySharedTypesPublish).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });

  it('chains into propagation with the published version pre-filled', async () => {
    const resetSharedTypesPublish = vi.fn();
    const store = seed({
      resetSharedTypesPublish,
      sharedTypesPublish: { status: 'done', version: '0.1.9999', output: 'ok', error: null, notice: null },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('0.1.9999');
      await press(instance, stdin, 'C');
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(1);
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('0.1.9999');
    } finally {
      instance.unmount();
    }
  });

  it('asks for confirmation when q is pressed while publishing', async () => {
    const store = seed({
      sharedTypesPublish: { status: 'running', version: null, output: null, error: null, notice: null },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'q');
      expect(stdout.output).toContain('QUIT MID-RUN');
      expect(store.getState().quitRequested).toBe(false);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().quitRequested).toBe(true);
    } finally {
      instance.unmount();
    }
  });

  it('shows the action bar with every command, its key and why an unavailable one is dimmed', async () => {
    const store = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      let frame = lastFrame(stdout.output);
      expect(frame).toContain('[P] publish');
      expect(frame).toContain('[Enter] propagate (enter a valid version)');
      expect(frame).toContain('[H] history');
      expect(frame).toContain('R: nothing to reload');
      expect(frame).not.toContain('(P publish)');
      await typeVersion(instance, stdin, '3');
      frame = lastFrame(stdout.output);
      expect(frame).not.toContain('enter a valid version');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(lastFrame(stdout.output)).toContain('(select a consumer)');
    } finally {
      instance.unmount();
    }
  });

  it('dims Publish and History without a single source and still explains History on H', async () => {
    const store = seed({ sharedTypesSources: [], sharedTypesSourcesStatus: 'ready' });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout.output)).toContain('[P] publish (no source repo in the EDT)');
      expect(lastFrame(stdout.output)).toContain('H: the shared-types source repo');
      await press(instance, stdin, 'h');
      expect(lastFrame(stdout.output)).toContain('History is unavailable: the shared-types source repo is not part of the active EDT.');
    } finally {
      instance.unmount();
    }
  });

  it('offers Reload after a load error and reloads on R', async () => {
    const loadSharedTypesSource = vi.fn(async () => {});
    const store = seed({
      loadSharedTypesSource,
      sharedTypesSources: [],
      sharedTypesSourcesStatus: 'error',
      sharedTypesSourcesError: { code: 'scan-failed', message: 'cannot read' },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Available actions lead the bar, so Reload stays visible even where the bar clips.
      expect(lastFrame(stdout.output)).toContain('[R] reload');
      expect(lastFrame(stdout.output)).not.toContain('nothing to reload');
      const before = loadSharedTypesSource.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadSharedTypesSource.mock.calls.length).toBe(before + 1);
    } finally {
      instance.unmount();
    }
  });

  it('done: lists the three explained choices with Propagate highlighted, Enter pre-fills the version', async () => {
    const { store, resetSharedTypesPublish } = seedWithReset(DONE_PUBLISH);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout.output);
      expect(frame).toContain('Published 0.1.9999');
      expect(frame).toContain('Propagate 0.1.9999 to consumers');
      expect(frame).toContain('Back to the form');
      expect(frame).toContain('Close');
      expect(frame).toContain('Dismiss this result and reset the form.');
      expect(frame.split('\n').find((line) => line.includes('›'))).toContain('Propagate 0.1.9999');
      expect(store.getState().footerContexts.map((entry) => entry.id)).toContain('shared-types-publish-done');
      await press(instance, stdin, KEYS.enter);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(1);
      expect(lastFrame(stdout.output)).toContain('Version: 0.1.9999');
    } finally {
      instance.unmount();
    }
  });

  it('done: Back to the form keeps the typed version, Close resets the form', async () => {
    const { store, resetSharedTypesPublish } = seedWithReset(IDLE_PUBLISH);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await typeVersion(instance, stdin, '5');
      store.setState({ sharedTypesPublish: DONE_PUBLISH });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      expect(lastFrame(stdout.output).split('\n').find((line) => line.includes('›'))).toContain('Back to the form');
      await press(instance, stdin, KEYS.enter);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(1);
      expect(lastFrame(stdout.output)).toContain('Version: 0.1.5');

      store.setState({ sharedTypesPublish: DONE_PUBLISH });
      await instance.waitUntilRenderFlush();
      // The cursor is back on the first choice for the new result.
      expect(lastFrame(stdout.output).split('\n').find((line) => line.includes('›'))).toContain('Propagate');
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.enter);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(2);
      expect(lastFrame(stdout.output)).not.toContain('Version: 0.1.5');
    } finally {
      instance.unmount();
    }
  });

  it('done: Esc closes and resets the form', async () => {
    const { store, resetSharedTypesPublish } = seedWithReset(IDLE_PUBLISH);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await typeVersion(instance, stdin, '5');
      store.setState({ sharedTypesPublish: DONE_PUBLISH });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.escape);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(1);
      expect(lastFrame(stdout.output)).not.toContain('Version: 0.1.5');
    } finally {
      instance.unmount();
    }
  });

  it('failed: lists Relaunch and Back, Enter relaunches, Down+Enter and Esc go back', async () => {
    const { store, resetSharedTypesPublish, retrySharedTypesPublish } = seedWithReset(FAILED_PUBLISH);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout.output);
      expect(frame).toContain('Publish failed [publish-failed]');
      expect(frame).toContain('Relaunch');
      expect(frame).toContain('Run the whole publish command again.');
      await press(instance, stdin, KEYS.enter);
      expect(retrySharedTypesPublish).toHaveBeenCalledTimes(1);

      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(1);

      store.setState({ sharedTypesPublish: FAILED_PUBLISH });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.escape);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(2);
      expect(retrySharedTypesPublish).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });

  it('shows Reload after a consumer load error and reloads the consumers on R', async () => {
    const loadSharedTypesConsumers = vi.fn(async () => {});
    const store = seed({
      loadSharedTypesConsumers,
      sharedTypesConsumers: [],
      sharedTypesConsumersStatus: 'error',
      sharedTypesConsumersError: { code: 'scan-failed', message: 'cannot list' },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout.output)).toContain('[R] reload');
      const before = loadSharedTypesConsumers.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadSharedTypesConsumers.mock.calls.length).toBe(before + 1);
    } finally {
      instance.unmount();
    }
  });

  it('done: Propagate leaves the cursor on the first consumer, so the next Enter propagates that version', async () => {
    const runSharedTypesPropagation = vi.fn(async () => {});
    const { store } = seedWithReset(DONE_PUBLISH);
    store.setState({ runSharedTypesPropagation });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      expect(runSharedTypesPropagation).toHaveBeenCalledTimes(1);
      expect(runSharedTypesPropagation).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.9999', repoPaths: ['/r/api'] }));
    } finally {
      instance.unmount();
    }
  });

  it('done: Close brings the form back exactly to its initial state (version, checklist, options)', async () => {
    const { store, resetSharedTypesPublish } = seedWithReset(IDLE_PUBLISH);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const initial = lastFrame(stdout.output);
      await typeVersion(instance, stdin, '5');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      const edited = lastFrame(stdout.output);
      expect(edited).toContain('[ ] api');
      expect(edited).toContain('[ ] Run npm i');
      store.setState({ sharedTypesPublish: DONE_PUBLISH });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.enter);
      expect(resetSharedTypesPublish).toHaveBeenCalledTimes(1);
      const frame = lastFrame(stdout.output);
      expect(frame.split('\n').find((line) => line.includes('Version:'))).toMatch(/Version: 0\.1\.\s*$/);
      expect(frame).toContain('[x] api');
      const defaults = store.getState().settings.sharedTypes;
      expect(frame).toContain(`[${defaults.install ? 'x' : ' '}] Run npm i`);
      expect(frame).toContain(`[${defaults.cleanRestart ? 'x' : ' '}] Clean restart`);
      expect(frame).toContain(`[${defaults.commit ? 'x' : ' '}] Commit package.json`);
      expect(frame).toBe(initial);
    } finally {
      instance.unmount();
    }
  });

  it('failed: R relaunches from any highlighted row', async () => {
    const { store, retrySharedTypesPublish, resetSharedTypesPublish } = seedWithReset(FAILED_PUBLISH);
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'R');
      expect(retrySharedTypesPublish).toHaveBeenCalledTimes(1);
      expect(resetSharedTypesPublish).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('keeps the choice screen visible and in charge of the keys after a source reload error', async () => {
    const { store, retrySharedTypesPublish } = seedWithReset(FAILED_PUBLISH);
    const loadSharedTypesSource = vi.fn(async () => {});
    store.setState({
      loadSharedTypesSource,
      sharedTypesSources: [],
      sharedTypesSourcesStatus: 'error',
      sharedTypesSourcesError: { code: 'scan-failed', message: 'cannot read' },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout.output);
      expect(frame).toContain('Relaunch');
      expect(frame).toContain('Publish failed [publish-failed]');
      const loads = loadSharedTypesSource.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(retrySharedTypesPublish).toHaveBeenCalledTimes(1);
      expect(loadSharedTypesSource.mock.calls.length).toBe(loads);
    } finally {
      instance.unmount();
    }
  });

  it('restarts the cursor on the first choice when another done result replaces the current one', async () => {
    const { store } = seedWithReset(DONE_PUBLISH);
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      expect(lastFrame(stdout.output).split('\n').find((line) => line.includes('›'))).toContain('Close');
      store.setState({ sharedTypesPublish: { ...DONE_PUBLISH, version: '0.1.10000' } });
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout.output).split('\n').find((line) => line.includes('›'))).toContain('Propagate 0.1.10000');
    } finally {
      instance.unmount();
    }
  });
});
