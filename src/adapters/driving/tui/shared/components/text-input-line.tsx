import { Text } from 'ink';
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

// One truncated line, so a long value never wraps into the height budget of the box around it.
export function TextInputLine(props: TextInputLineProps) {
  const { value, cursor, placeholder } = props;
  const layout = resolveTextInputLineLayout(props);
  const prefix = labelPrefix(props);
  const showPlaceholder = value === '' && placeholder !== undefined;
  if (!layout.showCursor) {
    return (
      <Text wrap="truncate-end">
        <Text color={layout.labelColor}>{prefix}</Text>
        {showPlaceholder ? <Text color={colors['text-dim']}>{placeholder}</Text> : <Text color={layout.labelColor}>{value}</Text>}
      </Text>
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
    <Text wrap="truncate-end">
      <Text color={layout.labelColor}>
        {prefix}
        {before}
      </Text>
      <Text inverse>{atCursor}</Text>
      <Text color={layout.labelColor}>{after}</Text>
      {showPlaceholder ? <Text color={colors['text-dim']}>{placeholder}</Text> : null}
    </Text>
  );
}
