// core/scripts/scan: the scan use-case (AD-2) — propose candidate manifest-carrying
// directories under a root. Proposes only, never auto-registers (AD-6); the driven
// registry adapter owns the walk and the root-existence probe (scan-root-not-found).
import { err, ok, type Result } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';

export interface ScanData {
  candidates: string[];
}

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
  return ok({ candidates: scanned.data });
}
