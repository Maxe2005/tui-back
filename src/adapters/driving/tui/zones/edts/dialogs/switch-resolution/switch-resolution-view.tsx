// tui/zones/edts/dialogs/switch-resolution: the SWITCH EDT resolution view's Ink rendering — the
// intro, Panel A (global strategy), Panel B (the shared BranchPlanTable, then the read-only dim
// state-1 rows), the "Configure <service>" box and the discard confirmation. State and key
// handling live in switch-resolution.logic.ts.
import { Box, Text } from 'ink';
import type { SwitchDirtyRepo } from '../../../../../../../core/edt/switch.js';
import { BoundedList } from '../../../../shared/components/bounded-list.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { BranchPlanTable, PanelTitle, type BranchPlanCell } from '../branch-plan-table.js';
import {
  autoStashedRepos,
  blockedRow,
  boxError,
  buildRows,
  globalOf,
  modeLabel,
  scopeLabel,
  validateRow,
  type LocalBranchList,
  type ResolutionRow,
  type SwitchResolutionBox,
  type SwitchResolutionState,
} from './switch-resolution.logic.js';

const COLUMN_HEADERS = ['Service', 'Scope', 'Current branch', 'Action', 'Target branch'] as const;


function Marker({ focused }: { focused: boolean }) {
  return <Text color={colors.accent} wrap="truncate-end">{focused ? '› ' : '  '}</Text>;
}

function rowCells(row: ResolutionRow, lists: Readonly<Record<string, LocalBranchList>>): BranchPlanCell[] {
  const error = validateRow(row, lists);
  const target = row.plan.kind === 'adopt' ? row.plan.branch : '—';
  return [
    { text: row.repo.service },
    { text: scopeLabel(row.repo) },
    { text: row.repo.currentBranch },
    { text: modeLabel(row.plan), ...(row.plan.kind === 'discard' ? { color: colors.warning } : {}) },
    { text: error !== null ? `✖ ${target === '' ? '—' : target}` : target, ...(error !== null ? { color: colors.error } : {}) },
  ];
}

function ResolutionBoxView({ box, row, lists }: { box: SwitchResolutionBox; row: ResolutionRow; lists: LocalBranchList | undefined }) {
  const { repo, hasOutgoing } = row;
  const focused = (line: SwitchResolutionBox['line']) => box.line === line;
  const live = boxError(box, row, lists);
  const error = live ?? box.error;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold wrap="truncate-end">
        Configure {repo.service}
      </Text>
      <Box>
        <Marker focused={focused('action')} />
        <Text color={focused('action') ? colors.accent : colors.text} wrap="truncate-end">
          {hasOutgoing
            ? `Action: ${box.action === 'adopt' ? '(•)' : '( )'} Adopt ${box.action === 'discard' ? '(•)' : '( )'} Discard`
            : 'Action: (•) Discard'}
        </Text>
      </Box>
      {box.action === 'adopt' ? (
        <Box>
          <Marker focused={focused('branch')} />
          <TextInputLine label="Branch" value={box.branch.value} cursor={box.branch.cursor} focused={focused('branch') && box.editing} />
        </Box>
      ) : null}
      {error !== null ? <Text color={colors.error} wrap="truncate-end">✖ {error}</Text> : null}
      <Box>
        <Marker focused={focused('apply')} />
        <Text color={focused('apply') ? colors.accent : colors.text} bold={focused('apply')}>
          [ Apply ]
        </Text>
      </Box>
    </Box>
  );
}

type ConfirmLine = { key: string; text: string; color: string };

export function discardConfirmLines(rows: readonly ResolutionRow[]): ConfirmLine[] {
  const lines: ConfirmLine[] = [];
  for (const row of rows) {
    if (row.plan.kind !== 'discard') {
      continue;
    }
    const paths = row.repo.dirtyPaths;
    lines.push({
      key: `${row.repo.repoPath}:head`,
      text: paths !== undefined ? `${row.repo.service} (${paths.length} file(s))` : `${row.repo.service} (file list unavailable)`,
      color: colors.warning,
    });
    for (const path of paths ?? []) {
      lines.push({ key: `${row.repo.repoPath}:${path}`, text: `    ${path}`, color: colors.text });
    }
  }
  return lines;
}

function DiscardConfirmView({
  rows,
  scroll,
  error,
  maxVisibleRows,
}: {
  rows: readonly ResolutionRow[];
  scroll: number;
  error: string | null;
  maxVisibleRows: number;
}) {
  const lines = discardConfirmLines(rows);
  const cursor = Math.min(scroll, Math.max(lines.length - 1, 0));
  return (
    <Box flexDirection="column">
      <Text color={colors.error} bold>
        CONFIRM OVERWRITE
      </Text>
      <Text color={colors.text}>
        The following files (tracked changes and untracked files) will be permanently destroyed. This cannot be undone. Files ignored by git are kept.
      </Text>
      <BoundedList
        items={lines}
        maxVisibleRows={maxVisibleRows}
        cursorIndex={cursor}
        moreAboveLabel="files above"
        moreBelowLabel="files below"
        renderItem={(line) => (
          <Text key={line.key} color={line.color} wrap="truncate-end">
            {line.text}
          </Text>
        )}
      />
      {error !== null ? <Text color={colors.error} wrap="truncate-end">✖ {error}</Text> : null}
    </Box>
  );
}

