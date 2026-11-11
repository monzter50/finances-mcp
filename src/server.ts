import { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from './apiClient.js';
import { OPEN_GATE, type SessionGate } from './auth/session.js';
import { registerReadTools } from './tools/read.js';
import { registerImportTools } from './tools/import.js';

export interface ServerOptions {
  /** FINANCES_MCP_ENABLE_WRITES=true: also register the screenshot import tools. */
  enableWrites?: boolean
  /** Keychain mode's browser-login session; without one, tools always run. */
  session?: SessionGate
}

// Transport-agnostic so tests can connect it over InMemoryTransport.
export function createServer (api: ApiClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'finances-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  const session = options.session ?? OPEN_GATE;
  registerReadTools(server, api, session);
  if (options.enableWrites === true) registerImportTools(server, api, session);
  return server;
}
