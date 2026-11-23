// tui/zones/routes: routes-zone.response-keys — Response sub-tab keys: Esc unwinds the rules panel then returns to Request; the tree/raw keys follow the tree model.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import {
  clampTreeSelection,
  moveTreeSelection,
  removeActiveRule,
  resolveTreeKeyAction,
  resolveTreePanelKeyAction,
} from '../../../shared/components/json-tree/model.js';

export function handleResponseTabKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    setPaneTab, filterPanelOpen, setFilterPanelOpen, setPanelCursor, classification, treeRuleList,
    clampedPanelCursor, rawLines, rawViewport, amendTreeState, frameTreeState, withClampedSelection,
    applyTreeAction, applyTreePanelAction,
  } = c;
  // Response tab: Esc closes the rules panel first, then returns to Request (the draft is
  // intact there); the tree/raw keys follow the tree model.
  if (key.escape === true) {
    if (filterPanelOpen) {
      setFilterPanelOpen(false);
    } else {
      setPaneTab('request');
    }
    return;
  }
  if (classification === null) {
    return;
  }
  if (classification.kind === 'raw') {
    const move = resolveTreeKeyAction(input, key);
    if (move === 'up' || move === 'down' || move === 'home' || move === 'end' || move === 'page-up' || move === 'page-down') {
      amendTreeState((live) => ({
        ...live,
        selected: moveTreeSelection(
          clampTreeSelection(live.selected, rawLines.length),
          rawLines.length,
          Math.max(rawViewport, 1),
          move,
        ),
      }));
    }
    return;
  }
  if (classification.kind === 'empty') {
    return;
  }
  if (filterPanelOpen) {
    // The open panel auto-owns the arrows: the cursor navigates the rule list
    // immediately (no activation keypress), windowed past 10 rows.
    if (key.upArrow === true) {
      setPanelCursor((prev) => clampTreeSelection(prev - 1, treeRuleList.length));
      return;
    }
    if (key.downArrow === true) {
      setPanelCursor((prev) => clampTreeSelection(prev + 1, treeRuleList.length));
      return;
    }
    if (key.home === true) {
      setPanelCursor(0);
      return;
    }
    if (key.end === true) {
      setPanelCursor(Math.max(0, treeRuleList.length - 1));
      return;
    }
    if (input === ' ' || input === 'd' || input === 'D') {
      if (treeRuleList.length > 0) {
        const at = clampedPanelCursor;
        amendTreeState((live) => {
          const next = removeActiveRule(frameTreeState(live).rules, at);
          if (next === null) {
            return null;
          }
          return {
            ...live,
            hiddenKeys: [...next.hiddenKeys],
            onlyKeys: [...next.onlyKeys],
            hideNulls: next.hideNulls,
            selected: withClampedSelection(live, next),
          };
        });
      }
      return;
    }
    const panelAction = resolveTreePanelKeyAction(input, treeRuleList.length);
    if (panelAction === null) {
      return;
    }
    applyTreePanelAction(panelAction);
    return;
  }
  const action = resolveTreeKeyAction(input, key);
  if (action === null) {
    return;
  }
  applyTreeAction(action);
  return;
}
