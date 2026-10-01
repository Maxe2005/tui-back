// The EDT zone's list column stacks 3 fixed-but-movable regions (EDTS / EDT SERVICES / OTHER
// SERVICES). Without explicit `flexBasis`/`minHeight`/`overflow` on each sub-pane's Box, Yoga's
// default (a flex item's minimum size is its content size) lets a pane with more rows than its
// ratio share grow past it and drag the boundaries down — position must not move with content
// volume (from 0 to 100+ rows, only with all three props present).
import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';

function edtEntry(topic: string): EdtRegistryEntry {
  return {
    ulid: `01J${topic.toUpperCase().padEnd(23, 'A')}`,
    topic,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [],
  };
}

const noopAsync = async () => {};

describe('EdtsZone list-column boundary positions are content-independent (post-2.21 bugfix)', () => {
  it('keeps the OTHER SERVICES label on the same row whether the EDTS pane has 1 or 30 entries', async () => {
    const { renderToString } = await import('../../shared/components/render-to-string.js');
    const { createAppStore } = await import('../../store/app-store.js');
    const { EdtsZone } = await import('./edts-zone.js');

    const renderWithEdtCount = async (count: number) => {
      const store = createAppStore();
      store.setState({
        edts: Array.from({ length: count }, (_, i) => edtEntry(`edt-${i}`)),
        edtsStatus: 'idle',
        activeEdt: null,
        edtsBranches: [],
        edtsBranchesStatus: 'idle',
        loadEdts: noopAsync,
        loadEdtsBranches: noopAsync,
      });

      // EdtsZone's own root has `flexGrow={1}` but no ancestor here constrains height — in the
      // real app that comes from AppShell's `height={rows}` (app-shell.tsx). A fixed-height
      // wrapper is required for Yoga to actually have finite space to allocate/clip against,
      // which is exactly the condition under which the reported bug (and this regression test)
      // manifests.
      const output = await renderToString(
        <Box height={24}>
          <EdtsZone useStore={store} />
        </Box>,
      );
      return output.split('\n').findIndex((line) => line.includes('OTHER SERVICES'));
    };

    const rowWithFewEdts = await renderWithEdtCount(1);
    const rowWithManyEdts = await renderWithEdtCount(30);

    expect(rowWithFewEdts).toBeGreaterThanOrEqual(0);
    expect(rowWithManyEdts).toBeGreaterThanOrEqual(0);
    expect(rowWithFewEdts).toBe(rowWithManyEdts);
  });
});
