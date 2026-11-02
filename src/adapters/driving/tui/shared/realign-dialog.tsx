// tui/shared/realign-dialog: the global realign overlay (`:realign`, or `A` on the Dashboard). It
// lists the drifted services in a checkbox table with presets and a restart selector, runs the
// selection with live per-service rows, then shows the summary, non-green first. Decisions live
// in realign-dialog.logic.ts; the state in the store's realign slice.
import { Box, Text } from 'ink';
import { useInput } from './hooks/use-input.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import { useBounds } from './bounds/bounds-context.js';
import { BoundedList } from './components/bounded-list.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { ModalDialog } from './components/modal-dialog.js';
import { RestartModeSelector } from './components/restart-mode-selector.js';
import { StateLine } from './components/state-line.js';
import { ClampedParagraph } from './components/truncated-text.js';
import { colors } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import { matchingPreset } from '../store/slices/realign-slice.js';
import { BranchPlanTable } from '../zones/edts/dialogs/branch-plan-table.js';
import { SwitchRestartReport } from '../zones/edts/dialogs/switch-restart-report.js';
import {
  REALIGN_ALIGNED_MESSAGE,
  REALIGN_NO_SELECTION_MESSAGE,
  REALIGN_PRESET_LABELS,
  REALIGN_PRESET_ORDER,
  REALIGN_STATUS_BADGES,
  describeRealignRow,
  describeRealignSummary,
  nextRealignPreset,
  orderRealignRows,
  realignCells,
  realignFooterContext,
  realignView,
  resolveRealignKey,
} from './realign-dialog.logic.js';

// Rows the selection view spends around its table: border and title, presets, header, the
// restart selector and its hint, the empty-selection note.
const SELECT_CHROME_ROWS = 14;
// Rows the run view spends around its realign list and around the restart report's list.
const RUN_CHROME_ROWS = 10;
const RESTART_REPORT_CHROME_ROWS = 14;

export const REALIGN_TABLE_HEADERS = ['Service', 'Branche actuelle', 'Branche attendue', 'Type'] as const;

export function RealignDialog({ useStore = useAppStore, onClose = () => {} }: { useStore?: AppStore; onClose?: () => void }) {
  const candidates = useStore((state) => state.realignCandidates);
  const draft = useStore((state) => state.realignDraft);
  const run = useStore((state) => state.realignRun);
  const bounds = useBounds();
  const view = realignView(candidates, run);
  const rows = candidates?.rows ?? [];
  const selected = new Set(draft.selected);

  useInput((input, key) => {
    const state = useStore.getState();
    const current = realignView(state.realignCandidates, state.realignRun);
    const listed = state.realignCandidates?.rows ?? [];
    const action = resolveRealignKey(input, key, {
      view: current,
      runStatus: state.realignRun?.status ?? null,
      cursor: state.realignDraft.cursor,
      rowCount: listed.length,
      selectedCount: state.realignDraft.selected.length,
    });
    switch (action.type) {
      case 'close':
        onClose();
        return;
      case 'move':
        state.moveRealignCursor(action.cursor);
        return;
      case 'toggle': {
        const row = listed[state.realignDraft.cursor];
        if (row !== undefined) {
          state.toggleRealignRow(row.path);
        }
        return;
      }
      case 'preset':
        state.applyRealignPreset(nextRealignPreset(matchingPreset(listed, state.realignDraft.selected)));
        return;
      case 'restart':
        state.cycleRealignRestartMode(action.direction);
        return;
      case 'confirm':
        void state.runRealign();
        return;
      case 'ignore':
        return;
    }
  });

  useFooterContext('realign', realignFooterContext(view, run?.status ?? null, draft.selected.length), useStore);

  let body;
  if (view === 'loading') {
    body = <StateLine kind="loading" subject="drifted services" />;
  } else if (view === 'error') {
    body = <ClampedParagraph color={colors.error} maxLines={4}>{candidates?.error ?? 'Could not list the drifted services.'}</ClampedParagraph>;
  } else if (view === 'empty') {
    body = <ClampedParagraph color={colors.success} maxLines={2}>{`✔ ${REALIGN_ALIGNED_MESSAGE}`}</ClampedParagraph>;
  } else if (view === 'select') {
    const preset = matchingPreset(rows, draft.selected);
    body = (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={colors.text}>Préréglage : </Text>
          {REALIGN_PRESET_ORDER.map((value) => (
            <Text key={value} color={value === preset ? colors.accent : colors['text-dim']} wrap="truncate-end">
              {value === preset ? '(•)' : '( )'} {REALIGN_PRESET_LABELS[value]}
              {'   '}
            </Text>
          ))}
        </Text>
        <BranchPlanTable
          headers={REALIGN_TABLE_HEADERS}
          rows={rows}
          rowKey={(row) => row.path}
          cells={(row) => realignCells(row, selected.has(row.path))}
          cursor={draft.cursor}
          focused
          maxVisibleRows={Math.max(1, bounds.rows - SELECT_CHROME_ROWS)}
          labels={{ moreAbove: 'more services above', moreBelow: 'more services below' }}
        />
        <RestartModeSelector mode={draft.restartMode} title="Redémarrer les services après le realign" keysHint="←/→ pour changer (ce realign seulement)." />
        {draft.selected.length === 0 ? <DimAnnotation text={REALIGN_NO_SELECTION_MESSAGE} /> : null}
      </Box>
    );
  } else if (run !== null) {
    const running = run.status === 'running';
    // Live: stable run order. Done: non-green first.
    const listedRows = running ? run.rows : orderRealignRows(run.rows);
    const showRestart = run.restartMode !== 'none' && (run.restartRows.length > 0 || run.restartError !== null);
    body = (
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">
          {running ? 'Realigning services…' : run.status === 'error' ? 'Realign not run.' : `Realign finished: ${describeRealignSummary(run.rows)}`}
        </Text>
        {run.error !== null ? <ClampedParagraph color={colors.error} maxLines={4}>{run.error}</ClampedParagraph> : null}
        <BoundedList
          items={listedRows}
          chromeRows={RUN_CHROME_ROWS + (showRestart ? RESTART_REPORT_CHROME_ROWS : 0)}
          renderItem={(row, index) => (
            <Text key={`${row.path}:${index}`} color={REALIGN_STATUS_BADGES[row.status].color} wrap="truncate-end">
              {'  '}
              {describeRealignRow(row)}
            </Text>
          )}
        />
        {showRestart ? (
          <SwitchRestartReport
            state={{
              topic: '',
              mode: run.restartMode === 'clean' ? 'clean' : 'simple',
              status: running ? 'running' : 'done',
              rows: run.restartRows,
              report: null,
              error: run.restartError,
            }}
            chromeRows={RESTART_REPORT_CHROME_ROWS + RUN_CHROME_ROWS}
          />
        ) : null}
      </Box>
    );
  }

  return (
    <ModalDialog title="REALIGN" open={true}>
      <Box flexDirection="column">{body}</Box>
    </ModalDialog>
  );
}
