import { Box, Text } from 'ink';
import { useInput } from '../hooks/use-input.js';
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useBounds } from '../bounds/bounds-context.js';
import { useElementSize } from '../hooks/use-element-size.js';
import { colors, spacing } from '../theme/theme.js';

export type ModalDialogProps = {
  title: string;
  open?: boolean;
  children?: ReactNode;
  // A tighter cap than the window; the dialog is never taller than its bounds regardless.
  maxHeight?: number;
  // Pinned below the body, never clipped by it.
  footer?: ReactNode;
};

// The open dialogs in opening order; only the last one (the topmost) takes PgUp/PgDn.
let openDialogs: string[] = [];
const listeners = new Set<() => void>();

function setOpenDialogs(next: string[]): void {
  openDialogs = next;
  for (const listener of listeners) listener();
}

function useIsTopmost(id: string, open: boolean): boolean {
  useEffect(() => {
    if (!open) return undefined;
    setOpenDialogs([...openDialogs, id]);
    return () => setOpenDialogs(openDialogs.filter((entry) => entry !== id));
  }, [id, open]);
  const top = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openDialogs.at(-1),
  );
  return open && top === id;
}

export function ModalDialog(props: ModalDialogProps) {
  const { title, open = true, children, maxHeight, footer } = props;
  const bounds = useBounds();
  const [bodyRef, bodySize] = useElementSize();
  const [innerRef, innerSize] = useElementSize();
  const [offset, setOffset] = useState(0);
  const topmost = useIsTopmost(useId(), open);
  // Rows of body hidden below the visible window; the body scrolls with PgUp/PgDn.
  const hidden = bodySize !== null && innerSize !== null ? Math.max(0, innerSize.height - bodySize.height) : 0;
  const scroll = Math.min(offset, hidden);
  const page = Math.max(1, (bodySize?.height ?? 1) - 1);
  // A fresh scroll position whenever the dialog reopens or its content shrinks below the offset.
  useEffect(() => {
    if (!open) setOffset(0);
  }, [open]);
  useEffect(() => {
    if (offset > hidden) setOffset(hidden);
  }, [offset, hidden]);
  useInput(
    (_input, key) => {
      if (key.pageDown) setOffset(Math.min(hidden, scroll + page));
      if (key.pageUp) setOffset(Math.max(0, scroll - page));
    },
    { isActive: topmost && hidden > 0 },
  );
  if (!open) return null;
  const frameCap = Math.max(1, bounds.rows);
  const cap = maxHeight === undefined ? frameCap : Math.min(maxHeight, frameCap);
  return (
    <Box
      backgroundColor={colors.surface}
      borderColor={colors.border}
      borderStyle="double"
      padding={spacing['1']}
      flexDirection="column"
      flexShrink={0}
      maxHeight={cap}
      overflow="hidden"
    >
      <Box flexShrink={0}>
        <Text color={colors.accent} wrap="truncate-end">
          {title}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={colors.text}>
          ──
        </Text>
      </Box>
      {children ? (
        <Box ref={bodyRef} flexDirection="column" flexShrink={1} minHeight={0} overflow="hidden">
          <Box ref={innerRef} flexDirection="column" flexShrink={0} marginTop={-scroll}>
            {children}
          </Box>
        </Box>
      ) : null}
      {hidden > 0 ? (
        <Box flexShrink={0}>
          <Text color={colors['text-dim']} wrap="truncate-end">
            {`${scroll > 0 ? '▲' : ' '}${scroll < hidden ? '▼' : ' '} PgUp/PgDn scroll`}
          </Text>
        </Box>
      ) : null}
      {footer ? <Box flexShrink={0}>{footer}</Box> : null}
    </Box>
  );
}
