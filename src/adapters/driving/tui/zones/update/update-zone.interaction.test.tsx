// tui/zones/update: real-keypress coverage for the branch-autocomplete adoption (spec
// branch-autocomplete-input-adoption) — the config dialog's branch editor hosts shared
// autocomplete state fed by the zone's own fetch-once-per-edit listBranches effect, behavior
// only a real keypress plus the zone's useEffect chain can exercise. Reuses
// edts-zone.interaction.test.tsx's real-Ink-input technique
// (shared/test-support/fake-tty.ts) — no pty required.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import type { Result } from '../../../../../core/result.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { createUpdateConfigDraft } from './update-config-dialog.logic.js';
import { UpdateZone } from './update-zone.js';

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

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

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(UpdateZone, { useStore: store }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

// The config draft is preset straight into the store (bypassing openUpdateConfig's own
// registry/manifest deps — draft creation is story 3.7's covered ground, not this spec's);
// the branch source still comes through the zone's live listBranches effect.
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
