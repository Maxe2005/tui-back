// tui/zones/logs: docker-subscription lifecycle — reconciles subscriptions with the repoPaths
// currently "active" (selected in either list, or the ad hoc fullscreen preview target): a
// deselected or closed preview's stream stops. A key both selected and previewed is subscribed
// once (subscribeLogsPane/LogsManager.subscribe are idempotent).
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
