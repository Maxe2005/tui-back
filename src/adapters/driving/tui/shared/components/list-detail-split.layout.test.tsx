// Without `flexBasis`/`minWidth`/`overflow` on the `list`/`detail` wrapper Boxes, Yoga's
// default (a flex item's minimum size is its content size) lets a long unbroken run of content
// in one pane refuse to shrink to its ratio share and starve the other pane. Repro: an 80-col
// container, ratio 0.4, a 200-char word in one pane and "short" in the other — "short" must
// render whole, on one line, at its own pane's share.
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
    // of width ("short" rendered as "shor" + a wrapped "t").
    expect(await renderWithLongContentIn('list')).toContain('short');
    expect(await renderWithLongContentIn('detail')).toContain('short');
  });
});
