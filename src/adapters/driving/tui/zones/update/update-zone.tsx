// tui/zones/update: the Update zone (story 3.1) — the TUI face of the EDT-scoped group
// update. Enter starts the same core/scripts/group-update.ts use-case the CLI's
// `tui-back update` wraps, in-process via the store slice (AD-2, never by shelling out to
// the CLI). Idle shows the last outcome, the zero-member no-op message, or the interrupted
// re-run offer; a run shows a per-service spinner; the outcome summary follows. `q`
// mid-run requires confirmation via a ModalDialog — on confirm the EDT is marked
// `interrupted` and the app quits (AppShell's quitRequested handoff); the next idle render
// offers a re-run.
//
// Every keystroke behavior is a standalone pure function below, unit-tested directly — the
// `useInput` callback stays a thin dispatcher over them (the edts-zone.tsx convention:
// the shared renderToString harness's fake stdin never emits data, so a useInput callback
// itself is never invoked by any test in the repo).
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GroupUpdateRepoResult } from '../../../../../core/scripts/group-update.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DetailPane, ModalDialog, Spinner, type SummaryTone } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';

export const UPDATE_IDLE_PROMPT = 'Press [Enter] to bring every member service up to date.';
export const UPDATE_INTERRUPTED_OFFER = 'The last update was interrupted — press [Enter] to re-run it.';
export const UPDATE_RUNNING_LABEL = 'Updating member services…';
export const UPDATE_LOADING_MEMBERS = 'Loading member services…';
export const UPDATE_QUIT_CONFIRM_TITLE = 'QUIT MID-RUN';
export const UPDATE_QUIT_CONFIRM_BODY = 'A group update is in progress. Quit and mark this EDT interrupted? ([y]/[n])';

// Collapses a detail message to one line — git/runtime stderr is multi-line, and a row is
// always exactly one rendered line.
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// A per-service outcome row — glyph always paired with the outcome word (never color
// alone), followed by the kebab-case code and the human detail message.
export function formatUpdateRow(row: GroupUpdateRepoResult): string {
  switch (row.outcome) {
    case 'updated':
      return `✔ ${row.service} — updated`;
    case 'skipped': {
      const code = row.detail?.code ?? 'skipped';
      const message = row.detail?.message !== undefined ? `: ${oneLine(row.detail.message)}` : '';
      return `○ ${row.service} — skipped (${code})${message}`;
    }
    case 'failed': {
      const code = row.detail?.code ?? 'failed';
      const message = row.detail?.message !== undefined ? `: ${oneLine(row.detail.message)}` : '';
      return `✖ ${row.service} — failed (${code})${message}`;
    }
  }
}

export function resolveUpdateTone(results: readonly GroupUpdateRepoResult[]): SummaryTone {
  if (results.some((row) => row.outcome === 'failed')) {
    return 'error';
  }
  if (results.some((row) => row.outcome === 'skipped')) {
    return 'warning';
  }
  return 'success';
}

// The DetailPane summary line for a finished run: every targeted service is named by count
// with an outcome from the closed set — none silently absent.
export function formatUpdateSummary(topic: string, results: readonly GroupUpdateRepoResult[]): string {
  const updated = results.filter((row) => row.outcome === 'updated').length;
  const skipped = results.filter((row) => row.outcome === 'skipped').length;
  const failed = results.filter((row) => row.outcome === 'failed').length;
  return `EDT "${topic}": ${updated} updated, ${skipped} skipped, ${failed} failed.`;
}

// The next idle render offers a re-run when the active EDT entry carries `interrupted`
// (an abandoned run) — a re-run is a true resume in effect because applied merges are
// no-ops.
export function shouldOfferRerun(
  edts: readonly EdtRegistryEntry[] | null,
  activeEdt: string | null,
): boolean {
  if (edts === null || activeEdt === null) {
    return false;
  }
  return edts.some((entry) => entry.ulid === activeEdt && entry.status === 'interrupted');
}

export function shouldConfirmQuit(input: string, updateStatus: string): boolean {
  return input === 'q' && updateStatus === 'running';
}

export type QuitConfirmDecision = 'confirm' | 'cancel';

export function resolveQuitConfirm(input: string, key: { return?: boolean; escape?: boolean }): QuitConfirmDecision | null {
  if (input === 'y' || input === 'Y' || key.return === true) {
    return 'confirm';
  }
  if (input === 'n' || input === 'N' || key.escape === true) {
    return 'cancel';
  }
  return null;
}

