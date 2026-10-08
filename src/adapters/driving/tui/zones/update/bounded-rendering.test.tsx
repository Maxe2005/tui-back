// The Update zone's stream-fed issue log is capped with an "older hidden" line; its detail text
// never exceeds the pane.
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { BoundsProvider } from '../../shared/bounds/bounds-context.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { frameLines } from '../../shared/test-support/matrix.js';
import { UpdateServiceDetail } from './update-service-detail.js';

describe('Update zone bounded rendering', () => {
  it('caps a 300-issue log to the newest entries with an older-hidden count', async () => {
    const issues = Array.from({ length: 300 }, (_, i) => ({ kind: 'conflict', detail: `issue number ${i}\n${'long '.repeat(200)}`, resolved: i % 2 === 0 }));
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
});
