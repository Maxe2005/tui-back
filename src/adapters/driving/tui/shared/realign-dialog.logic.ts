// tui/shared/realign-dialog: the realign overlay's pure decisions — which view shows, what a key
// does, the footer context, the table cells and the per-row badges and summary. The component
// only feeds raw Ink keys here and dispatches the result to the store.
import type { DriftCandidate } from '../../../../core/dashboard/drift.js';
import { REALIGN_SCOPES, cycleRealignScope, type RealignScope } from '../../../../core/ports/settings.js';
import type { FooterContextId } from '../keybindings/index.js';
import type { RealignCandidates, RealignLiveRow, RealignLiveStatus, RealignRun } from '../store/app-store.js';
import { nextCursorForKey } from './keys/list-cursor.js';
import { STATUS_BADGES } from './components/status-badge.js';
import { colors } from './theme/theme.js';

export const REALIGN_PRESET_LABELS: Record<RealignScope, string> = {
  none: 'Aucun',
  edt: "Services de l'EDT",
  all: 'Tous',
};

export const REALIGN_ALIGNED_MESSAGE = 'All services are aligned — nothing to realign.';
export const REALIGN_NO_SELECTION_MESSAGE = 'No service selected — check at least one to realign.';

export type RealignView = 'loading' | 'error' | 'empty' | 'select' | 'run';

export function realignView(candidates: RealignCandidates | null, run: RealignRun | null): RealignView {
  if (run !== null) {
    return 'run';
  }
  if (candidates === null || candidates.status === 'loading') {
    return 'loading';
  }
  if (candidates.status === 'error') {
    return 'error';
  }
  return candidates.rows.length === 0 ? 'empty' : 'select';
}

// From the preset the selection matches; a hand-edited selection starts over at the first one.
export function nextRealignPreset(current: RealignScope | null): RealignScope {
  return current === null ? REALIGN_SCOPES[0] : cycleRealignScope(current, 1);
}

export type RealignKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

export type RealignAction =
  | { type: 'ignore' }
  | { type: 'close' }
  | { type: 'move'; cursor: number }
  | { type: 'toggle' }
  | { type: 'preset' }
  | { type: 'restart'; direction: 1 | -1 }
  | { type: 'confirm' };

export function resolveRealignKey(
  input: string,
  key: RealignKey,
  state: { view: RealignView; runStatus: RealignRun['status'] | null; cursor: number; rowCount: number; selectedCount: number },
): RealignAction {
  if (state.view === 'run') {
    // Nothing interrupts a running realign; its result closes on Enter or Esc.
    return state.runStatus !== 'running' && (key.escape === true || key.return === true) ? { type: 'close' } : { type: 'ignore' };
  }
  if (key.escape === true) {
    return { type: 'close' };
  }
  if (state.view !== 'select') {
    return state.view === 'empty' && key.return === true ? { type: 'close' } : { type: 'ignore' };
  }
  if (key.ctrl === true || key.meta === true) {
    return { type: 'ignore' };
  }
  const cursor = nextCursorForKey(
    { upArrow: key.upArrow === true, downArrow: key.downArrow === true, home: key.home === true, end: key.end === true },
    state.cursor,
    state.rowCount,
  );
  if (cursor !== null) {
    return { type: 'move', cursor };
  }
  if (input === ' ') {
    return { type: 'toggle' };
  }
  if (input === 'p') {
    return { type: 'preset' };
  }
  if (key.leftArrow === true || key.rightArrow === true) {
    return { type: 'restart', direction: key.leftArrow === true ? -1 : 1 };
  }
  // An empty selection disables the confirmation.
  return key.return === true && state.selectedCount > 0 ? { type: 'confirm' } : { type: 'ignore' };
}

export function realignFooterContext(view: RealignView, runStatus: RealignRun['status'] | null, selectedCount: number): FooterContextId {
  if (view === 'run') {
    return runStatus === 'running' ? 'busy' : 'close';
  }
  if (view === 'select') {
    return selectedCount > 0 ? 'realign-select' : 'realign-select-empty';
  }
  return view === 'empty' ? 'close' : 'dismiss';
}

export type RealignCell = { text: string; color?: string };

// Checkbox and service, current branch, expected branch, member/other — all text, never colour alone.
export function realignCells(row: DriftCandidate, selected: boolean): RealignCell[] {
  const dim = selected ? {} : { color: colors['text-dim'] };
  return [
    { text: `${selected ? '[x]' : '[ ]'} ${row.service}`, ...dim },
    { text: row.branch ?? 'detached', ...dim },
    { text: row.expectedBranch, ...dim },
    { text: row.kind, color: colors['text-dim'] },
  ];
}

type Badge = { glyph: string; color: string; label: string };

export const REALIGN_STATUS_BADGES: Record<RealignLiveStatus, Badge> = {
  pending: { glyph: '·', color: colors['text-dim'], label: 'pending' },
  realigning: { ...STATUS_BADGES['in-progress'], label: 'realigning' },
  realigned: { glyph: '✔', color: colors.success, label: 'realigned' },
  unchanged: { glyph: '=', color: colors['text-dim'], label: 'already aligned' },
  skipped: { glyph: '⚠', color: colors.warning, label: 'skipped' },
  failed: { ...STATUS_BADGES.failed, label: 'failed' },
};

// "api — realigned", "web — skipped: web has uncommitted changes…".
export function describeRealignRow(row: RealignLiveRow): string {
  const badge = REALIGN_STATUS_BADGES[row.status];
  const detail = (row.status === 'skipped' || row.status === 'failed') && row.detail !== undefined ? `: ${row.detail.message}` : '';
  return `${badge.glyph} ${row.service} — ${badge.label}${detail}`;
}

const STATUS_ORDER: readonly RealignLiveStatus[] = ['failed', 'skipped', 'realigning', 'pending', 'realigned', 'unchanged'];

// Stable sort, non-green first: failed, skipped, then the rest.
export function orderRealignRows(rows: readonly RealignLiveRow[]): RealignLiveRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.row.status) - STATUS_ORDER.indexOf(b.row.status) || a.index - b.index)
    .map((entry) => entry.row);
}

// "2 realigned · 1 skipped" — zero counts are left out.
export function describeRealignSummary(rows: readonly RealignLiveRow[]): string {
  const order = ['realigned', 'unchanged', 'skipped', 'failed'] as const;
  const parts = order
    .map((status) => ({ status, count: rows.filter((row) => row.status === status).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${REALIGN_STATUS_BADGES[entry.status].label}`);
  return parts.length > 0 ? parts.join(' · ') : 'nothing realigned';
}
