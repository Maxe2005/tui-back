// tui/zones/shared-types: the zone's pure decisions — the form reducer (version field,
// consumer checklist, option toggles), the results cursor and the quit-confirm rule. The zone's
// `useInput` stays a thin dispatcher over these.
import type { PropagateOptions, PropagateServiceResult, PropagateStep } from '../../../../../core/shared-types/propagate-version.js';
import { isValidVersion } from '../../../../../core/shared-types/propagate-version.js';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../../shared/components/text-edit.js';
import { resolveMenuKey, type MenuItem, type MenuKey, type MenuStep } from '../../shared/components/menu-list.js';
import { SHARED_TYPES_ACTIONS, type SharedTypesActionId } from '../../keybindings/keybindings.js';

export const VERSION_PREFIX = '0.1.';

export type OptionKey = keyof PropagateOptions;
export const OPTION_ROWS: readonly { key: OptionKey; label: string }[] = [
  { key: 'install', label: 'Run npm i' },
  { key: 'cleanRestart', label: 'Clean restart' },
  { key: 'commit', label: 'Commit package.json + package-lock.json' },
];

export type FormState = {
  version: TextInputState;
  // 0 = version field, 1..n = consumers, n+1..n+3 = options.
  row: number;
  // The version field only captures keys once Enter entered it; merely landing on row 0 just
  // highlights it, so the left/right tab navigation keeps working.
  editing: boolean;
  // Consumers the developer unchecked — the default is every consumer checked.
  unchecked: ReadonlySet<string>;
  options: PropagateOptions;
};

export const DEFAULT_FORM_OPTIONS: PropagateOptions = { install: true, cleanRestart: false, commit: true };

export function initialFormState(options: PropagateOptions = DEFAULT_FORM_OPTIONS): FormState {
  return {
    version: { value: VERSION_PREFIX, cursor: VERSION_PREFIX.length },
    row: 0,
    editing: false,
    unchecked: new Set(),
    options: { ...options },
  };
}

export type FormKey = TextEditKey & { upArrow?: boolean; downArrow?: boolean; return?: boolean };

export function rowCount(consumerCount: number): number {
  return 1 + consumerCount + OPTION_ROWS.length;
}

export type RowTarget =
  | { kind: 'version' }
  | { kind: 'consumer'; index: number }
  | { kind: 'option'; key: OptionKey };

export function rowTarget(row: number, consumerCount: number): RowTarget {
  if (row <= 0) {
    return { kind: 'version' };
  }
  if (row <= consumerCount) {
    return { kind: 'consumer', index: row - 1 };
  }
  const option = OPTION_ROWS[Math.min(row - consumerCount - 1, OPTION_ROWS.length - 1)]!;
  return { kind: 'option', key: option.key };
}

export function selectedRepoPaths(state: FormState, repoPaths: readonly string[]): string[] {
  return repoPaths.filter((repoPath) => !state.unchecked.has(repoPath));
}

export function canRun(state: FormState, repoPaths: readonly string[]): boolean {
  return isValidVersion(state.version.value) && selectedRepoPaths(state, repoPaths).length > 0;
}

export type FormStep = { state: FormState; run: boolean };

// One keystroke on the form. Enter on the highlighted version field starts editing: every
// printable key edits the text until Enter/Esc/Up/Down leaves it. Elsewhere Up/Down move, Space
// toggles the row, Enter runs.
export function reduceForm(state: FormState, input: string, key: FormKey, repoPaths: readonly string[]): FormStep {
  const count = rowCount(repoPaths.length);
  const target = rowTarget(state.row, repoPaths.length);
  if (key.upArrow === true) {
    return { state: { ...state, editing: false, row: Math.max(0, state.row - 1) }, run: false };
  }
  if (key.downArrow === true) {
    return { state: { ...state, editing: false, row: Math.min(count - 1, state.row + 1) }, run: false };
  }
  if (target.kind === 'version') {
    if (!state.editing) {
      return { state: key.return === true ? { ...state, editing: true } : state, run: false };
    }
    if (key.return === true || key.escape === true) {
      return { state: { ...state, editing: false }, run: false };
    }
    return { state: { ...state, version: nextTextInputValue(state.version, input, key) }, run: false };
  }
  if (key.return === true) {
    return { state, run: canRun(state, repoPaths) };
  }
  if (input === ' ') {
    if (target.kind === 'consumer') {
      const repoPath = repoPaths[target.index]!;
      const unchecked = new Set(state.unchecked);
      if (unchecked.has(repoPath)) {
        unchecked.delete(repoPath);
      } else {
        unchecked.add(repoPath);
      }
      return { state: { ...state, unchecked }, run: false };
    }
    return { state: { ...state, options: { ...state.options, [target.key]: !state.options[target.key] } }, run: false };
  }
  return { state, run: false };
}

