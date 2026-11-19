// tui/zones/routes: routes-zone.nodes — builds the request-body editor node and the fired-response node handed to the right pane.
import type { ReactElement } from 'react';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import { JsonEmptyState, JsonRawEditor, JsonRawFallback, JsonTree, JsonTreeEditor } from '../../shared/components/json-tree/json-tree.js';

export function renderBodyNode(c: RoutesZoneCtx): ReactElement {
  const {
    filterPanelOpen, scalarEdit, addPrompt, rawEditor, editorDraft, editorTreeState, editorRows,
    editorHiddenCount, editorRuleList, editorErrors, editorFirstError, clampedEditorSelected,
    clampedEditorPanelCursor, bodyTotalBudget, editorOpen, editLabelFor,
  } = c;
  return (
  rawEditor !== null && editorOpen ? (
    <JsonRawEditor input={rawEditor.input} error={rawEditor.error} maxVisibleRows={bodyTotalBudget} />
  ) : (
    <JsonTreeEditor
      rows={editorRows}
      selected={clampedEditorSelected}
      hiddenCount={editorHiddenCount}
      rules={editorRuleList}
      hideNulls={editorTreeState.hideNulls}
      panelOpen={editorOpen && filterPanelOpen}
      panelCursor={clampedEditorPanelCursor}
      maxVisibleRows={bodyTotalBudget}
      bodyEmpty={editorDraft === undefined}
      editErrors={editorErrors}
      firstError={editorFirstError}
      editingPath={editorOpen ? (scalarEdit?.path ?? null) : null}
      editInput={editorOpen ? (scalarEdit?.input ?? null) : null}
      editLabel={scalarEdit !== null ? editLabelFor(scalarEdit.path) : 'Edit value'}
      addPrompt={editorOpen ? addPrompt : null}
    />
  )
  );
}

export function renderResponseNode(c: RoutesZoneCtx): ReactElement | null {
  const {
    filterPanelOpen, fireResult, classification, treeState, treeValue, treeRows, treeHiddenCount,
    treeActiveRuleCount, treeRuleList, clampedPanelCursor, clampedTreeSelected, rawLines, clampedRawSelected,
    treeTotalBudget, treeActive,
  } = c;
  return (
  classification === null || fireResult === null ? null : classification.kind === 'json' && treeValue !== undefined ? (
    <JsonTree
      rows={treeRows}
      selected={clampedTreeSelected}
      hiddenCount={treeHiddenCount}
      activeRuleCount={treeActiveRuleCount}
      rules={treeRuleList}
      hideNulls={treeState.hideNulls}
      panelOpen={treeActive && filterPanelOpen}
      panelCursor={clampedPanelCursor}
      maxVisibleRows={treeTotalBudget}
    />
  ) : classification.kind === 'raw' ? (
    <JsonRawFallback reason={classification.reason} lines={rawLines} selected={clampedRawSelected} maxVisibleRows={treeTotalBudget} />
  ) : classification.kind === 'empty' ? (
    <JsonEmptyState emptyKind={classification.emptyKind} />
  ) : null
  );
}
