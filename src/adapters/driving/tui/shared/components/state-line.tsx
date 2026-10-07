// tui/shared/components: the one loading / empty / error line. Loading = spinner + "Loading X…",
// empty = dim "No X yet." (or a caller-supplied sentence for filtered lists), error = error
// colour "Failed to load X." plus the retry hint only where the host zone binds R to a reload.
// `verb` swaps "Loading" / "Failed to load" when a different operation is in flight or failed
// (Scanning, Failed to scan).
import { Text } from 'ink';
import { RETRY_HINT } from '../../keybindings/index.js';
import { colors } from '../theme/theme.js';
import { formatHint } from './hints.js';
import { Spinner } from './spinner.js';

export type StateLineProps =
  | { kind: 'loading'; subject: string; verb?: string }
  | { kind: 'empty'; subject: string; text?: string }
  | { kind: 'error'; subject: string; retry?: boolean; verb?: string };

// Verb and subject, minus whichever is blank, so no stray space precedes the punctuation.
function joinParts(verb: string, subject: string): string {
  return [verb, subject].filter((part) => part.trim() !== '').join(' ');
}

export function resolveStateLineText(props: StateLineProps): string {
  switch (props.kind) {
    case 'loading':
      return `${joinParts(props.verb ?? 'Loading', props.subject)}…`;
    case 'empty':
      return props.text ?? `No ${props.subject} yet.`;
    case 'error':
      return `${joinParts(props.verb ?? 'Failed to load', props.subject)}.${props.retry === true ? ` ${formatHint(RETRY_HINT)}` : ''}`;
  }
}

export function StateLine(props: StateLineProps) {
  const text = resolveStateLineText(props);
  if (props.kind === 'loading') {
    return (
      <Text color={colors['text-dim']}>
        <Spinner /> {text}
      </Text>
    );
  }
  return <Text color={props.kind === 'error' ? colors.error : colors['text-dim']}>{text}</Text>;
}
