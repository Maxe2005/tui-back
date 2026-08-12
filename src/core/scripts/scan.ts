// core/scripts/scan: the scan use-case (AD-2) — propose candidate manifest-carrying
// directories under a root. Proposes only, never auto-registers (AD-6); the driven
// registry adapter owns the walk, the root-existence probe (scan-root-not-found), and the
// reporting of unreadable subtrees (`skipped`) so a partial scan is never silent.
import { err, ok, type Result } from '../result.js';
import type { RegistryPort, ScanResult } from '../ports/registry.js';

export type ScanData = ScanResult;

export async function scanRepos(
  registry: RegistryPort,
  root: string | undefined,
): Promise<Result<ScanData>> {
  if (root === undefined) {
    return err('missing-argument', 'Usage: tui-back scan <root>');
  }

  const scanned = await registry.scan(root);
  if (!scanned.ok) {
    return scanned;
  }
  return ok(scanned.data);
}
