// Bugfix (story 2.21 follow-up #2): ListDetailSplit's `list`/`detail` wrapper Boxes had no
// `flexBasis`/`minWidth`/`overflow` — Yoga's default "a flex item's minimum size is its own
// content size" (the exact trap edts-zone.tsx's internal EDTS/EDT-SERVICES/OTHER-SERVICES
// sub-splits were already fixed against, see edts-zone.layout.test.tsx) meant a long unbroken
// run of content in either pane refused to shrink to its ratio share and blew straight through
// the splitter into the other pane's space — the real-world symptom reported after 2.21 shipped
// ("pane size is dictated by its own content, not the splitter position"), and the actual reason
// that follow-up fix (96050cb, scoped only to edts-zone.tsx's *internal* vertical sub-splits)
// didn't resolve it: ListDetailSplit's own outer list<->detail split — the one every zone
// (EDTs, dashboard, routes, logs, shared-types, update) actually renders through — was never
// touched.
//
// Confirmed with a standalone repro before landing the fix: an 80-col container, ratio 0.4, a
// 200-char unbroken word in one pane and the literal word "short" in the other — pre-fix, the
// long pane's content refused to shrink to its ~31-col share, so the *other* pane's "short" got
// squeezed down to a sliver ("shor" on one row, "t" wrapped onto the next — Ink's own word-wrap,
// forced by real starvation of the other pane's width). Post-fix, "short" always renders whole,
// on one line, at its own pane's ratio share.
import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';

describe('ListDetailSplit list/detail widths are content-independent (post-2.21 bugfix #2)', () => {
  it('never squeezes the other pane\'s short content when one pane holds a long unbroken run of content', async () => {
    const { renderToString } = await import('./render-to-string.js');
    const { ListDetailSplit } = await import('./list-detail-split.js');

    const longWord = 'X'.repeat(200);
    const longPane = (
      <Box>
        <Text>{longWord}</Text>
      </Box>
    );
    const shortPane = (
      <Box>
        <Text>short</Text>
      </Box>
    );

    const renderWithLongContentIn = (side: 'list' | 'detail') =>
      renderToString(
        <Box width={80} height={20}>
          <ListDetailSplit
            ratio={0.4}
            list={side === 'list' ? longPane : shortPane}
            detail={side === 'detail' ? longPane : shortPane}
          />
        </Box>,
      );

    // The full word — never split across a line break by the other pane's overflow starving it
    // of width (the pre-fix regression: "short" rendered as "shor" + a wrapped "t").
    expect(await renderWithLongContentIn('list')).toContain('short');
    expect(await renderWithLongContentIn('detail')).toContain('short');
  });
});
