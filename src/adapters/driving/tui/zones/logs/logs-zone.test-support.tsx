// tui/zones/logs: shared fixtures and Ink helpers for the real-keypress LogsZone tests.
import { createElement } from 'react';
import { render } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/lifecycle/list.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';

export function service(overrides: Partial<ServiceBranchDivergence> = {}): ServiceBranchDivergence {
  return {
    service: 'route-explorer',
    path: '/repos/route-explorer',
    isMember: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    sharedBranch: 'development',
    protectedBranches: [],
    ...overrides,
  };
}

export async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// Mirrors edts-zone.interaction.test.tsx's own pressEscape: a lone ESC byte is ambiguous on
// the wire until Ink's internal flush-delay timer fires.
export async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

// `/` or `f` opens the editor on the rule list; `a` there starts a new rule.
export async function openRuleEditor(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, key = '/'): Promise<void> {
  await press(instance, stdin, key);
  await press(instance, stdin, 'a');
}

export function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(LogsZone, { useStore: store }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

export function seedStore(overrides: Record<string, unknown> = {}) {
  const store = createAppStore();
  store.setState({
    edts: [],
    edtsStatus: 'idle',
    activeEdt: null,
    edtsBranches: [
      service({ service: 'api-gateway', path: '/repos/api-gateway' }),
      service({ service: 'route-explorer', path: '/repos/route-explorer' }),
    ],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    ...overrides,
  });
  return store;
}
