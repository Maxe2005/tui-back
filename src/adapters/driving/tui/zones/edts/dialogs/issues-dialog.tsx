// tui/zones/edts/dialogs: the read-only "SERVICE LISTING ISSUES" dialog — opened with `i` from
// the issues summary line, closed by Esc/Enter. It carries no payload and submits nothing, so it
// has no createXDialogHandlers factory (edts-zone.tsx's useInput closes it inline) — just a
// view fed straight from the zone's store selectors.
import { Box, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import type { BranchDivergenceEntryError } from '../../../../../../core/edt/list.js';
import { BoundedBlocks } from '../../../shared/components/bounded-list.js';
import { TruncatedText } from '../../../shared/components/truncated-text.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import { explainIssueErrorCode, explainUnreachable } from '../edts-zone.logic.js';
import { StateLine } from '../../../shared/components/state-line.js';

export type IssuesDialogViewProps = {
  unreachable: readonly string[];
  errors: readonly BranchDivergenceEntryError[];
};

type IssueBlock = { key: string; rows: number; node: ReactNode };

// Arrow keys move through the issues; each block is 3-4 rows, so the window is row-based.
export function IssuesDialogView({ unreachable, errors }: IssuesDialogViewProps) {
  const [cursor, setCursor] = useState(0);
  const blocks: IssueBlock[] = [
    ...unreachable.map((path, index) => {
      const { reason, suggestion } = explainUnreachable();
      return {
        key: `unreachable-${index}`,
        rows: 3,
        node: (
          <Box flexDirection="column" marginBottom={1}>
            <TruncatedText color={colors.warning}>{`${path} — ${reason}`}</TruncatedText>
            <TruncatedText color={colors['text-dim']}>{`  → ${suggestion}`}</TruncatedText>
          </Box>
        ),
      };
    }),
    ...errors.map((entry, index) => {
      const { reason, suggestion } = explainIssueErrorCode(entry.code);
      return {
        key: `error-${index}`,
        rows: 4,
        node: (
          <Box flexDirection="column" marginBottom={1}>
            <TruncatedText color={colors.error}>{`${entry.path} — ${reason}`}</TruncatedText>
            <TruncatedText color={colors['text-dim']}>{`  ${entry.message}`}</TruncatedText>
            <TruncatedText color={colors['text-dim']}>{`  → ${suggestion}`}</TruncatedText>
          </Box>
        ),
      };
    }),
  ];
  const clamped = Math.min(cursor, Math.max(0, blocks.length - 1));
  useInput((_input, key) => {
    if (key.downArrow) setCursor(Math.min(blocks.length - 1, clamped + 1));
    if (key.upArrow) setCursor(Math.max(0, clamped - 1));
  });
  return (
    <ModalDialog title="SERVICE LISTING ISSUES" open={true}>
      <Box flexDirection="column">
        {blocks.length === 0 ? <StateLine kind="empty" subject="issues" text="No issues." /> : null}
        <BoundedBlocks blocks={blocks} chromeRows={8} cursorIndex={clamped} moreAboveLabel="more issues" moreBelowLabel="more issues" />
      </Box>
    </ModalDialog>
  );
}
