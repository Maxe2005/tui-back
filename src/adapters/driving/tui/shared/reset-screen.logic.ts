// tui/shared/reset-screen.logic: the `:reset` overlay's pure key-handling state machine. Three
// steps: select (checkboxes; Services force-checks and locks EDTs; Enter needs one checked),
// summary (read-only review; Enter advances once the preview loaded), confirm (Enter executes
// only on exactly `reset`). Esc cancels from any step — nothing was written yet.
import { resolveResetCategories, type ResetCategory } from '../../../../core/scripts/reset-tool.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from './components/text-edit.js';
import { nextCursorForKey } from './keys/list-cursor.js';

export type ResetScreenStep = 'select' | 'summary' | 'confirm';

export const RESET_CONFIRM_WORD = 'reset';

export const RESET_SCREEN_ROWS: readonly ResetCategory[] = ['edts', 'histories', 'services'];

export const RESET_CATEGORY_LABELS: Record<ResetCategory, string> = {
  edts: 'EDTs',
  histories: 'Histories',
  services: 'Registered services',
};

export type ResetScreenState = {
  step: ResetScreenStep;
  cursor: number;
  checked: Record<ResetCategory, boolean>;
  confirm: TextInputState;
};

export type ResetScreenKey = TextEditKey & { return?: boolean; escape?: boolean };

export type ResetScreenAction =
  | { kind: 'none' }
  | { kind: 'close' }
  | { kind: 'execute'; categories: ResetCategory[] };

export type ResetScreenKeyResult = { state: ResetScreenState; action: ResetScreenAction };

export function createResetScreenState(): ResetScreenState {
  return {
    step: 'select',
    cursor: 0,
    checked: { edts: false, histories: false, services: false },
    confirm: { value: '', cursor: 0 },
  };
}

export function isEdtsLocked(state: ResetScreenState): boolean {
  return state.checked.services;
}

export function selectedCategories(state: ResetScreenState): ResetCategory[] {
  return RESET_SCREEN_ROWS.filter((category) => state.checked[category]);
}

// Exact comparison on purpose: `Reset`, `reset ` and `rese` must all be refused.
export function isConfirmWordValid(value: string): boolean {
  return value === RESET_CONFIRM_WORD;
}

export function toggleResetCategory(state: ResetScreenState, category: ResetCategory): ResetScreenState {
  if (category === 'edts' && isEdtsLocked(state)) {
    return state;
  }
  const nextValue = !state.checked[category];
  const checked = { ...state.checked, [category]: nextValue };
  if (category === 'services' && nextValue) {
    checked.edts = true;
  }
  return { ...state, checked };
}

const NONE: ResetScreenAction = { kind: 'none' };

// `summaryReady`: whether the summary step's preview has loaded successfully. Enter on the
// summary only advances once it has — the developer must never confirm a deletion whose
// contents they could not review (a still-loading or failed preview leaves Esc as the only
// way out).
export function handleResetScreenKey(
  state: ResetScreenState,
  input: string,
  key: ResetScreenKey,
  summaryReady = true,
): ResetScreenKeyResult {
  if (key.escape) {
    return { state, action: { kind: 'close' } };
  }

  if (state.step === 'select') {
    const cursor = nextCursorForKey(key, state.cursor, RESET_SCREEN_ROWS.length);
    if (cursor !== null) {
      return { state: { ...state, cursor }, action: NONE };
    }
    if (input === ' ') {
      const category = RESET_SCREEN_ROWS[state.cursor];
      return { state: category ? toggleResetCategory(state, category) : state, action: NONE };
    }
    if (key.return && selectedCategories(state).length > 0) {
      return { state: { ...state, step: 'summary' }, action: NONE };
    }
    return { state, action: NONE };
  }

  if (state.step === 'summary') {
    if (key.return && summaryReady) {
      return { state: { ...state, step: 'confirm', confirm: { value: '', cursor: 0 } }, action: NONE };
    }
    return { state, action: NONE };
  }

  // confirm
  if (key.return) {
    if (isConfirmWordValid(state.confirm.value)) {
      return { state, action: { kind: 'execute', categories: selectedCategories(state) } };
    }
    return { state, action: NONE };
  }
  return { state: { ...state, confirm: nextTextInputValue(state.confirm, input, key) }, action: NONE };
}

