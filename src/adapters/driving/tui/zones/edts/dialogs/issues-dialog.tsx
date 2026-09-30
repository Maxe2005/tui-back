// tui/zones/edts/dialogs: the read-only "SERVICE LISTING ISSUES" dialog (story 2.34) — opened
// with `i` from the issues summary line, closed by Esc/Enter. Unlike every other dialog in
// this zone it carries no payload of its own and submits nothing, so it gets no
// createXDialogHandlers factory (edts-zone.tsx's useInput closes it inline) — just a view,
// fed unreachable/errors straight from the zone's own store selectors.
import { Box, Text } from 'ink';
import type { BranchDivergenceEntryError } from '../../../../../../core/edt/list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import { explainIssueErrorCode, explainUnreachable } from '../edts-zone.logic.js';

export type IssuesDialogViewProps = {
  unreachable: readonly string[];
  errors: readonly BranchDivergenceEntryError[];
};

export function IssuesDialogView({ unreachable, errors }: IssuesDialogViewProps) {
  return (
    <ModalDialog title="SERVICE LISTING ISSUES" onConfirm={() => {}} onCancel={() => {}} open={true} maxHeight={20}>
      <Box flexDirection="column">
        {unreachable.length === 0 && errors.length === 0 ? <Text color={colors.text}>No issues.</Text> : null}
        {unreachable.map((path) => {
          const { reason, suggestion } = explainUnreachable();
          return (
            <Box key={path} flexDirection="column" marginBottom={1}>
              <Text color={colors.warning}>
                {path} — {reason}
              </Text>
              <Text color={colors['text-dim']}>  → {suggestion}</Text>
            </Box>
          );
        })}
        {errors.map((entry, index) => {
          const { reason, suggestion } = explainIssueErrorCode(entry.code);
          return (
            <Box key={`${entry.path}-${index}`} flexDirection="column" marginBottom={1}>
              <Text color={colors.error}>
                {entry.path} — {reason}
              </Text>
              <Text color={colors['text-dim']}>  {entry.message}</Text>
              <Text color={colors['text-dim']}>  → {suggestion}</Text>
            </Box>
          );
        })}
        <Text color={colors.text}>[Esc] close</Text>
      </Box>
    </ModalDialog>
  );
}
