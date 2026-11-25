// tui/zones/routes: use-routes-body-editor — the request-body editor plumbing: live draft/error reads, scalar/add/raw confirms and the editor tree / rules-panel key actions.
import type { RoutesBaseCtx } from './use-routes-derived.js';
import {
  addEntryAtPath,
  addHiddenKey,
  addOnlyKey,
  type BodyEditError,
  changeTypeAtPath,
  clampTreeSelection,
  clearTreeRules,
  findParentIndex,
  flattenJson,
  foldNextDepthLevel,
  getValueAtPath,
  type JsonTreeState,
  moveTreeSelection,
  parseRawJsonBuffer,
  removeActiveRule,
  resolveAddParentPath,
  scalarKindOf,
  setValueAtPath,
  toggleFoldPath,
  toggleHideNulls,
  type TreeKeyAction,
  type TreePanelAction,
  unfoldNextDepthLevel,
  validateScalarText,
} from '../../../shared/components/json-tree/model.js';
import { createMultiline, moveToOffset, multilineText } from '../../../shared/components/inputs/multiline-edit.js';
import { bodyTreeKey } from '../logic/routes-request.logic.js';

export function useRoutesBodyEditor(c: RoutesBaseCtx) {
  const {
    useStore, updateJsonTreeState, updateBodyDraft, setBodyEditError, setBodyEditErrors, setFilterPanelOpen,
    setPanelCursor, scalarEdit, setScalarEdit, addPrompt, setAddPrompt, rawEditor, setRawEditor,
    editorRouteKey, editorTreeState, editorRows, editorViewport,
  } = c;
  // Editor plumbing. Drafts and error maps are read live from the store at apply time (never the
  // render closure), so two composed updates in one tick compute from the latest state instead
  // of a stale draft.
  const amendEditorTreeState = (recipe: (live: JsonTreeState) => JsonTreeState | null) => {
    if (editorRouteKey === null) {
      return;
    }
    const key = bodyTreeKey(editorRouteKey);
    updateJsonTreeState(key, (live) => recipe(live) ?? live);
  };

  const frameEditorTreeState = (snapshot: JsonTreeState, draft: unknown) => {
    const rules = { hiddenKeys: snapshot.hiddenKeys, onlyKeys: snapshot.onlyKeys, hideNulls: snapshot.hideNulls };
    const rows = draft === undefined ? [] : flattenJson(draft, snapshot.foldedPaths, rules);
    return { rules, rows, selected: clampTreeSelection(snapshot.selected, rows.length) };
  };

  const editorWithClampedSelection = (previous: JsonTreeState, draft: unknown) => {
    const frame = frameEditorTreeState(previous, draft);
    return clampTreeSelection(previous.selected, frame.rows.length);
  };

  const readEditorDraft = (): unknown => {
    if (editorRouteKey === null) {
      return undefined;
    }
    const live = useStore.getState().bodyDrafts;
    return Object.prototype.hasOwnProperty.call(live, editorRouteKey) ? live[editorRouteKey] : undefined;
  };

  const readEditorErrors = (): Record<string, BodyEditError> => {
    if (editorRouteKey === null) {
      return {};
    }
    return useStore.getState().bodyEditErrors[editorRouteKey] ?? {};
  };

  const scalarToEditableText = (value: unknown): string => {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return 'null';
  };

  const editLabelFor = (path: string): string => {
    const row = editorRows.find((candidate) => candidate.path === path);
    const key = row?.key ?? (row?.index !== null && row?.index !== undefined ? `[${row.index}]` : null);
    return key === null || key === '' ? 'Edit value' : `Edit ${key}`;
  };

  const confirmScalarEdit = () => {
    if (editorRouteKey === null || scalarEdit === null) {
      return;
    }
    const routeKey = editorRouteKey;
    const { path, kind, input } = scalarEdit;
    const draft = readEditorDraft();
    // An already-errored path re-validates against its pre-error kind (the draft holds
    // a string by now), so fixing the text restores the original kind's value.
    const effectiveKind = readEditorErrors()[path]?.kind ?? kind;
    const checked = validateScalarText(effectiveKind, input.value);
    if (checked.ok) {
      const result = setValueAtPath(draft, path, checked.value);
      if (result.ok) {
        updateBodyDraft(routeKey, () => result.value);
        setBodyEditError(routeKey, path, null);
      }
    } else {
      // Invalid entries stay in the draft as raw text in error color — never coerced.
      const result = setValueAtPath(draft, path, input.value);
      if (result.ok) {
        updateBodyDraft(routeKey, () => result.value);
      }
      setBodyEditError(routeKey, path, { reason: checked.reason, kind: effectiveKind });
    }
    setScalarEdit(null);
  };

  const confirmAddPrompt = () => {
    if (editorRouteKey === null || addPrompt === null) {
      return;
    }
    const routeKey = editorRouteKey;
    const draft = readEditorDraft();
    const result = addEntryAtPath(draft, addPrompt.parentPath, addPrompt.input.value);
    if (!result.ok) {
      // Duplicate/empty names keep the prompt open with the reason inline.
      setAddPrompt({ parentPath: addPrompt.parentPath, input: addPrompt.input, error: result.reason });
      return;
    }
    updateBodyDraft(routeKey, () => result.value);
    amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, result.value) }));
    setAddPrompt(null);
  };

  const leaveRawEditor = () => {
    if (editorRouteKey === null || rawEditor === null) {
      return;
    }
    // An untouched/emptied buffer is a cancel, not a body: parsing `''` would fail and
    // trap the developer (Esc is the only exit), so it closes with nothing written.
    if (multilineText(rawEditor.editor).trim() === '') {
      setRawEditor(null);
      return;
    }
    const routeKey = editorRouteKey;
    const parsed = parseRawJsonBuffer(multilineText(rawEditor.editor));
    if (!parsed.ok) {
      // Invalid JSON keeps the developer in raw mode with the error + line/column;
      // the previous valid body is preserved (nothing is written). The location leads
      // the message so narrow terminals truncate the JSON error text, never the line.
      setRawEditor({
        editor: moveToOffset(rawEditor.editor, parsed.position),
        error: `(line ${parsed.line}, column ${parsed.column}) ${parsed.reason}`,
      });
      return;
    }
    updateBodyDraft(routeKey, () => parsed.value);
    setBodyEditErrors(routeKey, {});
    amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, parsed.value) }));
    setRawEditor(null);
  };

  const applyEditorTreeAction = (action: TreeKeyAction) => {
    if (editorRouteKey === null) {
      return;
    }
    const routeKey = editorRouteKey;
    if (action === 'toggle-panel') {
      setFilterPanelOpen(true);
      setPanelCursor(0);
      return;
    }
    if (action === 'up' || action === 'down' || action === 'home' || action === 'end' || action === 'page-up' || action === 'page-down') {
      amendEditorTreeState((live) => {
        const draft = readEditorDraft();
        const frame = frameEditorTreeState(live, draft);
        return {
          ...live,
          selected: moveTreeSelection(frame.selected, frame.rows.length, Math.max(editorViewport, 1), action),
        };
      });
      return;
    }
    if (action === 'open-raw') {
      const draft = readEditorDraft();
      const pretty = draft === undefined ? '' : JSON.stringify(draft, null, 2);
      setRawEditor({ editor: createMultiline(pretty), error: null });
      return;
    }
    const draft = readEditorDraft();
    if (draft === undefined) {
      return;
    }
    switch (action) {
      case 'fold': {
        amendEditorTreeState((live) => {
          const frame = frameEditorTreeState(live, readEditorDraft());
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
        amendEditorTreeState((live) => {
          const frame = frameEditorTreeState(live, readEditorDraft());
          const row = frame.rows[frame.selected];
          if (row === undefined || !row.folded) {
            return null;
          }
          return { ...live, foldedPaths: live.foldedPaths.filter((path) => path !== row.normalizedPath) };
        });
        return;
      }
      case 'fold-level': {
        const value = draft;
        amendEditorTreeState((live) => ({ ...live, foldedPaths: foldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'unfold-level': {
        const value = draft;
        amendEditorTreeState((live) => ({ ...live, foldedPaths: unfoldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'hide-key':
      case 'only-key': {
        amendEditorTreeState((live) => {
          const frame = frameEditorTreeState(live, readEditorDraft());
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
            selected: editorWithClampedSelection({ ...live, hiddenKeys: [...next.hiddenKeys], onlyKeys: [...next.onlyKeys], hideNulls: next.hideNulls }, readEditorDraft()),
          };
        });
        return;
      }
      case 'edit-value': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined || row.kind === 'object' || row.kind === 'array') {
          return;
        }
        const located = getValueAtPath(draft, row.path);
        if (!located.found) {
          return;
        }
        const kind = scalarKindOf(located.value) ?? row.kind;
        if (kind !== 'string' && kind !== 'number' && kind !== 'boolean' && kind !== 'null') {
          return;
        }
        const text = scalarToEditableText(located.value);
        setScalarEdit({ path: row.path, kind, input: { value: text, cursor: text.length } });
        return;
      }
      case 'add-entry': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined) {
          return;
        }
        const parentPath = resolveAddParentPath(draft, row.path);
        if (parentPath === null) {
          return;
        }
        const parent = getValueAtPath(draft, parentPath);
        if (!parent.found) {
          return;
        }
        if (Array.isArray(parent.value)) {
          const result = addEntryAtPath(draft, parentPath);
          if (!result.ok) {
            return;
          }
          // Appending shifts no indices, so sibling errors stay pinned — nothing drops.
          updateBodyDraft(routeKey, () => result.value);
          amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, result.value) }));
          return;
        }
        setAddPrompt({ parentPath, input: { value: '', cursor: 0 }, error: null });
        return;
      }
      case 'change-type': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined || row.kind === 'object' || row.kind === 'array') {
          return;
        }
        // Re-parse failures fall back to kind string inside the model, so only
        // structural failures (missing path) stay inert here.
        const result = changeTypeAtPath(draft, row.path);
        if (!result.ok) {
          return;
        }
        updateBodyDraft(routeKey, () => result.value);
        setBodyEditError(routeKey, row.path, null);
        return;
      }
    }
  };

  const applyEditorPanelAction = (panelAction: TreePanelAction) => {
    if (panelAction.type === 'close-panel') {
      setFilterPanelOpen(false);
      return;
    }
    if (panelAction.type === 'toggle-nulls') {
      amendEditorTreeState((previous) => {
        const next = toggleHideNulls({ hiddenKeys: previous.hiddenKeys, onlyKeys: previous.onlyKeys, hideNulls: previous.hideNulls });
        return { ...previous, hideNulls: next.hideNulls, selected: editorWithClampedSelection(previous, readEditorDraft()) };
      });
      return;
    }
    if (panelAction.type === 'clear-all') {
      amendEditorTreeState((live) => {
        const next = clearTreeRules(frameEditorTreeState(live, readEditorDraft()).rules);
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
      return;
    }
    amendEditorTreeState((live) => {
      const next = removeActiveRule(frameEditorTreeState(live, readEditorDraft()).rules, panelAction.index);
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
  };
  return {
    amendEditorTreeState, frameEditorTreeState, editorWithClampedSelection, readEditorDraft,
    readEditorErrors, scalarToEditableText, editLabelFor, confirmScalarEdit, confirmAddPrompt,
    leaveRawEditor, applyEditorTreeAction, applyEditorPanelAction,
  };
}

export type RoutesBodyEditor = ReturnType<typeof useRoutesBodyEditor>;