// ---------------------------------------------------------------------------------------------
// Pure line builders for the summary (step 2) and result views — kept here, next to the state
// machine, so the exact wording the developer reviews is unit-testable without mounting Ink.

export type ResetSummaryPreview = {
  status: 'loading' | 'ready' | 'error';
  edtTopics: string[];
  serviceCount: number;
  error: string | null;
  edtRegistryFile: string;
  registryFile: string;
  edtsBaseDir: string;
};

export type ResetLine = { text: string; tone: 'text' | 'dim' | 'error' | 'success' | 'warning' };

export function buildResetSummaryLines(categories: readonly ResetCategory[], preview: ResetSummaryPreview | null): ResetLine[] {
  const effective = resolveResetCategories(categories);
  if (preview === null || preview.status === 'loading') {
    return [{ text: 'Loading what would be deleted…', tone: 'dim' }];
  }
  const lines: ResetLine[] = [];
  if (preview.status === 'error') {
    lines.push({ text: `Could not read current data: ${preview.error ?? 'unknown error'}`, tone: 'warning' });
  }
  if (effective.includes('edts')) {
    const count = preview.edtTopics.length;
    lines.push({
      text: `EDTs — ${count} EDT${count === 1 ? '' : 's'}${count > 0 ? `: ${preview.edtTopics.join(', ')}` : ''}`,
      tone: 'error',
    });
    lines.push({ text: `  ${preview.edtRegistryFile} — every entry removed`, tone: 'text' });
    lines.push({ text: `  ${preview.edtsBaseDir}/* — per-EDT dirs, databases and action logs deleted`, tone: 'text' });
    lines.push({ text: '  state.json — activeEdt set to null', tone: 'text' });
  }
  if (effective.includes('histories')) {
    lines.push({ text: 'Histories — every Logs filter history', tone: 'error' });
    lines.push({ text: '  state.json — filterHistory emptied', tone: 'text' });
  }
  if (effective.includes('services')) {
    const count = preview.serviceCount;
    lines.push({ text: `Registered services — ${count} service${count === 1 ? '' : 's'}`, tone: 'error' });
    lines.push({ text: `  ${preview.registryFile} — every entry removed`, tone: 'text' });
  }
  lines.push({ text: 'Git is never touched: member branches and tui-back stashes stay.', tone: 'dim' });
  lines.push({ text: 'Kept: settings.yaml, splitter ratios, lock files. No backup is made.', tone: 'dim' });
  return lines;
}

export type ResetResultInput = {
  outcomes: Partial<Record<ResetCategory, { outcome: 'ok' } | { outcome: 'failed'; error: { message: string } }>>;
  leftBranches: Array<{ topic: string; service: string; repoPath: string; branch: string }>;
};

export function buildResetResultLines(result: ResetResultInput | null, error: string | null): ResetLine[] {
  if (result === null) {
    return error !== null ? [{ text: `✗ Reset failed: ${error}`, tone: 'error' }] : [];
  }
  const lines: ResetLine[] = [];
  // A result plus an error: the reset ran, but something after it (the UI reload) failed —
  // show both, never hide the per-category outcomes or the left-behind branches.
  if (error !== null) {
    lines.push({ text: `✗ ${error}`, tone: 'error' });
  }
  for (const category of RESET_SCREEN_ROWS) {
    const outcome = result.outcomes[category];
    if (!outcome) {
      continue;
    }
    lines.push(
      outcome.outcome === 'ok'
        ? { text: `✓ ${RESET_CATEGORY_LABELS[category]} reset`, tone: 'success' }
        : { text: `✗ ${RESET_CATEGORY_LABELS[category]} failed: ${outcome.error.message}`, tone: 'error' },
    );
  }
  if (result.leftBranches.length > 0) {
    lines.push({ text: 'Branches left behind (git untouched — delete them by hand if unwanted):', tone: 'warning' });
    for (const branch of result.leftBranches) {
      lines.push({ text: `  ${branch.service} / ${branch.repoPath} / ${branch.branch}  (${branch.topic})`, tone: 'text' });
    }
  }
  return lines;
}