// `q` mid-run asks for confirmation instead of quitting (propagation or publish).
export function shouldConfirmQuit(input: string, runStatus: string, publishStatus?: string): boolean {
  return input === 'q' && (runStatus === 'running' || publishStatus === 'running');
}

export function isPublishRunning(publishStatus: string): boolean {
  return publishStatus === 'running';
}

// Publish entry: `p` starts a publish when exactly one source is loaded and nothing runs.
export function shouldStartPublish(input: string, publishStatus: string, sourceCount: number, sourcesStatus?: string): boolean {
  if (sourcesStatus !== undefined) {
    return (input === 'p' || input === 'P') && publishStatus === 'idle' && sourceCount === 1 && sourcesStatus === 'ready';
  }
  return (input === 'p' || input === 'P') && publishStatus === 'idle' && sourceCount === 1;
}

// Why the History view cannot open: it reads the one shared-types-source repo of the active EDT.
export function historyDisabledReason(sourcesStatus: string, sourceError: string | undefined, sourceCount: number): string {
  if (sourcesStatus === 'error' && sourceError !== undefined) {
    return `History is unavailable: ${sourceError}`;
  }
  if (sourcesStatus === 'error') {
    return 'History is unavailable: the source repo could not be read.';
  }
  if (sourceCount > 1) {
    return 'History is unavailable: several source repos are in the active EDT.';
  }
  if (sourceCount === 0) {
    return 'History is unavailable: the shared-types source repo is not part of the active EDT.';
  }
  return 'History is unavailable: the source repo is still loading.';
}

export type SharedTypesActionsInput = {
  form: FormState;
  repoPaths: readonly string[];
  sourcesStatus: string;
  sourceError: string | undefined;
  sourceCount: number;
  consumersStatus: string;
  publishStatus: string;
  runStatus: string;
};

function publishReason(input: SharedTypesActionsInput): string | null {
  if (input.publishStatus !== 'idle' || input.runStatus !== 'idle') {
    return 'a run is in progress';
  }
  if (input.sourcesStatus === 'error') {
    return 'source repo unavailable';
  }
  if (input.sourcesStatus !== 'ready') {
    return 'source repo loading';
  }
  if (input.sourceCount === 0) {
    return 'no source repo in the EDT';
  }
  if (input.sourceCount > 1) {
    return 'several source repos';
  }
  return null;
}

function propagateReason(input: SharedTypesActionsInput): string | null {
  if (input.runStatus !== 'idle' || input.publishStatus !== 'idle') {
    return 'a run is in progress';
  }
  if (input.consumersStatus === 'error') {
    return 'consuming services unavailable';
  }
  if (input.consumersStatus !== 'ready') {
    return 'consuming services loading';
  }
  if (input.repoPaths.length === 0) {
    return 'no consuming service';
  }
  if (!isValidVersion(input.form.version.value)) {
    return 'enter a valid version';
  }
  if (!canRun(input.form, input.repoPaths)) {
    return 'select a consumer';
  }
  // Enter on the version row edits the field (or leaves it); only another row propagates.
  if (input.form.editing) {
    return 'finish editing the version';
  }
  if (input.form.row === 0) {
    return 'move to a consumer row';
  }
  return null;
}

export const HISTORY_UNAVAILABLE_PREFIX = 'History is unavailable: ';

// The bar shows the reason right after `[H] history`, so the sentence's own prefix (and its
// closing period, like every other bar fragment) is dropped there; pressing H still shows the full
// historyDisabledReason sentence.
function historyReason(input: SharedTypesActionsInput): string | null {
  if (input.sourcesStatus === 'ready' && input.sourceCount === 1) {
    return null;
  }
  const reason = historyDisabledReason(input.sourcesStatus, input.sourceError, input.sourceCount);
  const fragment = reason.startsWith(HISTORY_UNAVAILABLE_PREFIX) ? reason.slice(HISTORY_UNAVAILABLE_PREFIX.length) : reason;
  return fragment.replace(/\.$/, '');
}

function reloadReason(input: SharedTypesActionsInput): string | null {
  return input.sourcesStatus === 'error' || input.consumersStatus === 'error' ? null : 'nothing to reload';
}

