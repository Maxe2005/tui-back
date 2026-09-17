// shared/components/branch-picker: story 2.26 — replaces the plain-text-field `branchEdit`
// sub-dialog (BranchEditState in edts-zone.tsx) at the EDT zone's 3 non-creation branch-entry
// points (Modify's per-member branch step, Service-actions' "Change branch for this EDT",
// Add-to-EDT) with a 3-way explicit mode switch: Pick existing (browse `listBranches`) /
// Create new (default; base branch + name, both filterable) / Rename current (only where the
// entry point already has a member branch to rename).
//
// Follows this codebase's established split (edts-zone.tsx's own Design Notes): every
// keystroke behavior is a standalone pure function, unit-tested directly — `handleBranchPickerKey`
// is this component's single reducer, called from edts-zone.tsx's own `useInput` dispatcher
// (never a component-owned `useInput`, keeping the "thin dispatcher over pure functions"
// convention this file already established). `BranchPicker` itself only ever renders, exactly
// like `TextInputLine`/`FailedResultList` — it never captures input.
//
// A second filterable-list *component* was explicitly ruled out (Boundaries: "one widget, two
// call sites") — `matchBranchesByPrefix` plus the inline list rendering below is reused for
// both Create-new's base-branch candidates and Pick-existing's target-branch candidates.
import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';
import { TextInputLine } from './text-input-line.js';
import { DimAnnotation } from './dim-annotation.js';

export type BranchPickerMode = 'pick-existing' | 'create-new' | 'rename-current';

// Boundaries: "Mode switch defaults to Create new" — Tab cycles Pick existing -> Create new ->
// Rename current -> (back to) Pick existing, skipping Rename current entirely when the entry
// point has no current member branch to rename (Add-to-EDT).
export function cycleBranchPickerMode(mode: BranchPickerMode, hasCurrentBranch: boolean): BranchPickerMode {
  const order: BranchPickerMode[] = hasCurrentBranch
    ? ['pick-existing', 'create-new', 'rename-current']
    : ['pick-existing', 'create-new'];
  const idx = order.indexOf(mode);
  const safeIdx = idx === -1 ? 0 : idx;
  return order[(safeIdx + 1) % order.length];
}

// Case-insensitive prefix match — same convention as commands.ts's matchCommands (Boundaries:
// "Filtering is case-insensitive prefix match, same convention as matchCommands").
export function matchBranchesByPrefix(query: string, branches: readonly string[]): string[] {
  const needle = query.toLowerCase();
  return branches.filter((branch) => branch.toLowerCase().startsWith(needle));
}

// The picker's confirmed result — the caller (edts-zone.tsx) decides what to do with it:
// 'set' -> feed straight into the entry point's existing setBranches/addMembers call; 'create'
// -> createMemberBranch first, then the same call with branchName as the target; 'rename' ->
// either modifyEdt's renameBranches param (when repoPath is already a member — Rename current,
// or Pick-existing's row-rename landing on that same member's own branch) or a direct
// renameBranch pre-step followed by the same call (Add-to-EDT, structurally not-yet-a-member).
export type BranchPickerOutcome =
  | { kind: 'set'; branch: string }
  | { kind: 'create'; branchName: string; baseBranch: string }
  | { kind: 'rename'; oldName: string; newName: string };

export type BranchPickerRenameSub = {
  oldName: string;
  value: string;
  // Story 2.32: value's own caret position — mirrors every other field's paired cursor here.
  cursor: number;
  error: string | null;
};

export type BranchPickerState = {
  mode: BranchPickerMode;
  hasCurrentBranch: boolean;
  currentBranch: string;
  // Create new
  baseBranch: string;
  // Story 2.32: baseBranch's own caret position.
  baseBranchCursor: number;
  baseFocused: boolean; // true: base-branch field focused; false: name field focused
  nameValue: string;
  // Story 2.32: nameValue's own caret position.
  nameValueCursor: number;
  nameSubListOpen: boolean;
  nameSubListCursor: number;
  // Pick existing
  pickQuery: string;
  // Story 2.32: pickQuery's own caret position — named distinctly from `pickCursor` below
  // (Boundaries: "new cursor names must not collide with existing cursor row-selection
  // fields ... BranchPickerState.pickCursor").
  pickQueryCursor: number;
  pickCursor: number;
  // Pick-existing's row-rename sub-view, and Rename current's own (only) field — same shape,
  // since "Rename current" is defined as "the exact pick-then-rename mechanism ... pre-selected
  // onto that member's own registered branch, skipping the picking step" (Boundaries).
  renameSub: BranchPickerRenameSub | null;
  error: string | null;
};

