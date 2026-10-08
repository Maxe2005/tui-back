// tui/zones/shared-types: real keypresses (fake-TTY technique) — typing the version, toggling,
// running with the chosen selection, and the mid-run quit confirmation.
import { createElement } from 'react';
import { Box, render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { SharedTypesZone } from './shared-types-zone.js';

const CONSUMERS = [
  { service: 'api', repoPath: '/r/api', branch: 'feat/x', dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
  { service: 'web', repoPath: '/r/web', branch: 'feat/x', dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
];

function seed(extra: Record<string, unknown> = {}) {
  const store = createAppStore();
  const runSharedTypesPropagation = vi.fn(async () => {});
  store.setState({
    sharedTypesConsumersStatus: 'ready',
    sharedTypesConsumers: CONSUMERS,
    loadSharedTypesConsumers: async () => {},
    runSharedTypesPropagation,
    ...extra,
  });
  return { store, runSharedTypesPropagation };
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
  await new Promise((resolve) => setTimeout(resolve, 10));
}


describe('SharedTypesZone interaction', () => {
  it('types the version, unchecks one service and runs with the chosen selection and options', async () => {
    const { store, runSharedTypesPropagation } = seed();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      for (const char of '3674') {
        await press(instance, stdin, char);
      }
      await press(instance, stdin, KEYS.down); // api
      await press(instance, stdin, KEYS.down); // web
      await press(instance, stdin, KEYS.space); // uncheck web
      await press(instance, stdin, KEYS.enter);

      expect(runSharedTypesPropagation).toHaveBeenCalledWith({
        version: '0.1.3674',
        repoPaths: ['/r/api'],
        options: { install: true, cleanRestart: false, commit: true },
      });
    } finally {
      instance.unmount();
    }
  });

  it('captures input while typing the version so the global q cannot quit', async () => {
    const { store } = seed();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'q');
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
    }
  });

  it('asks for confirmation when q is pressed mid-run, and only quits after Enter', async () => {
    const { store } = seed({
      sharedTypesRun: {
        status: 'running',
        version: '0.1.1',
        options: { install: true, cleanRestart: false, commit: true },
        blocked: null,
        results: [],
        live: { repoPath: '/r/api', step: 'install' },
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'q');
      expect(stdout.output).toContain('QUIT MID-RUN');
      expect(store.getState().quitRequested).toBe(false);

      await press(instance, stdin, KEYS.escape);
      expect(store.getState().quitRequested).toBe(false);

      await press(instance, stdin, 'q');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().quitRequested).toBe(true);
    } finally {
      instance.unmount();
    }
  });

  it('retries the highlighted failed service with R', async () => {
    const retrySharedTypesService = vi.fn(async () => {});
    const { store } = seed({
      retrySharedTypesService,
      sharedTypesRun: {
        status: 'done',
        version: '0.1.1',
        options: { install: true, cleanRestart: false, commit: true },
        blocked: null,
        results: [
          { service: 'api', repoPath: '/r/api', outcome: 'done', steps: [] },
          { service: 'web', repoPath: '/r/web', outcome: 'failed', steps: [], failedStep: 'install', error: { code: 'restart-failed', message: 'npm ERR' } },
        ],
        live: null,
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'R');
      expect(retrySharedTypesService).toHaveBeenCalledWith('/r/web');
    } finally {
      instance.unmount();
    }
  });
});

