// core/ports/route-scanner: the RouteScannerPort a repo's route-explorer module
// implements (AD-5). Core's routes use-case consumes discovered routes through this port
// without ever importing the driven scanner adapter (AD-1); the adapter owns where the
// OpenAPI spec lives and how it parses. The canonical route identity across scanner
// implementations is `method + path` only — anything scanner-specific (operationId,
// framework metadata) never crosses this port.
//
// Error codes owned by this capability: `route-exploration-not-activated` (core's
// manifest gate — the repo never activated `route-explorer`) and `route-scan-failed`
// (the scanner could not produce a list — unparsable/unreadable spec, never an empty
// list). Both are kebab-case per AD-3.
import type { Result } from '../result.js';

export interface Route {
  method: string;
  path: string;
  summary?: string;
}

export interface RouteScannerPort {
  scan(repoPath: string, config: Record<string, unknown>): Promise<Result<Route[]>>;
}
