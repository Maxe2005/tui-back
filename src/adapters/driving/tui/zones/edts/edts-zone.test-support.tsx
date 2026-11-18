// Shared render/keypress helpers for the EdtsZone real-keypress test files.
import { createElement } from 'react';
import { render } from 'ink';
import { it } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { Result } from '../../../../../core/result.js';
import type { CreateCandidateBranches, CreateEdtData } from '../../../../../core/edt/create.js';
import { createAppStore, type CreateEdtParams } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { EdtsZone } from './edts-zone.js';
import { CREATE_WIZARD_TITLE as WIZARD_TITLE } from './dialogs/create-wizard/create-wizard.js';

export function edt(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
  return {
    ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
    topic: 'demo',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [],
    ...overrides,
  };
}

export async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
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
export async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

export async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
  for (const char of text) {
    await press(instance, stdin, char);
  }
}

// Step 3 loads each selected service's branch lists on entry (never fetching).
export type ListsResult = Result<CreateCandidateBranches>;
export const readyBranches = async (): Promise<ListsResult> => ({ ok: true, data: { local: ['main', 'development'], remote: [] } });

// Lets the async list loads settle (a resolved promise, then React's commit).
export async function settle(instance: ReturnType<typeof render>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await instance.waitUntilRenderFlush();
}

// The picker fetches its branch list in an effect after it opens; Enter on the base field waits for it.
export async function settleBranches(instance: ReturnType<typeof render>): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await settle(instance);
  }
}

export function lastWizardFrame(stdout: FakeTtyStdout): string {
  return stdout.output.slice(stdout.output.lastIndexOf(WIZARD_TITLE));
}

// Two services with diverging manifest sharedBranch values (svc-a: main, svc-b: development).
export function step3Store(
  options: {
    lists?: Record<string, CreateCandidateBranches>;
    listCreateBranches?: (repoPath: string) => Promise<ListsResult>;
    edts?: EdtRegistryEntry[];
  } = {},
) {
  const store = createAppStore();
  const createCalls: CreateEdtParams[] = [];
  const listCalls: string[] = [];
  store.setState({
    edts: options.edts ?? [],
    edtsStatus: 'idle',
    activeEdt: null,
    // Manifest fixtures — each service's manifest lists its own protected branches.
    edtsBranches: [
      { service: 'svc-a', path: '/repos/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'main', protectedBranches: ['development', 'preprod', 'prod'] },
      { service: 'svc-b', path: '/repos/b', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: ['preprod', 'prod'] },
    ],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    listCreateBranches:
      options.listCreateBranches ??
      (async (repoPath: string): Promise<ListsResult> => {
        listCalls.push(repoPath);
        const lists = options.lists?.[repoPath] ?? { local: ['main', 'development'], remote: [] };
        return { ok: true, data: lists };
      }),
    createEdt: async (params): Promise<Result<CreateEdtData>> => {
      createCalls.push(params);
      return { ok: true, data: { ulid: 'new-ulid', topic: params.topic, results: [] } };
    },
  });
  return { store, createCalls, listCalls };
}

// Name -> the first `services` candidates checked -> Step 3, lists loaded.
export async function reachStep3(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, name: string, services: number): Promise<void> {
  await instance.waitUntilRenderFlush();
  await type(instance, stdin, name);
  await press(instance, stdin, KEYS.enter); // Step 1 -> Step 2
  for (let index = 0; index < services; index += 1) {
    if (index > 0) {
      await press(instance, stdin, KEYS.down);
    }
    await press(instance, stdin, KEYS.space);
  }
  await press(instance, stdin, KEYS.enter); // Step 2 -> Step 3
  await settle(instance);
}

export function mount(
  store: ReturnType<typeof createAppStore>,
  extraProps: {
    initialDialogKind?: 'create' | 'switch-confirm' | 'switch-blocked' | 'modify' | 'service-actions' | 'add-to-edt' | 'delete-confirm' | 'delete-confirm-rejected';
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
