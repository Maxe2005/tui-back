// tui/zones/update: real-keypress coverage (shared/test-support/fake-tty.ts) for what only a real
// keypress plus the zone's useEffect chain can exercise — the config dialog's branch editor fed
// by the zone's fetch-once-per-edit listBranches effect, the trigger keys, the no-arg
// `:update-service` handoff and the service quick-pick.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../core/result.js';
import { ok } from '../../../../../core/result.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { createUpdateConfigDraft } from './update-config-dialog.logic.js';
import { UpdateZone } from './update-zone.js';

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// A lone ESC byte is ambiguous on the wire — Ink's input parser can't tell it apart from
// the first byte of a CSI sequence until its own internal
// `pendingInputFlushDelayMilliseconds` (20ms) real timer fires to flush it as a
// standalone Escape keypress. `waitUntilRenderFlush()` only waits for React's own
// commit, not that timer, so a bare `press(..., KEYS.escape)` can resolve before Ink
// has delivered `key.escape: true` at all. Every Escape press goes through this
// instead (the edts-zone.interaction.test.tsx pressEscape precedent).

// The branch-source fetch is a useEffect chain behind a real keypress delivery (both async
// in Ink): a fixed flush count races it. Poll the accumulated output instead — exits on the
// first frame containing the marker, fails loudly on timeout.
async function waitForOutput(
  instance: ReturnType<typeof render>,
  stdout: FakeTtyStdout,
  marker: string,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await instance.waitUntilRenderFlush();
    if (stdout.output.includes(marker)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for output to contain: ${marker}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function mount(store: ReturnType<typeof createAppStore>, initialRecap = false) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(UpdateZone, { useStore: store, initialRecap }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

// The config draft is preset straight into the store (bypassing openUpdateConfig's own
// registry/manifest deps, covered elsewhere); the branch source still comes through the zone's
// live listBranches effect.
function storeWithConfig(listBranches: (repoPath: string) => Promise<Result<string[]>>) {
  const store = createAppStore();
  store.setState({
    settings: {
      ...store.getState().settings,
      edts: { ...store.getState().settings.edts, branchDropdownMaxRows: 2 },
    },
    edtsBranches: [],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    listBranches,
    updateConfig: createUpdateConfigDraft('edt', [
      { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' },
    ]),
  });
  return store;
}

// The minimally-wired store for paths that read ports (pinned/single-service config
// opens, the service quick-pick enumeration): only the ports those paths touch are real
// (registry/manifest/state/edtRegistry, plus docker for the zone's health poll and empty
// guards for the rest); the zone's own mount-time loads stay stubbed per test.
function wiredDeps(): AppStoreDeps {
  const registry: RegistryPort = {
    list: async () => ok(['/repo/a']),
    add: async () => ok(undefined),
    remove: async () => ok(undefined),
    exists: async () => ok(true),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: async () => ok({ path: '/x', backupPath: null }),
  };
  const manifest: ManifestPort = {
    load: async (repoPath: string) =>
      ok({
        service: `svc-${repoPath.split('/').pop()}`,
        container: `ctr-${repoPath.split('/').pop()}`,
        migrationCommand: 'npm run migration:run',
        sharedBranch: 'development',
        modules: {},
      }),
  };
  const edtRegistry: EdtRegistryPort = {
    add: async () => ok(undefined),
    list: async () => ok([{ ulid: 'edt-1', topic: 'demo', createdAt: '2026-09-17T00:00:00.000Z', status: 'active' as const, members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }] }]),
    setStatus: async () => ok(undefined),
    update: async () => ok(undefined),
    remove: async () => ok(undefined),
  };
  const state: StatePort = {
    readActiveEdt: async () => ok('edt-1'),
    writeActiveEdt: async () => ok(undefined),
    readSplitterRatios: async () => ok(null),
    writeSplitterRatios: async () => ok(undefined),
    readFilterHistory: async () => ok(null),
    writeFilterHistory: async () => ok(undefined),
  };
  return {
    registry,
    manifest,
    edtRegistry,
    state,
    git: {} as unknown as GitPort,
    lock: {} as unknown as AppStoreDeps['lock'],
    edtRegistryResourceKey: 'edt-registry',
    edtsBaseDir: '/edts',
    registryResourceKey: 'registry',
    settings: {} as unknown as AppStoreDeps['settings'],
    container: {},
    migration: {},
    restart: {},
    docker: { getContainerHealth: async () => ok('up' as const) } as unknown as DockerPort,
  } as unknown as AppStoreDeps;
}

describe('UpdateZone branch-autocomplete wiring (real keypress)', () => {
  it('the open branch editor proposes that row listBranches, capped live by settings.edts.branchDropdownMaxRows', async () => {
    // The editor opens pre-filled with the row's sourceBranch ('development'), so the
    // branches must contain it as a substring — an empty-overlap list would (correctly)
    // render zero rows and prove nothing about the cap.
    const store = storeWithConfig(async (): Promise<Result<string[]>> => ({
      ok: true,
      data: ['development', 'development-hotfix', 'development-experiment', 'zzz-other'],
    }));

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // row 0 is a service row -> begin branch edit
      await waitForOutput(instance, stdout, 'development-hotfix');

      // The zone threaded its own listBranches result plus the live store cap into the
      // dialog: 3 substring matches at maxRows 2 render two rows plus the overflow line.
      // A zone that never fires its effect (or hardcodes the cap) fails here — reducer-level
      // tests inject branches/maxRows directly and cannot catch that.
      expect(stdout.output).toContain('Merge from');
      expect(stdout.output).toContain('development-hotfix');
      expect(stdout.output).toContain('… 1 more');
      expect(stdout.output).not.toContain('development-experiment');
      expect(stdout.output).not.toContain('zzz-other');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a listBranches failure keeps the `Failed to load branches.` line with a usable field', async () => {
    const store = storeWithConfig(async (): Promise<Result<string[]>> => ({
      ok: false,
      error: { code: 'git-error', message: 'boom' },
    }));

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // row 0 is a service row -> begin branch edit
      await waitForOutput(instance, stdout, 'Failed to load branches.');

      expect(stdout.output).toContain('Merge from');
      expect(stdout.output).toContain('Failed to load branches.');
      expect(stdout.output).toContain('development');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// The zone keys dispatch through the real useInput chain (the pure resolveUpdateTrigger mapping
// is covered in update-zone.test.tsx; these prove the thin dispatcher calls the opener). The
// store stays unwired, so the opener lands in its explicit store-not-wired error — never a
// throw, and proof the key reached it.
describe('UpdateZone update triggers (real keypress)', () => {
  const ROW_A: ServiceBranchDivergence = {
    service: 'svc-a',
    path: '/repo/a',
    isMember: true,
    sharedBranch: 'development',
    protectedBranches: [],
    branch: 'feat/a',
    ahead: 0,
    behind: 0,
    status: 'current',
  };

  function storeWithServices() {
    const store = createAppStore();
    store.setState({
      edtsBranches: [ROW_A],
      edtsBranchesStatus: 'idle',
      edts: [
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
        },
      ],
      activeEdt: 'edt-1',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    return store;
  }

  it('p on the highlighted row reaches openUpdateConfig (unwired: explicit error, never a throw)', async () => {
    const store = storeWithServices();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'p');
      await waitForOutput(instance, stdout, 'No ports wired into the TUI store');

      expect(store.getState().updateConfig).toBeNull();
      expect(store.getState().updateErrorCode).toBe('store-not-wired');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('g reaches openUpdateConfig pre-scoped to the EDT (unwired: explicit error, never a throw)', async () => {
    const store = storeWithServices();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'g');
      await waitForOutput(instance, stdout, 'No ports wired into the TUI store');

      expect(store.getState().updateConfig).toBeNull();
      expect(store.getState().updateErrorCode).toBe('store-not-wired');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('g mid-run is ignored — no screen, no error, the run keeps its status', async () => {
    const store = storeWithServices();
    store.setState({ updateStatus: 'running' });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'g');
      await instance.waitUntilRenderFlush();

      expect(store.getState().updateConfig).toBeNull();
      expect(store.getState().updateStatus).toBe('running');
      expect(store.getState().updateErrorCode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('p with no row selected opens nothing — null config, no error, no throw', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      edts: [],
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'p');
      await instance.waitUntilRenderFlush();

      expect(store.getState().updateConfig).toBeNull();
      expect(store.getState().updateErrorCode).toBeNull();
      expect(store.getState().updateStatus).toBe('idle');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// The no-arg `:update-service` handoff end to end — the store raises the selection request, the
// mounted zone consumes it against its highlighted row (or opens the quick-pick with none). A
// minimally-wired store: only the ports this path reads are real (registry/manifest/state/
// edtRegistry, plus docker for the zone's health poll and empty guards for the rest); the
// zone's own mount-time loads stay stubbed.
describe('UpdateZone no-arg update-service handoff (real mount)', () => {
  const ROW_A: ServiceBranchDivergence = {
    service: 'svc-a',
    path: '/repo/a',
    isMember: true,
    sharedBranch: 'development',
    protectedBranches: [],
    branch: 'feat/a',
    ahead: 0,
    behind: 0,
    status: 'current',
  };

  it('a no-arg request with a highlighted row opens the config pre-scoped to that service', async () => {
    const store = createAppStore(wiredDeps());
    store.setState({
      edtsBranches: [ROW_A],
      edtsBranchesStatus: 'idle',
      edts: [
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
        },
      ],
      activeEdt: 'edt-1',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    // The real no-arg command path — arg parsing, guards, and request raising.
    await store.getState().openUpdateServiceDialog('update-service');
    expect(store.getState().updateServiceSelectRequest).toBe(true);

    const { instance, stdout } = mount(store);
    try {
      await waitForOutput(instance, stdout, 'Single service: svc-a');

      // Consumed exactly once, pre-scoped to the highlighted row, nothing ran.
      expect(store.getState().updateServiceSelectRequest).toBe(false);
      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-a', repoPath: '/repo/a', selected: true }],
      });
      expect(store.getState().updateStatus).toBe('idle');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a no-arg request with no row selected opens the filterable quick-pick instead', async () => {
    const store = createAppStore(wiredDeps());
    store.setState({
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      edts: [],
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    await store.getState().openUpdateServiceDialog('update-service');

    const { instance, stdout } = mount(store);
    try {
      await waitForOutput(instance, stdout, 'UPDATE SERVICE');

      expect(store.getState().updateServiceSelectRequest).toBe(false);
      expect(store.getState().updateConfig).toBeNull();
      expect(stdout.output).toContain('svc-a');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// Keypresses while the service quick-pick is open — the pick owns every keystroke (filter, move,
// confirm into a pre-scoped config, cancel). Mounted with a preset pick over the wired store so
// Enter can actually open the config.
describe('UpdateZone service pick keypress (real keypress)', () => {
  const PICK = [
    { service: 'svc-a', repoPath: '/repo/a' },
    { service: 'svc-b', repoPath: '/repo/b' },
  ];

  function storeWithPick() {
    const store = createAppStore(wiredDeps());
    store.setState({
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      edts: [],
      activeEdt: null,
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      updateServicePick: PICK,
    });
    return store;
  }

  it('typing a filter that matches nothing shows the explicit no-match line', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'zzz');
      await waitForOutput(instance, stdout, 'No matching service');

      expect(store.getState().updateServicePick).not.toBeNull();
      expect(store.getState().updateConfig).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter confirms the highlighted row into a pre-scoped config and closes the pick', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter); // cursor 0 -> svc-a
      await waitForOutput(instance, stdout, 'Single service: svc-a');

      expect(store.getState().updateServicePick).toBeNull();
      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-a', repoPath: '/repo/a', selected: true }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('arrows move the cursor: down then Enter confirms the second row', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await waitForOutput(instance, stdout, 'Single service: svc-b');

      expect(store.getState().updateServicePick).toBeNull();
      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-b', repoPath: '/repo/b', selected: true }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the filter also matches the repo path, so Enter confirms the path-matched service', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/repo/b');
      await press(instance, stdin, KEYS.enter);
      await waitForOutput(instance, stdout, 'Single service: svc-b');

      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-b', repoPath: '/repo/b', selected: true }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Home no longer jumps the list to its first row: the highlighted row survives it', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down); // highlight svc-b
      await press(instance, stdin, KEYS.home);
      // Decisive proof: a Home that jumped the list back to its first row would make this
      // Enter confirm svc-a instead.
      await press(instance, stdin, KEYS.enter);
      await waitForOutput(instance, stdout, 'Single service: svc-b');

      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-b', repoPath: '/repo/b', selected: true }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Home and End move the caret to both ends of the filter text', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'vc');
      await press(instance, stdin, KEYS.home);
      await press(instance, stdin, 's'); // "svc" only if Home moved the caret to the start
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, '-b'); // "svc-b" only if End moved it back to the end
      await press(instance, stdin, KEYS.enter);
      await waitForOutput(instance, stdout, 'Single service: svc-b');

      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-b', repoPath: '/repo/b', selected: true }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a reopened pick starts unfiltered on its first row, whether Esc or the store closed it', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // First session: narrow to svc-b, then Esc.
      await press(instance, stdin, 'svc-b');
      await pressEscape(instance, stdin);
      expect(store.getState().updateServicePick).toBeNull();

      // Second session: move the highlight off the first row, then the store itself closes
      // the pick (the path no key handler sees).
      store.setState({ updateServicePick: PICK });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      store.setState({ updateServicePick: null });
      await instance.waitUntilRenderFlush();

      // Third session: Enter must confirm the first candidate — a leftover "svc-b" filter
      // or a leftover highlight on the second row would both confirm svc-b instead.
      store.setState({ updateServicePick: PICK });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await waitForOutput(instance, stdout, 'Single service: svc-a');

      expect(store.getState().updateConfig).toMatchObject({
        rows: [{ service: 'svc-a', repoPath: '/repo/a', selected: true }],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the filter is caret-editable: text typed after a Left is inserted at the caret, not appended', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'b');
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, 'svc-');
      // The filter now reads "svc-b". An append-only field would read "bsvc-", match
      // nothing, and make this Enter a no-op.
      await press(instance, stdin, KEYS.enter);
      await waitForOutput(instance, stdout, 'Single service: svc-b');

      expect(store.getState().updateServicePick).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the pick with no config opened', async () => {
    const store = storeWithPick();

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await pressEscape(instance, stdin);
      await instance.waitUntilRenderFlush();

      expect(store.getState().updateServicePick).toBeNull();
      expect(store.getState().updateConfig).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an empty filter opens nothing and leaves the pick open', async () => {
    const store = storeWithPick();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'zzz');
      await waitForOutput(instance, stdout, 'No matching service');
      await press(instance, stdin, KEYS.enter);
      await instance.waitUntilRenderFlush();

      expect(store.getState().updateServicePick).not.toBeNull();
      expect(store.getState().updateConfig).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// The zone keys dispatch through to the openers with their args on a wired store — `g` opens the
// draft EDT-scoped with every member pre-selected, `p` opens a one-row draft for the highlighted
// row (the unwired trigger tests above stop at store-not-wired before reading any arg).
describe('UpdateZone wired dispatch args (real keypress)', () => {
  const ROW_A: ServiceBranchDivergence = {
    service: 'svc-a',
    path: '/repo/a',
    isMember: true,
    sharedBranch: 'development',
    protectedBranches: [],
    branch: 'feat/a',
    ahead: 0,
    behind: 0,
    status: 'current',
  };
  const ROW_B: ServiceBranchDivergence = {
    service: 'svc-b',
    path: '/repo/b',
    isMember: true,
    sharedBranch: 'development',
    protectedBranches: [],
    branch: 'feat/b',
    ahead: 0,
    behind: 0,
    status: 'current',
  };
  const MEMBERS = [
    { service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' },
    { service: 'svc-b', repoPath: '/repo/b', branch: 'feat/b' },
  ];

  function storeWithTwoMembers() {
    const deps = wiredDeps();
    deps.edtRegistry = {
      ...(deps.edtRegistry as object),
      list: async () =>
        ok([
          {
            ulid: 'edt-1',
            topic: 'demo',
            createdAt: '2026-09-17T00:00:00.000Z',
            status: 'active' as const,
            members: MEMBERS,
          },
        ]),
    } as unknown as AppStoreDeps['edtRegistry'];
    const store = createAppStore(deps);
    store.setState({
      edtsBranches: [ROW_A, ROW_B],
      edtsBranchesStatus: 'idle',
      edts: [
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: MEMBERS,
        },
      ],
      activeEdt: 'edt-1',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    return store;
  }

  it('g opens the draft EDT-scoped with all members pre-selected', async () => {
    const store = storeWithTwoMembers();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'g');
      await waitForOutput(instance, stdout, 'PARAMÈTRES GLOBAUX');

      expect(store.getState().updateConfig).toMatchObject({
        scope: 'edt',
        rows: [
          { service: 'svc-a', repoPath: '/repo/a', selected: true },
          { service: 'svc-b', repoPath: '/repo/b', selected: true },
        ],
      });
      expect(store.getState().updateStatus).toBe('idle');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab moves to the table, Enter opens the service box and Esc closes it without changes', async () => {
    const store = storeWithTwoMembers();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'g');
      await waitForOutput(instance, stdout, 'PARAMÈTRES GLOBAUX');
      await press(instance, stdin, '\t');
      await press(instance, stdin, '\r');
      await waitForOutput(instance, stdout, 'Configurer svc-a');
      await press(instance, stdin, '\u001b');
      await waitForOutput(instance, stdout, 'RÉSUMÉ ET EXCEPTIONS PAR SERVICE');

      expect(store.getState().updateConfig).not.toBeNull();
      expect(store.getState().updateConfig?.rows.every((row) => row.origin === 'shared')).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('From EDT with no EDT chosen blocks the run: Space on the source line, Esc, then y is refused', async () => {
    const store = storeWithTwoMembers();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'g');
      await waitForOutput(instance, stdout, 'PARAMÈTRES GLOBAUX');
      await press(instance, stdin, ' ');
      await waitForOutput(instance, stdout, '✖ aucun EDT choisi');
      await press(instance, stdin, '\u001b');
      // Ink holds a lone Esc briefly to tell it from an escape sequence; give it time so the
      // Tab below is not read as Meta+Tab.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      await press(instance, stdin, '\t');
      await waitForOutput(instance, stdout, '[Ctrl+R] Revenir au global');
      await press(instance, stdin, 'y');
      await waitForOutput(instance, stdout, 'Source de merge non résolue');

      expect(store.getState().updateConfig?.strategy.kind).toBe('edt-pending');
      expect(store.getState().updateStatus).toBe('idle');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('p on the highlighted row opens a one-row draft for that service', async () => {
    const store = storeWithTwoMembers();

    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'p');
      await waitForOutput(instance, stdout, 'Single service: svc-a');

      expect(store.getState().updateConfig).toMatchObject({
        scope: 'edt',
        rows: [{ service: 'svc-a', repoPath: '/repo/a', selected: true }],
      });
      expect(store.getState().updateStatus).toBe('idle');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('opens on the global view with no service focused, two distinct panes, and an arrow focuses a service', async () => {
    const store = storeWithTwoMembers();
    store.setState({ edtsBranches: [ROW_A, ROW_B, { ...ROW_B, service: 'svc-other', path: '/repo/other' }] });

    const { instance, stdout, stdin } = mount(store, true);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('EDT MEMBERS');
      expect(stdout.output).toContain('OTHER SERVICES');
      expect(stdout.output).toContain('[G] EDT update');
      expect(stdout.output).toContain('No update has run yet in this session.');

      // Without a focused service, p opens nothing.
      await press(instance, stdin, 'p');
      expect(store.getState().updateConfig).toBeNull();
      expect(store.getState().updateErrorCode).toBeNull();

      const before = stdout.output.length;
      await press(instance, stdin, KEYS.down);
      await instance.waitUntilRenderFlush();
      expect(stdout.output.slice(before)).not.toContain('[G] EDT update');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
