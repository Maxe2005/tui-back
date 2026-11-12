// adapters/driving/mcp/authorization-gate: the single enforcement point for human approval of
// MCP tool calls. Every non-`read` tool passes through `authorize` before it runs; anything
// other than an explicit "accept" (decline, cancel, timeout, elicitation error, client without
// the elicitation capability) fails closed. Approvals are per call and never cached.
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
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

const MAX_ARGS_CHARS = 2000;
const MAX_TIMER_MS = 2147483647;
const clean = (value: string): string => value.replace(/[\r\n\u0000-\u001f]/g, ' ');

export function buildPrompt(request: AuthorizationRequest): string {
  let args = JSON.stringify(request.args ?? {});
  if (args.length > MAX_ARGS_CHARS) args = `${args.slice(0, MAX_ARGS_CHARS)}…[truncated]`;
  const targets = request.targets.map(clean);
  const lines = [
    `Approve ${request.safety === 'destructive' ? 'DESTRUCTIVE ' : ''}tui-back tool "${request.tool}"?`,
    `Arguments: ${args}`,
    `Affects: ${targets.length === 0 ? '(the tui-back workspace)' : targets.join(', ')}`,
  ];
  return lines.join('\n');
}

export function createAuthorizationGate(deps: GateDeps): AuthorizationGate {
  const timeoutMs =
    Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? Math.min(deps.timeoutMs, MAX_TIMER_MS) : DEFAULT_AUTHORIZATION_TIMEOUT_MS;
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
      const elicitation = capabilities?.elicitation;
      const urlOnly =
        typeof elicitation === 'object' && elicitation !== null && 'url' in elicitation && !('form' in elicitation);
      if (elicitation === undefined || elicitation === null || urlOnly) {
        return err(
          'authorization-unavailable',
          `Tool "${request.tool}" changes the workspace and needs human approval, but the connected MCP client does not support elicitation. Nothing was run.`,
          { reason: urlOnly ? 'url-only-elicitation' : 'client-lacks-elicitation' },
        );
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const answer = await Promise.race([
          deps.elicit({ message: buildPrompt(request), requestedSchema: { type: 'object', properties: {} } }, { timeout: timeoutMs }),
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
        const timedOut = error instanceof McpError && error.code === ErrorCode.RequestTimeout;
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
