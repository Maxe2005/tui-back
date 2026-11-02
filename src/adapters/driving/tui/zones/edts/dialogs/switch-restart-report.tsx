// tui/zones/edts/dialogs: the post-switch restart report (FR-37) — one row per managed service,
// live while the run is in flight (`pending → restarting → verifying → final state`), then a
// summary with the non-green services first. Glyph AND colour per phase, never colour alone; the
// glyph set extends the Update zone's (↻ restarting, ⣾ in progress, ✖ failed, ○ down).
import { Box, Text } from 'ink';
import { orderRestartRows, summarizeRestartRows, type RestartRow, type RestartRowPhase } from '../../../../../../core/edt/switch-restart.js';
import type { AppState } from '../../../store/app-store.js';
import { BoundedList } from '../../../shared/components/bounded-list.js';
import { DimAnnotation } from '../../../shared/components/dim-annotation.js';
import { STATUS_BADGES } from '../../../shared/components/status-badge.js';
import { colors } from '../../../shared/theme/theme.js';

type Badge = { glyph: string; color: string; label: string };

export const RESTART_PHASE_BADGES: Record<RestartRowPhase, Badge> = {
  pending: { glyph: '·', color: colors['text-dim'], label: 'pending' },
  restarting: { ...STATUS_BADGES.restarting, label: 'restarting' },
  verifying: { ...STATUS_BADGES['in-progress'], label: 'verifying' },
  functional: { glyph: '✔', color: colors.success, label: 'functional' },
  'up-unverified': { glyph: '◉', color: colors.info, label: 'up, unverified' },
  unhealthy: { glyph: '⚠', color: colors.warning, label: 'unhealthy' },
  down: { ...STATUS_BADGES.down, label: 'down' },
  failed: { ...STATUS_BADGES.failed, label: 'failed' },
  skipped: { glyph: '–', color: colors['text-dim'], label: 'skipped' },
};

// "api — functional", "web — unhealthy: HTTP 503", "lib — skipped (no container)".
export function describeRestartRow(row: RestartRow): string {
  const badge = RESTART_PHASE_BADGES[row.phase];
  const reason = row.phase === 'skipped' && row.skipReason !== undefined ? ` (${row.skipReason})` : '';
  const detail = row.detail !== undefined && row.detail !== '' ? `: ${row.detail}` : '';
  return `${badge.glyph} ${row.service} — ${badge.label}${reason}${detail}`;
}

// "2 functional · 1 unhealthy · 1 skipped" — zero counts are left out.
export function describeRestartSummary(rows: readonly RestartRow[]): string {
  const summary = summarizeRestartRows(rows);
  const order = ['functional', 'up-unverified', 'unhealthy', 'restarting', 'down', 'failed', 'skipped'] as const;
  const parts = order.filter((key) => summary[key] > 0).map((key) => `${summary[key]} ${RESTART_PHASE_BADGES[key].label}`);
  return parts.length > 0 ? parts.join(' · ') : 'nothing to restart';
}

export function SwitchRestartReport({
  state,
  chromeRows = 0,
  maxVisibleRows,
}: {
  state: NonNullable<AppState['switchRestart']>;
  // Rows the dialog spends around the list (border, title, summary lines) — the list gets the rest.
  chromeRows?: number;
  // Instead of chromeRows: the list's own row budget, when the dialog shares its height with
  // another list.
  maxVisibleRows?: number;
}) {
  const running = state.status === 'running';
  // Live: stable run order. Done: non-green first.
  const rows = running ? state.rows : orderRestartRows(state.rows);
  return (
    <Box flexDirection="column">
      <Text color={colors.text} wrap="truncate-end">
        {running ? `Restarting services (${state.mode})…` : `Restart ${state.mode} finished: ${describeRestartSummary(rows)}`}
      </Text>
      {state.error !== null ? <DimAnnotation text={state.error} /> : null}
      <BoundedList
        items={rows}
        chromeRows={chromeRows}
        {...(maxVisibleRows !== undefined ? { maxVisibleRows } : {})}
        renderItem={(row, index) => (
          <Text key={`${row.repoPath}:${index}`} color={RESTART_PHASE_BADGES[row.phase].color} wrap="truncate-end">
            {'  '}
            {describeRestartRow(row)}
          </Text>
        )}
      />
    </Box>
  );
}