export function UpdateZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const updateStatus = useStore((state) => state.updateStatus);
  const updateResults = useStore((state) => state.updateResults);
  const updateNote = useStore((state) => state.updateNote);
  const updateTopic = useStore((state) => state.updateTopic);
  const updateError = useStore((state) => state.updateError);
  const updateErrorCode = useStore((state) => state.updateErrorCode);
  const runGroupUpdate = useStore((state) => state.runGroupUpdate);
  const markUpdateInterrupted = useStore((state) => state.markUpdateInterrupted);
  const activeEdt = useStore((state) => state.activeEdt);
  const edts = useStore((state) => state.edts);
  const requestQuit = useStore((state) => state.requestQuit);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const resizeMode = useStore((state) => state.resizeMode);

  const [quitConfirm, setQuitConfirm] = useState(false);

  // While the quit-confirm dialog owns the keystroke, every global shortcut (including `?`
  // help and the zone mnemonics) must not fire — the same zoneInputCaptured gate the EDTs
  // zone's own dialogs use.
  useEffect(() => {
    setZoneInputCaptured(quitConfirm);
  }, [quitConfirm, setZoneInputCaptured]);

  useInput(
    (input, key) => {
      if (quitConfirm) {
        const decision = resolveQuitConfirm(input, key);
        if (decision === 'confirm') {
          setQuitConfirm(false);
          void markUpdateInterrupted().then(() => requestQuit());
        } else if (decision === 'cancel') {
          setQuitConfirm(false);
        }
        return;
      }
      if (updateStatus === 'running') {
        if (shouldConfirmQuit(input, updateStatus)) {
          setQuitConfirm(true);
        }
        return;
      }
      if (key.return) {
        void runGroupUpdate();
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode },
  );

  // The active EDT's own membership — the per-service spinner rows during a run, before the
  // core use-case resolves with its per-service outcome rows.
  const runningMembers = edts?.find((entry) => entry.ulid === activeEdt)?.members ?? [];
  const offerRerun = shouldOfferRerun(edts, activeEdt);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={spacing['pane-padding-x']}>
      <Text color={colors['text-dim']}>UPDATE</Text>
      {updateStatus === 'running' ? (
        <Box flexDirection="column">
          <Box>
            <Spinner />
            <Text color={colors.text}> {UPDATE_RUNNING_LABEL}</Text>
          </Box>
          {runningMembers.length === 0 ? (
            <Text color={colors['text-dim']}>{UPDATE_LOADING_MEMBERS}</Text>
          ) : (
            runningMembers.map((member) => (
              <Box key={member.repoPath}>
                <Spinner />
                <Text color={colors.text}> {member.service} ({member.branch})</Text>
              </Box>
            ))
          )}
        </Box>
      ) : null}
      {updateStatus === 'done' && updateTopic !== null ? (
        // The zero-member no-op carries its note as the primary outcome line — rendering
        // the success-toned `0 updated, 0 skipped, 0 failed` counts DetailPane for it
        // would overstate a no-op as a result.
        updateNote !== null && updateResults.length === 0 ? (
          <Box flexDirection="column">
            <Text color={colors.text}>{updateNote}</Text>
            <Text color={colors['text-dim']}>Press [Enter] to run again.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {updateResults.map((row, index) => (
              // Duplicate service names occur within one EDT — key by service + index so
              // React never drops a same-named row.
              <Text key={`${row.service}-${index}`} color={colors.text}>
                {formatUpdateRow(row)}
              </Text>
            ))}
            <DetailPane
              title="Group update"
              summary={{ tone: resolveUpdateTone(updateResults), text: formatUpdateSummary(updateTopic, updateResults) }}
            >
              {updateNote ?? `Press [Enter] to run again.`}
            </DetailPane>
          </Box>
        )
      ) : null}
      {updateStatus === 'error' ? (
        <Box flexDirection="column">
          <Text color={colors.error}>
            {updateError ?? 'Group update failed.'}
            {updateErrorCode !== null ? ` (code: ${updateErrorCode})` : ''}
          </Text>
          <Text color={colors['text-dim']}>Press [Enter] to try again.</Text>
        </Box>
      ) : null}
      {updateStatus === 'idle' ? (
        <Box flexDirection="column">
          <Text color={colors.text}>{offerRerun ? UPDATE_INTERRUPTED_OFFER : UPDATE_IDLE_PROMPT}</Text>
        </Box>
      ) : null}
      <ModalDialog title={UPDATE_QUIT_CONFIRM_TITLE} open={quitConfirm} onConfirm={() => {}} onCancel={() => setQuitConfirm(false)}>
        <Text color={colors.text}>{UPDATE_QUIT_CONFIRM_BODY}</Text>
      </ModalDialog>
    </Box>
  );
}
