// tui/zones/routes: routes-zone.request-keys — Request sub-tab keys: section switching, the body editor (tree + rules panel) and the params/query/headers row cursor.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import {
  clampTreeSelection,
  removeActiveRule,
  resolveTreeKeyAction,
  resolveTreePanelKeyAction,
} from '../../../shared/components/json-tree/model.js';
import { moveRoutesSelection, resolveRoutesDirection } from '../routes-zone.logic.js';
import { nextRequestSection, type RequestRowSection } from '../routes-request.logic.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';

export function handleRequestTabKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    updateRequestDraft, filterPanelOpen, setFilterPanelOpen, setPanelCursor, section, setSection, rowCursor,
    setRowCursor, setRowEdit, setRowAddPrompt, paneRouteKey, paneDraft, editorRuleList,
    clampedEditorPanelCursor, editorOpen, amendEditorTreeState, frameEditorTreeState,
    editorWithClampedSelection, readEditorDraft, applyEditorTreeAction, applyEditorPanelAction, closePane,
    rowsOf,
  } = c;
  const sectionStep = resolveFocusStep(input, key, 'tab');
  if (sectionStep !== null) {
    setSection((previous) => nextRequestSection(previous, sectionStep));
    setRowCursor(0);
    setFilterPanelOpen(false);
    setPanelCursor(0);
    return;
  }
  if (section === 'body') {
    // Esc closes the editor's rules panel first, then leaves the pane.
    if (key.escape === true) {
      if (filterPanelOpen) {
        setFilterPanelOpen(false);
      } else {
        closePane();
      }
      return;
    }
    if (!editorOpen) {
      return;
    }
    if (filterPanelOpen) {
      // Same auto-owning rule list as the response panel, over the editor's own
      // folds/filters (revisit restores them together with the draft).
      if (key.upArrow === true) {
        setPanelCursor((prev) => clampTreeSelection(prev - 1, editorRuleList.length));
        return;
      }
      if (key.downArrow === true) {
        setPanelCursor((prev) => clampTreeSelection(prev + 1, editorRuleList.length));
        return;
      }
      if (key.home === true) {
        setPanelCursor(0);
        return;
      }
      if (key.end === true) {
        setPanelCursor(Math.max(0, editorRuleList.length - 1));
        return;
      }
      if (input === ' ' || input === 'd' || input === 'D') {
        if (editorRuleList.length > 0) {
          const at = clampedEditorPanelCursor;
          amendEditorTreeState((live) => {
            const next = removeActiveRule(frameEditorTreeState(live, readEditorDraft()).rules, at);
            if (next === null) {
              return null;
            }
            return {
              ...live,
              hiddenKeys: [...next.hiddenKeys],
              onlyKeys: [...next.onlyKeys],
              hideNulls: next.hideNulls,
              selected: editorWithClampedSelection(live, readEditorDraft()),
            };
          });
        }
        return;
      }
      const editorPanelAction = resolveTreePanelKeyAction(input, editorRuleList.length);
      if (editorPanelAction === null) {
        return;
      }
      applyEditorPanelAction(editorPanelAction);
      return;
    }
    const editorAction = resolveTreeKeyAction(input, key);
    if (editorAction === null) {
      return;
    }
    applyEditorTreeAction(editorAction);
    return;
  }
  if (key.escape === true) {
    closePane();
    return;
  }
  const rowSection: RequestRowSection = section;
  const rows = rowsOf(paneDraft, rowSection);
  const at = rows.length === 0 ? 0 : Math.min(rowCursor, rows.length - 1);
  const direction = resolveRoutesDirection(key);
  if (direction !== null) {
    setRowCursor(moveRoutesSelection(at, direction, rows.length));
    return;
  }
  if (key.home === true) {
    setRowCursor(0);
    return;
  }
  if (key.end === true) {
    setRowCursor(Math.max(0, rows.length - 1));
    return;
  }
  if (key.return === true) {
    const row = rows[at];
    if (row !== undefined) {
      setRowEdit({ section: rowSection, index: at, input: { value: row.value, cursor: row.value.length } });
    }
    return;
  }
  if (rowSection !== 'params' && (input === 'a' || input === 'A')) {
    setRowAddPrompt({ section: rowSection, input: { value: '', cursor: 0 }, error: null });
    return;
  }
  return;
}
