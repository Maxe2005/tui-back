// tui/shared/components: the one fixed-menu list — rows with a clamped cursor, Home/End, Enter
// chooses the highlighted row, Esc answers the menu's own "cancel" choice. The reducer is pure
// (renderToString never delivers keys) and the view only renders the rows.
import { nextCursorForKey } from '../keys/list-cursor.js';
import { ListRow } from './list-row.js';

export type MenuItem<V extends string = string> = {
  value: V;
  label: string;
  // A disabled row stays visible but Enter on it never chooses.
  disabled?: boolean;
  // Dim text after the label (e.g. why a row is disabled).
  note?: string;
};

export type MenuKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
};

export type MenuStep<V extends string = string> =
  | { type: 'move'; cursor: number }
  | { type: 'choose'; choice: V }
  | { type: 'ignore' };

// `escapeChoice` is what Esc answers — the menu's own least-destructive exit, which need not be
// one of its rows.
export function resolveMenuKey<V extends string>(
  key: MenuKey,
  cursor: number,
  items: readonly MenuItem<V>[],
  escapeChoice: V,
): MenuStep<V> {
  const next = nextCursorForKey(key, cursor, items.length);
  if (next !== null) {
    return { type: 'move', cursor: next };
  }
  if (key.return === true) {
    const item = items[cursor];
    return item === undefined || item.disabled === true ? { type: 'ignore' } : { type: 'choose', choice: item.value };
  }
  if (key.escape === true) {
    return { type: 'choose', choice: escapeChoice };
  }
  return { type: 'ignore' };
}

export function MenuList<V extends string>({ items, cursor }: { items: readonly MenuItem<V>[]; cursor: number }) {
  return (
    <>
      {items.map((item, index) => (
        <ListRow key={item.value} label={item.label} meta={item.note} selected={index === cursor} />
      ))}
    </>
  );
}