export function SwitchResolutionView({
  state,
  dirty,
  targetTopic,
  maxVisibleRows,
}: {
  state: SwitchResolutionState;
  dirty: readonly SwitchDirtyRepo[];
  targetTopic: string;
  // Panel B's table / the confirmation's file list height budget (NFR-7).
  maxVisibleRows: number;
}) {
  const global = globalOf(state);
  const rows = buildRows(dirty, global);

  if (state.confirm !== null) {
    return <DiscardConfirmView rows={rows} scroll={state.confirm.scroll} error={state.confirm.error} maxVisibleRows={maxVisibleRows} />;
  }

  const box = state.box;
  const boxRow = box !== null ? rows.find((row) => row.repo.repoPath === box.repoPath) : undefined;
  if (box !== null && boxRow !== undefined) {
    return <ResolutionBoxView box={box} row={boxRow} lists={state.lists[box.repoPath]} />;
  }

  const outgoing = state.outgoingTopic;
  const stashed = autoStashedRepos(dirty);
  const globalFocused = state.panel === 'global';
  const lineFocused = (line: 'action' | 'name') => globalFocused && state.globalLine === line;
  const rowsFocused = state.panel === 'rows';
  const blocked = blockedRow(rows, state.lists, state.rowCursor);
  const listsPending = Object.values(state.lists).some((list) => list.status !== 'ready');
  return (
    <Box flexDirection="column">
      <Text color={colors.text} wrap="truncate-end">
        {outgoing !== null
          ? `You are leaving the EDT “${outgoing}” for “${targetTopic}”. These services have uncommitted changes outside “${outgoing}”: adopt them into “${outgoing}” or discard them. Member services of “${outgoing}” are stashed automatically.`
          : `Switch to “${targetTopic}”: these services have uncommitted changes. Member services of the EDT being left are stashed automatically.`}
      </Text>
      <PanelTitle text="GLOBAL STRATEGY" focused={globalFocused} />
      <Box>
        <Marker focused={lineFocused('action')} />
        <Text color={lineFocused('action') ? colors.accent : colors.text} wrap="truncate-end">
          {outgoing !== null
            ? `Default action: ${state.globalAction === 'adopt' ? '(•)' : '( )'} Adopt into ${outgoing}  ${state.globalAction === 'discard' ? '(•)' : '( )'} Discard`
            : 'Default action: (•) Discard'}
        </Text>
      </Box>
      {outgoing === null ? (
        <Text color={colors['text-dim']}>{'  '}No outgoing EDT: there is no EDT to adopt this work into, only discarding is possible.</Text>
      ) : null}
      {outgoing !== null && state.globalAction === 'adopt' ? (
        <Box>
          <Marker focused={lineFocused('name')} />
          <TextInputLine
            label="Global branch name"
            value={state.globalName.value}
            cursor={state.globalName.cursor}
            focused={lineFocused('name') && state.editing}
          />
        </Box>
      ) : null}
      <PanelTitle text="AFFECTED SERVICES" focused={rowsFocused} />
      <BranchPlanTable
        headers={COLUMN_HEADERS}
        rows={rows}
        rowKey={(row) => row.repo.repoPath}
        cells={(row) => rowCells(row, state.lists)}
        cursor={state.rowCursor}
        focused={rowsFocused}
        maxVisibleRows={maxVisibleRows}
        labels={{ moreAbove: 'services above', moreBelow: 'services below' }}
      />
      <BoundedList
        items={stashed}
        chromeRows={maxVisibleRows + 10}
        renderItem={(repo) => (
          <Text key={repo.repoPath} color={colors['text-dim']} wrap="truncate-end">
            {'  '}
            {repo.service} — will be stashed for {outgoing ?? 'the EDT being left'} (restored on return)
          </Text>
        )}
      />
      {blocked !== undefined ? (
        <Text color={colors.error} wrap="truncate-end">
          ✖ {blocked.row.repo.service} : {blocked.error}
        </Text>
      ) : null}
      {state.error !== null ? <Text color={colors.error} wrap="truncate-end">✖ {state.error}</Text> : null}
      {listsPending ? (
        <Text color={colors['text-dim']}>Local branches are loading or unavailable — the “already exists” check is skipped for these services.</Text>
      ) : null}
    </Box>
  );
}
