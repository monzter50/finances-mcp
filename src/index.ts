#!/usr/bin/env node
// stdout is the MCP protocol channel: log only with console.error.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, resolveEnv } from './config.js';
import { createApiClient } from './apiClient.js';
import { createServer } from './server.js';

const env = resolveEnv();
const api = createApiClient(loadConfig(env)); // fail fast on bad env
const enableWrites = env.FINANCES_MCP_ENABLE_WRITES === 'true';

serveStdio(() => createServer(api, { enableWrites }));
