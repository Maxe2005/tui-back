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
  // Scroll position (index of the first visible line) and the row budget for the list — paths and error messages are unbounded, so every line is truncated to one row and
  // the whole listing is windowed (NFR-7) instead of letting wrapped text overflow the modal.
  scroll?: number;
  maxVisibleRows?: number;
};

type IssueLine = { key: string; text: string; color: string };

// One physical row per entry: the view renders each with wrap="truncate-end", so the line
// count is exactly the scrollable length (the zone's key handler clamps against it).
export function buildIssuesLines(
  unreachable: readonly string[],
  errors: readonly BranchDivergenceEntryError[],
): IssueLine[] {
  const lines: IssueLine[] = [];
  const gap = (key: string) => lines.push({ key, text: ' ', color: colors.text });
  unreachable.forEach((path, index) => {
    const { reason, suggestion } = explainUnreachable();
    lines.push({ key: `u${index}`, text: `${path} — ${reason}`, color: colors.warning });
    lines.push({ key: `u${index}s`, text: `  → ${suggestion}`, color: colors['text-dim'] });
    gap(`u${index}g`);
  });
  errors.forEach((entry, index) => {
    const { reason, suggestion } = explainIssueErrorCode(entry.code);
    lines.push({ key: `e${index}`, text: `${entry.path} — ${reason}`, color: colors.error });
    lines.push({ key: `e${index}m`, text: `  ${entry.message}`, color: colors['text-dim'] });
    lines.push({ key: `e${index}s`, text: `  → ${suggestion}`, color: colors['text-dim'] });
    gap(`e${index}g`);
  });
  return lines;
}

// The two ▲/▼ indicator rows are always reserved so the dialog's height never jumps while
// scrolling; the zone's key handler clamps `scroll` against the same figures.
export function issuesWindowSize(maxVisibleRows: number): number {
  return Math.max(maxVisibleRows - 2, 1);
}

export function maxIssuesScroll(lineCount: number, maxVisibleRows: number): number {
  return Math.max(lineCount - issuesWindowSize(maxVisibleRows), 0);
}

export function IssuesDialogView({ unreachable, errors, scroll = 0, maxVisibleRows = 12 }: IssuesDialogViewProps) {
  const lines = buildIssuesLines(unreachable, errors);
  const windowSize = issuesWindowSize(maxVisibleRows);
  const top = Math.min(Math.max(scroll, 0), maxIssuesScroll(lines.length, maxVisibleRows));
  const visible = lines.slice(top, top + windowSize);
  return (
    <ModalDialog title="SERVICE LISTING ISSUES" onConfirm={() => {}} onCancel={() => {}} open={true}>
      <Box flexDirection="column">
        {lines.length === 0 ? <Text color={colors.text}>No issues.</Text> : null}
        {top > 0 ? <Text color={colors['text-dim']}>▲ more above</Text> : null}
        {visible.map((line) => (
          <Text key={line.key} color={line.color} wrap="truncate-end">
            {line.text}
          </Text>
        ))}
        {top + windowSize < lines.length ? <Text color={colors['text-dim']}>▼ more below</Text> : null}
        <Text color={colors['text-dim']} wrap="truncate-end">
          [↑/↓] scroll · [Esc] close
        </Text>
      </Box>
    </ModalDialog>
  );
}
