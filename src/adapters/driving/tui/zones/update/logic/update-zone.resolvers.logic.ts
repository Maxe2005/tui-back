// tui/zones/update: prompt/label constants, run-result formatters and the trigger/confirm key resolvers.
import { SHARED_EDT_TOPIC, isSharedEdtTopic } from '../../../../../../core/edt/shared-edt/shared-edt.js';
import type { GroupUpdateRepoResult } from '../../../../../../core/scripts/group-update/group-update.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/storage/edt-registry.js';
import type { SummaryTone } from '../../../shared/components/index.js';
import { formatHint, formatHints } from '../../../shared/components/dialogs/hints.js';

export const UPDATE_IDLE_PROMPT = formatHints([['M', 'EDT update'], ['P', 'this service'], ['Enter', 'service actions']]);

export const UPDATE_ALL_REPOS_PROMPT = formatHint(['A', 'all-repos maintenance mode (every managed repo)']);

export const UPDATE_INTERRUPTED_OFFER = `Last update was interrupted — ${formatHint(['Enter', 'service actions'])}`;

export const UPDATE_NO_RECAP = 'No update has run yet in this session.';

export const UPDATE_RUNNING_LABEL = 'Updating member services…';

export const UPDATE_ALL_RUNNING_LABEL = 'Updating all managed repos…';

export const UPDATE_SELECTION_RUNNING_LABEL = 'Updating selected services…';

export const UPDATE_QUIT_CONFIRM_TITLE = 'QUIT MID-RUN';

export const UPDATE_QUIT_CONFIRM_BODY = 'A group update is in progress. Quit and mark this EDT interrupted?';

export const UPDATE_QUIT_CONFIRM_BODY_ALL = 'A group update is in progress. Quit without marking anything interrupted?';

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
  if (isSharedEdtTopic(topic)) {
    return `${SHARED_EDT_TOPIC} (all shared branches): ${updated} updated, ${skipped} skipped, ${failed} failed.`;
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

// The EDT-scoped main trigger — `m` while idle/done/error opens the config pre-scoped to every
// EDT member (never while a run is in flight — a second trigger is rejected by the same guard as
// every other scope).
export function shouldOpenEdtConfig(input: string, updateStatus: string): boolean {
  return (input === 'm' || input === 'M') && updateStatus !== 'running';
}

// The single-service trigger — `p` while idle/done/error opens the config pre-scoped to the
// highlighted row (the dispatcher ignores it when no row is selected).
export function shouldOpenSingleConfig(input: string, updateStatus: string): boolean {
  return (input === 'p' || input === 'P') && updateStatus !== 'running';
}

// The trigger mapping — `a` opens the pre-run configuration screen pre-scoped to every managed
// repo, `m` to the EDT members, `p` to the highlighted row; `Enter` opens the per-service action menu
// for the selected row (Update this service / Clean restart / Cancel). No trigger ever starts
// an unconfigured run. Pure because the zone's `useInput` is never driven in tests, so an inline
// mapping would let a wiring regression back to a direct `runGroupUpdate` go undetected.
export type UpdateTriggerAction = 'open-edt-config' | 'open-all-config' | 'open-service-menu' | 'open-single-config' | 'none';

export function resolveUpdateTrigger(
  input: string,
  key: { return?: boolean },
  updateStatus: string,
): UpdateTriggerAction {
  if (updateStatus === 'running') {
    return 'none';
  }
  if (shouldOpenEdtConfig(input, updateStatus)) {
    return 'open-edt-config';
  }
  if (shouldOpenAllConfirm(input, updateStatus)) {
    return 'open-all-config';
  }
  if (shouldOpenSingleConfig(input, updateStatus)) {
    return 'open-single-config';
  }
  if (key.return === true) {
    return 'open-service-menu';
  }
  return 'none';
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
  if (key.return === true) {
    return 'confirm';
  }
  if (key.escape === true) {
    return 'cancel';
  }
  return null;
}
