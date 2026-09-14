import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type TextInputLineProps = {
  label: string;
  value: string;
  focused?: boolean;
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
  const { label, value, focused = false } = props;
  const layout = resolveTextInputLineLayout(props);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={layout.labelColor}>
          {label}: {value}
        </Text>
        {layout.showCursor ? <Text inverse> </Text> : null}
      </Box>
      {layout.showCursor ? <Text color={colors.text}>[Enter] confirm  [Esc] cancel</Text> : null}
    </Box>
  );
}
