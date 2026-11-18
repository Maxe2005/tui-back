// tui/zones/edts/dialogs: the "fast-forward the shared branches" results dialog (story 2.48) —
// one row per managed service, glyph AND colour per outcome (never colour alone), through a
// BoundedList so any number of services stays inside the terminal. Running: nothing to press.
// Done: Enter/Esc close it (the zone's useInput handles keys, like the issues dialog).
import { Box } from 'ink';
import type { FastForwardSharedRow } from '../../../../../../core/edt/fast-forward-shared.js';
import { BoundedList } from '../../../shared/components/bounded-list.js';
import { ModalDialog } from '../../../shared/components/modal-dialog.js';
import { StateLine } from '../../../shared/components/state-line.js';
import { TruncatedText } from '../../../shared/components/truncated-text.js';
import { colors } from '../../../shared/theme/theme.js';
import type { FastForwardDialogState } from '../edts-zone.logic.js';

type Badge = { glyph: string; color: string; label: string };

export const FAST_FORWARD_BADGES: Record<FastForwardSharedRow['outcome'], Badge> = {
  'fast-forwarded': { glyph: '✔', color: colors.success, label: 'fast-forwarded' },
  'up-to-date': { glyph: '=', color: colors['text-dim'], label: 'up to date' },
  skipped: { glyph: '–', color: colors.warning, label: 'skipped' },
  failed: { glyph: '✖', color: colors.error, label: 'failed' },
};

// "✔ api — fast-forwarded (development)", "– web — skipped (dirty)", "✖ lib — failed: <first line>".
export function describeFastForwardRow(row: FastForwardSharedRow): string {
  const badge = FAST_FORWARD_BADGES[row.outcome];
  const reason = row.outcome === 'skipped' && row.reason !== undefined ? ` (${row.reason})` : '';
  const branch = row.outcome === 'fast-forwarded' || row.outcome === 'up-to-date' ? ` (${row.branch})` : '';
  const firstLine = row.detail?.split('\n')[0] ?? '';
  const detail = row.outcome === 'failed' && firstLine !== '' ? `: ${firstLine}` : '';
  return `${badge.glyph} ${row.service} — ${badge.label}${reason}${branch}${detail}`;
}

// "2 fast-forwarded · 1 skipped" — zero counts are left out.
export function describeFastForwardSummary(rows: readonly FastForwardSharedRow[]): string {
  const order = ['fast-forwarded', 'up-to-date', 'skipped', 'failed'] as const;
  const parts = order
    .map((outcome) => ({ outcome, count: rows.filter((row) => row.outcome === outcome).length }))
    .filter(({ count }) => count > 0)
    .map(({ outcome, count }) => `${count} ${FAST_FORWARD_BADGES[outcome].label}`);
  return parts.length > 0 ? parts.join(' · ') : 'no shared branch to fast-forward';
}

export function FastForwardDialogView({ dialog }: { dialog: FastForwardDialogState }) {
  return (
    <ModalDialog title="FAST-FORWARD SHARED BRANCHES" open={true}>
      <Box flexDirection="column">
        {dialog.status === 'running' ? <StateLine kind="loading" subject="the shared branches" verb="Fast-forwarding" /> : null}
        {dialog.status === 'done' ? (
          <TruncatedText color={colors.text}>{`Done: ${describeFastForwardSummary(dialog.rows)}`}</TruncatedText>
        ) : null}
        {dialog.error !== null ? <TruncatedText color={colors.error}>{dialog.error}</TruncatedText> : null}
        <BoundedList
          items={dialog.rows}
          chromeRows={8}
          renderItem={(row, index) => (
            <TruncatedText key={`${row.repoPath}:${index}`} color={FAST_FORWARD_BADGES[row.outcome].color}>
              {`  ${describeFastForwardRow(row)}`}
            </TruncatedText>
          )}
        />
      </Box>
    </ModalDialog>
  );
}
