import { Box, Text } from 'ink';
import { useElementSize } from '../hooks/use-element-size.js';
import { colors } from '../theme/theme.js';

export type TextInputLineProps = {
  label: string;
  value: string;
  focused?: boolean;
  // The caret's position within `value`, in [0, value.length]. Defaults to `value.length`
  // (an always-trailing caret) for callers that don't track one.
  cursor?: number;
  // Dim text standing for "use the default" while the value is empty.
  placeholder?: string;
  // Set for a column layout: the label is padded to this width and followed by a space instead
  // of a colon, so several lines align. An empty label prints no label at all.
  labelWidth?: number;
  // The line is the row cursor's target (accent label) without being edited.
  highlighted?: boolean;
  // Text appended after the value, in its own colour, never cut by the caret window.
  suffix?: { text: string; color: string };
};

export type ResolvedTextInputLine = {
  labelColor: string;
  showCursor: boolean;
};

export function resolveTextInputLineLayout(props: TextInputLineProps): ResolvedTextInputLine {
  const focused = props.focused ?? false;
  return {
    labelColor: focused || props.highlighted === true ? colors.accent : colors.text,
    showCursor: focused,
  };
}

function labelPrefix({ label, labelWidth }: TextInputLineProps): string {
  if (label === '') {
    return '';
  }
  return labelWidth === undefined ? `${label}: ` : `${label.padEnd(labelWidth)} `;
}

// The slice of `value` that fits `width` cells beside `prefixLength` label cells while keeping the
// caret cell visible: the window slides right with the caret, one cell stays for the caret itself.
export function windowAroundCaret(
  value: string,
  position: number,
  prefixLength: number,
  width: number,
): { start: number; text: string } {
  const room = Math.max(1, width - prefixLength - 1);
  const start = Math.max(0, position - (room - 1));
  return { start, text: value.slice(start, start + room) };
}

// One truncated line, so a long value never wraps into the height budget of the box around it.
// When the line is cut by its width, a focused field scrolls so the caret stays on screen.
export function TextInputLine(props: TextInputLineProps) {
  const { value, cursor, placeholder, suffix } = props;
  const layout = resolveTextInputLineLayout(props);
  const prefix = labelPrefix(props);
  const [ref, size] = useElementSize();
  const showPlaceholder = value === '' && placeholder !== undefined;
  if (!layout.showCursor) {
    return (
      <Box ref={ref} flexGrow={1}>
        <Text wrap="truncate-end">
          <Text color={layout.labelColor}>{prefix}</Text>
          {showPlaceholder ? <Text color={colors['text-dim']}>{placeholder}</Text> : <Text color={layout.labelColor}>{value}</Text>}
          {suffix !== undefined ? <Text color={suffix.color}>{suffix.text}</Text> : null}
        </Text>
      </Box>
    );
  }
  // Clamp defensively — a caller-supplied cursor out of [0, value.length] must never crash the
  // render or slice into nonsense.
  const position = Math.min(Math.max(cursor ?? value.length, 0), value.length);
  const suffixLength = suffix?.text.length ?? 0;
  // The box grows to the width it is given, so its measured width is the room, not the content.
  const cut = size !== null && size.width < prefix.length + value.length + 1 + suffixLength;
  const shown = cut ? windowAroundCaret(value, position, prefix.length + suffixLength, size.width) : { start: 0, text: value };
  const caret = position - shown.start;
  const before = shown.text.slice(0, caret);
  // At the end of the value there's no character to sit the caret on, so it renders as an
  // inverse space.
  const atCursor = shown.text.slice(caret, caret + 1) || ' ';
  const after = shown.text.slice(caret + 1);
  return (
    <Box ref={ref} flexGrow={1}>
      <Text wrap="truncate-end">
        <Text color={layout.labelColor}>
          {prefix}
          {before}
        </Text>
        <Text inverse>{atCursor}</Text>
        <Text color={layout.labelColor}>{after}</Text>
        {showPlaceholder ? <Text color={colors['text-dim']}>{placeholder}</Text> : null}
        {suffix !== undefined ? <Text color={suffix.color}>{suffix.text}</Text> : null}
      </Text>
    </Box>
  );
}