export function createBranchPickerState(params: {
  suggestedName: string;
  defaultBaseBranch: string;
  hasCurrentBranch: boolean;
  currentBranch: string;
}): BranchPickerState {
  return {
    mode: 'create-new',
    hasCurrentBranch: params.hasCurrentBranch,
    currentBranch: params.currentBranch,
    baseBranch: params.defaultBaseBranch,
    baseBranchCursor: params.defaultBaseBranch.length,
    baseFocused: true,
    nameValue: params.suggestedName,
    nameValueCursor: params.suggestedName.length,
    nameSubListOpen: false,
    nameSubListCursor: 0,
    pickQuery: '',
    pickQueryCursor: 0,
    pickCursor: 0,
    renameSub: null,
    error: null,
  };
}

// Reopens the picker pre-filled with a collided value after a `branch-exists`/
// `branch-owned-by-other-edt` failure (I/O matrix: "Reopens the relevant field, re-submits").
// Story 2.32: a programmatic overwrite — the reopened field's cursor resets to the collided
// value's length (Always: "Programmatic value overwrites ... reset cursor to value.length").
export function applyBranchPickerRetry(
  state: BranchPickerState,
  retry: { field: 'create-name' | 'rename'; value: string; oldName?: string },
): BranchPickerState {
  if (retry.field === 'create-name') {
    return { ...state, mode: 'create-new', baseFocused: false, nameValue: retry.value, nameValueCursor: retry.value.length, error: null };
  }
  return {
    ...state,
    mode: state.hasCurrentBranch && retry.oldName === state.currentBranch ? 'rename-current' : 'pick-existing',
    renameSub: {
      oldName: retry.oldName ?? state.renameSub?.oldName ?? state.currentBranch,
      value: retry.value,
      cursor: retry.value.length,
      error: null,
    },
  };
}

// A minimal, local re-implementation of edts-zone.tsx's nextTextInputValue (deliberately not
// imported from there: edts-zone.tsx imports this module, and this module must never import
// back from it — a cycle). Same defensive behavior: every non-character key is filtered out
// before it ever reaches the value. Story 2.32: retargeted to `{value, cursor}` in/out, in
// lockstep with nextTextInputValue's own retargeting — Left/Right/Home/End now move `cursor`
// (clamped to [0, value.length]) and Backspace/Delete/typed-char apply at `cursor`.
type TextEditKey = {
  backspace?: boolean;
  delete?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

type TextEditState = { value: string; cursor: number };

function applyTextInput(current: TextEditState, input: string, key: TextEditKey): TextEditState {
  const { value, cursor } = current;
  // Code review fix: ctrl/meta must stay fully inert even when combined with an arrow/Home/
  // End/Backspace/Delete flag — checked first, mirroring edts-zone.logic.ts's own
  // nextTextInputValue fix, so Ctrl/Meta+<key> never moves or edits the caret here either.
  if (key.ctrl || key.meta) {
    return current;
  }
  if (key.leftArrow) {
    return { value, cursor: Math.max(0, cursor - 1) };
  }
  if (key.rightArrow) {
    return { value, cursor: Math.min(value.length, cursor + 1) };
  }
  if (key.home) {
    return { value, cursor: 0 };
  }
  if (key.end) {
    return { value, cursor: value.length };
  }
  if (key.backspace) {
    if (cursor === 0) {
      return current;
    }
    return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
  }
  if (key.delete) {
    if (cursor >= value.length) {
      return current;
    }
    return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
  }
  if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) {
    return current;
  }
  if (input.length === 0) {
    return current;
  }
  return { value: value.slice(0, cursor) + input + value.slice(cursor), cursor: cursor + input.length };
}

export type BranchPickerKeyResult =
  | { type: 'update'; state: BranchPickerState }
  | { type: 'submit'; outcome: BranchPickerOutcome }
  | { type: 'cancel' };

