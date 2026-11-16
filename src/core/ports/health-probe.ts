// core/ports/health-probe: the HealthProbePort core uses to ask a service's manifest `healthUrl`
// whether it answers. One `GET` with a per-request timeout; core never does inline HTTP. A probe
// never throws: an unreachable URL or a timeout is `ok({ healthy: false })`, not an `err`.
import type { Result } from '../result.js';

export interface HealthProbeOutcome {
  // True only for a 2xx answer.
  healthy: boolean;
  // HTTP status when the service answered, absent on timeout / connection failure.
  status?: number;
  // Why the probe was not healthy (non-2xx, timeout, connection error) — for the report detail.
  reason?: string;
}

export interface HealthProbePort {
  probe(url: string, timeoutMs: number): Promise<Result<HealthProbeOutcome>>;
}
