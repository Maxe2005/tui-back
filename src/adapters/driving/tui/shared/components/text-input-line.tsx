import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type TextInputLineProps = {
  label: string;
  value: string;
  focused?: boolean;
  // The caret's position within `value`, in [0, value.length]. Defaults to `value.length`
  // (an always-trailing caret) for callers that don't track one.
  cursor?: number;
};

export type ResolvedTextInputLine = {
  labelColor: string;
  showCursor: boolean;
};

export function resolveTextInputLineLayout(props: TextInputLineProps): ResolvedTextInputLine {
  const focused = props.focused ?? false;
  return {
    labelColor: focused ? colors.accent : colors.text,
    showCursor: focused,
  };
}

export function TextInputLine(props: TextInputLineProps) {
  const { label, value, focused = false, cursor } = props;
  const layout = resolveTextInputLineLayout(props);
  if (!layout.showCursor) {
    // Unfocused: no caret to place.
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={layout.labelColor}>
            {label}: {value}
          </Text>
        </Box>
      </Box>
    );
  }
  // Clamp defensively — a caller-supplied cursor out of [0, value.length] must never crash the
  // render or slice into nonsense.
  const position = Math.min(Math.max(cursor ?? value.length, 0), value.length);
  const before = value.slice(0, position);
  // At the end of the value there's no character to sit the caret on, so it renders as an
  // inverse space.
  const atCursor = value.slice(position, position + 1) || ' ';
  const after = value.slice(position + 1);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={layout.labelColor}>
          {label}: {before}
        </Text>
        <Text inverse>{atCursor}</Text>
        <Text color={layout.labelColor}>{after}</Text>
      </Box>
      <Text color={colors.text}>[Enter] confirm  [Esc] cancel</Text>
    </Box>
  );
}
