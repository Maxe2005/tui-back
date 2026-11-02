// tui/shared/hooks: the one predicate every zone's key handler is gated on. An open overlay
// (command bar, registry/settings/reset screen, realign dialog, help panel) or Ctrl+W resize-mode is the sole
// consumer of keys — Ink dispatches each keypress to every mounted handler, so zones go inert.
// A new overlay is registered here and nowhere else.
import { useAppStore, type AppStore, type AppState } from '../../store/app-store.js';

export function isZoneInputActive(
  state: Pick<
    AppState,
    'commandBarOpen' | 'registryScreenOpen' | 'settingsScreenOpen' | 'resetScreenOpen' | 'realignScreenOpen' | 'helpOpen' | 'resizeMode'
  >,
): boolean {
  return (
    !state.commandBarOpen &&
    !state.registryScreenOpen &&
    !state.settingsScreenOpen &&
    !state.resetScreenOpen &&
    !state.realignScreenOpen &&
    !state.helpOpen &&
    state.resizeMode === null
  );
}

export function useZoneInputActive(useStore: AppStore = useAppStore): boolean {
  return useStore(isZoneInputActive);
}
