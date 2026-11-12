// MCP entrypoint (`tui-back mcp`): serves the read tools over stdio. stdout carries protocol
// messages only; stdin is the transport, never read by tools (interactive: false).
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../adapters/driving/mcp/server.js';
import { buildToolRegistry } from '../adapters/driving/mcp/tool-registry.js';
import { composeSubcommands } from './composition.js';

try {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  const server = createMcpServer(buildToolRegistry(composeSubcommands({ interactive: false })), version);
  const close = (): void => {
    void server.close().catch((error: unknown) => console.error(error));
  };
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
