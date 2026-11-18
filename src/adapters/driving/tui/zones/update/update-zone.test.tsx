// tui/zones/update: tests for the Update zone's pure keystroke/render helpers plus
// renderToString smoke coverage of each visual state (idle prompt, interrupted re-run
// offer, running spinner, done summary, top-level error). The useInput callback itself is
// never invoked here — the shared harness's fake stdin never emits data (the edts-zone
// convention) — so keystroke behavior is verified through the pure functions directly.
import { UPDATE_INCIDENTS_TITLE } from './update-incidents.logic.js';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render } from 'ink';
import { ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import { footerContextOf } from '../../shared/test-support/mount-for-test.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { fakeTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { createAppStore } from '../../store/app-store.js';
import { UPDATE_ALL_REPOS_PROMPT, UPDATE_ALL_RUNNING_LABEL, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_IDLE_PROMPT, UPDATE_INTERRUPTED_OFFER, UPDATE_QUIT_CONFIRM_BODY, UPDATE_QUIT_CONFIRM_BODY_ALL, UPDATE_RUNNING_LABEL, UPDATE_SELECTION_RUNNING_LABEL, UpdateZone } from './update-zone.js';
import { INTERRUPTED_EDTS, ACTIVE_EDT, SERVICE_A, SERVICE_B, LOADING_MEMBERS, noopLoad, fakeUpdateZoneDeps } from './update-zone.test-support.js';

describe('UpdateZone rendering', () => {
  it('idle with no interruption shows the Enter prompt plus the all-repos affordance', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).toContain(UPDATE_ALL_REPOS_PROMPT);
  });

  it('the idle prompt names all three triggers (main g, all-repos a, single-service p) plus the Enter menu', async () => {
    expect(UPDATE_IDLE_PROMPT).toContain('[M]');
    expect(UPDATE_IDLE_PROMPT).toContain('[P]');
    expect(UPDATE_IDLE_PROMPT).toContain('[Enter]');
    expect(UPDATE_ALL_REPOS_PROMPT).toContain('[A]');
  });

  it('an open service pick lists every candidate under the filter field and its hint', async () => {
    const store = createAppStore();
    store.setState({
      updateServicePick: [
        { service: 'svc-a', repoPath: '/repo/a' },
        { service: 'svc-b', repoPath: '/repo/b' },
      ],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('UPDATE SERVICE');
    expect(output).toContain('svc-a');
    expect(output).toContain('/repo/a');
    expect(output).toContain('svc-b');
    expect(output).toContain('Filter:');
    expect(await footerContextOf(store, createElement(UpdateZone, { useStore: store }))).toBe('menu');
  });

  it('a closed service pick renders no pick modal', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain('UPDATE SERVICE');
  });

  it('a pick with no candidate at all shows its own empty line, distinct from the no-match wording', async () => {
    const store = createAppStore();
    store.setState({ updateServicePick: [] });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('UPDATE SERVICE');
    expect(output).toContain('No service to select');
    expect(output).not.toContain('No matching service');
  });

  it('idle with an interrupted active EDT shows the re-run offer', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_INTERRUPTED_OFFER);
  });

  it('the interrupted offer routes through the service-actions menu, never a direct re-run', () => {
    expect(UPDATE_INTERRUPTED_OFFER).toContain('service actions');
    expect(UPDATE_INTERRUPTED_OFFER).not.toContain('to re-run');
  });

  it('running shows the spinner label plus one row per active-EDT member', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1', updateStatus: 'running' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain('svc-a');
  });

  it('running with no membership loaded yet shows the dim loading line instead of empty rows', async () => {
    const store = createAppStore();
    store.setState({ edts: null, activeEdt: null, updateStatus: 'running' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain(LOADING_MEMBERS);
  });

  it('an all-repos run shows the all label with the generic loading line, never EDT member rows', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1', updateStatus: 'running', updateScope: 'all' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_ALL_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain(LOADING_MEMBERS);
    expect(output).not.toContain('svc-a (feat/a)');
  });

  it('done with an all-repos outcome renders the All-repos title variant', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'all-repos',
      updateScope: 'all',
      updateResults: [{ service: 'a', outcome: 'updated' }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('ALL-REPOS UPDATE');
    expect(output).toContain('All repos: 1 updated, 0 skipped, 0 failed.');
  });

  it('the quit-mid-run dialog names no EDT interruption during an all-repos run', async () => {
    // The dialog copy is state-driven: render the open dialog through the store by
    // forcing the running + all-scope state the dialog reads. The dialog itself opens
    // via keystroke state, so assert the copy constants directly against the branch
    // the component renders.
    expect(UPDATE_QUIT_CONFIRM_BODY).toContain('mark this EDT interrupted');
    expect(UPDATE_QUIT_CONFIRM_BODY_ALL).not.toContain('mark this EDT interrupted');
  });

  it('done shows every per-service row plus the summary counts', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [
        { service: 'svc-a', outcome: 'updated' },
        { service: 'svc-b', outcome: 'failed', detail: { code: 'merge-conflict', message: 'conflict' } },
      ],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('✔ svc-a  shared branch → ?  updated');
    expect(output).toContain('✖ svc-b  shared branch → ?  failed (merge-conflict): conflict');
    expect(output).toContain('1 updated, 0 skipped, 1 failed');
    // Enter opens the row-local service menu — the follow-up hint promises the menu, never a
    // direct re-run.
    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).not.toContain('to run again');
  });

  it('done renders duplicate service names as separate rows (keyed by service + index)', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [
        { service: 'route-explorer', outcome: 'updated' },
        { service: 'route-explorer', outcome: 'failed', detail: { code: 'merge-conflict', message: 'conflict' } },
      ],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('✔ route-explorer');
    expect(output).toContain('✖ route-explorer');
  });

  it('done with a zero-member no-op note renders the note, never the zeroed counts pane', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateNote: 'EDT "demo" has no member services — nothing to update.',
      updateResults: [],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('has no member services');
    expect(output).not.toContain('0 updated, 0 skipped, 0 failed');
    expect(output).toContain(UPDATE_IDLE_PROMPT);
  });

  it('error shows the message, the kebab-case code, and the retry hint', async () => {
    const store = createAppStore();
    store.setState({ updateStatus: 'error', updateError: 'No active EDT', updateErrorCode: 'no-active-edt' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('No active EDT');
    expect(output).toContain('no-active-edt');
    // The retry hint promises the service-actions menu, never a direct retry.
    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).not.toContain('to try again');
  });

  it('a raised blocker renders the modal title, body, and all four choices', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      incidentPopupOpen: true,
      incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }, raisedAt: 0 }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_INCIDENTS_TITLE);
    expect(output).toContain('svc-a');
    expect(output).toContain('/repo/a');
    for (const item of UPDATE_BLOCKER_MENU_ITEMS) {
      expect(output).toContain(item.label);
    }
  });

  it('a re-presented merge conflict renders its retry counter and reason', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      incidentPopupOpen: true,
      incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict', retry: 2, retryReason: 'Unmerged paths remain' }, raisedAt: 0 }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('Retry #2');
    expect(output).toContain('Unmerged paths remain');
  });

  it('a merge-conflict blocker never offers the stash choice', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      incidentPopupOpen: true,
      incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }, raisedAt: 0 }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain('Stash changes');
    expect(output).toContain('Open in editor, then retry');
  });

  it('no raised blocker renders no blocker modal', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain(UPDATE_INCIDENTS_TITLE);
  });
});