const ACTION_REASONS: Record<SharedTypesActionId, (input: SharedTypesActionsInput) => string | null> = {
  publish: publishReason,
  propagate: propagateReason,
  history: historyReason,
  reload: reloadReason,
};

// The action bar of the form view: every Shared Types command with its availability — the same
// conditions the key dispatcher applies (`shouldStartPublish`, `canRun` + the focused row, the
// History gate, the load-error Reload). Available actions come first (declaration order kept
// within each group) so a narrow, clipped bar still shows what can be pressed.
export function sharedTypesActions(input: SharedTypesActionsInput): ServiceAction[] {
  const actions: ServiceAction[] = SHARED_TYPES_ACTIONS.map((action) => {
    const reason = ACTION_REASONS[action.id](input);
    return {
      id: action.id,
      key: action.key,
      label: action.label,
      availability: reason === null ? { available: true } : { available: false, reason },
    };
  });
  return [...actions.filter((action) => action.availability.available), ...actions.filter((action) => !action.availability.available)];
}

// The post-publish choice screens. Each row carries a one-line explanation; the screen's local
// cursor starts on the first row.
export type PublishDoneChoice = 'propagate' | 'back' | 'close';
export type PublishFailedChoice = 'relaunch' | 'back';

// The one builder of the done screen's rows: the zone renders and resolves keys on the same array.
// A done publish without a version still offers the same three rows.
export function publishDoneChoices(version: string | null): readonly MenuItem<PublishDoneChoice>[] {
  return [
    { value: 'propagate', label: `Propagate ${version ?? 'the published version'} to consumers`, description: 'Back to the form with this version pre-filled, ready to propagate.' },
    { value: 'back', label: 'Back to the form', description: 'Dismiss this result and return to the form as you left it.' },
    { value: 'close', label: 'Close', description: 'Dismiss this result and reset the form.' },
  ];
}

export const PUBLISH_FAILED_CHOICES: readonly MenuItem<PublishFailedChoice>[] = [
  { value: 'relaunch', label: 'Relaunch', description: 'Run the whole publish command again.' },
  { value: 'back', label: 'Back', description: 'Dismiss the failure and return to the form.' },
];

// A cursor left over from a longer menu never points past the last row.
export function clampChoiceCursor(cursor: number, length: number): number {
  return Math.max(0, Math.min(cursor, length - 1));
}

// Up/Down/Home/End move, Enter chooses the highlighted row, Esc = Close; `C` stays a shortcut
// for Propagate. `items` is the array the screen renders (`publishDoneChoices(version)`).
export function resolvePublishDoneChoice(
  input: string,
  key: MenuKey,
  cursor: number,
  items: readonly MenuItem<PublishDoneChoice>[],
): MenuStep<PublishDoneChoice> {
  if (input === 'c' || input === 'C') {
    return { type: 'choose', choice: 'propagate' };
  }
  return resolveMenuKey(key, clampChoiceCursor(cursor, items.length), items, 'close');
}

// Same keys, Esc = Back; `R` stays a shortcut for Relaunch.
export function resolvePublishFailedChoice(input: string, key: MenuKey, cursor: number): MenuStep<PublishFailedChoice> {
  if (input === 'r' || input === 'R') {
    return { type: 'choose', choice: 'relaunch' };
  }
  return resolveMenuKey(key, clampChoiceCursor(cursor, PUBLISH_FAILED_CHOICES.length), PUBLISH_FAILED_CHOICES, 'back');
}

export function resolveQuitDecision(input: string, key: { return?: boolean; escape?: boolean }): 'confirm' | 'cancel' | null {
  if (key.return === true) {
    return 'confirm';
  }
  if (key.escape === true) {
    return 'cancel';
  }
  return null;
}

export const STEP_LABELS: Record<PropagateStep, string> = {
  gate: 'checking the branch',
  'dirty-check': 'checking for uncommitted changes',
  write: 'rewriting the dependency line',
  install: 'running npm i',
  restart: 'restarting',
  commit: 'committing',
};

export function summarizeResult(result: PropagateServiceResult): string {
  if (result.outcome === 'done') {
    const done = result.steps.filter((step) => step.status === 'done' && step.step !== 'gate' && step.step !== 'dirty-check');
    return `done (${done.map((step) => step.step).join(', ')})`;
  }
  if (result.outcome === 'skipped') {
    return `skipped: ${result.reason ?? 'unknown reason'}`;
  }
  return `failed at ${result.failedStep ?? 'unknown step'} [${result.error?.code ?? 'error'}]: ${result.error?.message ?? ''}`;
}
