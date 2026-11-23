// tui/zones/logs: logs-zone.rule-list-keys — the filter editor's rule-list, named-set library and
// set-name views: one handler per view, each called while that view owns the keyboard.
import { nextTextInputValue } from '../../../shared/components/inputs/text-edit.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { cycleFilterLevel, openRuleEditorState, openRuleSetNameState, backToRuleListState, toggleLogRule, deleteLogRule, moveLogRule, MAX_LOG_FILTER_RULES, type FilterEditorState } from '../logs-zone.logic.js';
import { nextCursorForKey } from '../../../shared/keys/list-cursor.js';
import type { LogsKey, LogsZoneCtx } from '../logs-zone.ctx.js';

// Keys of the rule list view: the scope's changes apply to the store immediately.
export function handleRuleListKey(c: LogsZoneCtx, editor: FilterEditorState, input: string, key: LogsKey): void {
  const { currentScopeOf, ruleSets, setFilterEditor, setHistoryGridCursor, updateScopeOf } = c;
  const scope = currentScopeOf(editor);
  const count = scope.rules.length;
  const cursor = Math.min(editor.listCursor, Math.max(count - 1, 0));
  if (editor.confirmClear) {
    if (input === 'y' || input === 'Y' || key.return) {
      updateScopeOf(editor, (current) => ({ ...current, rules: [] }));
      setFilterEditor({ ...editor, listCursor: 0, confirmClear: false, notice: null });
    } else {
      setFilterEditor({ ...editor, confirmClear: false });
    }
    return;
  }
  if (key.escape) {
    setFilterEditor(null);
    setHistoryGridCursor(null);
    return;
  }
  const base: FilterEditorState = { ...editor, listCursor: cursor, notice: null };
  if (key.ctrl && (key.leftArrow || key.rightArrow)) {
    updateScopeOf(editor, (current) => ({ ...current, level: cycleFilterLevel(current.level, key.rightArrow ? 'next' : 'previous') }));
    setFilterEditor(base);
    return;
  }
  if (key.ctrl && (key.upArrow || key.downArrow)) {
    const direction = key.upArrow ? 'up' : 'down';
    const moved = moveLogRule(scope, cursor, direction);
    if (moved !== scope) {
      updateScopeOf(editor, (current) => moveLogRule(current, cursor, direction));
      setFilterEditor({ ...base, listCursor: direction === 'up' ? cursor - 1 : cursor + 1 });
    } else {
      setFilterEditor(base);
    }
    return;
  }
  const nextCursor = nextCursorForKey(key, cursor, count);
  if (nextCursor !== null) {
    setFilterEditor({ ...base, listCursor: nextCursor });
    return;
  }
  if (key.ctrl || key.meta) {
    return;
  }
  if (input === 'a') {
    if (count >= MAX_LOG_FILTER_RULES) {
      setFilterEditor({ ...base, notice: `Rule limit reached (${MAX_LOG_FILTER_RULES}) — delete one to add another.` });
      return;
    }
    setFilterEditor(openRuleEditorState(base, null, null));
    return;
  }
  if (input === 's') {
    if (count === 0) {
      setFilterEditor({ ...base, notice: 'No rules to save — add one first.' });
      return;
    }
    setFilterEditor(openRuleSetNameState(base, null, ''));
    return;
  }
  if (input === 'l') {
    setFilterEditor({ ...base, view: 'library', libraryCursor: Math.min(editor.libraryCursor, Math.max(ruleSets.length - 1, 0)) });
    return;
  }
  const rule = scope.rules[cursor];
  if (rule === undefined) {
    setFilterEditor(base);
    return;
  }
  if (key.return) {
    setFilterEditor(openRuleEditorState(base, cursor, rule));
  } else if (input === ' ') {
    updateScopeOf(editor, (current) => toggleLogRule(current, cursor));
    setFilterEditor(base);
  } else if (input === 'd') {
    updateScopeOf(editor, (current) => deleteLogRule(current, cursor));
    setFilterEditor({ ...base, listCursor: Math.max(Math.min(cursor, count - 2), 0) });
  } else if (input === 'X') {
    setFilterEditor({ ...base, confirmClear: true });
  } else {
    setFilterEditor(base);
  }
}

