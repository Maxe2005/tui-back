// Publish interactions: source gating, coarse running state, failure relaunch,
// success chain pre-fill and quit confirmation while publishing.
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
      await press(instance, stdin, 'c');
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
});
