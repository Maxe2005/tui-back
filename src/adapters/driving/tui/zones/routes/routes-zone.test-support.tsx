// tui/zones/routes: shared fixtures and Ink helpers for the real-keypress RoutesZone tests.
import { createElement } from 'react';
import { Box, Text, render } from 'ink';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { RoutesZone } from './routes-zone.js';

export const ROWS = 14;

export function seed() {
  const store = createAppStore();
  store.setState({
    routesStatus: 'ready',
    routesRepoPath: '/repos/gateway',
    routes: Array.from({ length: 40 }, (_, i) => ({
      method: i % 2 === 0 ? 'GET' : 'POST',
      path: `/resource-${i}/{id}`,
      summary: `SUMMARY-${i} a rather long description that must only show in the detail pane`,
    })),
    routesError: null,
    loadRoutes: async () => {},
    fireRoute: async () => {},
  });
  return store;
}

export function mount(store: ReturnType<typeof createAppStore>, rows = ROWS) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 100, rows });
  const stdin = fakeInteractiveTtyStdin();
  // Mirrors AppShell: a fixed-height column with fixed sibling rows above and below the zone.
  const instance = render(
    createElement(
      Box,
      { flexDirection: 'column', height: rows, overflow: 'hidden' },
      createElement(Text, {}, 'TABS-ROW'),
      createElement(RoutesZone, { useStore: store }),
      createElement(Text, {}, 'FOOTER-ROW'),
    ),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return { instance, stdout, stdin };
}

export async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

export function lastFrame(stdout: FakeTtyStdout): string {
  // Every Ink render writes the whole frame in one chunk; the newest chunk carrying the
  // sibling row is the current screen.
  const chunks = (stdout as unknown as { chunks: string[] }).chunks;
  return [...chunks].reverse().find((chunk) => chunk.includes('TABS-ROW')) ?? '';
}
