// tui/zones/shared-types: the zone's pure decisions — the form reducer (version field,
// consumer checklist, option toggles), the results cursor and the quit-confirm rule. The zone's
// `useInput` stays a thin dispatcher over these.
import type { PropagateOptions, PropagateServiceResult, PropagateStep } from '../../../../../core/shared-types/propagate-version.js';
import { isValidVersion } from '../../../../../core/shared-types/propagate-version.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../../shared/components/text-edit.js';

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
  // Consumers the developer unchecked — the default is every consumer checked.
  unchecked: ReadonlySet<string>;
  options: PropagateOptions;
};

export function initialFormState(): FormState {
  return {
    version: { value: VERSION_PREFIX, cursor: VERSION_PREFIX.length },
    row: 0,
    unchecked: new Set(),
    options: { install: true, cleanRestart: false, commit: true },
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

// One keystroke on the form. On the version field every printable key edits the text; elsewhere
// Up/Down move, Space toggles the row, Enter runs. Enter on the version field moves down.
export function reduceForm(state: FormState, input: string, key: FormKey, repoPaths: readonly string[]): FormStep {
  const count = rowCount(repoPaths.length);
  const target = rowTarget(state.row, repoPaths.length);
  if (key.upArrow === true) {
    return { state: { ...state, row: Math.max(0, state.row - 1) }, run: false };
  }
  if (key.downArrow === true) {
    return { state: { ...state, row: Math.min(count - 1, state.row + 1) }, run: false };
  }
  if (target.kind === 'version') {
    if (key.return === true) {
      return { state: { ...state, row: Math.min(count - 1, 1) }, run: false };
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

// `q` mid-run asks for confirmation instead of quitting.
export function shouldConfirmQuit(input: string, runStatus: string): boolean {
  return input === 'q' && runStatus === 'running';
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
