// tui/zones/routes: use-routes-response-tree — the fired-response tree plumbing: amend/frame helpers and the tree / rules-panel key actions.
import type { RoutesBaseCtx } from './use-routes-derived.js';
import {
  addHiddenKey,
  addOnlyKey,
  clampTreeSelection,
  clearTreeRules,
  findParentIndex,
  flattenJson,
  foldNextDepthLevel,
  type JsonTreeState,
  moveTreeSelection,
  removeActiveRule,
  toggleFoldPath,
  toggleHideNulls,
  type TreeKeyAction,
  type TreePanelAction,
  unfoldNextDepthLevel,
} from '../../../shared/components/json-tree/model.js';

export function useRoutesResponseTree(c: RoutesBaseCtx) {
  const { updateJsonTreeState, setFilterPanelOpen, setPanelCursor, firedRouteKey, treeValue, treeViewport } = c;
  // Apply a (possibly null = no-op) tree-state recipe against the store's live state;
  // recipes always derive rows/rules from the live snapshot they receive, so two rapid
  // keypresses before a re-render compose instead of the second discarding the first.
  const amendTreeState = (recipe: (live: JsonTreeState) => JsonTreeState | null) => {
    if (firedRouteKey === null) {
      return;
    }
    const key = firedRouteKey;
    updateJsonTreeState(key, (live) => recipe(live) ?? live);
  };

  // Rows/rules/selection derived from a state snapshot (render-time or live) against
  // the stable fired value.
  const frameTreeState = (snapshot: JsonTreeState) => {
    const rules = { hiddenKeys: snapshot.hiddenKeys, onlyKeys: snapshot.onlyKeys, hideNulls: snapshot.hideNulls };
    const rows = treeValue === undefined ? [] : flattenJson(treeValue, snapshot.foldedPaths, rules);
    return { rules, rows, selected: clampTreeSelection(snapshot.selected, rows.length) };
  };

  // Clamp the cursor against the post-change rows (hiding/filtering can only shrink them).
  const withClampedSelection = (previous: JsonTreeState, rules: { hiddenKeys: readonly string[]; onlyKeys: readonly string[]; hideNulls: boolean }) => {
    const nextRows = treeValue === undefined ? [] : flattenJson(treeValue, previous.foldedPaths, rules);
    return clampTreeSelection(previous.selected, nextRows.length);
  };

  const applyTreeAction = (action: TreeKeyAction) => {
    if (action === 'toggle-panel') {
      setFilterPanelOpen(true);
      setPanelCursor(0);
      return;
    }
    if (action === 'up' || action === 'down' || action === 'home' || action === 'end' || action === 'page-up' || action === 'page-down') {
      amendTreeState((live) => {
        const frame = frameTreeState(live);
        return {
          ...live,
          selected: moveTreeSelection(frame.selected, frame.rows.length, Math.max(treeViewport, 1), action),
        };
      });
      return;
    }
    if (treeValue === undefined) {
      return;
    }
    const value = treeValue;
    switch (action) {
      case 'fold': {
        amendTreeState((live) => {
          const frame = frameTreeState(live);
          const row = frame.rows[frame.selected];
          if (row === undefined) {
            return null;
          }
          const isContainer = row.kind === 'object' || row.kind === 'array';
          if (isContainer && !row.folded) {
            const next = toggleFoldPath(live.foldedPaths, row.normalizedPath, true);
            return next === null ? null : { ...live, foldedPaths: next };
          }
          const parent = findParentIndex(frame.rows, frame.selected);
          return parent === null ? null : { ...live, selected: parent };
        });
        return;
      }
      case 'unfold': {
        amendTreeState((live) => {
          const frame = frameTreeState(live);
          const row = frame.rows[frame.selected];
          if (row === undefined || !row.folded) {
            return null;
          }
          return { ...live, foldedPaths: live.foldedPaths.filter((path) => path !== row.normalizedPath) };
        });
        return;
      }
      case 'fold-level': {
        amendTreeState((live) => ({ ...live, foldedPaths: foldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'unfold-level': {
        amendTreeState((live) => ({ ...live, foldedPaths: unfoldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'hide-key':
      case 'only-key': {
        amendTreeState((live) => {
          const frame = frameTreeState(live);
          const row = frame.rows[frame.selected];
          const next = action === 'hide-key' ? addHiddenKey(frame.rules, row?.key ?? null) : addOnlyKey(frame.rules, row?.key ?? null);
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
        return;
      }
    }
  };

  const applyTreePanelAction = (panelAction: TreePanelAction) => {
    if (panelAction.type === 'close-panel') {
      setFilterPanelOpen(false);
      return;
    }
    if (panelAction.type === 'toggle-nulls') {
      amendTreeState((previous) => {
        const next = toggleHideNulls({ hiddenKeys: previous.hiddenKeys, onlyKeys: previous.onlyKeys, hideNulls: previous.hideNulls });
        return { ...previous, hideNulls: next.hideNulls, selected: withClampedSelection(previous, next) };
      });
      return;
    }
    if (panelAction.type === 'clear-all') {
      amendTreeState((live) => {
        const next = clearTreeRules(frameTreeState(live).rules);
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
      return;
    }
    amendTreeState((live) => {
      const next = removeActiveRule(frameTreeState(live).rules, panelAction.index);
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
  };
  return {
    amendTreeState, frameTreeState, withClampedSelection, applyTreeAction, applyTreePanelAction,
  };
}

export type RoutesResponseTree = ReturnType<typeof useRoutesResponseTree>;