// Keys of the named-set library: Enter applies (asking first when the active list is not
// empty), r renames, d deletes (asking first), Esc returns to the rule list.
export function handleLibraryKey(c: LogsZoneCtx, editor: FilterEditorState, input: string, key: LogsKey): void {
  const { applySetToScope, currentScopeOf, deleteRuleSetAction, ruleSets, setFilterEditor } = c;
  const count = ruleSets.length;
  const cursor = Math.min(editor.libraryCursor, Math.max(count - 1, 0));
  if (editor.setConfirm !== null) {
    const confirm = editor.setConfirm;
    // A confirmation whose set vanished (the library shrank) is dropped, never acted on.
    if (confirm.kind !== 'overwrite' && ruleSets[confirm.index] === undefined) {
      setFilterEditor({ ...editor, setConfirm: null, libraryCursor: Math.max(Math.min(cursor, count - 1), 0), error: 'That set no longer exists.' });
      return;
    }
    if (input === 'y' || input === 'Y' || key.return) {
      if (confirm.kind === 'apply') {
        applySetToScope({ ...editor, libraryCursor: cursor }, confirm.index);
      } else if (confirm.kind === 'delete') {
        const deleted = deleteRuleSetAction(confirm.index);
        setFilterEditor({
          ...editor,
          setConfirm: null,
          libraryCursor: Math.max(Math.min(cursor, count - 2), 0),
          notice: deleted.ok ? 'Set deleted.' : deleted.error.message,
        });
      }
    } else {
      setFilterEditor({ ...editor, setConfirm: null });
    }
    return;
  }
  if (key.escape) {
    setFilterEditor(backToRuleListState(editor));
    return;
  }
  const base: FilterEditorState = { ...editor, libraryCursor: cursor, notice: null };
  const nextCursor = nextCursorForKey(key, cursor, count);
  if (nextCursor !== null) {
    setFilterEditor({ ...base, libraryCursor: nextCursor });
    return;
  }
  const set = ruleSets[cursor];
  if (key.ctrl || key.meta || set === undefined) {
    setFilterEditor(base);
    return;
  }
  if (key.return) {
    if (currentScopeOf(editor).rules.length > 0) {
      setFilterEditor({ ...base, setConfirm: { kind: 'apply', index: cursor } });
    } else {
      applySetToScope(base, cursor);
    }
  } else if (input === 'r') {
    setFilterEditor(openRuleSetNameState(base, cursor, set.name));
  } else if (input === 'd') {
    setFilterEditor({ ...base, setConfirm: { kind: 'delete', index: cursor } });
  } else {
    setFilterEditor(base);
  }
}

// Keys of the set-name input (save or rename): Enter confirms, Esc goes back.
export function handleSetNameKey(c: LogsZoneCtx, editor: FilterEditorState, input: string, key: LogsKey): void {
  const { renameRuleSetAction, saveActiveRulesAs, setFilterEditor } = c;
  if (editor.setConfirm !== null) {
    if (input === 'y' || input === 'Y' || key.return) {
      saveActiveRulesAs(editor, true);
    } else {
      setFilterEditor({ ...editor, setConfirm: null });
    }
    return;
  }
  if (key.escape) {
    setFilterEditor(editor.nameMode === 'rename' ? { ...editor, view: 'library', error: null } : backToRuleListState(editor));
    return;
  }
  if (key.return) {
    if (editor.nameMode === 'save') {
      saveActiveRulesAs(editor, false);
      return;
    }
    const renamed = renameRuleSetAction(editor.nameIndex ?? -1, editor.name);
    setFilterEditor(
      renamed.ok
        ? { ...editor, view: 'library', error: null, notice: `Renamed to "${editor.name.trim()}".` }
        : { ...editor, error: renamed.error.message },
    );
    return;
  }
  if (key.upArrow || key.downArrow || resolveFocusStep(input, key, 'tab') !== null || key.ctrl || key.meta) {
    return;
  }
  const result = nextTextInputValue({ value: editor.name, cursor: editor.nameCursor }, input, key);
  setFilterEditor({ ...editor, name: result.value, nameCursor: result.cursor, error: null });
}
