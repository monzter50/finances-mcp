import { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from './apiClient.js';
import { registerReadTools } from './tools/read.js';
import { registerImportTools } from './tools/import.js';

export interface ServerOptions {
  /** FINANCES_MCP_ENABLE_WRITES=true: also register the screenshot import tools. */
  enableWrites?: boolean
}

// Transport-agnostic so tests can connect it over InMemoryTransport.
export function createServer (api: ApiClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'finances-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  registerReadTools(server, api);
  if (options.enableWrites === true) registerImportTools(server, api);
  return server;
}
