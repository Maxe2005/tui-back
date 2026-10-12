// tui/shared/input-history: the one implementation of "recall what I typed before" — used by
// the Logs filter editor (story 5.4) and the `:` command bar (story 5.6). Pure and generic over
// the surrounding editor: callers keep their own draft/cursor state and only feed this module the
// current text, the browse state and the list.

// Front-pushes `entry` onto `history`, then trims to `maxSize`. With `dedupEverywhere`, any
// previous occurrence is removed first, so each entry exists at most once per list; otherwise
// only a repeat of the top entry is deduped (a non-top repeat is stored twice).
export function pushHistoryEntry(
  history: readonly string[],
  entry: string,
  maxSize: number,
  dedupEverywhere = false,
): string[] {
  const rest = dedupEverywhere
    ? history.filter((existing) => existing !== entry)
    : history.length > 0 && history[0] === entry
      ? history.slice(1)
      : history;
  return [entry, ...rest].slice(0, Math.max(maxSize, 0));
}

// Arrow-recall browsing state: `index` is the position in `history` currently shown (0 == most
// recent), `savedDraft` is the draft exactly as it stood before browsing began, restored verbatim
// once `↓` walks back past the most-recent entry.
export type HistoryBrowseState = { index: number; savedDraft: string };

export type HistoryBrowseResult = { query: string; browsing: HistoryBrowseState | null };

// `↑` on an untouched draft recalls the most-recent entry (preserving the draft as `savedDraft`);
// further `↑` walks older entries; `↑` at the oldest entry (or on an empty history) is a no-op.
// Any entry equal to the draft being browsed from is skipped (the most-recent one on a fresh `↑`
// when it equals the query; entries equal to `savedDraft` while walking older).
export function resolveHistoryBrowseUp(
  currentQuery: string,
  browsing: HistoryBrowseState | null,
  history: readonly string[],
): HistoryBrowseResult {
  if (history.length === 0) {
    return { query: currentQuery, browsing };
  }
  if (browsing === null) {
    let index = 0;
    while (index < history.length && history[index] === currentQuery) {
      index += 1;
    }
    if (index >= history.length) {
      return { query: currentQuery, browsing };
    }
    return { query: history[index]!, browsing: { index, savedDraft: currentQuery } };
  }
  let nextIndex = browsing.index + 1;
  while (nextIndex < history.length && history[nextIndex] === browsing.savedDraft) {
    nextIndex += 1;
  }
  if (nextIndex >= history.length) {
    return { query: currentQuery, browsing };
  }
  return { query: history[nextIndex]!, browsing: { index: nextIndex, savedDraft: browsing.savedDraft } };
}

// `↓` while browsing walks back toward the draft; one more `↓` past the most-recent entry
// (index 0) restores the original draft exactly and ends browsing. Only called while browsing.
// Like `↑`, entries equal to `savedDraft` are skipped — walking onto one restores the draft
// directly instead of showing the text twice.
export function resolveHistoryBrowseDown(
  browsing: HistoryBrowseState,
  history: readonly string[],
): HistoryBrowseResult {
  let prevIndex = browsing.index - 1;
  while (prevIndex >= 0 && history[prevIndex] === browsing.savedDraft) {
    prevIndex -= 1;
  }
  if (prevIndex < 0) {
    return { query: browsing.savedDraft, browsing: null };
  }
  return { query: history[prevIndex]!, browsing: { index: prevIndex, savedDraft: browsing.savedDraft } };
}

// The snap-back rule: a printable character or Backspace while browsing ends browsing, restores
// the saved draft and applies the keystroke on top of it (cursor at the draft's end). Not
// browsing, the live text/cursor are returned unchanged. Also used by Tab-style actions that must
// start from the pre-browse draft rather than the recalled text.
export function resolveSnapBackBase(
  query: string,
  cursor: number,
  browsing: HistoryBrowseState | null,
): { base: string; cursor: number } {
  if (browsing === null) {
    return { base: query, cursor };
  }
  return { base: browsing.savedDraft, cursor: browsing.savedDraft.length };
}
