// tui/shared/components/json-tree/view: story 6.7 — the thin Ink view over model.ts.
// Renders only the visible rows through BoundedList (AD-12) inside a caller-measured
// budget: the item list, then the filter panel when open, then the always-present status
// line. All key handling lives in the routes zone's useInput over the model's pure
// dispatchers (the logs-zone convention: never a component-owned useInput here); this
// file owns layout, colors, truncation display, and the raw/empty fallbacks only.
import { Box, Text } from 'ink';
import { BoundedList } from '../bounded-list.js';
import { colors, jsonTreeColors, spacing } from '../../theme/theme.js';
import {
  formatTreeStatusLine,
  resolveTreeListBudget,
  type ActiveRule,
  type JsonTreeRow,
} from './model.js';

function valueColorFor(kind: JsonTreeRow['kind']): string {
  switch (kind) {
    case 'string':
      return jsonTreeColors.string;
    case 'number':
      return jsonTreeColors.number;
    case 'boolean':
      return jsonTreeColors.boolean;
    case 'null':
      return jsonTreeColors.null;
    default:
      return colors.text;
  }
}

function JsonTreeRowView({ row, selected }: { row: JsonTreeRow; selected: boolean }) {
  const isContainer = row.kind === 'object' || row.kind === 'array';
  const glyph = isContainer ? (row.folded ? '▸' : '▾') : ' ';
  const indent = ' '.repeat(row.depth * spacing.indent);
  const keyPart = row.key ?? (row.index !== null ? `[${row.index}]` : '');
  return (
    <Box backgroundColor={selected ? colors['surface-selected'] : undefined}>
      <Box flexShrink={0}>
        <Text color={selected ? colors.accent : colors['surface-selected']}>{selected ? '▌›' : '  '}</Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text color={colors.text}>{`${indent}${glyph} `}</Text>
          {keyPart !== '' ? <Text color={jsonTreeColors.key}>{keyPart}</Text> : null}
          {isContainer ? (
            <Text color={colors['text-dim']}>{`${keyPart !== '' ? ': ' : ''}${row.kind === 'object' ? `{${row.size ?? 0}}` : `[${row.size ?? 0}]`}`}</Text>
          ) : (
            <Text>
              <Text color={colors['text-dim']}>{`${keyPart !== '' ? ': ' : ''}`}</Text>
              <Text color={valueColorFor(row.kind)}>{row.displayValue ?? ''}</Text>
            </Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}

export function JsonTreeFilterPanel({ rules, hideNulls }: { rules: readonly ActiveRule[]; hideNulls: boolean }) {
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']}>
        {`Filters — ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`}
      </Text>
      {rules.map((rule, index) => (
        <Text key={`${rule.kind}:${rule.key}`} color={colors.text} wrap="truncate-end">
          {`  [${index + 1}] ${rule.kind === 'hide' ? 'hide' : 'only'} "${rule.key}"`}
        </Text>
      ))}
      <Text color={colors.text}>{`  [n] hide nulls: ${hideNulls ? 'on' : 'off'}`}</Text>
      <Text color={colors['text-dim']}>[1-9] remove · [n] nulls · [c] clear · [f] close</Text>
    </Box>
  );
}

export type JsonTreeProps = {
  rows: readonly JsonTreeRow[];
  selected: number;
  hiddenCount: number;
  activeRuleCount: number;
  rules: readonly ActiveRule[];
  hideNulls: boolean;
  panelOpen: boolean;
  // Total row budget for the whole tree block (list + panel + status), measured by the caller.
  maxVisibleRows: number;
};

export function JsonTree({ rows, selected, hiddenCount, activeRuleCount, rules, hideNulls, panelOpen, maxVisibleRows }: JsonTreeProps) {
  const listBudget = resolveTreeListBudget(maxVisibleRows, panelOpen, rules.length);
  return (
    <Box flexDirection="column">
      {rows.length === 0 ? (
        <Text color={colors['text-dim']}>All lines hidden by filters — press f to review them.</Text>
      ) : (
        <BoundedList
          items={rows}
          maxVisibleRows={listBudget}
          cursorIndex={selected}
          renderItem={(row, index) => <JsonTreeRowView key={row.path} row={row} selected={index === selected} />}
        />
      )}
      {panelOpen ? <JsonTreeFilterPanel rules={rules} hideNulls={hideNulls} /> : null}
      <Text color={colors['text-dim']}>{formatTreeStatusLine(hiddenCount, activeRuleCount)}</Text>
    </Box>
  );
}

// Unparsable bodies fall back to scrollable raw text with their reason — never a partial
// tree. The reason line is caller chrome (1 row); the lines scroll through BoundedList.
export function JsonRawFallback({
  reason,
  lines,
  selected,
  maxVisibleRows,
}: {
  reason: 'truncated at 64 KB' | 'not JSON';
  lines: readonly string[];
  selected: number;
  maxVisibleRows: number;
}) {
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']} wrap="truncate-end">
        {reason === 'truncated at 64 KB'
          ? 'Raw body — truncated at 64 KB. Showing as text.'
          : 'Raw body — not JSON. Showing as text.'}
      </Text>
      <BoundedList
        items={lines}
        maxVisibleRows={Math.max(0, maxVisibleRows - 1)}
        cursorIndex={selected}
        renderItem={(line, index) =>
          index === selected ? (
            <Box key={index} backgroundColor={colors['surface-selected']}>
              <Text color={colors.accent} wrap="truncate-end">{`› ${line === '' ? ' ' : line}`}</Text>
            </Box>
          ) : (
            <Text key={index} color={colors.text} wrap="truncate-end">
              {line === '' ? ' ' : line}
            </Text>
          )
        }
      />
    </Box>
  );
}

// Empty bodies and empty objects/arrays are explicit empty states, distinct from errors.
export function JsonEmptyState({ emptyKind }: { emptyKind: 'empty-body' | 'empty-json' }) {
  return (
    <Text color={colors['text-dim']}>
      {emptyKind === 'empty-body' ? 'Empty response body — nothing to show.' : 'Empty JSON value ({} or []) — nothing to show.'}
    </Text>
  );
}
