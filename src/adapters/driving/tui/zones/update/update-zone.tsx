// tui/zones/update: the Update zone (story 3.1) — the TUI face of the EDT-scoped group
// update. Enter starts the same core/scripts/group-update.ts use-case the CLI's
// `tui-back update` wraps, in-process via the store slice (AD-2, never by shelling out to
// the CLI). Idle shows the last outcome, the zero-member no-op message, or the interrupted
// re-run offer; a run shows a per-service spinner; the outcome summary follows. `q`
// mid-run requires confirmation via a ModalDialog — on confirm the EDT is marked
// `interrupted` and the app quits (AppShell's quitRequested handoff); the next idle render
// offers a re-run.
//
// Story 3.4 backs core's `onUpdateBlocker` seam here: a dirty/conflicted repo pauses the
// run on a bounded four-choice modal menu (stash / open in editor / cancel repo / cancel
// run) rendered as `ListRow`s. The editor spawn is driving-side only (`launchEditor`);
// every git write still goes through the core use-case (AD-1).
//
// Every keystroke behavior is a standalone pure function below, unit-tested directly — the
// `useInput` callback stays a thin dispatcher over them (the edts-zone.tsx convention:
// the shared renderToString harness's fake stdin never emits data, so a useInput callback
// itself is never invoked by any test in the repo).
import { spawnSync } from 'node:child_process';
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GroupUpdateRepoResult, UpdateBlocker } from '../../../../../core/scripts/group-update.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DetailPane, ListRow, ModalDialog, Spinner, type SummaryTone } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';

