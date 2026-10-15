// The EDTs zone's growing collections stay windowed around their cursor and announce what is hidden.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { BoundsProvider } from '../../shared/bounds/bounds-context.js';
import { FakeTtyStdout, KEYS, fakeInteractiveTtyStdin } from '../../shared/test-support/fake-tty.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { adversarialEdt, adversarialServices, failedRows, MULTILINE_ERROR } from '../../shared/test-support/dialog-registry.js';
import { EdtsZone } from './edts-zone.js';
import { IssuesDialogView } from './dialogs/issues-dialog.js';
import { DeleteDialogView } from './dialogs/delete-dialog.js';
import { initialDeleteDialog } from './edts-zone.logic.js';
import { frameLines } from '../../shared/test-support/matrix.js';

const region = { columns: 60, rows: 15, children: null };

describe('EDTs zone bounded rendering', () => {
  it('issues dialog windows 160 issues with an indicator and keeps each on one line', async () => {
    const output = await renderToString(
      createElement(
        BoundsProvider,
        region,
        createElement(IssuesDialogView, {
          unreachable: Array.from({ length: 80 }, (_, i) => `/repos/unreachable-${i}`),
          errors: Array.from({ length: 80 }, (_, i) => ({ path: `/repos/broken-${i}`, code: 'git-error', message: MULTILINE_ERROR })) as never,
        }),
      ),
      { columns: 60, rows: 15 },
    );
    const lines = frameLines(output);
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(output).toContain('▼ more issues');
    expect(output).not.toContain('third line');
  });

  it('delete dialog keeps the cursor row visible among 200 members', async () => {
    const services = adversarialServices(200);
    const dialog = {
      ...initialDeleteDialog(adversarialEdt(), false),
      memberRows: services.map((s) => ({
        repoPath: s.path,
        service: s.service,
        branch: 'main',
        merged: true,
        clean: true,
        disposition: 'leave' as const,
      })),
      memberCursor: 150,
      failedRows: failedRows(),
    };
    const output = await renderToString(createElement(BoundsProvider, region, createElement(DeleteDialogView, { dialog })), {
      columns: 60,
      rows: 15,
    });
    expect(output).toContain('service-with-a-very-long-name-150');
    expect(output).toContain('more above');
    expect(frameLines(output).length).toBeLessThanOrEqual(15);
  });

  it('EDT list scrolls to the selected entry among 100 EDTs', async () => {
    const store = createAppStore();
    store.setState({
      edts: Array.from({ length: 100 }, (_, i) => ({ ...adversarialEdt(2), ulid: `u${i}`, topic: `topic-${i}` })),
      edtsStatus: 'idle',
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    } as never);
    const stdout = new FakeTtyStdout();
    stdout.columns = 80;
    stdout.rows = 24;
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(EdtsZone, { useStore: store }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      for (let i = 0; i < 80; i += 1) {
        (stdin as unknown as { write: (c: string) => void }).write(KEYS.down);
        await instance.waitUntilRenderFlush();
      }
      const last = stdout.output.slice(stdout.output.lastIndexOf('EDTS'));
      expect(last).toContain('topic-80');
      expect(last).toContain('more above');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('issues dialog arrows reveal later issues and show the above indicator', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = 60;
    stdout.rows = 15;
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(
      createElement(
        BoundsProvider,
        region,
        createElement(IssuesDialogView, {
          unreachable: Array.from({ length: 40 }, (_, i) => `/repos/unreachable-${i}`),
          errors: [],
        }),
      ),
      { stdout: stdout as unknown as NodeJS.WriteStream, stdin, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    const last = () => stdout.output.slice(stdout.output.lastIndexOf('SERVICE LISTING ISSUES'));
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(last()).toContain('unreachable-0');
      expect(last()).not.toContain('unreachable-30');
      for (let i = 0; i < 30; i += 1) {
        (stdin as unknown as { write: (c: string) => void }).write(KEYS.down);
        await instance.waitUntilRenderFlush();
      }
      expect(last()).toContain('unreachable-30');
      expect(last()).toContain('▲ more issues');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('issues dialog ignores arrows when there are no issues', async () => {
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(IssuesDialogView, { unreachable: [], errors: [] }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      (stdin as unknown as { write: (c: string) => void }).write(KEYS.down);
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('No issues.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
