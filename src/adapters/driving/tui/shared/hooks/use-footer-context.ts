// tui/shared/hooks: registers the footer context an owner (a zone, a screen) currently shows and
// clears it on unmount, so the footer follows the dialog/pane that owns the keyboard.
import { useEffect } from 'react';
import type { FooterContextId } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';

export function useFooterContext(owner: string, id: FooterContextId | null, useStore: AppStore = useAppStore): void {
  const setFooterContext = useStore((state) => state.setFooterContext);
  useEffect(() => {
    setFooterContext(owner, id);
  }, [owner, id, setFooterContext]);
  useEffect(() => () => setFooterContext(owner, null), [owner, setFooterContext]);
}
