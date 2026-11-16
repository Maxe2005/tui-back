// tui/shared/terminal-view: the app-level Terminal overlay, opened from the
// Dashboard's focused row (`Ctrl+T` service, `Ctrl+X` container). A header (target, cwd,
// running indicator), the shared ScrollableOutput, and one prompt line at the bottom. Windowed it
// is a double-bordered box over the lower part of the zone; fullscreen (`Ctrl+F`) it fills the
// zone region. It owns every key while open: decisions live in terminal-view.logic.ts, the
// session in the store's terminal slice; the draft, focus, scroll and confirmation are local.
// Not a ModalDialog: its body must be a measured, flex-grown box for ScrollableOutput.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { markerText } from '../../../../core/shell/line-buffer.js';
import { useAppStore, type AppStore, type TerminalLine } from '../store/app-store.js';
import { useBounds } from './bounds/bounds-context.js';
import { FullscreenFrame } from './components/fullscreen-frame.js';
import { ScrollableOutput } from './components/scrollable-output.js';
import { nextTextInputValue, type TextInputState } from './components/text-edit.js';
import { TextInputLine } from './components/text-input-line.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import { useInput } from './hooks/use-input.js';
import { resolveHistoryBrowseDown, resolveHistoryBrowseUp, type HistoryBrowseState } from './input-history/index.js';
import { adjustScrollOffset } from './scrollable-output/index.js';
import { colors, spacing } from './theme/theme.js';
import { TERMINAL_BUSY_NOTICE } from '../store/slices/terminal-text.js';
import {
  TERMINAL_CONFIRM_CLOSE_TEXT,
  pageScrollOffset,
  toSingleLine,
  resolveTerminalKey,
  sanitizeTerminalText,
  terminalFooterContext,
  terminalWindowRows,
  type TerminalFocus,
} from './terminal-view.logic.js';

const EMPTY_DRAFT: TextInputState = { value: '', cursor: 0 };
// Windowed: the double border (2 rows) around the content. Both modes: header and prompt rows.
const BORDER_ROWS = 2;
const HEADER_PROMPT_ROWS = 2;
const PROMPT_PLACEHOLDER = 'type a command';
const PROMPT_DISABLED_PLACEHOLDER = 'prompt unavailable';

function lineColor(line: TerminalLine): string {
  if (line.kind === 'stdout') {
    return colors.text;
  }
  return line.kind === 'stderr' ? colors.error : colors['text-dim'];
}

// useState plus a synchronously updated current value, read by event handlers between renders.
function useSyncedState<T>(initialValue: T): [T, (next: T) => void, () => T] {
  const [value, setValue] = useState(initialValue);
  const ref = useRef(value);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  const read = useCallback(() => ref.current, []);
  return [value, set, read];
}

function lineText(line: TerminalLine): string {
  return sanitizeTerminalText(line.text);
}