export const UPDATE_IDLE_PROMPT = 'Press [Enter] to bring every member service up to date.';
export const UPDATE_ALL_REPOS_PROMPT = 'Press [A] for all-repos maintenance mode (every managed repo).';
export const UPDATE_INTERRUPTED_OFFER = 'The last update was interrupted — press [Enter] to re-run it.';
export const UPDATE_RUNNING_LABEL = 'Updating member services…';
export const UPDATE_ALL_RUNNING_LABEL = 'Updating all managed repos…';
export const UPDATE_LOADING_MEMBERS = 'Loading member services…';
export const UPDATE_QUIT_CONFIRM_TITLE = 'QUIT MID-RUN';
export const UPDATE_QUIT_CONFIRM_BODY = 'A group update is in progress. Quit and mark this EDT interrupted? ([y]/[n])';
export const UPDATE_QUIT_CONFIRM_BODY_ALL = 'A group update is in progress. Quit without marking anything interrupted? ([y]/[n])';
export const UPDATE_ALL_CONFIRM_TITLE = 'ALL-REPOS UPDATE';
export const UPDATE_ALL_CONFIRM_BODY =
  'Update every managed repo (outside the active EDT too)? Press [Enter] to confirm, [Esc] to cancel.';

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
// with an outcome from the closed set — none silently absent. The all-repos scope renders
// its own title variant (no EDT topic to name).
export function formatUpdateSummary(topic: string, results: readonly GroupUpdateRepoResult[]): string {
  const updated = results.filter((row) => row.outcome === 'updated').length;
  const skipped = results.filter((row) => row.outcome === 'skipped').length;
  const failed = results.filter((row) => row.outcome === 'failed').length;
  if (topic === 'all-repos') {
    return `All repos: ${updated} updated, ${skipped} skipped, ${failed} failed.`;
  }
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

// The separate all-repos trigger: `a` while idle/done/error opens the confirm gate (never
// while a run is in flight — a second trigger is rejected by the core lock instead).
export function shouldOpenAllConfirm(input: string, updateStatus: string): boolean {
  return (input === 'a' || input === 'A') && updateStatus !== 'running';
}

export type AllConfirmDecision = 'confirm' | 'cancel';

// The all-repos modal gate: [Enter] confirms (the run starts), [Esc] cancels. Anything
// else is ignored so a stray keystroke never launches the wider-blast-radius run.
export function resolveAllConfirm(input: string, key: { return?: boolean; escape?: boolean }): AllConfirmDecision | null {
  if (key.return === true) {
    return 'confirm';
  }
  if (key.escape === true) {
    return 'cancel';
  }
  return null;
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

// Story 3.4: the assisted-resolution menu — the seam's four fixed choices rendered as
// `ListRow`s navigated like the EDT zone's `SERVICE_ACTION_MENU_ITEMS` (arrows/Home/End +
// Enter — the story 2.7 canonical contract; filterable-list widgets are overkill for four
// fixed rows). `Escape` answers `cancel-repo`: the least-destructive unblock (the repo is
// skipped, the rest of the run continues) so a stray keystroke never cancels the run.
export const UPDATE_BLOCKER_TITLE = 'UPDATE BLOCKED';

export const UPDATE_BLOCKER_MENU_ITEMS = Object.freeze([
  { value: 'stash', label: 'Stash changes and continue' },
  { value: 'edited', label: 'Open in editor — I resolved it by hand' },
  { value: 'cancel-repo', label: 'Cancel this repo (continue with the rest)' },
  { value: 'cancel-run', label: 'Cancel the whole run' },
] as const);

export type UpdateBlockerMenuValue = (typeof UPDATE_BLOCKER_MENU_ITEMS)[number]['value'];

// The modal body names the blocked service, its repo path, and the blocker kind —
// mid-merge/mid-rebase rows stress that the pre-existing state is reported, never
// auto-touched.
export function formatBlockerBody(blocker: UpdateBlocker): string {
  switch (blocker.kind) {
    case 'dirty-worktree':
      return `"${blocker.service}" has uncommitted changes (${blocker.repoPath}).`;
    case 'merge-conflict':
      return `"${blocker.service}" hit a merge conflict (${blocker.repoPath}).`;
    case 'mid-merge':
      return `"${blocker.service}" is already mid-merge from an earlier run (${blocker.repoPath}) — left as-is.`;
    case 'mid-rebase':
      return `"${blocker.service}" is already mid-rebase from an earlier run (${blocker.repoPath}) — rebases are never touched.`;
  }
}

export type BlockerMenuKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
};

export type BlockerMenuStep = { type: 'move'; cursor: number } | { type: 'choose'; choice: UpdateBlockerMenuValue } | { type: 'ignore' };

export function resolveBlockerMenuKey(input: string, key: BlockerMenuKey, cursor: number): BlockerMenuStep {
  const length = UPDATE_BLOCKER_MENU_ITEMS.length;
  if (key.home === true) {
    return { type: 'move', cursor: 0 };
  }
  if (key.end === true) {
    return { type: 'move', cursor: length - 1 };
  }
  if (key.upArrow === true) {
    return { type: 'move', cursor: Math.max(0, cursor - 1) };
  }
  if (key.downArrow === true) {
    return { type: 'move', cursor: Math.min(length - 1, cursor + 1) };
  }
  if (key.return === true) {
    const item = UPDATE_BLOCKER_MENU_ITEMS[cursor];
    if (item === undefined) {
      return { type: 'ignore' };
    }
    return { type: 'choose', choice: item.value };
  }
  if (key.escape === true) {
    return { type: 'choose', choice: 'cancel-repo' };
  }
  return { type: 'ignore' };
}

// Story 3.4: the driving-side editor launch — core only ever sees the `edited` choice,
// never an editor (AD-1: the TUI never calls a driven adapter; spawning the editor is
// driving-side only). Spawns `$EDITOR` (fallback `vi`) on the blocked repo with the
// terminal attached and waits for exit; the exit status is deliberately unread — core's
// re-verification is the gate (a no-op edit simply re-presents the menu). An `$EDITOR`
// value carries its own flags (`code --wait`, `emacs -nw`, ...) — the first
// whitespace-separated token is the binary, the rest are leading args with the blocked
// repo appended last.
export function launchEditor(repoPath: string): void {
  const configured = process.env.EDITOR?.trim();
  const [binary = 'vi', ...leading] = configured !== undefined && configured !== '' ? configured.split(/\s+/) : [];
  spawnSync(binary, [...leading, repoPath], { stdio: 'inherit' });
}

export function UpdateZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const updateStatus = useStore((state) => state.updateStatus);
  const updateResults = useStore((state) => state.updateResults);
  const updateNote = useStore((state) => state.updateNote);
  const updateTopic = useStore((state) => state.updateTopic);
  const updateError = useStore((state) => state.updateError);
  const updateErrorCode = useStore((state) => state.updateErrorCode);
  const updateScope = useStore((state) => state.updateScope);
  const updateBlocker = useStore((state) => state.updateBlocker);
  const resolveUpdateBlocker = useStore((state) => state.resolveUpdateBlocker);
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
  const [allConfirm, setAllConfirm] = useState(false);
  const [blockerCursor, setBlockerCursor] = useState(0);

  // While any dialog owns the keystroke, every global shortcut (including `?`
  // help and the zone mnemonics) must not fire — the same zoneInputCaptured gate the EDTs
  // zone's own dialogs use. The blocker menu captures hardest: while a repo waits, no
  // other zone key may fire at all.
  useEffect(() => {
    setZoneInputCaptured(quitConfirm || allConfirm || updateBlocker !== null);
  }, [quitConfirm, allConfirm, updateBlocker, setZoneInputCaptured]);

  // A newly raised blocker always opens the menu on its first row.
  useEffect(() => {
    if (updateBlocker !== null) {
      setBlockerCursor(0);
    }
  }, [updateBlocker]);

  useInput(
    (input, key) => {
      // Story 3.4: while a repo waits on the resolution seam, the menu owns every
      // keystroke — `q` must not open the quit-confirm underneath it (cancel the run
      // through the menu instead).
      if (updateBlocker !== null) {
        const step = resolveBlockerMenuKey(input, key, blockerCursor);
        if (step.type === 'move') {
          setBlockerCursor(step.cursor);
        } else if (step.type === 'choose') {
          if (step.choice === 'edited') {
            // Driving-side editor: spawn `$EDITOR` and wait for exit, then report the
            // choice — core re-verifies before resuming (a no-op edit re-presents).
            launchEditor(updateBlocker.repoPath);
          }
          resolveUpdateBlocker(step.choice);
        }
        return;
      }
      if (allConfirm) {
        const decision = resolveAllConfirm(input, key);
        if (decision === 'confirm') {
          setAllConfirm(false);
          void runGroupUpdate('all');
        } else if (decision === 'cancel') {
          setAllConfirm(false);
        }
        return;
      }
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
      if (shouldOpenAllConfirm(input, updateStatus)) {
        setAllConfirm(true);
        return;
      }
      if (key.return) {
        void runGroupUpdate();
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode },
  );

  // The active EDT's own membership — the per-service spinner rows during a run, before the
  // core use-case resolves with its per-service outcome rows. An all-repos run targets no
  // single EDT, so it shows the generic loading line instead of EDT member rows.
  const runningMembers = edts?.find((entry) => entry.ulid === activeEdt)?.members ?? [];
  const offerRerun = shouldOfferRerun(edts, activeEdt);
  const isAllRun = updateScope === 'all';
  const runningLabel = isAllRun ? UPDATE_ALL_RUNNING_LABEL : UPDATE_RUNNING_LABEL;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={spacing['pane-padding-x']}>
      <Text color={colors['text-dim']}>UPDATE</Text>
      {updateStatus === 'running' ? (
        <Box flexDirection="column">
          <Box>
            <Spinner />
            <Text color={colors.text}> {runningLabel}</Text>
          </Box>
          {isAllRun || runningMembers.length === 0 ? (
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
              title={updateTopic === 'all-repos' ? 'All-repos update' : 'Group update'}
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
          <Text color={colors['text-dim']}>{UPDATE_ALL_REPOS_PROMPT}</Text>
        </Box>
      ) : null}
      <ModalDialog title={UPDATE_QUIT_CONFIRM_TITLE} open={quitConfirm} onConfirm={() => {}} onCancel={() => setQuitConfirm(false)}>
        <Text color={colors.text}>{isAllRun ? UPDATE_QUIT_CONFIRM_BODY_ALL : UPDATE_QUIT_CONFIRM_BODY}</Text>
      </ModalDialog>
      <ModalDialog title={UPDATE_ALL_CONFIRM_TITLE} open={allConfirm} onConfirm={() => {}} onCancel={() => setAllConfirm(false)}>
        <Text color={colors.text}>{UPDATE_ALL_CONFIRM_BODY}</Text>
      </ModalDialog>
      <ModalDialog title={UPDATE_BLOCKER_TITLE} open={updateBlocker !== null} onConfirm={() => {}} onCancel={() => {}}>
        {updateBlocker !== null ? (
          <Box flexDirection="column">
            <Text color={colors.text}>{formatBlockerBody(updateBlocker)}</Text>
            {UPDATE_BLOCKER_MENU_ITEMS.map((item, index) => (
              <ListRow key={item.value} label={item.label} selected={index === blockerCursor} />
            ))}
          </Box>
        ) : null}
      </ModalDialog>
    </Box>
  );
}
