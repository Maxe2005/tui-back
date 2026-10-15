// tui/zones/dashboard: the fixed launch banner, then the registry-error / empty-registry prompt
// (checked first) or the snapshot sections. The registry check re-runs on mount and whenever the
// registry screen's open flag flips (the zone never remounts); the snapshot loads on mount and
// on `R`, and re-loads when the active EDT changes. Up/Down move the row cursor, Ctrl+O/R/L run
// the focused row's registry actions, Enter opens it in its zone, `a` steps through the Attention
// lines and lands the cursor on the line's service. Overlays make the zone inert.
import { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { useInput } from '../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../shared/hooks/use-zone-input-active.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { DashboardBody } from './dashboard-body.js';
import { nextCursorForKey } from '../../shared/keys/list-cursor.js';
import { actionForKey, buildAttentionItems, nextAttentionIndex, resolveDashboardBody, rowIndexForAttention } from './dashboard.logic.js';
import { LaunchBanner } from './launch-banner.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';

export const EMPTY_REGISTRY_MESSAGE = 'No repos registered yet.';
export const EMPTY_REGISTRY_HINT = 'Press [:] to scan a root path and register repos.';
// A registry.list() failure (e.g. a corrupt registry.yaml) renders its own error branch rather
// than silently falling through to whatever registryEmpty last was.
export const REGISTRY_CHECK_ERROR_MESSAGE = 'Failed to check the repo registry.';

// Used only while the registry's action list is not loaded (unwired ports): the key still
// reaches the store, which reports the missing port inline.
const FALLBACK_ACTION_IDS: Record<string, string> = { o: 'open-in-ide', r: 'restart-simple', l: 'restart-clean' };

export function DashboardZone({
  useStore = useAppStore,
}: {
  useStore?: AppStore;
}) {
  const registryEmpty = useStore((state) => state.registryEmpty);
  const registryEmptyStatus = useStore((state) => state.registryEmptyStatus);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const checkRegistryEmpty = useStore((state) => state.checkRegistryEmpty);
  const loadDashboard = useStore((state) => state.loadDashboard);
  const activeEdt = useStore((state) => state.activeEdt);
  const servicesSection = useStore((state) => state.dashboardServices);
  const updatedAt = useStore((state) => state.dashboardUpdatedAt);
  const loadServiceActions = useStore((state) => state.loadDashboardServiceActions);
  const runServiceAction = useStore((state) => state.runDashboardServiceAction);
  const openServiceInZone = useStore((state) => state.openServiceInZone);
  const [cursor, setCursor] = useState(0);
  const [attentionPick, setAttentionPick] = useState<number | null>(null);
  const zoneInputActive = useZoneInputActive(useStore);

  useEffect(() => {
    void checkRegistryEmpty();
  }, [registryScreenOpen, checkRegistryEmpty]);

  const body = resolveDashboardBody(registryEmpty, registryEmptyStatus);
  const showSections = body === 'sections';

  // Nothing is probed behind the registry-error / empty-registry prompt.
  useEffect(() => {
    if (showSections) {
      void loadDashboard({ queueIfBusy: true });
    }
  }, [activeEdt, loadDashboard, showSections]);

  // A new EDT lists other services: the cursor starts over so a key never lands on a stranger.
  useEffect(() => {
    setCursor(0);
  }, [activeEdt]);

  const rows = servicesSection?.services ?? [];
  // Rows can shrink on reload: keep the stored cursor inside them.
  useEffect(() => {
    setCursor((current) => (rows.length === 0 ? 0 : Math.min(current, rows.length - 1)));
  }, [rows.length]);
  const focusedIndex = rows.length === 0 ? 0 : Math.min(cursor, rows.length - 1);
  const attentionItems = useMemo(() => buildAttentionItems(rows), [rows]);
  // The picked line only shows as selected while the cursor still sits on its service.
  const pickedItem = attentionPick === null ? undefined : attentionItems[attentionPick];
  const attentionIndex = pickedItem !== undefined && rows[focusedIndex]?.path === pickedItem.path ? attentionPick : null;
  useEffect(() => {
    setAttentionPick(null);
  }, [activeEdt, attentionItems.length]);
  const focusedPath = showSections ? rows[focusedIndex]?.path ?? null : null;

  // The focused row's actions (availability, lock names) are re-read when focus moves or the
  // rows reload; never on a timer.
  useEffect(() => {
    if (focusedPath !== null) {
      void loadServiceActions(focusedPath);
    }
  }, [focusedPath, updatedAt, loadServiceActions]);

  useInput(
    (input, key) => {
      if (key.ctrl === true) {
        // Ctrl+<letter> runs the registry action bound to that key on the focused row.
        if (focusedPath === null) {
          return;
        }
        const actions = useStore.getState().dashboardServiceActions[focusedPath];
        const action = actionForKey(actions ?? [], input);
        const id = action !== undefined ? (action.availability.available ? action.id : null) : actions === undefined ? FALLBACK_ACTION_IDS[input] : null;
        if (id !== undefined && id !== null) {
          void runServiceAction(focusedPath, id);
        }
        return;
      }
      if (key.meta === true) {
        return;
      }
      if (input === 'R') {
        void loadDashboard();
        return;
      }
      if (input === 'a') {
        const pick = nextAttentionIndex(attentionPick, attentionItems.length);
        const target = pick === null ? -1 : rowIndexForAttention(rows, attentionItems[pick]!);
        if (pick !== null && target >= 0) {
          setAttentionPick(pick);
          setCursor(target);
        }
        return;
      }
      if (focusedPath === null) {
        return;
      }
      const next = nextCursorForKey(key, focusedIndex, rows.length);
      if (next !== null) {
        setCursor(next);
        return;
      }
      if (key.return === true) {
        openServiceInZone(focusedPath);
      }
    },
    { isActive: zoneInputActive },
  );


  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      {/* Rendered unconditionally — the banner is permanent on every Dashboard render, above
          whatever content follows. */}
      <LaunchBanner />
      {body === 'registry-error' ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <ClampedParagraph color={colors.error} maxLines={4}>{`${REGISTRY_CHECK_ERROR_MESSAGE}`}</ClampedParagraph>
        </Box>
      ) : body === 'empty-registry' ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <ClampedParagraph color={colors.text} maxLines={4}>{`${EMPTY_REGISTRY_MESSAGE}`}</ClampedParagraph>
          <DimAnnotation text={EMPTY_REGISTRY_HINT} />
        </Box>
      ) : (
        <DashboardBody useStore={useStore} cursor={focusedIndex} attentionItems={attentionItems} attentionIndex={attentionIndex} />
      )}
    </Box>
  );
}
