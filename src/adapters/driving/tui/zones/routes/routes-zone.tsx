// tui/zones/routes: the Routes zone — a resizable list/detail split of the repo's discovered
// routes (BoundedList of ListRows) with an inline filter, and a focusable right pane with
// Saved | Request | Response sub-tabs. `Enter` opens the Request tab (the list never fires);
// `Ctrl+R` fires the draft. While the pane holds focus it captures the keyboard from AppShell;
// `Esc` unwinds sub-editors, then Response → Request and Saved → list, then back to the list.
import { Box } from 'ink';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import { ClampedParagraph } from '../../shared/components/display/truncated-text.js';
import { DimAnnotation } from '../../shared/components/feedback/dim-annotation.js';
import { FooterContext } from '../../shared/components/chrome/footer-context.js';
import { ROUTES_LIST_CHROME_ROWS } from './routes-zone.constants.js';
import { RoutesDetailPane } from './routes-detail-pane.js';
import { RoutesListPane } from './routes-list-pane.js';
import { RoutesModals } from './routes-modals.js';
import { StateLine } from '../../shared/components/feedback/state-line.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { canEditRouteBody, resolveAddParentPath } from '../../shared/components/json-tree/model.js';
import { colors } from '../../shared/theme/theme.js';
import { formatRoutesDisabledMessage, RoutesDisabledView, RoutesNoticeView } from './routes-zone.states.js';
import { renderBodyNode, renderResponseNode } from './routes-zone.nodes.js';
import { routesFooterContext } from './routes-zone.logic.js';
import { type AppStore, useAppStore } from '../../store/app-store.js';
import { useRoutesBodyEditor } from './use-routes-body-editor.js';
import { useRoutesDerived } from './use-routes-derived.js';
import { useRoutesEffects } from './use-routes-effects.js';
import { useRoutesInput } from './use-routes-input.js';
import { useRoutesPaneActions } from './use-routes-pane-actions.js';
import { useRoutesResponseTree } from './use-routes-response-tree.js';
import { useRoutesState } from './use-routes-state.js';

export { formatRoutesDisabledMessage };

export function RoutesZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const state = useRoutesState(useStore);
  const derived = useRoutesDerived(state);
  const baseCtx = { ...state, ...derived };
  const responseTree = useRoutesResponseTree(baseCtx);
  const bodyEditor = useRoutesBodyEditor(baseCtx);
  const paneActions = useRoutesPaneActions(baseCtx);
  const ctx: RoutesZoneCtx = { ...baseCtx, ...responseTree, ...bodyEditor, ...paneActions };
  useRoutesEffects(ctx);
  useRoutesInput(ctx);

  const {
    status, carryingServices, routes, routesStatus, routesError, routesRepoPath, paneTab, selected, filter,
    filterEditing, filterPanelOpen, section, rowEdit, rowAddPrompt, savePrompt, savedTabDeleteConfirm,
    scalarEdit, addPrompt, rawEditor, windowSize, listAreaRef, listAreaSize, paneFocused, visibleRoutes,
    paneDraft, classification, editorDraft, editorRows, clampedEditorSelected, editorOpen, treeActive,
  } = ctx;

  if (status === 'disabled') {
    return <RoutesDisabledView carryingServices={carryingServices} />;
  }

  if (routesStatus === 'error' && routesError?.code === 'route-exploration-not-activated') {
    return (
      <RoutesNoticeView filterEditing={filterEditing} paneFocused={paneFocused} useStore={useStore}>
        <StateLine kind="empty" subject="routes" text="No route list for this repo." />
        <DimAnnotation text={routesError.message} />
      </RoutesNoticeView>
    );
  }

  if (routesStatus === 'error') {
    return (
      <RoutesNoticeView filterEditing={filterEditing} paneFocused={paneFocused} useStore={useStore}>
        <ClampedParagraph color={colors.error} maxLines={4}>{`${routesError ? routesError.message : 'Route scan failed.'}`}</ClampedParagraph>
      </RoutesNoticeView>
    );
  }

  if (routesStatus !== 'ready' || routes === null) {
    return (
      <RoutesNoticeView filterEditing={filterEditing} paneFocused={paneFocused} useStore={useStore}>
        <StateLine kind="loading" subject="routes" />
      </RoutesNoticeView>
    );
  }

  if (routes.length === 0) {
    return (
      <RoutesNoticeView filterEditing={filterEditing} paneFocused={paneFocused} useStore={useStore}>
        <StateLine kind="empty" subject="routes" text="No routes discovered for this repo." />
      </RoutesNoticeView>
    );
  }

  const clamped = visibleRoutes.length === 0 ? 0 : Math.min(selected, visibleRoutes.length - 1);
  const focused = visibleRoutes[clamped];
  // Live, measured budget of the flex-bound list area (it sits between the pane's header and
  // hint lines), so the BoundedList — indicator rows included — always fits exactly.
  const maxVisibleRows = listAreaSize !== null ? listAreaSize.height : Math.max(windowSize.rows - ROUTES_LIST_CHROME_ROWS, 3);
  const filterActive = filter.value !== '';
  const focusedEditable = focused !== undefined && canEditRouteBody(focused);
  // The footer reflects editor focus — the sub-editor owns the line while open, the tree mode
  // lists the edit keys. The add key only shows when an add target exists (UX-DR7: never hint an
  // inert key — scalar roots and empty drafts take `r`).
  const editorSelectedRow = editorOpen ? editorRows[clampedEditorSelected] : undefined;
  const editorCanAdd =
    editorSelectedRow !== undefined && editorDraft !== undefined && resolveAddParentPath(editorDraft, editorSelectedRow.path) !== null;
  const rowSectionRows = paneDraft !== null && section !== 'body' ? paneDraft[section] : [];
  const footerContext = routesFooterContext({
    unavailable: false,
    filterEditing,
    paneFocused,
    paneTab,
    saveState: savePrompt === null ? 'none' : savePrompt.duplicate ? 'duplicate' : 'naming',
    savedDeleteConfirm: savedTabDeleteConfirm !== null,
    listEditable: focusedEditable,
    filterPanelOpen,
    responseKind: treeActive ? (classification?.kind ?? null) : null,
    section,
    rowEditing: rowEdit !== null || rowAddPrompt !== null,
    rowCount: rowSectionRows.length,
    editor: { open: editorOpen, raw: rawEditor !== null, editing: scalarEdit !== null || addPrompt !== null, canAdd: editorCanAdd },
  });

  const bodyNode = renderBodyNode(ctx);
  const responseNode = renderResponseNode(ctx);

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface}>
      <FooterContext owner="routes" id={footerContext} useStore={useStore} />
      <ZoneLayout
        zoneId="routes"
        useStore={useStore}
        first={
          <RoutesListPane
            routes={routes}
            visibleRoutes={visibleRoutes}
            routesRepoPath={routesRepoPath}
            filter={filter}
            filterEditing={filterEditing}
            filterActive={filterActive}
            listAreaRef={listAreaRef}
            maxVisibleRows={maxVisibleRows}
            clamped={clamped}
          />
        }
        second={<RoutesDetailPane c={ctx} focused={focused} bodyNode={bodyNode} responseNode={responseNode} />}
      />
      <RoutesModals c={ctx} />
    </Box>
  );
}
