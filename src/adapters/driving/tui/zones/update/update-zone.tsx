// tui/zones/update: the Update zone — runs core group-update in-process (AD-2) behind a pre-run
// configuration screen, with an always-visible service list (live health, last outcome, live
// phase and issue log). Dirty/conflicted repos pause the run on a bounded menu (stash / open in
// editor / cancel repo / cancel run); `q` mid-run asks to confirm and marks the EDT interrupted.
// This file only composes the layers: state → derived → effects → one `useInput` dispatcher
// (use-update-input.ts); the render lives in update-service-list-column / update-detail-column /
// update-zone-dialogs. Every keystroke decision is a pure function; useInput stays a thin dispatcher.
import { Box, Text } from 'ink';
import { ZoneLayout } from '../../shared/components/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { FullscreenReport } from './report/fullscreen-report.js';
import { UpdateDetailColumn } from './services/update-detail-column.js';
import { UpdateServiceListColumn } from './services/update-service-list-column.js';
import { UpdateZoneDialogs } from './update-zone-dialogs.js';
import type { UpdateZoneCtx } from './update-zone.ctx.js';
import { useUpdateDerived } from './hooks/use-update-derived.js';
import { useUpdateEffects } from './hooks/use-update-effects.js';
import { useUpdateInput } from './hooks/use-update-input.js';
import { useUpdateState } from './hooks/use-update-state.js';

// Public surface unchanged: everything the pure modules export is still importable from here.
export * from './logic/update-zone.resolvers.logic.js';
export * from './logic/update-zone.blockers.logic.js';

// The zone opens on the global recap view with no service focused (`initialRecap`); an arrow
// key focuses a service. Tests pass `initialRecap={false}` to start on a service.
export function UpdateZone({ useStore = useAppStore, initialRecap = true }: { useStore?: AppStore; initialRecap?: boolean }) {
  const state = useUpdateState(useStore, initialRecap);
  const derived = useUpdateDerived(state);
  const c: UpdateZoneCtx = { useStore, ...state, ...derived };
  useUpdateEffects(c);
  useUpdateInput(c);
  const { report, reportOffset, reportWrap, reportBudget, reportWidth, reportLayout } = c;

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      {/* Only the title line carries left padding — the outer Box stays unpadded so it doesn't
          double up the list/detail panes' own paddingX. */}
      {report !== null ? (
        <FullscreenReport lines={report.lines} offset={reportOffset} wrapLines={reportWrap} visibleLines={reportBudget} contentWidth={reportWidth} onLayout={(rows, columns) => { reportLayout.current = { rows, columns }; }} />
      ) : (
        <>
          <Box paddingX={spacing['pane-padding-x']}>
            <Text color={colors['text-dim']}>UPDATE</Text>
          </Box>
          <ZoneLayout zoneId="update" useStore={useStore} first={<UpdateServiceListColumn c={c} />} second={<UpdateDetailColumn c={c} />} />
        </>
      )}
      <UpdateZoneDialogs c={c} />
    </Box>
  );
}
