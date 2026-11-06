#!/usr/bin/env node
// stdout is the MCP protocol channel: log only with console.error.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, resolveEnv } from './config.js';
import { createApiClient } from './apiClient.js';
import { createServer } from './server.js';

let api: ReturnType<typeof createApiClient>;
let enableWrites: boolean;
try {
  const env = resolveEnv();
  api = createApiClient(loadConfig(env)); // fail fast on bad env
  enableWrites = env.FINANCES_MCP_ENABLE_WRITES === 'true';
} catch (err) {
  // Config errors are already actionable; a stack trace only hides them (e.g. in the Inspector's stderr panel).
  console.error(`finances-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

serveStdio(() => createServer(api, { enableWrites }));
