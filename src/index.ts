#!/usr/bin/env node
// stdout is the MCP protocol channel: log only with console.error.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, resolveEnv } from './config.js';
import { createApiClient } from './apiClient.js';
import { createServer } from './server.js';

const api = createApiClient(loadConfig(resolveEnv())); // fail fast on bad env

serveStdio(() => createServer(api));