// The picker's single reducer — dispatched from edts-zone.tsx's own useInput callback whenever
// a branch-picker session is open, mirroring how handleBranchEditInput/nextTextInputValue are
// dispatched today. `branches` is the repo's own listBranches() result (candidate source for
// both Create-new's base-branch field and Pick-existing's list — one widget, two call sites);
// `otherMemberBranches` is target.members' deduplicated branch names (Create-new's name-field
// sub-list).
export function handleBranchPickerKey(
  state: BranchPickerState,
  branches: readonly string[],
  otherMemberBranches: readonly string[],
  input: string,
  key: TextEditKey,
): BranchPickerKeyResult {
  if (key.escape) {
    if (state.mode === 'pick-existing' && state.renameSub !== null) {
      return { type: 'update', state: { ...state, renameSub: null } };
    }
    if (state.mode === 'create-new' && state.nameSubListOpen) {
      return { type: 'update', state: { ...state, nameSubListOpen: false } };
    }
    return { type: 'cancel' };
  }

  // Tab cycles the mode switch — never while a Pick-existing row-rename sub-view is open
  // (Escape closes that back to the list first).
  if (key.tab && !(state.mode === 'pick-existing' && state.renameSub !== null)) {
    const nextMode = cycleBranchPickerMode(state.mode, state.hasCurrentBranch);
    // Always closes Create-new's other-members sub-list on any mode change — otherwise a
    // Tab-away-then-back-to-Create-new leaves it open and the next Enter on the name field gets
    // swallowed into "pick from list" instead of submitting.
    if (nextMode === 'rename-current') {
      return {
        type: 'update',
        state: {
          ...state,
          mode: nextMode,
          renameSub: { oldName: state.currentBranch, value: state.currentBranch, cursor: state.currentBranch.length, error: null },
          nameSubListOpen: false,
          nameSubListCursor: 0,
          error: null,
        },
      };
    }
    const clearedRename = state.mode === 'rename-current' ? null : state.renameSub;
    return {
      type: 'update',
      state: { ...state, mode: nextMode, renameSub: clearedRename, baseFocused: true, nameSubListOpen: false, nameSubListCursor: 0, error: null },
    };
  }

  if (state.mode === 'create-new') {
    return handleCreateNewKey(state, branches, otherMemberBranches, input, key);
  }
  if (state.mode === 'pick-existing') {
    return handlePickExistingKey(state, branches, input, key);
  }
  return handleRenameCurrentKey(state, input, key);
}

function handleCreateNewKey(
  state: BranchPickerState,
  branches: readonly string[],
  otherMemberBranches: readonly string[],
  input: string,
  key: TextEditKey,
): BranchPickerKeyResult {
  if (state.baseFocused) {
    if (key.return) {
      return { type: 'update', state: { ...state, baseFocused: false } };
    }
    if (key.downArrow || key.upArrow) {
      const matches = matchBranchesByPrefix(state.baseBranch, branches);
      if (matches.length === 0) {
        return { type: 'update', state };
      }
      const dir = key.downArrow ? 1 : -1;
      const idx = matches.indexOf(state.baseBranch);
      const nextIdx = ((idx === -1 ? 0 : idx) + dir + matches.length) % matches.length;
      const nextBaseBranch = matches[nextIdx];
      // Story 2.32: cycling through suggestions is a programmatic overwrite — the caret jumps
      // to the new value's end (Always: "Programmatic value overwrites ... reset cursor to
      // value.length"), same as every other suggestion/retry reseed in this file.
      return { type: 'update', state: { ...state, baseBranch: nextBaseBranch, baseBranchCursor: nextBaseBranch.length } };
    }
    const editedBase = applyTextInput({ value: state.baseBranch, cursor: state.baseBranchCursor }, input, key);
    return { type: 'update', state: { ...state, baseBranch: editedBase.value, baseBranchCursor: editedBase.cursor } };
  }

  // Name field focused
  if (state.nameSubListOpen) {
    if (key.return) {
      const picked = otherMemberBranches[state.nameSubListCursor];
      const nextNameValue = picked ?? state.nameValue;
      return {
        type: 'update',
        state: {
          ...state,
          nameValue: nextNameValue,
          nameValueCursor: picked !== undefined ? nextNameValue.length : state.nameValueCursor,
          nameSubListOpen: false,
        },
      };
    }
    if (key.downArrow || key.upArrow) {
      if (otherMemberBranches.length === 0) {
        return { type: 'update', state };
      }
      const dir = key.downArrow ? 1 : -1;
      const next = Math.min(Math.max(state.nameSubListCursor + dir, 0), otherMemberBranches.length - 1);
      return { type: 'update', state: { ...state, nameSubListCursor: next } };
    }
    return { type: 'update', state };
  }
  if (key.downArrow && otherMemberBranches.length > 0) {
    return { type: 'update', state: { ...state, nameSubListOpen: true, nameSubListCursor: 0 } };
  }
  if (key.return) {
    const trimmed = state.nameValue.trim();
    if (trimmed === '') {
      return { type: 'update', state: { ...state, error: 'Branch name must not be empty' } };
    }
    return { type: 'submit', outcome: { kind: 'create', branchName: trimmed, baseBranch: state.baseBranch.trim() } };
  }
  const editedName = applyTextInput({ value: state.nameValue, cursor: state.nameValueCursor }, input, key);
  return { type: 'update', state: { ...state, nameValue: editedName.value, nameValueCursor: editedName.cursor, error: null } };
}

