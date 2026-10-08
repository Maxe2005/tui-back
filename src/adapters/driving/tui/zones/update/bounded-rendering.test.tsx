// The Update zone's stream-fed issue log is capped with an "older hidden" line; its detail text
// never exceeds the pane.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { BoundsProvider } from '../../shared/bounds/bounds-context.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { frameLines } from '../../shared/test-support/matrix.js';
import { UpdateServiceDetail } from './update-service-detail.js';
import { UpdateZone } from './update-zone.js';
import { createAppStore } from '../../store/app-store.js';
import { FakeTtyStdout, KEYS, fakeInteractiveTtyStdin } from '../../shared/test-support/fake-tty.js';

describe('Update zone bounded rendering', () => {
  it('caps a 300-issue log to the newest entries with an older-hidden count', async () => {
    const issues = Array.from({ length: 300 }, (_, i) => ({ kind: 'conflict', detail: `issue number ${i}\n${'long '.repeat(200)}`, resolved: i % 2 === 0 })) as never;
    const output = await renderToString(
      createElement(
        BoundsProvider,
        { columns: 60, rows: 25, children: null },
        createElement(UpdateServiceDetail, { service: 'svc', mode: 'live', context: null, steps: undefined, result: undefined, issues }),
      ),
      { columns: 60, rows: 25 },
    );
    expect(output).toMatch(/… \d+ older hidden/);
    expect(output).toContain('issue number 299');
    expect(output).not.toContain('issue number 0 ');
    expect(frameLines(output).length).toBeLessThanOrEqual(25);
    for (const line of frameLines(output)) {
      expect(Array.from(line).length).toBeLessThanOrEqual(60);
    }
  });

  it('scrolls the recap result list with PgDn / PgUp', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: Array.from({ length: 120 }, (_, i) => ({ service: `svc-${i}`, outcome: 'updated' })),
      edtsBranches: [],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    } as never);
    const stdout = new FakeTtyStdout();
    stdout.columns = 100;
    stdout.rows = 30;
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(UpdateZone, { useStore: store, initialRecap: true }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const last = () => stdout.output.slice(stdout.output.lastIndexOf('Last update'));
    const press = async (chunk: string) => {
      (stdin as unknown as { write: (c: string) => void }).write(chunk);
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
    };
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(last()).toContain('svc-0 ');
      expect(last()).not.toContain('svc-60 ');
      for (let i = 0; i < 5; i += 1) await press(KEYS.pageDown);
      expect(last()).toContain('▲');
      expect(last()).not.toContain('svc-0 ');
      await press(KEYS.pageUp);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
