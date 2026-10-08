// tui/shared/reset-screen: the `:reset` full-screen overlay, reachable only through the `reset`
// command. Select categories -> review the exact summary -> type `reset`, then a result view of
// each category's outcome and every git branch left behind. Every decision lives in
// reset-screen.logic.ts; this component feeds it raw Ink keys. Danger styling: error-colored
// border and title, never the accent.
import { useRef, useState, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { TextInputLine } from './components/text-input-line.js';
import { StateLine } from './components/state-line.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import type { FooterContextId } from '../keybindings/index.js';
import { colors, spacing } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import {
  RESET_CATEGORY_LABELS,
  RESET_CONFIRM_WORD,
  RESET_SCREEN_ROWS,
  buildResetResultLines,
  buildResetSummaryLines,
  createResetScreenState,
  handleResetScreenKey,
  isEdtsLocked,
  selectedCategories,
  type ResetLine,
  type ResetScreenState,
} from './reset-screen.logic.js';
import { BoundedList } from './components/bounded-list.js';

const TONE_COLORS: Record<ResetLine['tone'], string> = {
  text: colors.text,
  dim: colors['text-dim'],
  error: colors.error,
  success: colors.success,
  warning: colors.warning,
};

export type ResetScreenProps = {
  useStore?: AppStore;
  onClose?: () => void;
  // Test-only injection point (mirrors settings-screen.tsx's initialTab): renderToString never
  // delivers a keypress, so a render test can't step its way to the summary/confirm views.
  initialState?: ResetScreenState;
};

// Rows the reset frame and its prompts keep around a line list.
const RESET_LIST_CHROME_ROWS = 12;

function Lines({ lines }: { lines: ResetLine[] }) {
  return (
    <Box flexDirection="column">
      <BoundedList
        items={lines}
        chromeRows={RESET_LIST_CHROME_ROWS}
        renderItem={(line, index) => (
          <Text key={index} color={TONE_COLORS[line.tone]} wrap="truncate-end">
            {line.text}
          </Text>
        )}
      />
    </Box>
  );
}

export function ResetScreen({ useStore = useAppStore, onClose = () => {}, initialState }: ResetScreenProps) {
  const preview = useStore((state) => state.resetPreview);
  const status = useStore((state) => state.resetStatus);
  const result = useStore((state) => state.resetResult);
  const error = useStore((state) => state.resetError);
  const runReset = useStore((state) => state.runReset);

  const [screen, setScreen] = useState<ResetScreenState>(() => initialState ?? createResetScreenState());
  // Several keypresses can arrive before React re-renders (fast typing of `reset`, a paste):
  // each one must build on the previous one's result, never on this render's stale `screen`.
  // The ref is the source of truth for key handling; `screen` only drives rendering.
  const screenRef = useRef(screen);

  useInput((input, key) => {
    const store = useStore.getState();
    if (store.resetStatus === 'running') {
      // Nothing can interrupt a reset once it has started.
      return;
    }
    if (store.resetStatus === 'done') {
      if (key.escape || key.return) {
        onClose();
      }
      return;
    }
    const next = handleResetScreenKey(screenRef.current, input, key, store.resetPreview?.status === 'ready');
    screenRef.current = next.state;
    setScreen(next.state);
    if (next.action.kind === 'close') {
      onClose();
    } else if (next.action.kind === 'execute') {
      void runReset(next.action.categories);
    }
  });

  let body;
  let note: ReactNode = null;
  let context: FooterContextId | null;
  if (status === 'running') {
    body = <Text color={colors.warning}>Resetting…</Text>;
    note = 'Please wait.';
    context = 'busy';
  } else if (status === 'done') {
    body = <Lines lines={buildResetResultLines(result, error)} />;
    context = 'close';
  } else if (screen.step === 'select') {
    const locked = isEdtsLocked(screen);
    body = (
      <Box flexDirection="column">
        <Text color={colors.text}>Select what to reset:</Text>
        {RESET_SCREEN_ROWS.map((category, index) => {
          const highlighted = index === screen.cursor;
          return (
            <Box key={category} flexDirection="row">
              <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
              <CheckboxListItem
                label={RESET_CATEGORY_LABELS[category]}
                state={screen.checked[category] ? 'checked' : 'unchecked'}
                meta={category === 'edts' && locked ? '(required by Registered services)' : undefined}
              />
            </Box>
          );
        })}
      </Box>
    );
    const anyChecked = selectedCategories(screen).length > 0;
    context = anyChecked ? 'reset-select' : 'reset-select-empty';
    note = anyChecked ? null : 'Check at least one.';
  } else if (screen.step === 'summary') {
    body = (
      <Box flexDirection="column">
        <Text color={colors.text}>The following will be permanently deleted:</Text>
        <Lines lines={buildResetSummaryLines(selectedCategories(screen), preview)} />
      </Box>
    );
    context = preview?.status === 'ready' ? 'reset-summary' : 'reset-wait';
    if (preview?.status === 'error') {
      note = <StateLine kind="error" subject="the summary" />;
    } else if (preview?.status !== 'ready') {
      note = <StateLine kind="loading" subject="the summary" />;
    }
  } else {
    body = (
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-end">
          Type <Text color={colors.error}>{RESET_CONFIRM_WORD}</Text> and press Enter. This permanently deletes the data and cannot be undone.
        </Text>
        <TextInputLine label="Confirm" value={screen.confirm.value} cursor={screen.confirm.cursor} focused />
      </Box>
    );
    context = 'reset-confirm';
    note = 'Only the exact word executes.';
  }

  useFooterContext('reset', context, useStore);

  return (
    <Box
      backgroundColor={colors.surface}
      borderColor={colors.error}
      borderStyle="double"
      padding={spacing['1']}
      flexDirection="column"
    >
      <Text color={colors.error} bold>
        RESET TOOL DATA
      </Text>
      <Text color={colors.text}>──</Text>
      {body}
      {typeof note === 'string' ? <DimAnnotation text={note} /> : note}
    </Box>
  );
}
