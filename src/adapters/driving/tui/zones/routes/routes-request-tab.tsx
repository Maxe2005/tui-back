// tui/zones/routes/request tab: the Routes right pane's sub-tab strip and its Request tab view
// (Params, Query, Headers, Body sections). Stateless: the zone owns the keys, the cursor and the
// inline editors; the Body section renders whatever editor node the zone hands it
// (JsonTreeEditor / JsonRawEditor) inside a measured box.
import type { ReactNode } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { ListRow } from '../../shared/components/list-row.js';
import type { TextInputState } from '../../shared/components/text-edit.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { colors } from '../../shared/theme/theme.js';
import type { RoutesPaneTab } from '../../store/slices/routes-slice.js';
import {
  REQUEST_SECTION_LABELS,
  type RequestDraft,
  type RequestRow,
  type RequestRowSection,
  type RequestSection,
} from './routes-request.logic.js';

// Rows shown per Params/Query/Headers section before the list windows (the Body keeps
// the remaining height).
const MAX_SECTION_ROWS = 4;

const PANE_TAB_LABELS: Record<RoutesPaneTab, string> = { saved: 'Saved', request: 'Request', response: 'Response' };

// The active tab is marked and bold; the strip turns accent while the pane holds focus
// (the pane's "title highlighted" focus cue).
export function RoutesPaneTabStrip({ tabs, active, focused }: { tabs: readonly RoutesPaneTab[]; active: RoutesPaneTab; focused: boolean }) {
  return (
    <Box flexDirection="row" flexShrink={0}>
      {tabs.map((tab, index) => (
        <Box key={tab} flexShrink={0}>
          {index > 0 ? <Text color={colors['text-dim']}> │ </Text> : null}
          <Text
            color={tab === active ? (focused ? colors.accent : colors.text) : colors['text-dim']}
            bold={tab === active}
            underline={tab === active && focused}
          >
            {tab === active ? `▸ ${PANE_TAB_LABELS[tab]}` : PANE_TAB_LABELS[tab]}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function formatRequestRow(row: RequestRow): string {
  return `${row.name}${row.required ? '*' : ''} = ${row.value === '' ? '—' : row.value}`;
}

function SectionHeader({ section, active, focused, count }: { section: RequestSection; active: boolean; focused: boolean; count?: number }) {
  return (
    <Text color={active && focused ? colors.accent : colors['text-dim']} bold={active} wrap="truncate-end">
      {`${active ? '▸ ' : '  '}${REQUEST_SECTION_LABELS[section].toUpperCase()}${count !== undefined && count > 0 ? ` (${count})` : ''}`}
    </Text>
  );
}

export type RoutesRequestTabProps = {
  draft: RequestDraft | null;
  // null while the pane is unfocused (a preview: no active section).
  section: RequestSection | null;
  focused: boolean;
  rowCursor: number;
  rowEdit: { section: RequestRowSection; index: number; input: TextInputState } | null;
  rowAddPrompt: { section: 'query' | 'headers'; input: TextInputState; error: string | null } | null;
  hasBody: boolean;
  fireBlock: string | null;
  bodyAreaRef: { current: DOMElement | null };
  body: ReactNode;
};

export function RoutesRequestTab({ draft, section, focused, rowCursor, rowEdit, rowAddPrompt, hasBody, fireBlock, bodyAreaRef, body }: RoutesRequestTabProps) {
  const rowSections: RequestRowSection[] = ['params', 'query', 'headers'];
  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      {fireBlock !== null ? (
        <Text color={colors.error} wrap="truncate-end">
          {fireBlock}
        </Text>
      ) : null}
      {rowSections.map((rowSection) => {
        const rows = draft === null ? [] : draft[rowSection];
        const active = section === rowSection;
        const cursor = rows.length === 0 ? 0 : Math.min(rowCursor, rows.length - 1);
        return (
          <Box key={rowSection} flexDirection="column" flexShrink={0}>
            <SectionHeader section={rowSection} active={active} focused={focused} count={rows.length} />
            {rows.length === 0 ? (
              <Text color={colors['text-dim']}>    (none)</Text>
            ) : (
              <BoundedList
                items={rows}
                maxVisibleRows={MAX_SECTION_ROWS}
                cursorIndex={active ? cursor : 0}
                renderItem={(row, index) =>
                  rowEdit !== null && rowEdit.section === rowSection && rowEdit.index === index ? (
                    <Box key={`${row.name}#${index}`} paddingLeft={2}>
                      <TextInputLine label={`${row.name}${row.required ? '*' : ''}`} value={rowEdit.input.value} cursor={rowEdit.input.cursor} focused />
                    </Box>
                  ) : (
                    <ListRow key={`${row.name}#${index}`} label={formatRequestRow(row)} selected={active && focused && index === cursor} />
                  )
                }
              />
            )}
            {rowAddPrompt !== null && rowAddPrompt.section === rowSection ? (
              <Box flexDirection="column" paddingLeft={2}>
                <TextInputLine label="New name" value={rowAddPrompt.input.value} cursor={rowAddPrompt.input.cursor} focused />
                {rowAddPrompt.error !== null ? <Text color={colors.error}>{rowAddPrompt.error}</Text> : null}
              </Box>
            ) : null}
          </Box>
        );
      })}
      <SectionHeader section="body" active={section === 'body'} focused={focused} />
      {hasBody ? (
        <Box ref={bodyAreaRef} flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
          {body}
        </Box>
      ) : (
        <Text color={colors['text-dim']}>    (no body for this route)</Text>
      )}
    </Box>
  );
}