export function TerminalView({
  useStore = useAppStore,
  initial = {},
}: {
  useStore?: AppStore;
  // The local state's starting point, for fixtures; the shell always opens on the defaults.
  initial?: { focus?: TerminalFocus; confirming?: boolean };
}) {
  const target = useStore((state) => state.terminalTarget);
  const lines = useStore((state) => state.terminalLines);
  const droppedCount = useStore((state) => state.terminalDroppedCount);
  const cwd = useStore((state) => state.terminalCwd);
  const running = useStore((state) => state.terminalRunning);
  const ready = useStore((state) => state.terminalReady);
  const fullscreen = useStore((state) => state.terminalFullscreen);
  const notice = useStore((state) => state.terminalNotice);
  const helpOpen = useStore((state) => state.helpOpen);
  const bounds = useBounds();
  // Ink can deliver several keypresses from one stdin chunk before React re-renders, so the key
  // handler reads these through refs that are updated synchronously with each state change.
  const [draft, setDraft, draftRef] = useSyncedState<TextInputState>(EMPTY_DRAFT);
  const [browsing, setBrowsing, browsingRef] = useSyncedState<HistoryBrowseState | null>(null);
  const [focus, setFocus, focusRef] = useSyncedState<TerminalFocus>(initial.focus ?? 'prompt');
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming, confirmingRef] = useSyncedState(initial.confirming ?? false);

  // The dropped-lines marker heads the retained output, scrolled like any other line.
  const displayLines = useMemo<readonly TerminalLine[]>(
    () => (droppedCount > 0 ? [{ kind: 'status', text: markerText(droppedCount) }, ...lines] : lines),
    [droppedCount, lines],
  );

  // Scrolled back, the view stays on the same lines while output arrives: the offset (counted from
  // the tail) grows by the lines appended since the last render. Pinned to the tail (0), it stays.
  // Adjusted during render, so no frame shows the drifted window.
  const appendedTotal = droppedCount + lines.length;
  const [seenTotal, setSeenTotal] = useState(appendedTotal);
  if (seenTotal !== appendedTotal) {
    setSeenTotal(appendedTotal);
    const grown = appendedTotal - seenTotal;
    if (grown > 0 && offset > 0) {
      setOffset(Math.min(offset + grown, Math.max(displayLines.length - 1, 0)));
    }
  }

  // The command the confirmation was about ended on its own: nothing left to confirm.
  useEffect(() => {
    if (!running) {
      setConfirming(false);
    }
  }, [running]);

  const extraRows = (confirming ? 1 : 0) + (notice !== null && !confirming ? 1 : 0);
  const frameRows = fullscreen ? bounds.rows : Math.max(0, terminalWindowRows(bounds.rows) - BORDER_ROWS);
  const outputRows = Math.max(1, frameRows - HEADER_PROMPT_ROWS - extraRows);
  // Fullscreen: the frame's pane padding; windowed: the border plus one column of padding a side.
  const outputColumns = Math.max(1, bounds.columns - (fullscreen ? 2 * spacing['pane-padding-x'] : 2 + 2 * spacing['1']));

  useInput(
    (input, key) => {
      const state = useStore.getState();
      const draft = draftRef();
      const browsing = browsingRef();
      const action = resolveTerminalKey(input, key, {
        focus: focusRef(),
        confirming: confirmingRef(),
        running: state.terminalRunning,
        ready: state.terminalReady,
      });
      const edit = () => {
        // The draft is one line: a pasted newline run becomes a single space.
        const next = nextTextInputValue(draft, toSingleLine(input), key);
        if (next.value !== draft.value || next.cursor !== draft.cursor) {
          setDraft(next);
          // Editing a recalled entry adopts it as the draft.
          setBrowsing(null);
          state.setTerminalNotice(null);
        }
      };
      switch (action.type) {
        case 'run':
          // A refused run (busy race, no session) keeps the draft and the scroll position.
          if (state.runTerminalCommand(draft.value).accepted) {
            setDraft(EMPTY_DRAFT);
            setBrowsing(null);
            setOffset(0);
          }
          return;
        case 'busy':
          state.setTerminalNotice(TERMINAL_BUSY_NOTICE);
          return;
        case 'cancel':
          state.cancelTerminalCommand();
          return;
        case 'clear-draft':
          setDraft(EMPTY_DRAFT);
          setBrowsing(null);
          state.setTerminalNotice(null);
          return;
        case 'history': {
          if (action.direction === 'down' && browsing === null) {
            return;
          }
          const result =
            action.direction === 'up'
              ? resolveHistoryBrowseUp(draft.value, browsing, state.terminalHistory)
              : resolveHistoryBrowseDown(browsing!, state.terminalHistory);
          setDraft({ value: result.query, cursor: result.query.length });
          setBrowsing(result.browsing);
          return;
        }
        case 'focus':
          setFocus(action.focus);
          return;
        case 'fullscreen':
          state.toggleTerminalFullscreen();
          return;
        case 'close':
        case 'cancel-and-close':
          state.closeTerminal();
          return;
        case 'confirm-close':
          setConfirming(true);
          return;
        case 'keep-running':
          setConfirming(false);
          return;
        case 'scroll':
          setOffset((current) => adjustScrollOffset(current, action.direction, displayLines.length));
          return;
        case 'page':
          setOffset((current) => pageScrollOffset(current, action.direction, displayLines.length, outputRows));
          return;
        case 'help':
          state.openHelp();
          return;
        case 'type-into-prompt':
          setFocus('prompt');
          edit();
          return;
        case 'edit':
          edit();
          return;
        case 'ignore':
          return;
      }
    },
    { isActive: !helpOpen },
  );

  useFooterContext('terminal', terminalFooterContext({ focus, confirming, running }), useStore);

  const title = target === null ? 'Terminal' : target.kind === 'container' ? `Container terminal · ${target.label}` : `Terminal · ${target.label}`;
  const cwdText = cwd ?? (target?.kind === 'container' ? "container's workdir" : '');
  const content = (
    <>
      <Box flexDirection="row" flexShrink={0}>
        <Box flexShrink={1} minWidth={0}>
          <Text color={colors.accent} bold wrap="truncate-end">
            {title}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} marginLeft={1}>
          <Text color={colors['text-dim']} wrap="truncate-start">
            {cwdText}
          </Text>
        </Box>
        {offset > 0 ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text color={colors['text-dim']} wrap="truncate-end">
              {`↑ ${String(offset)} back`}
            </Text>
          </Box>
        ) : null}
        {running ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text color={colors.info} wrap="truncate-end">
              ● running
            </Text>
          </Box>
        ) : null}
      </Box>
      <ScrollableOutput
        lines={displayLines}
        offset={offset}
        wrap={false}
        fallbackRows={outputRows}
        fallbackWidth={outputColumns}
        format={lineText}
        color={lineColor}
        placeholder={null}
      />
      {confirming ? (
        <Box flexShrink={0}>
          <Text color={colors.warning} wrap="truncate-end">
            {TERMINAL_CONFIRM_CLOSE_TEXT}
          </Text>
        </Box>
      ) : notice !== null ? (
        <Box flexShrink={0}>
          <Text color={colors['text-dim']} wrap="truncate-end">
            {notice}
          </Text>
        </Box>
      ) : null}
      <Box flexShrink={0}>
        <TextInputLine
          label="$"
          labelWidth={1}
          value={draft.value}
          cursor={draft.cursor}
          focused={focus === 'prompt' && ready && !confirming}
          placeholder={ready ? PROMPT_PLACEHOLDER : PROMPT_DISABLED_PLACEHOLDER}
        />
      </Box>
    </>
  );

  // Hidden (not unmounted) behind the help panel, so the draft, focus and scroll survive it.
  const display = helpOpen ? 'none' : 'flex';
  if (fullscreen) {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" display={display}>
        <FullscreenFrame>{content}</FullscreenFrame>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      height={terminalWindowRows(bounds.rows)}
      borderStyle="double"
      borderColor={colors.border}
      backgroundColor={colors.surface}
      paddingX={spacing['1']}
      overflow="hidden"
      display={display}
    >
      {content}
    </Box>
  );
}