describe('UpdateZone service-list shell rendering', () => {
  it('idle: every service carries a glyph (health fallback down until the first poll resolves), selected detail shows idle', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('svc-a');
    expect(output).toContain('svc-b');
    // No health poll has resolved yet, so the glyph falls back to StatusBadge's down glyph.
    expect(output).toContain('○');
    // The first row (svc-a, the EDT member) is selected by default; no run has ever
    // targeted it, so the detail pane says so.
    expect(output).toContain('No update has run for this service yet.');
  });

  it('unhealthy and inconsistent rows show their glyph and their name', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
      updateServiceHealth: { [SERVICE_A.path]: 'unhealthy', [SERVICE_B.path]: 'inconsistent' },
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcARow).toMatch(/◐\s*unhealthy/);
    expect(svcBRow).toMatch(/⚠\s*inconsistent/);
  });

  it('updating: only the service targeted by the in-flight EDT-scoped run shows the updating glyph — the non-targeted service keeps its raw-health glyph', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');

    // Isolate each service's own *list row* line (identified by its unique meta text "+0/-0",
    // which only the list row — not the running-members spinner line that also mentions the
    // service name — carries) so a bug that marks every row 'updating' regardless of scope (e.g.
    // isTargeted collapsed to bare `updateStatus === 'running'`) fails this test.
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    // svc-a is the active EDT's sole member — targeted by this EDT-scoped run.
    expect(svcARow).toContain('⇄');
    // (the detail pane shares the terminal line, so only the list column is checked)
    expect(svcARow?.slice(0, 40)).not.toContain('○');

    // svc-b is not an EDT member: during a run the list keeps only the services being
    // updated, so it is gone.
    expect(svcBRow).toBeUndefined();
  });

  it('updating: a single-service run inside the EDT marks only the selected member — the other member keeps its own glyph', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, { ...SERVICE_B, isMember: true }],
      edtsBranchesStatus: 'idle',
      edts: [{ ...ACTIVE_EDT, members: [...ACTIVE_EDT.members, { service: 'svc-b', repoPath: '/repo/b', branch: 'development' }] }],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      updateScope: 'edt',
      // The `p` trigger's confirmed config: scope `edt`, one selected row.
      updateSelection: [{ service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' }],
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: true }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcBRow).toContain('⇄');
    expect(svcARow).toBeUndefined();
    // The running-members spinner list names the selected member only.
    expect(output).toContain('svc-b (development)');
    expect(output).not.toContain('svc-a (feat/a)');
  });

  it('updating: a single-service run outside the EDT (all scope) marks only that service and names it', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      updateScope: 'all',
      updateSelection: [{ service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' }],
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcBRow).toContain('⇄');
    expect(svcARow).toBeUndefined();
    expect(output).toContain(UPDATE_SELECTION_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_ALL_RUNNING_LABEL);
    expect(output).not.toContain(LOADING_MEMBERS);
  });

  it('error: a service whose last completed run failed shows the error glyph and the failure detail', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      lastServiceOutcomes: {
        'svc-a': { service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict', message: 'Automatic merge failed' } },
      },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('✖');
    expect(output).toContain('failed (merge-conflict): Automatic merge failed');
  });
});

