// adapters/driving/mcp/server: MCP stdio server over the tool registry. Tool results are the
// AD-3 envelope serialized as JSON text; stdout is reserved for protocol messages, so every
// diagnostic goes to stderr. Annotations are advisory — the registry's safety class rules.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { err, type Result } from '../../../core/result.js';
import { createAuthorizationGate, DEFAULT_AUTHORIZATION_TIMEOUT_MS, type AuthorizationGate } from './authorization-gate.js';
import type { PreparedCall, RegisteredTool, ToolRunContext } from './tool-registry.js';

export function createMcpServer(
  tools: RegisteredTool[],
  version: string,
  options: { authorizationTimeoutMs?: number; gate?: AuthorizationGate } = {},
): McpServer {
  const server = new McpServer({ name: 'tui-back', version });
  const gate =
    options.gate ??
    createAuthorizationGate({
      getCapabilities: () => server.server.getClientCapabilities(),
      elicit: async (request, requestOptions) => {
        const response = await server.server.elicitInput(request, requestOptions);
        return { action: response.action };
      },
      timeoutMs: options.authorizationTimeoutMs ?? DEFAULT_AUTHORIZATION_TIMEOUT_MS,
    });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: `${tool.description} [safety: ${tool.safety}]`,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.safety === 'read',
          ...(tool.safety === 'destructive' ? { destructiveHint: true } : {}),
        },
        _meta: { safety: tool.safety },
      },
      async (input: Record<string, unknown>, extra: ToolExtra) => {
        let finished = false;
        const ctx: ToolRunContext = {
          ...(extra?.signal === undefined ? {} : { signal: extra.signal }),
          ...progressSender(extra, () => finished),
        };
        try {
          return await handle(tool, input, ctx, gate);
        } finally {
          finished = true;
        }
      },
    );
  }
  return server;
}

type ToolReply = { content: Array<{ type: 'text'; text: string }>; isError: boolean };
const reply = (text: string, isError: boolean): ToolReply => ({ content: [{ type: 'text' as const, text }], isError });
const cancelledReply = (tool: RegisteredTool): ToolReply =>
  reply(JSON.stringify(err('cancelled', `The request for "${tool.name}" was cancelled; nothing was run.`)), true);

async function handle(tool: RegisteredTool, input: Record<string, unknown>, ctx: ToolRunContext, gate: AuthorizationGate): Promise<ToolReply> {
  const invalid = tool.validateInput?.(input);
  if (invalid !== undefined) {
    return reply(JSON.stringify(err('invalid-argument', invalid)), true);
  }
  if (tool.safety !== 'read') {
    let targets: string[] | undefined;
    if (tool.prepare !== undefined) {
      if (ctx.signal?.aborted === true) return cancelledReply(tool);
      let prepared: Result<PreparedCall>;
      try {
        prepared = await tool.prepare(input, ctx);
      } catch (error) {
        console.error(error);
        prepared = err('internal-error', 'Internal error while preparing the tool; see server logs.');
      }
      if (!prepared.ok) {
        return reply(JSON.stringify(prepared), true);
      }
      if ('done' in prepared.data) {
        return reply(JSON.stringify(prepared.data.done), !prepared.data.done.ok);
      }
      targets = prepared.data.targets;
      ctx.argv = prepared.data.argv;
    }
    let verdict: Result<void>;
    try {
      verdict = await gate.authorize({
        tool: tool.name,
        safety: tool.safety,
        args: tool.redact === undefined ? input : tool.redact(input),
        targets: targets ?? tool.describeTargets?.(input) ?? [],
      });
    } catch (error) {
      console.error(error);
      verdict = err('authorization-denied', `Authorization for "${tool.name}" could not be prepared; nothing was run.`, {
        reason: 'prompt-build-failed',
      });
    }
    if (!verdict.ok) {
      return reply(JSON.stringify(verdict), true);
    }
    if (ctx.signal?.aborted === true) return cancelledReply(tool);
  }
  const { text, isError } = await runToEnvelope(tool, input, ctx);
  return reply(text, isError);
}

const INTERNAL_ERROR_TEXT = JSON.stringify(err('internal-error', 'Internal error while running the tool; see server logs.'));

// Always yields an envelope: a throw, a non-Result value or an unserializable result becomes a
// generic internal-error (full detail on stderr only, never in the client-facing message).
async function runToEnvelope(tool: RegisteredTool, input: Record<string, unknown>, ctx: ToolRunContext): Promise<{ text: string; isError: boolean }> {
  try {
    const result: unknown = await tool.run(input, ctx);
    if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
      throw new Error(`tool "${tool.name}" returned a non-Result value`);
    }
    const text: string | undefined = JSON.stringify(result);
    if (typeof text !== 'string') {
      throw new Error(`tool "${tool.name}" result is not serializable`);
    }
    return { text, isError: !(result as Result<unknown>).ok };
  } catch (error) {
    console.error(error);
    return { text: INTERNAL_ERROR_TEXT, isError: true };
  }
}

interface ToolExtra {
  signal?: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; message?: string } }) => Promise<void>;
}

// Progress is sent only when the client supplied a progressToken; the counter is strictly
// increasing and a failed send is logged, never propagated into the running tool.
function progressSender(extra: ToolExtra | undefined, isFinished: () => boolean): { onProgress?: (message: string) => void } {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || send === undefined) {
    return {};
  }
  let counter = 0;
  return {
    onProgress: (message) => {
      if (isFinished()) {
        return;
      }
      counter += 1;
      try {
        send({ method: 'notifications/progress', params: { progressToken: token, progress: counter, message } }).catch((error: unknown) => {
          console.error(error);
        });
      } catch (error) {
        console.error(error);
      }
    },
  };
}
