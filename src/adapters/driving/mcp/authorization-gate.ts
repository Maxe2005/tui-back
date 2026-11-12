// adapters/driving/mcp/authorization-gate: the single enforcement point for human approval of
// MCP tool calls. Every non-`read` tool passes through `authorize` before it runs; anything
// other than an explicit "accept" (decline, cancel, timeout, elicitation error, client without
// the elicitation capability) fails closed. Approvals are per call and never cached.
import { err, ok, type Result } from '../../../core/result.js';
import type { SafetyClass } from './tool-registry.js';

export interface ElicitRequest {
  message: string;
  requestedSchema: { type: 'object'; properties: Record<string, never> };
}
export interface ElicitResponse {
  action: 'accept' | 'decline' | 'cancel';
}

export interface AuthorizationRequest {
  tool: string;
  safety: SafetyClass;
  /** Already-redacted arguments, shown verbatim to the human. */
  args: unknown;
  /** Repos / EDTs the call affects. */
  targets: string[];
}

export interface AuthorizationGate {
  authorize(request: AuthorizationRequest): Promise<Result<void>>;
}

export interface GateDeps {
  getCapabilities: () => { elicitation?: unknown } | undefined;
  elicit: (request: ElicitRequest, options: { timeout: number }) => Promise<ElicitResponse>;
  timeoutMs: number;
}

export const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;

export function buildPrompt(request: AuthorizationRequest): string {
  const lines = [
    `Approve ${request.safety === 'destructive' ? 'DESTRUCTIVE ' : ''}tui-back tool "${request.tool}"?`,
    `Arguments: ${JSON.stringify(request.args ?? {})}`,
    `Affects: ${request.targets.length === 0 ? '(the tui-back workspace)' : request.targets.join(', ')}`,
  ];
  return lines.join('\n');
}

export function createAuthorizationGate(deps: GateDeps): AuthorizationGate {
  return {
    async authorize(request) {
      if (request.safety === 'read') {
        return ok(undefined);
      }
      let capabilities: { elicitation?: unknown } | undefined;
      try {
        capabilities = deps.getCapabilities();
      } catch {
        capabilities = undefined;
      }
      if (capabilities?.elicitation === undefined || capabilities.elicitation === null) {
        return err(
          'authorization-unavailable',
          `Tool "${request.tool}" changes the workspace and needs human approval, but the connected MCP client does not support elicitation. Nothing was run.`,
          { reason: 'client-lacks-elicitation' },
        );
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), deps.timeoutMs);
        });
        const answer = await Promise.race([
          deps.elicit({ message: buildPrompt(request), requestedSchema: { type: 'object', properties: {} } }, { timeout: deps.timeoutMs }),
          timeout,
        ]);
        if (answer === 'timeout') {
          return err('authorization-denied', `Authorization for "${request.tool}" timed out; nothing was run.`, { reason: 'timeout' });
        }
        if (answer.action === 'accept') {
          return ok(undefined);
        }
        return err('authorization-denied', `The human ${answer.action === 'cancel' ? 'cancelled' : 'declined'} "${request.tool}"; nothing was run.`, { reason: answer.action });
      } catch (error) {
        console.error(error);
        const timedOut = /timed? ?out/i.test(String(error));
        return err(
          'authorization-denied',
          timedOut
            ? `Authorization for "${request.tool}" timed out; nothing was run.`
            : `Authorization for "${request.tool}" could not be obtained (elicitation failed); nothing was run.`,
          { reason: timedOut ? 'timeout' : 'elicitation-error' },
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
