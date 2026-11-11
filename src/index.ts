#!/usr/bin/env node
// stdout is the MCP protocol channel: log only with console.error.
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { envName, loadConfig, readKeychainPassword, resolveEnv, writeKeychainPassword } from './config.js';
import { createApiClient } from './apiClient.js';
import { createServer } from './server.js';
import { createSession, type Session } from './auth/session.js';

function openBrowser (url: string) {
  if (process.platform !== 'darwin') return; // the URL is already on stderr
  execFile('open', [url], (err) => { if (err) console.error(`finances-mcp: could not open the browser: ${err.message}`); });
}

let api: ReturnType<typeof createApiClient>;
let enableWrites: boolean;
let session: Session | undefined;
try {
  const env = resolveEnv();
  const cfg = loadConfig(env); // fail fast on bad env
  api = createApiClient(cfg);
  enableWrites = env.FINANCES_MCP_ENABLE_WRITES === 'true';
  if (cfg.keychainService !== undefined) {
    session = createSession(api, {
      keychainService: cfg.keychainService,
      tokenName: `mcp-${envName() ?? 'default'}-${hostname()}`.slice(0, 60),
      scopes: enableWrites ? ['read', 'write'] : ['read'],
      openBrowser,
      readKeychain: readKeychainPassword,
      writeKeychain: writeKeychainPassword
    });
  }
} catch (err) {
  // Config errors are already actionable; a stack trace only hides them (e.g. in the Inspector's stderr panel).
  console.error(`finances-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

serveStdio(() => createServer(api, { enableWrites, session }));
// Checked in the background so Claude isn't kept waiting; tools wait for it via require().
session?.start().catch((err: unknown) => { console.error(`finances-mcp: session check failed: ${String(err)}`); });
