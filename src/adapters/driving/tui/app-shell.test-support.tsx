import { createElement } from 'react';
import { render } from 'ink';
import { vi } from 'vitest';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/storage/edt-registry.js';
import type { GitPort } from '../../../core/ports/vcs/git.js';
import type { LockPort } from '../../../core/ports/runtime/lock.js';
import type { ManifestPort } from '../../../core/ports/vcs/manifest.js';
import type { RegistryPort } from '../../../core/ports/storage/registry.js';
import type { StatePort } from '../../../core/ports/storage/state.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../core/ports/storage/settings.js';
import type { DockerPort } from '../../../core/ports/runtime/docker.js';
import { AppShell } from './app-shell.js';
import { createAppStore, type AppStoreDeps } from './store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './shared/test-support/fake-tty.js';
import { manifestFor } from './store/store.test-support.js';

// The mount-time/registry-close `loadTabVisibility()` effect is AppShell's only production
// activation path, and a deps-less `createAppStore()` only ever takes its `!deps` early
// return — so without wired deps no test could tell that effect running apart from the
// effect being deleted.
export function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repo/a'])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (path: string) => ok(manifestFor(path))),
  };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('feat/a')),
    aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    pull: vi.fn(async () => ok(undefined)),
    mergeBranch: vi.fn(async () => ok(undefined)),
    abortMerge: vi.fn(async () => ok(undefined)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([])),
    discardPaths: vi.fn(async () => ok(undefined)),
    discardAll: vi.fn(async () => ok(undefined)),
    diffNameOnly: vi.fn(async () => ok([])),
    headRevision: vi.fn(async () => ok('head-a')),
    diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    listUnmergedPaths: vi.fn(async () => ok([] as string[])),
    readWorktreeFile: vi.fn(async () => ok("")),
    writeResolvedFile: vi.fn(async () => ok(undefined)),
    checkoutSide: vi.fn(async () => ok(undefined)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    fetchRemote: vi.fn(async () => ok(undefined)),
    listUnpushedCommits: vi.fn(async () => ok([] as string[])),
    listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
    listBranchesContaining: vi.fn(async () => ok([] as string[])),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
    readLogRules: vi.fn(async () => ok(null)),
    writeLogRules: vi.fn(async () => ok(undefined)),
    readLogRuleSets: vi.fn(async () => ok(null)),
    writeLogRuleSets: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  const docker: DockerPort = {
    streamLogs: vi.fn(() => () => {}),
    fetchLogsBefore: vi.fn(async () => ok([])),
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    restartContainer: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git,
    edtRegistry,
    state,
    lock,
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    settings,
    docker,
    ...overrides,
  };
}

// loadTabVisibility() chains several awaited port calls (listRepos, readActiveEdt, ...) before
// its terminal set() lands — `waitUntilRenderFlush()` only waits for React's own next commit,
// not that async chain settling, so every wait below pairs it with a real macrotask delay
// (mirrors this file's own `pressEscape` working around the same class of gap for Ink's
// internal Escape-flush timer).
export async function flushAsyncLoad(instance: ReturnType<typeof render>): Promise<void> {
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await instance.waitUntilRenderFlush();
}

export function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(AppShell, { useStore: store, onQuit: () => {} }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

export async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// A lone ESC byte is ambiguous on the wire — Ink's input parser can't tell it apart from the
// first byte of a CSI sequence (e.g. an arrow key) until either more bytes arrive or its own
// internal `pendingInputFlushDelayMilliseconds` (20ms, ink/build/components/App.js) real timer
// fires to flush it as a standalone Escape keypress. `waitUntilRenderFlush()` only waits for
// React's own commit, not that timer, so a bare `press(..., KEYS.escape)` can resolve before
// Ink has actually delivered `key.escape: true` to `useInput` at all (edts-zone.interaction
// .test.tsx documents/works around the same gap) — every Escape press in this file goes
// through this instead.
export async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}
