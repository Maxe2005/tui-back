// tui/store/slices: the `:` command bar's persisted recall list — most recent
// first, one flat list in state.json (`commandHistory`). In the store (not bar-local) so the
// Settings screen's clear action and the bar's recall share one source of truth, like
// filterHistory in logs-slice.ts; both run on the same shared persisted-history controller.
import type { StateCreator } from 'zustand';
import type { AppState, AppStoreDeps } from '../app-store.js';
import { createPersistedHistoryStore, pushHistoryEntry } from '../../shared/input-history/index.js';

export type CommandHistorySlice = {
  commandHistory: string[];
  // Hydrates commandHistory from state.json once at AppShell mount — a missing/corrupt file (or
  // an unwired store) keeps the empty default.
  loadCommandHistory: () => Promise<void>;
  // Called on a recognized command's Enter: pushes the submitted query (dedup/size per
  // settings.commandPalette) and persists the whole list immediately.
  commitCommandHistoryEntry: (query: string) => void;
  clearCommandHistory: () => void;
  // `:reset` (histories category): empties the list and resolves only once every queued write
  // has landed, so the reset's own disk write can't be overwritten by a pending save.
  clearCommandHistoryAndDrainSaves: () => Promise<void>;
};

export function createCommandHistorySlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], CommandHistorySlice> {
  const store = createPersistedHistoryStore<string[]>(
    deps ? { read: () => deps.state.readCommandHistory(), write: (history) => deps.state.writeCommandHistory(history) } : null,
  );

  return (set, get) => ({
    commandHistory: [],
    loadCommandHistory: () => store.load((history) => set({ commandHistory: history })),
    commitCommandHistoryEntry: (query) => {
      store.mutate(() => {
        const { historySize, historyDedup } = get().settings.commandPalette;
        set((state) => ({ commandHistory: pushHistoryEntry(state.commandHistory, query, historySize, historyDedup) }));
        return get().commandHistory;
      });
    },
    clearCommandHistory: () => {
      store.mutate(() => {
        set({ commandHistory: [] });
        return get().commandHistory;
      });
    },
    clearCommandHistoryAndDrainSaves: () => store.resetAndDrain(() => set({ commandHistory: [] })),
  });
}
