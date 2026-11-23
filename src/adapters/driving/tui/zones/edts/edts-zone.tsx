// tui/zones/edts: the EDTs zone — an EDT selector with its dialogs (create wizard, switch,
// modify, delete, quick-pick, service actions) above the EDT SERVICES / OTHER SERVICES lists,
// all Tab-cycled panes, driving core/edt use-cases in-process (AD-2). This file only composes the
// layers: state → derived → handlers → effects → one `useInput` dispatcher (use-edts-input.ts);
// the render lives in edts-list-column / edts-detail-column / edts-dialog-views. Every keystroke
// decision is a pure function in edts-zone.logic.ts; DetailPane takes only Text-safe content
// (UX-DR17), so a git-error detail renders as a DimAnnotation sibling.
import { Box } from 'ink';
import { ZoneLayout } from '../../shared/components/layout/zone-layout.js';
import { colors } from '../../shared/theme/theme.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { EdtsDetailColumn } from './views/edts-detail-column.js';
import { EdtsDialogViews } from './views/edts-dialog-views.js';
import { EdtsListColumn } from './views/edts-list-column.js';
import type { InitialDialogKind } from './logic/edts-zone.dialog-seed.js';
import type { EdtsZoneCtx } from './edts-zone.ctx.js';
import type { PaneFocus } from './logic/edts-zone.logic.js';
import { useEdtsDerived } from './hooks/use-edts-derived.js';
import { useEdtsDialogEffects } from './hooks/use-edts-dialog-effects.js';
import { useEdtsEffects } from './hooks/use-edts-effects.js';
import { createEdtsHandlers } from './hooks/use-edts-handlers.js';
import { useEdtsInput } from './hooks/use-edts-input.js';
import { useEdtsState } from './hooks/use-edts-state.js';

export function EdtsZone({
  useStore = useAppStore,
  // Test-only injection point (like `useStore` above): renderToString's fake stdin never emits a
  // real keypress, so a smoke test can't Tab its way to the SERVICES pane. Production always
  // starts on 'edts' — the EDT selector.
  initialPaneFocus = 'edts',
  // Test-only injection point: renderToString performs one synchronous render-then-unmount pass
  // and never observes a *second*, effect-triggered commit — so a smoke test can't rely on the
  // "zero EDTs auto-opens the create dialog" effect having run. The interaction tests exercise
  // that effect through a real Ink render loop; this prop only seeds the same initial state.
  // Production always starts with no dialog open.
  initialDialogKind,
}: {
  useStore?: AppStore;
  initialPaneFocus?: PaneFocus;
  initialDialogKind?: InitialDialogKind;
}) {
  const state = useEdtsState(useStore, initialPaneFocus, initialDialogKind);
  const derived = useEdtsDerived(state);
  const base = { ...state, ...derived };
  const c: EdtsZoneCtx = { useStore, ...base, ...createEdtsHandlers(useStore, base) };
  useEdtsEffects(c);
  useEdtsDialogEffects(c);
  useEdtsInput(c);

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ZoneLayout
        zoneId="edts"
        useStore={useStore}
        first={<EdtsListColumn c={c} />}
        second={<EdtsDetailColumn c={c} />}
      />
      <EdtsDialogViews c={c} />
    </Box>
  );
}
