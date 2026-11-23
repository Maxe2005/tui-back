// tui/zones/routes: routes-detail-pane — the right pane: route detail, sub-tab strip and the Request / Saved / Response tab views.
import type { ReactNode } from 'react';
import { Box } from 'ink';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import { ClampedParagraph } from '../../shared/components/display/truncated-text.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ROUTES_PANE_TABS } from '../../store/slices/routes-slice.js';
import { RoutesPaneTabStrip, RoutesRequestTab } from './routes-request-tab.js';
import { RoutesResponseTab } from './routes-response-tab.js';
import { RoutesSavedTab } from './routes-saved-tab.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatRouteDetail } from './routes-zone.logic.js';

export function RoutesDetailPane({
  c,
  focused,
  bodyNode,
  responseNode,
}: {
  c: RoutesZoneCtx;
  focused: RoutesZoneCtx['visibleRoutes'][number] | undefined;
  bodyNode: ReactNode;
  responseNode: ReactNode;
}) {
  const {
    paneTab, savedRequests, savedRequestsError, section, rowCursor, rowEdit, rowAddPrompt, fireBlock,
    savePrompt, saveNotice, savedTabState, savedTabError, responseAreaRef, bodyAreaRef, paneFocused,
    paneResponse, paneDraft, paneHasBody, savedTabItems,
  } = c;
  return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
        {focused ? <DetailPane title="Route">{formatRouteDetail(focused)}</DetailPane> : null}
        {focused ? <RoutesPaneTabStrip tabs={ROUTES_PANE_TABS} active={paneTab} focused={paneFocused} /> : null}
        {focused && paneTab === 'request' ? (
          <RoutesRequestTab
            draft={paneDraft}
            section={paneFocused ? section : null}
            focused={paneFocused}
            rowCursor={rowCursor}
            rowEdit={rowEdit}
            rowAddPrompt={rowAddPrompt}
            hasBody={paneHasBody}
            fireBlock={paneFocused ? fireBlock : null}
            bodyAreaRef={bodyAreaRef}
            body={bodyNode}
          />
        ) : null}
        {focused && paneTab === 'request' && savePrompt !== null ? (
          <Box flexDirection="column">
            <TextInputLine label="Name" value={savePrompt.input.value} cursor={savePrompt.input.cursor} focused />
            {savePrompt.error !== null ? <ClampedParagraph color={colors.error} maxLines={4}>{`${savePrompt.error}`}</ClampedParagraph> : null}
          </Box>
        ) : null}
        {focused && paneTab === 'request' && saveNotice !== null && savePrompt === null ? (
          <DimAnnotation text={saveNotice} />
        ) : null}
        {focused && paneTab === 'saved' ? (
          <RoutesSavedTab
            items={savedTabItems}
            pickState={savedTabState}
            error={paneFocused ? (savedTabError ?? savedRequestsError?.message ?? null) : null}
            isLoaded={savedRequests !== null}
          />
        ) : null}
        {focused && paneTab === 'response' ? (
          <RoutesResponseTab response={paneResponse} focused={paneFocused} areaRef={responseAreaRef}>
            {responseNode}
          </RoutesResponseTab>
        ) : null}
      </Box>
  );
}