function handlePickExistingKey(
  state: BranchPickerState,
  branches: readonly string[],
  input: string,
  key: TextEditKey,
): BranchPickerKeyResult {
  const matches = matchBranchesByPrefix(state.pickQuery, branches);

  if (state.renameSub !== null) {
    if (key.return) {
      const trimmed = state.renameSub.value.trim();
      if (trimmed === '') {
        return { type: 'update', state: { ...state, renameSub: { ...state.renameSub, error: 'Branch name must not be empty' } } };
      }
      return { type: 'submit', outcome: { kind: 'rename', oldName: state.renameSub.oldName, newName: trimmed } };
    }
    const editedRename = applyTextInput({ value: state.renameSub.value, cursor: state.renameSub.cursor }, input, key);
    return {
      type: 'update',
      state: {
        ...state,
        renameSub: { ...state.renameSub, value: editedRename.value, cursor: editedRename.cursor, error: null },
      },
    };
  }

  // Ctrl+R: the row's secondary "rename" action (Boundaries) — never a plain "r" keypress,
  // which must stay available as ordinary filter text.
  if (key.ctrl && input.toLowerCase() === 'r') {
    const highlighted = matches[state.pickCursor];
    if (highlighted === undefined) {
      return { type: 'update', state };
    }
    return {
      type: 'update',
      state: { ...state, renameSub: { oldName: highlighted, value: highlighted, cursor: highlighted.length, error: null } },
    };
  }

  if (key.downArrow || key.upArrow) {
    if (matches.length === 0) {
      return { type: 'update', state: { ...state, pickCursor: 0 } };
    }
    const dir = key.downArrow ? 1 : -1;
    const next = Math.min(Math.max(state.pickCursor + dir, 0), matches.length - 1);
    return { type: 'update', state: { ...state, pickCursor: next } };
  }
  if (key.return) {
    const branch = matches[state.pickCursor];
    if (branch === undefined) {
      return { type: 'update', state: { ...state, error: 'No branch selected' } };
    }
    return { type: 'submit', outcome: { kind: 'set', branch } };
  }
  const editedQuery = applyTextInput({ value: state.pickQuery, cursor: state.pickQueryCursor }, input, key);
  // Code review fix: a pure caret move (Left/Right/Home/End) leaves pickQuery's *value*
  // unchanged — the highlighted row must survive it. Only an actual filter-text change
  // (typing/Backspace/Delete) re-derives the match list and resets pickCursor to the top.
  const nextPickCursor = editedQuery.value === state.pickQuery ? state.pickCursor : 0;
  return {
    type: 'update',
    state: { ...state, pickQuery: editedQuery.value, pickQueryCursor: editedQuery.cursor, pickCursor: nextPickCursor, error: null },
  };
}

function handleRenameCurrentKey(state: BranchPickerState, input: string, key: TextEditKey): BranchPickerKeyResult {
  const sub = state.renameSub ?? { oldName: state.currentBranch, value: state.currentBranch, cursor: state.currentBranch.length, error: null };
  if (key.return) {
    const trimmed = sub.value.trim();
    if (trimmed === '') {
      return { type: 'update', state: { ...state, renameSub: { ...sub, error: 'Branch name must not be empty' } } };
    }
    return { type: 'submit', outcome: { kind: 'rename', oldName: sub.oldName, newName: trimmed } };
  }
  const editedSub = applyTextInput({ value: sub.value, cursor: sub.cursor }, input, key);
  return {
    type: 'update',
    state: { ...state, renameSub: { ...sub, value: editedSub.value, cursor: editedSub.cursor, error: null } },
  };
}

const MODE_LABELS: Record<BranchPickerMode, string> = {
  'pick-existing': 'Pick existing',
  'create-new': 'Create new',
  'rename-current': 'Rename current',
};

export type BranchPickerProps = {
  state: BranchPickerState;
  branches: readonly string[];
  branchesStatus: 'loading' | 'ready' | 'error';
  otherMemberBranches: readonly string[];
  // Code review (story 2.27): Create-EDT's base-branch step repurposes "Create new" mode's Name
  // field to mean "the base branch itself" — that session never creates a new branch (see
  // create-dialog.tsx's applyBaseBranchOutcome), so the mode's own nested "base to create the
  // new branch from" sub-field is dead chrome there. When true, hides that nested field and
  // relabels the remaining one "Base branch" instead of "Name" — but only while it isn't
  // focused, so the already-accepted Tab-cycle rough edge (baseFocused resets to true) still
  // falls back to the original, fully-functional two-field render rather than a focus with
  // nothing shown. Every other call site omits this prop and is unaffected.
  hideNestedBaseField?: boolean;
};

