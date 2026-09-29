// tui/store/slices: the `:reset` overlay — reachable exclusively through the registered
// `reset` command (never a raw keypress). Mirrors settings-slice.ts's open/close triplet, plus
// a BUSY guard on open, a preview load for the summary step, and `runReset`, which calls the
// core resetTool use-case in-process (AD-2) and then rehydrates every store field it could
// have invalidated (loadEdts, loadTabVisibility, checkRegistryEmpty, loadFilterHistory) so
// the EDTs zone and top bar reflect the reset without restarting the TUI.
import type { StateCreator } from 'zustand';
import { resetTool, type ResetCategory, type ResetToolData } from '../../../../../core/scripts/reset-tool.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

const NO_DEPS_ERROR = 'No ports wired into the TUI store';

export const RESET_NOTICE_TIMEOUT_MS = 5000;

export type ResetPreview = {
  status: 'loading' | 'ready' | 'error';
  edtTopics: string[];
  serviceCount: number;
  error: string | null;
  // The files each category touches (resource keys are the absolute file paths).
  edtRegistryFile: string;
  registryFile: string;
  edtsBaseDir: string;
};

export type ResetSlice = {
  resetScreenOpen: boolean;
  // Why `:reset` was refused (BUSY) — shown as a one-line notice, no overlay opened.
  resetNotice: string | null;
  resetPreview: ResetPreview | null;
  resetStatus: 'idle' | 'running' | 'done';
  resetResult: ResetToolData | null;
  resetError: string | null;
  // Returns whether the overlay opened (false = refused, see resetNotice).
  openResetScreen: () => boolean;
  closeResetScreen: () => void;
  dismissResetNotice: () => void;
  runReset: (categories: ResetCategory[]) => Promise<void>;
};

export function resolveResetBusyReason(state: Pick<AppState, 'runInProgress' | 'currentEdtAction'>): string | null {
  if (state.runInProgress) {
    return 'Reset unavailable: a group update is running. Wait for it to finish.';
  }
  if (state.currentEdtAction !== null) {
    return `Reset unavailable: an EDT action (${state.currentEdtAction.type}) is in progress. Finish or cancel it first.`;
  }
  return null;
}

export function createResetSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], ResetSlice> {
  // Bumped on every open so a preview load from a superseded session never lands late.
  let previewSession = 0;

  return (set, get) => {
    const loadPreview = async (session: number) => {
      if (!deps) {
        set({ resetPreview: { ...emptyPreview(), status: 'error', error: NO_DEPS_ERROR } });
        return;
      }
      const [edts, repos] = await Promise.all([deps.edtRegistry.list(), deps.registry.list()]);
      if (session !== previewSession) {
        return;
      }
      const base = {
        edtRegistryFile: deps.edtRegistryResourceKey,
        registryFile: deps.registryResourceKey,
        edtsBaseDir: deps.edtsBaseDir,
      };
      if (!edts.ok || !repos.ok) {
        const error = !edts.ok ? edts.error.message : !repos.ok ? repos.error.message : null;
        set({ resetPreview: { ...base, status: 'error', edtTopics: [], serviceCount: 0, error } });
        return;
      }
      set({
        resetPreview: {
          ...base,
          status: 'ready',
          edtTopics: edts.data.map((entry) => entry.topic),
          serviceCount: repos.data.length,
          error: null,
        },
      });
    };

    return {
      resetScreenOpen: false,
      resetNotice: null,
      resetPreview: null,
      resetStatus: 'idle',
      resetResult: null,
      resetError: null,
      openResetScreen: () => {
        const reason = resolveResetBusyReason(get());
        if (reason !== null) {
          set({ resetNotice: reason });
          // Auto-dismissed rather than keypress-dismissed: the Enter that ran `:reset` reaches
          // every mounted useInput, so a "next key clears it" rule could erase the notice
          // before it was ever seen. Only clears its own notice, never a newer one.
          const timer = setTimeout(() => {
            if (get().resetNotice === reason) {
              set({ resetNotice: null });
            }
          }, RESET_NOTICE_TIMEOUT_MS);
          timer.unref?.();
          return false;
        }
        previewSession += 1;
        set({
          resetScreenOpen: true,
          resetNotice: null,
          resetPreview: { ...emptyPreview(), status: 'loading' },
          resetStatus: 'idle',
          resetResult: null,
          resetError: null,
        });
        void loadPreview(previewSession);
        return true;
      },
      closeResetScreen: () => {
        // A running reset can't be abandoned mid-way — the overlay stays until it settles.
        if (get().resetStatus === 'running') {
          return;
        }
        previewSession += 1;
        set({ resetScreenOpen: false, resetPreview: null, resetStatus: 'idle', resetResult: null, resetError: null });
      },
      dismissResetNotice: () => set({ resetNotice: null }),
      runReset: async (categories) => {
        if (get().resetStatus === 'running') {
          return;
        }
        if (!deps) {
          set({ resetStatus: 'done', resetError: NO_DEPS_ERROR });
          return;
        }
        set({ resetStatus: 'running', resetResult: null, resetError: null });
        const result = await resetTool({
          categories,
          edtRegistry: deps.edtRegistry,
          registry: deps.registry,
          state: deps.state,
          lock: deps.lock,
          keys: { edtRegistry: deps.edtRegistryResourceKey, registry: deps.registryResourceKey },
          edtsBaseDir: deps.edtsBaseDir,
        });
        // Rehydrate only after every disk write has settled (Design Notes: avoids racing the
        // logs slice's own filter-history save chain).
        await Promise.all([
          get().loadEdts(),
          get().loadTabVisibility(),
          get().checkRegistryEmpty(),
          get().loadFilterHistory(),
        ]);
        if (result.ok) {
          set({ resetStatus: 'done', resetResult: result.data });
        } else {
          set({ resetStatus: 'done', resetError: result.error.message });
        }
      },
    };
  };
}

function emptyPreview(): ResetPreview {
  return {
    status: 'loading',
    edtTopics: [],
    serviceCount: 0,
    error: null,
    edtRegistryFile: '',
    registryFile: '',
    edtsBaseDir: '',
  };
}
