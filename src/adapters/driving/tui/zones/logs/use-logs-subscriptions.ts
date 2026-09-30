// tui/zones/logs: docker-subscription lifecycle — extracted from logs-zone.tsx (refactor).
// Reconciles docker subscriptions with whichever repoPaths are currently "active" (selected in
// either list, or the ad hoc fullscreen preview target) — I/O matrix SELECTION_CHANGE: "that
// stream stops"; FULLSCREEN_PREVIEW: "stream started ad hoc" / "Escape stops that ad hoc
// stream". A key both selected and previewed (Enter on an already-selected row) is only ever
// subscribed once (subscribeLogsPane/LogsManager.subscribe are both idempotent).
import { useEffect, useRef } from 'react';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';

export function useLogsSubscriptions({
  activeRepoPaths,
  logsFullscreenTarget,
  rows,
  subscribeLogsPane,
  unsubscribeLogsPane,
}: {
  activeRepoPaths: readonly string[];
  logsFullscreenTarget: string | null;
  rows: readonly ServiceBranchDivergence[];
  subscribeLogsPane: (repoPath: string, service: string) => Promise<void>;
  unsubscribeLogsPane: (repoPath: string) => void;
}): void {
  const previousActiveKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextKeys = new Set(activeRepoPaths);
    if (logsFullscreenTarget !== null) {
      nextKeys.add(logsFullscreenTarget);
    }
    const previousKeys = previousActiveKeysRef.current;
    for (const path of nextKeys) {
      if (!previousKeys.has(path)) {
        const service = rows.find((row) => row.path === path)?.service ?? path;
        void subscribeLogsPane(path, service);
      }
    }
    for (const path of previousKeys) {
      if (!nextKeys.has(path)) {
        unsubscribeLogsPane(path);
      }
    }
    previousActiveKeysRef.current = nextKeys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPaths, logsFullscreenTarget, rows]);

  // Leaving the Logs zone (unmount) must never leave a docker child process running
  // unattended — tears down every still-active subscription.
  useEffect(
    () => () => {
      for (const path of previousActiveKeysRef.current) {
        unsubscribeLogsPane(path);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