describe('UpdateZone health-poll wiring against real (fake-port) deps', () => {
  it('polls each row by its own repoPath (never by service name) and the rendered row reflects the resolved health glyph', async () => {
    // manifest.load resolves repoPath -> container ('ctr-a' for /repo/a, 'ctr-b' for
    // /repo/b); getContainerHealth reports 'up' only for 'ctr-a'. If the poll effect were
    // ever keyed by `row.service` instead of `row.path` (updateServiceHealth reads by
    // path — see update-zone.tsx), the lookup would simply never resolve and every row
    // would stay on the `down` fallback forever — both assertions below would fail
    // together in that case.
    const getContainerHealth = vi.fn(async (container: string) => ok(container === 'ctr-a' ? ('up' as const) : ('down' as const)));
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth,
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeUpdateZoneDeps({ docker }));
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const stdout = new FakeTtyStdout();
    const instance = render(createElement(UpdateZone, { useStore: store, initialRecap: false }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: fakeTtyStdin(),
      interactive: false,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      // Flushes the mount effect's fire-and-forget poll chain (manifest.load then
      // getContainerHealth, each a resolved-async mock) — a real macrotask tick, mirrors
      // update-slice.test.ts's own flushPolls helper — then waits for the state update's
      // own React commit to actually paint.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await instance.waitUntilRenderFlush();

      // Non-interactive Ink only actually flushes its buffered frame to the stream on
      // unmount (mirrors render-to-string.ts's own waitUntilExit-after-unmount sequencing)
      // — the poll above must resolve *before* this, not after, so the frame it unmounts
      // with already reflects the resolved health.
      const exit = instance.waitUntilExit();
      instance.unmount();
      await exit;

      const lines = stdout.output.split('\n');
      const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
      const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));
      expect(svcARow).toBeDefined();
      expect(svcBRow).toBeDefined();
      expect(svcARow).toContain('●');
      expect(svcBRow).toContain('○');
    } catch (error) {
      instance.unmount();
      throw error;
    }
  });
});

