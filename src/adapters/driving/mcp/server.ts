// adapters/driving/mcp/server: MCP stdio server over the tool registry. Tool results are the
// AD-3 envelope serialized as JSON text; stdout is reserved for protocol messages, so every
// diagnostic goes to stderr. Annotations are advisory — the registry's safety class rules.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { err, type Result } from '../../../core/result.js';
import type { RegisteredTool } from './tool-registry.js';

export function createMcpServer(tools: RegisteredTool[], version: string): McpServer {
  const server = new McpServer({ name: 'tui-back', version });
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
      async (input: Record<string, unknown>) => {
        const { text, isError } = await runToEnvelope(tool, input);
        return { content: [{ type: 'text' as const, text }], isError };
      },
    );
  }
  return server;
}

const INTERNAL_ERROR_TEXT = JSON.stringify(err('internal-error', 'Internal error while running the tool; see server logs.'));

// Always yields an envelope: a throw, a non-Result value or an unserializable result becomes a
// generic internal-error (full detail on stderr only, never in the client-facing message).
async function runToEnvelope(tool: RegisteredTool, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  try {
    const result: unknown = await tool.run(input);
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
