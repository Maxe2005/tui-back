// tui/zones/update: UpdateZone health-poll wiring and live per-service detail against fake-port deps.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render } from 'ink';
import { ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { fakeTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { createAppStore } from '../../store/app-store.js';
import { UpdateZone } from './update-zone.js';
import { ACTIVE_EDT, SERVICE_A, SERVICE_B, noopLoad, fakeUpdateZoneDeps } from './update-zone.test-support.js';

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
