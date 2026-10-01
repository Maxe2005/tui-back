// tui/shared/components/json-tree/json-tree: the thin Ink view over model.ts. Renders only the
// visible rows through BoundedList inside a caller-measured budget: the item list, then the
// filter panel when open, then the always-present status line. All key handling lives in the
// routes zone's useInput over the model's pure dispatchers; this file owns layout and colors.
import { Box, Text } from 'ink';
import { BoundedList } from '../bounded-list.js';
import { colors, jsonTreeColors, spacing } from '../../theme/theme.js';
import { TextInputLine } from '../text-input-line.js';
import type { TextInputState } from '../text-edit.js';
import {
  formatBodyEditStatus,
  formatTreeStatusLine,
  PANEL_VISIBLE_RULE_ROWS,
  resolveTreeListBudget,
  type ActiveRule,
  type BodyEditError,
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

function JsonTreeRowView({ row, selected, error }: { row: JsonTreeRow; selected: boolean; error?: string | null }) {
  const isContainer = row.kind === 'object' || row.kind === 'array';
  const glyph = isContainer ? (row.folded ? '▸' : '▾') : ' ';
  const indent = ' '.repeat(row.depth * spacing.indent);
  const keyPart = row.key ?? (row.index !== null ? `[${row.index}]` : '');
  const invalid = error !== undefined && error !== null && error !== '';
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
          ) : invalid ? (
            <Text>
              <Text color={colors['text-dim']}>{`${keyPart !== '' ? ': ' : ''}`}</Text>
              <Text color={colors.error}>{`${row.displayValue ?? ''} ✖ ${error}`}</Text>
            </Text>
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

export function JsonTreeFilterPanel({ rules, hideNulls, cursor }: { rules: readonly ActiveRule[]; hideNulls: boolean; cursor: number }) {
  const clamped = rules.length === 0 ? 0 : Math.min(Math.max(cursor, 0), rules.length - 1);
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']}>
        {`Filters — ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`}
      </Text>
      <BoundedList
        items={rules}
        maxVisibleRows={Math.min(rules.length, PANEL_VISIBLE_RULE_ROWS)}
        cursorIndex={clamped}
        renderItem={(rule, index) =>
          index === clamped ? (
            <Box key={`${rule.kind}:${rule.key}`} backgroundColor={colors['surface-selected']}>
              <Text color={colors.accent} wrap="truncate-end">{`› [${index + 1}] ${rule.kind === 'hide' ? 'hide' : 'only'} "${rule.key}"`}</Text>
            </Box>
          ) : (
            <Text key={`${rule.kind}:${rule.key}`} color={colors.text} wrap="truncate-end">
              {`  [${index + 1}] ${rule.kind === 'hide' ? 'hide' : 'only'} "${rule.key}"`}
            </Text>
          )
        }
      />
      <Text color={colors.text}>{`  [n] hide nulls: ${hideNulls ? 'on' : 'off'}`}</Text>
      <Text color={colors['text-dim']}>[↑↓] select · [space] remove · [1-9] remove · [n] nulls · [c] clear · [f] close</Text>
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
  panelCursor: number;
  // Total row budget for the whole tree block (list + panel + status), measured by the caller.
  maxVisibleRows: number;
  // Per-path scalar errors — an invalid entry keeps its raw text in the draft and renders in
  // error color with its reason (glyph + color, never color alone), never coerced.
  editErrors?: Readonly<Record<string, BodyEditError>>;
};

export function JsonTree({ rows, selected, hiddenCount, activeRuleCount, rules, hideNulls, panelOpen, panelCursor, maxVisibleRows, editErrors }: JsonTreeProps) {
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
          renderItem={(row, index) => <JsonTreeRowView key={row.path} row={row} selected={index === selected} error={editErrors?.[row.path]?.reason} />}
        />
      )}
      {panelOpen ? <JsonTreeFilterPanel rules={rules} hideNulls={hideNulls} cursor={panelCursor} /> : null}
      <Text color={colors['text-dim']}>{formatTreeStatusLine(hiddenCount, activeRuleCount)}</Text>
    </Box>
  );
}