// The one filterable-list widget (Boundaries: "a second filterable-list component" is
// explicitly ruled out) — reused for both Create-new's base-branch candidates (highlighting
// whichever candidate the base field's current value equals) and Pick-existing's target
// candidates (highlighting `cursor`). Purely presentational, like the rest of this file's
// render tree — the actual filtering (matchBranchesByPrefix) and cursor movement are handled
// by handleBranchPickerKey, never here.
function FilterableBranchList({ matches, highlightedIndex }: { matches: readonly string[]; highlightedIndex: number }) {
  if (matches.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {matches.map((branch, index) => (
        <Text key={branch} color={index === highlightedIndex ? colors.accent : colors.text}>
          {index === highlightedIndex ? '› ' : '  '}
          {branch}
        </Text>
      ))}
    </Box>
  );
}

export function BranchPicker({ state, branches, branchesStatus, otherMemberBranches, hideNestedBaseField = false }: BranchPickerProps) {
  const modes: BranchPickerMode[] = state.hasCurrentBranch
    ? ['pick-existing', 'create-new', 'rename-current']
    : ['pick-existing', 'create-new'];

  return (
    <Box flexDirection="column">
      <Text color={colors.text}>
        {modes.map((mode) => (mode === state.mode ? `[${MODE_LABELS[mode]}]` : ` ${MODE_LABELS[mode]} `)).join(' ')}
        {'  [Tab] switch mode'}
      </Text>
      {branchesStatus === 'loading' ? <Text color={colors['text-dim']}>Loading branches…</Text> : null}
      {branchesStatus === 'error' ? <Text color={colors.error}>Failed to load branches.</Text> : null}

      {state.mode === 'create-new' ? (
        <Box flexDirection="column">
          {hideNestedBaseField && !state.baseFocused ? null : (
            <>
              <TextInputLine label="Base branch" value={state.baseBranch} cursor={state.baseBranchCursor} focused={state.baseFocused} />
              {state.baseFocused ? (
                <FilterableBranchList
                  matches={matchBranchesByPrefix(state.baseBranch, branches)}
                  highlightedIndex={matchBranchesByPrefix(state.baseBranch, branches).indexOf(state.baseBranch)}
                />
              ) : null}
            </>
          )}
          <TextInputLine
            label={hideNestedBaseField ? 'Base branch' : 'Name'}
            value={state.nameValue}
            cursor={state.nameValueCursor}
            focused={!state.baseFocused}
          />
          {otherMemberBranches.length > 0 ? (
            <Box flexDirection="column" paddingLeft={2}>
              <Text color={colors['text-dim']}>
                {state.nameSubListOpen ? "Other members' branches ([Enter] pick, [Esc] close):" : "[↓] other members' branches"}
              </Text>
              {state.nameSubListOpen
                ? otherMemberBranches.map((branch, index) => (
                    <Text key={branch} color={index === state.nameSubListCursor ? colors.accent : colors.text}>
                      {index === state.nameSubListCursor ? '› ' : '  '}
                      {branch}
                    </Text>
                  ))
                : null}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {state.mode === 'pick-existing' ? (
        state.renameSub !== null ? (
          <Box flexDirection="column">
            <TextInputLine label={`Rename "${state.renameSub.oldName}" to`} value={state.renameSub.value} cursor={state.renameSub.cursor} focused />
            {state.renameSub.error ? <DimAnnotation text={state.renameSub.error} /> : null}
          </Box>
        ) : (
          <Box flexDirection="column">
            <TextInputLine label="Filter" value={state.pickQuery} cursor={state.pickQueryCursor} focused />
            <FilterableBranchList matches={matchBranchesByPrefix(state.pickQuery, branches)} highlightedIndex={state.pickCursor} />
            <Text color={colors['text-dim']}>[Enter] set branch  [Ctrl+R] rename this branch</Text>
          </Box>
        )
      ) : null}

      {state.mode === 'rename-current' ? (
        <Box flexDirection="column">
          <TextInputLine
            label={`Rename "${state.renameSub?.oldName ?? state.currentBranch}" to`}
            value={state.renameSub?.value ?? state.currentBranch}
            cursor={state.renameSub?.cursor ?? state.currentBranch.length}
            focused
          />
          {state.renameSub?.error ? <DimAnnotation text={state.renameSub.error} /> : null}
        </Box>
      ) : null}

      {state.error ? <DimAnnotation text={state.error} /> : null}
    </Box>
  );
}
