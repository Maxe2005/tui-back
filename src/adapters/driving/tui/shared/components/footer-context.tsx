// tui/shared/components: renders nothing, but registers a footer context while mounted — for a
// view that decides its context after hook-bearing early returns, where `useFooterContext`
// cannot be called.
import type { FooterContextId, FooterOwner } from '../../keybindings/index.js';
import { useFooterContext } from '../hooks/use-footer-context.js';
import type { AppStore } from '../../store/app-store.js';

export function FooterContext({ owner, id, useStore }: { owner: FooterOwner; id: FooterContextId | null; useStore?: AppStore }) {
  useFooterContext(owner, id, useStore);
  return null;
}
