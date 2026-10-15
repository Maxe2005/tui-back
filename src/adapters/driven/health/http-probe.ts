// adapters/driven/health: the driven implementation of core's HealthProbePort — a single Node
// `fetch` GET bounded by `AbortSignal.timeout`.
import type { HealthProbePort } from '../../../core/ports/health-probe.js';
import { err, ok } from '../../../core/result.js';

export function createHttpHealthProbe(fetchImpl: typeof fetch = fetch): HealthProbePort {
  return {
    async probe(url, timeoutMs) {
      if (url.trim() === '') {
        return err('invalid-argument', 'health probe url must not be empty');
      }
      try {
        const response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
        // Drain nothing: the body is irrelevant, release the connection.
        void response.body?.cancel().catch(() => {});
        if (response.status >= 200 && response.status < 300) {
          return ok({ healthy: true, status: response.status });
        }
        return ok({ healthy: false, status: response.status, reason: `HTTP ${response.status}` });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        const reason = name === 'TimeoutError' || name === 'AbortError' ? `timed out after ${timeoutMs} ms` : error instanceof Error ? error.message : String(error);
        return ok({ healthy: false, reason });
      }
    },
  };
}
