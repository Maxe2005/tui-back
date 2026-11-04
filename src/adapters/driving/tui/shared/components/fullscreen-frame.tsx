// tui/shared/components: the outer container of a fullscreen output view (the Logs fullscreen
// preview, the Terminal view) — fills the zone's area, clips anything past it, and applies the
// standard horizontal pane padding. Open/close state stays with the caller's store.
import type { ReactNode } from 'react';
import { Box } from 'ink';
import { spacing } from '../theme/theme.js';

export function FullscreenFrame({ children }: { children?: ReactNode }) {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      {children}
    </Box>
  );
}
