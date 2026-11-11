/**
 * MCP server entry point.
 *
 * Run over stdio by Claude Code, which is why nothing here may write to stdout: the
 * transport owns it. Diagnostics go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSddServer } from '@agentforge/mcp-server';

async function main(): Promise<void> {
  const server = createSddServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write('agentforge-sdd MCP server connected over stdio\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `agentforge-sdd MCP server failed to start: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exit(1);
});
