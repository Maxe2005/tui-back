// tui/shared/heal-dialog: the Dashboard's Heal overlay (`H`). Confirm lists the targets then the
// skipped services with their reasons, with a switchable mode; Enter runs the heal and the rows go
// live through the shared SwitchRestartReport, then the summary shows non-green first. Esc during
// the run asks before hiding it (the run keeps going). Decisions live in heal-dialog.logic.ts; the
// state in the store's heal slice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from './hooks/use-input.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import { useBounds } from './bounds/bounds-context.js';
import { ModalDialog } from './components/modal-dialog.js';
import { RestartModeSelector } from './components/restart-mode-selector.js';
import { ClampedParagraph } from './components/truncated-text.js';
import { colors } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import { SwitchRestartReport } from '../zones/edts/dialogs/switch-restart-report.js';
import { HEAL_CONFIRM_CLOSE_TEXT, HEAL_MODES, describeHealPlan, healFooterContext, healView, resolveHealKey } from './heal-dialog.logic.js';

// Modal frame: border, padding, title, separator and the PgUp/PgDn line.
const MODAL_CHROME_ROWS = 7;
// The EDT line and the plan summary line.
const HEADER_ROWS = 2;
// The mode selector: its top margin, title, choices and hint (DimAnnotation, up to 3 lines).
const SELECTOR_ROWS = 6;
// The report's own header line.
const REPORT_HEADER_ROWS = 1;
// The confirm-close prompt (ClampedParagraph, up to 3 lines).
const CONFIRM_CLOSE_ROWS = 3;
const ERROR_MAX_ROWS = 4;

// The restart list's row budget for each view, so the overlay never outgrows its region.
export function healListBudget(regionRows: number, view: 'confirm' | 'running' | 'confirm-close' | 'done'): number {
  const chrome =
    MODAL_CHROME_ROWS +
    HEADER_ROWS +
    REPORT_HEADER_ROWS +
    (view === 'confirm' ? SELECTOR_ROWS : 0) +
    (view === 'confirm-close' ? CONFIRM_CLOSE_ROWS : 0);
  return Math.max(1, regionRows - chrome);
}

export function HealDialog({
  useStore = useAppStore,
  onClose = () => {},
  initial = {},
}: {
  useStore?: AppStore;
  onClose?: () => void;
  // The local state's starting point, for fixtures; the shell always opens on the defaults.
  initial?: { confirmingClose?: boolean };
}) {
  const run = useStore((state) => state.healRun);
  const bounds = useBounds();
  // Read by the key handler between renders: Ink can deliver several keys before a re-render.
  const [confirmingClose, setConfirmingCloseState] = useState(initial.confirmingClose ?? false);
  const confirmingRef = useRef(confirmingClose);
  const setConfirmingClose = useCallback((next: boolean) => {
    confirmingRef.current = next;
    setConfirmingCloseState(next);
  }, []);
  const running = run?.status === 'running';

  // The run ended on its own while the prompt was up: nothing left to confirm.
  useEffect(() => {
    if (!running) {
      setConfirmingClose(false);
    }
  }, [running, setConfirmingClose]);

  const view = healView(run, confirmingClose);

  useInput((input, key) => {
    const state = useStore.getState();
    const current = healView(state.healRun, confirmingRef.current);
    if (current === null) {
      return;
    }
    const action = resolveHealKey(input, key, current);
    switch (action.type) {
      case 'close':
        setConfirmingClose(false);
        onClose();
        return;
      case 'toggle-mode':
        state.toggleHealMode();
        return;
      case 'confirm':
        void state.startHeal();
        return;
      case 'confirm-close':
        setConfirmingClose(true);
        return;
      case 'keep-open':
        setConfirmingClose(false);
        return;
      case 'ignore':
        return;
    }
  });

  useFooterContext('heal', view === null ? null : healFooterContext(view), useStore);

  if (run === null || view === null) {
    return null;
  }
  let body;
  if (view === 'error') {
    body = (
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">Heal not run.</Text>
        <ClampedParagraph color={colors.error} maxLines={ERROR_MAX_ROWS}>{run.error ?? 'The heal could not run.'}</ClampedParagraph>
      </Box>
    );
  } else {
    const topic = run.plan?.edt.topic ?? '';
    body = (
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">{`EDT: ${topic}`}</Text>
        <Text color={colors['text-dim']} wrap="truncate-end">{describeHealPlan(run.plan?.rows ?? run.rows)}</Text>
        {view === 'confirm' ? (
          <RestartModeSelector mode={run.mode} modes={HEAL_MODES} title="Mode de redémarrage" keysHint="←/→ ou Espace pour changer (ce heal seulement)." />
        ) : null}
        <SwitchRestartReport
          state={{
            topic,
            mode: run.mode,
            // The confirm list keeps the plan order (targets first), like a live run.
            status: view === 'done' ? 'done' : 'running',
            rows: run.rows,
            report: run.report,
            error: null,
          }}
          maxVisibleRows={healListBudget(bounds.rows, view)}
          {...(view === 'confirm' ? { heading: `Services to restart (${run.mode})` } : {})}
        />
        {view === 'confirm-close' ? <ClampedParagraph color={colors.warning} maxLines={CONFIRM_CLOSE_ROWS}>{HEAL_CONFIRM_CLOSE_TEXT}</ClampedParagraph> : null}
      </Box>
    );
  }

  return (
    <ModalDialog title="HEAL" open={true}>
      <Box flexDirection="column">{body}</Box>
    </ModalDialog>
  );
}
