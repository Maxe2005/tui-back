// tui/shared/components: the one loading / empty / error line. Loading = spinner + "Loading X…",
// empty = dim "No X yet." (or a caller-supplied sentence for filtered lists), error = error
// colour "Failed to load X." plus "[R] retry" only where the host zone binds R to a reload.
import { Text } from 'ink';
import { colors } from '../theme/theme.js';
import { Spinner } from './spinner.js';

export type StateLineProps =
  | { kind: 'loading'; subject: string }
  | { kind: 'empty'; subject: string; text?: string }
  | { kind: 'error'; subject: string; retry?: boolean };

export function resolveStateLineText(props: StateLineProps): string {
  switch (props.kind) {
    case 'loading':
      return `Loading ${props.subject}…`;
    case 'empty':
      return props.text ?? `No ${props.subject} yet.`;
    case 'error':
      return `Failed to load ${props.subject}.${props.retry === true ? ' [R] retry' : ''}`;
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