// The multi-line raw buffer. Caller-owned `TextInputState` (like FilterPanel): `Return`
// inserts `\n` (handled by the zone's dispatcher, never here), `Esc` leaves and validates.
// Invalid JSON keeps the buffer open with the parse error plus its line/column; the previous
// valid body is preserved (the zone never writes it).
export function JsonRawEditor({ input, error, maxVisibleRows }: { input: TextInputState; error: string | null; maxVisibleRows: number }) {
  const lines = input.value.split('\n');
  const before = input.value.slice(0, Math.min(Math.max(input.cursor, 0), input.value.length));
  const cursorLine = before.split('\n').length - 1;
  const cursorCol = (before.split('\n').pop() ?? '').length;
  const chrome = error !== null && error !== '' ? 2 : 1;
  const lineBudget = Math.max(0, maxVisibleRows - chrome);
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']}>Raw JSON — [enter] newline · [esc] done</Text>
      {error !== null && error !== '' ? <Text color={colors.error} wrap="truncate-end">{`✖ ${error}`}</Text> : null}
      <BoundedList
        items={lines}
        maxVisibleRows={lineBudget}
        cursorIndex={Math.min(Math.max(cursorLine, 0), Math.max(lines.length - 1, 0))}
        renderItem={(line, index) => {
          if (index !== cursorLine) {
            return (
              <Text key={index} color={colors.text} wrap="truncate-end">
                {line === '' ? ' ' : line}
              </Text>
            );
          }
          const clampedCol = Math.min(Math.max(cursorCol, 0), line.length);
          const cursorBefore = line.slice(0, clampedCol);
          const atCursor = line.slice(clampedCol, clampedCol + 1) || ' ';
          const after = line.slice(clampedCol + 1);
          return (
            <Box key={index} backgroundColor={colors['surface-selected']}>
              <Text color={colors.text} wrap="truncate-end">{cursorBefore}</Text>
              <Text inverse>{atCursor}</Text>
              <Text color={colors.text} wrap="truncate-end">{after}</Text>
            </Box>
          );
        }}
      />
    </Box>
  );
}

export type JsonTreeAddPrompt = { parentPath: string; input: TextInputState; error: string | null };

// The edit-mode tree: the visible-rows list (invalid entries in error color) plus the inline
// scalar editor row, the structural add-key prompt, and the editor status line (first
// validation error when present, `N lines hidden — still sent` whenever hiddenCount > 0). The
// raw buffer replaces this whole block while open (rendered by the caller through
// `JsonRawEditor`); an empty draft renders its own empty state with the `r` hint.
export type JsonTreeEditorProps = {
  rows: readonly JsonTreeRow[];
  selected: number;
  hiddenCount: number;
  rules: readonly ActiveRule[];
  hideNulls: boolean;
  panelOpen: boolean;
  panelCursor: number;
  maxVisibleRows: number;
  bodyEmpty: boolean;
  editErrors: Readonly<Record<string, BodyEditError>>;
  firstError: string | null;
  editingPath: string | null;
  editInput: TextInputState | null;
  editLabel: string;
  addPrompt: JsonTreeAddPrompt | null;
};

export function JsonTreeEditor({
  rows,
  selected,
  hiddenCount,
  rules,
  hideNulls,
  panelOpen,
  panelCursor,
  maxVisibleRows,
  bodyEmpty,
  editErrors,
  firstError,
  editingPath,
  editInput,
  editLabel,
  addPrompt,
}: JsonTreeEditorProps) {
  // resolveTreeListBudget already subtracts the status line plus the open panel; the
  // inline scalar editor (input + its confirm/cancel hint) and the add-key prompt
  // (input + hint + optional inline error) are editor-only chrome on top of that.
  const extraChromeRows =
    (editingPath !== null && editInput !== null ? 2 : 0) +
    (addPrompt !== null ? 2 + (addPrompt.error !== null && addPrompt.error !== '' ? 1 : 0) : 0);
  const listBudget = Math.max(0, resolveTreeListBudget(maxVisibleRows, panelOpen, rules.length) - extraChromeRows);
  // Zero rules active means no filter can hide rows: an empty list is a genuinely-empty value
  // (the explicit empty state), never the all-filtered line.
  const rulesHideRows = rules.length > 0 || hideNulls;
  return (
    <Box flexDirection="column">
      {rows.length === 0 ? (
        bodyEmpty ? (
          <Text color={colors['text-dim']}>Empty body — press r to paste JSON.</Text>
        ) : !rulesHideRows ? (
          <Text color={colors['text-dim']}>Empty JSON value ({} or []) — nothing to show.</Text>
        ) : (
          <Text color={colors['text-dim']}>All lines hidden by filters — press f to review them.</Text>
        )
      ) : (
        <BoundedList
          items={rows}
          maxVisibleRows={listBudget}
          cursorIndex={selected}
          renderItem={(row, index) => <JsonTreeRowView key={row.path} row={row} selected={index === selected} error={editErrors[row.path]?.reason} />}
        />
      )}
      {editingPath !== null && editInput !== null ? (
        <TextInputLine label={editLabel} value={editInput.value} cursor={editInput.cursor} focused />
      ) : null}
      {addPrompt !== null ? (
        <Box flexDirection="column">
          <TextInputLine label="Key name" value={addPrompt.input.value} cursor={addPrompt.input.cursor} focused />
          {addPrompt.error !== null && addPrompt.error !== '' ? (
            <Text color={colors.error} wrap="truncate-end">{`✖ ${addPrompt.error}`}</Text>
          ) : null}
        </Box>
      ) : null}
      {panelOpen ? <JsonTreeFilterPanel rules={rules} hideNulls={hideNulls} cursor={panelCursor} /> : null}
      <Text color={firstError !== null ? colors.error : colors['text-dim']}>{formatBodyEditStatus(firstError, hiddenCount)}</Text>
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