describe('UpdateZone live per-service detail', () => {
  it('running with the selected service targeted shows its live step plus the issue log instead of the last outcome', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServicePhase: { 'svc-a': 'pulling' },
      liveServiceSteps: { 'svc-a': { merge: 'running', migration: 'pending', restart: 'pending' } },
      liveServiceIssues: {
        'svc-a': [
          { kind: 'dirty-worktree', detail: '/repo/a', resolved: false },
          { kind: 'merge-conflict', detail: '/repo/a', resolved: true },
        ],
      },
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    // The first row (svc-a, the EDT member) is selected and targeted — the live view
    // replaces the last-outcome view that would otherwise read "updated".
    expect(output).toContain('UPDATE IN PROGRESS');
    expect(output).toContain('◐ Merge — in progress');
    expect(output).toContain('○ Migration — waiting');
    expect(output).toContain('⚠ dirty-worktree — /repo/a (needs your input)');
    expect(output).toContain('✔ merge-conflict — /repo/a (resolved)');
  });

  it('running with the selected service targeted but no phase yet shows the starting step', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('UPDATE IN PROGRESS');
    expect(output).toContain('○ Merge — waiting');
  });

  it('running with the migrate phase targeted shows the migrating glyph on that service’s own row', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServicePhase: { 'svc-a': 'migrating' },
      liveServiceSteps: { 'svc-a': { merge: 'done', migration: 'running', restart: 'pending' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));

    expect(svcARow).toBeDefined();
    expect(svcARow).toContain('⇒');
    expect(output).toContain('✔ Merge — done');
    expect(output).toContain('◐ Migration — in progress');
  });

  it('a rejected trigger raises a notice without leaving the running view', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      updateNotice: { code: 'update-already-running', message: 'A group update is already in progress' },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('⚠ A group update is already in progress (update-already-running)');
    expect(output).toContain('UPDATE IN PROGRESS');
  });

  it('a service finished mid-run shows its last update while the run is still going', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServiceDone: { 'svc-a': true },
      lastServiceRuns: {
        'svc-a': {
          steps: { merge: 'done', migration: 'done', restart: 'done' },
          result: { service: 'svc-a', outcome: 'updated', run: { merge: { kind: 'up-to-date' } } },
          source: 'develop',
          target: 'feat/a',
          topic: 'demo',
        },
      },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).not.toContain('UPDATE IN PROGRESS');
    expect(output).toContain('last update');
    expect(output).toContain('develop → feat/a (EDT demo)');
    expect(output).toContain('✔ Merge — done');
    expect(output).toContain('already up to date');
    expect(output).toContain('✔ Restart — done');
  });

  it('done reverts to the final per-service outcome even with a stale live phase in the map', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [{ service: 'svc-a', outcome: 'updated' }],
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      liveServicePhase: { 'svc-a': 'pulling' },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).not.toContain('step:');
  });

  it('idle with a standalone restart in flight on the selected service shows its live restarting step', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'idle',
      serviceRestartInFlight: { '/repo/a': 'restart' },
      liveServicePhase: { 'svc-a': 'restarting' },
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('step: restarting');
  });

  it('idle with a standalone restart in flight but no emission yet shows starting, never a stale outcome', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'idle',
      serviceRestartInFlight: { '/repo/a': 'restart' },
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('step: starting');
  });
});
