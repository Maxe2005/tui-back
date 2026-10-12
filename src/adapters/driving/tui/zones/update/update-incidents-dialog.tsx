// tui/zones/update: the incident queue popup. Lists every pending incident (service,
// kind, age) through a BoundedList next to the guided menu of the selected one. Purely
// presentational — the zone owns the keys, the cursor and the mode.
import { Box, Text } from 'ink';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';
import { ListRow } from '../../shared/components/list-row.js';
import { MenuList } from '../../shared/components/menu-list.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { colors } from '../../shared/theme/theme.js';
import type { UpdateIncident } from '../../store/slices/update-slice.js';
import { formatIncidentRow, UPDATE_INCIDENTS_TITLE } from './update-incidents.logic.js';
import { blockerMenuItems, formatBlockerBody, formatBlockerRetry } from './update-zone.js';

// Rows the dialog keeps for its frame, body and menu around the incident list.
const INCIDENT_LIST_MAX_ROWS = 6;

export function UpdateIncidentsDialog({
  incidents,
  selected,
  mode,
  menuCursor,
  editorError,
  now,
}: {
  incidents: readonly UpdateIncident[];
  selected: number;
  // `list`: arrows pick an incident; `menu`: its guided menu owns the cursor.
  mode: 'list' | 'menu';
  menuCursor: number;
  editorError: string | null;
  now: number;
}) {
  const current = incidents[selected];
  return (
    <ModalDialog title={`${UPDATE_INCIDENTS_TITLE} (${incidents.length})`} open>
      <Box flexDirection="column">
        <BoundedList
          items={incidents}
          maxVisibleRows={INCIDENT_LIST_MAX_ROWS}
          cursorIndex={selected}
          renderItem={(incident, index) => (
            <ListRow key={incident.id} label={formatIncidentRow(incident, now)} selected={index === selected} />
          )}
        />
        {current !== undefined ? (
          <Box flexDirection="column" marginTop={1}>
            <ClampedParagraph color={colors.text} maxLines={3}>{formatBlockerBody(current.blocker)}</ClampedParagraph>
            {formatBlockerRetry(current.blocker) !== null ? (
              <ClampedParagraph color={colors.warning} maxLines={3}>{`${formatBlockerRetry(current.blocker)}`}</ClampedParagraph>
            ) : null}
            {current.stillBlocked !== undefined ? (
              <ClampedParagraph color={colors.warning} maxLines={3}>{`↻ Still blocked — ${current.stillBlocked.reason}`}</ClampedParagraph>
            ) : null}
            {editorError !== null ? <ClampedParagraph color={colors.error} maxLines={3}>{`✖ ${editorError}`}</ClampedParagraph> : null}
            <MenuList items={blockerMenuItems(current.blocker.kind)} cursor={mode === 'menu' ? menuCursor : -1} />
            {mode === 'list' ? (
              <Text color={colors['text-dim']} wrap="truncate-end">Enter: choose for this incident · Esc: close (nothing resolved)</Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
