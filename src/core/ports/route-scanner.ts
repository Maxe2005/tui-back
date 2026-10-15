// core/ports/route-scanner: the RouteScannerPort a repo's route-explorer module implements
// (AD-5). Route identity across scanners is `method + path` only; scanner-specific metadata
// never crosses this port. Error codes: `route-exploration-not-activated` (the repo's manifest
// does not activate `route-explorer`) and `route-scan-failed` (no list could be produced —
// unparsable/unreadable spec, never an empty list).
import type { Result } from '../result.js';

// A route may also carry the request details its scanner could discover — parameters, the
// body content type and a body example. All optional and plain data: a scanner that discovers
// none of them simply omits the keys, and no scanner-specific vocabulary (schema, $ref, …)
// ever crosses this port.
export interface RouteParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  example?: unknown;
}

export interface Route {
  method: string;
  path: string;
  summary?: string;
  parameters?: RouteParameter[];
  bodyContentType?: string;
  bodyExample?: unknown;
}

export interface RouteScannerPort {
  scan(repoPath: string, config: Record<string, unknown>): Promise<Result<Route[]>>;
}
