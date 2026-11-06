// Required env vars, no fallbacks: a missing value must fail at startup.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

export interface Config { apiUrl: string, apiToken: string, timeoutMs: number }

// Repo root, from both src/ (tsx) and dist/ (built).
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Reads a generic password from the macOS login Keychain. Store it with
 * `security add-generic-password -s <service> -a "$USER" -w` (prompts for the value).
 */
export function readKeychainPassword (service: string): string {
  if (process.platform !== 'darwin') throw new Error('FINANCES_API_TOKEN_KEYCHAIN only works on macOS');
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error(`No Keychain item for service "${service}". Add it with: security add-generic-password -s ${service} -a "$USER" -w`);
  }
}

function resolveToken (env: NodeJS.ProcessEnv, readKeychain: (service: string) => string): string {
  const service = env.FINANCES_API_TOKEN_KEYCHAIN?.trim();
  if (!service) return env.FINANCES_API_TOKEN?.trim() ?? '';
  if (env.FINANCES_API_TOKEN) throw new Error('Set FINANCES_API_TOKEN or FINANCES_API_TOKEN_KEYCHAIN, not both');
  return readKeychain(service).trim();
}

export function loadConfig (env: NodeJS.ProcessEnv = process.env, readKeychain = readKeychainPassword): Config {
  const apiUrl = env.FINANCES_API_URL?.trim();
  if (!apiUrl) throw new Error('FINANCES_API_URL is required (e.g. http://localhost:3000/api). Set it in the environment, or create .env.<name> from .env.example and pass --env <name>.');
  const apiToken = resolveToken(env, readKeychain);
  // Same format as the API (src/utils/apiToken.ts) and the .gitleaks.toml rule.
  if (!/^fpat_[A-Za-z0-9_-]{43}$/.test(apiToken)) {
    throw new Error('FINANCES_API_TOKEN (or the FINANCES_API_TOKEN_KEYCHAIN item) must be a full personal API token (fpat_ followed by 43 characters)');
  }

  const url = new URL(apiUrl);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new Error('FINANCES_API_URL must use https unless it points at localhost');
  }
  return { apiUrl: apiUrl.replace(/\/+$/, ''), apiToken, timeoutMs: 10_000 };
}

/**
 * `--env <name>` loads `.env.<name>` from the repo root. Its values win over
 * the process environment so a stray exported var can't silently redirect
 * the server to another environment. Without `--env`, only process env is used.
 */
export function resolveEnv (argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, root = ROOT): NodeJS.ProcessEnv {
  const { values } = parseArgs({ args: argv, options: { env: { type: 'string' } } });
  const name = values.env;
  if (name === undefined) return env;
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`--env must be a simple name like local or staging, got "${name}"`);

  const file = `${root.replace(/\/$/, '')}/.env.${name}`;
  if (!existsSync(file)) throw new Error(`--env ${name}: ${file} not found (copy .env.example)`);
  return { ...env, ...parseEnv(readFileSync(file, 'utf8')) };
}
