// tui/shared/reset-screen: the `:reset` full-screen overlay — reachable exclusively through
// the registered `reset` command inside the `:` command bar (never a raw keypress). Three
// steps (select categories -> review the exact summary -> type `reset`) then a result view
// listing each category's outcome and every git branch left behind.
//
// Self-contained useInput + pure key handling (mirrors settings-screen.tsx): every decision
// lives in reset-screen.logic.ts; this component only feeds it raw Ink keys and applies the
// returned state/action. Danger styling: error-colored border and title, never the accent.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { TextInputLine } from './components/text-input-line.js';
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

function Lines({ lines }: { lines: ResetLine[] }) {
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index} color={TONE_COLORS[line.tone]}>
          {line.text}
        </Text>
      ))}
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

  useInput((input, key) => {
    if (status === 'running') {
      // Nothing can interrupt a reset once it has started.
      return;
    }
    if (status === 'done') {
      if (key.escape || key.return) {
        onClose();
      }
      return;
    }
    const next = handleResetScreenKey(screen, input, key);
    setScreen(next.state);
    if (next.action.kind === 'close') {
      onClose();
    } else if (next.action.kind === 'execute') {
      void runReset(next.action.categories);
    }
  });

  let body;
  let hint: string;
  if (status === 'running') {
    body = <Text color={colors.warning}>Resetting…</Text>;
    hint = 'Please wait.';
  } else if (status === 'done') {
    body = <Lines lines={buildResetResultLines(result, error)} />;
    hint = 'Enter or Esc to close.';
  } else if (screen.step === 'select') {
    const locked = isEdtsLocked(screen);
    body = (
      <Box flexDirection="column">
        <Text color={colors.text}>Select what to reset:</Text>
        {RESET_SCREEN_ROWS.map((category, index) => {
          const highlighted = index === screen.cursor;
          return (
            <Box key={category} flexDirection="row">
              <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
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
    hint = selectedCategories(screen).length > 0
      ? 'Space to toggle, Enter to review, Esc to cancel.'
      : 'Space to toggle (check at least one), Esc to cancel.';
  } else if (screen.step === 'summary') {
    body = (
      <Box flexDirection="column">
        <Text color={colors.text}>The following will be permanently deleted:</Text>
        <Lines lines={buildResetSummaryLines(selectedCategories(screen), preview)} />
      </Box>
    );
    hint = 'Enter to continue, Esc to cancel.';
  } else {
    body = (
      <Box flexDirection="column">
        <Text color={colors.text}>
          Type <Text color={colors.error}>{RESET_CONFIRM_WORD}</Text> and press Enter to delete. This cannot be undone.
        </Text>
        <TextInputLine label="Confirm" value={screen.confirm.value} cursor={screen.confirm.cursor} focused />
      </Box>
    );
    hint = 'Only the exact word executes. Esc to cancel.';
  }

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
      <DimAnnotation text={hint} />
    </Box>
  );
}
