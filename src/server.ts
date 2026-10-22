import { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from './apiClient.js';
import { registerReadTools } from './tools/read.js';

// Transport-agnostic so tests can connect it over InMemoryTransport.
export function createServer (api: ApiClient): McpServer {
  const server = new McpServer({ name: 'finances-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  registerReadTools(server, api);
  return server;
}
