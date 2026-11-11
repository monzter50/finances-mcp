// Required env vars, no fallbacks: a missing value must fail at startup.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

/**
 * `apiToken` is null only in Keychain mode (`keychainService` set) when there is
 * no usable token yet: the session then asks the user to log in (src/auth/session.ts).
 */
export interface Config { apiUrl: string, apiToken: string | null, keychainService?: string, timeoutMs: number }

// Repo root, from both src/ (tsx) and dist/ (built).
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Same format as the API (src/utils/apiToken.ts) and the .gitleaks.toml rule.
export const TOKEN_PATTERN = /^fpat_[A-Za-z0-9_-]{43}$/;

/** Reads a generic password from the macOS login Keychain, or null if there is no item. */
export function readKeychainPassword (service: string): string | null {
  if (process.platform !== 'darwin') throw new Error('FINANCES_API_TOKEN_KEYCHAIN only works on macOS');
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * Creates or replaces (-U) the Keychain item. The command goes through
 * `security -i` on stdin so the token never shows up in another process's `ps`.
 */
export function writeKeychainPassword (service: string, token: string): void {
  // Both end up unquoted in the command line, so only allow characters that need no escaping.
  if (!TOKEN_PATTERN.test(token) || !/^[\w.-]+$/.test(service)) throw new Error('Refusing to write an unexpected Keychain value');
  const account = (process.env.USER ?? 'finances-mcp').replace(/[^\w.-]/g, '');
  execFileSync('security', ['-i'], { input: `add-generic-password -U -s ${service} -a ${account} -w ${token}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
}

function resolveToken (env: NodeJS.ProcessEnv, readKeychain: (service: string) => string | null): string | null {
  const service = env.FINANCES_API_TOKEN_KEYCHAIN?.trim();
  if (service) {
    if (env.FINANCES_API_TOKEN) throw new Error('Set FINANCES_API_TOKEN or FINANCES_API_TOKEN_KEYCHAIN, not both');
    // Missing or malformed: not fatal, the user logs in and the item is rewritten.
    const token = readKeychain(service)?.trim() ?? '';
    return TOKEN_PATTERN.test(token) ? token : null;
  }

  const token = env.FINANCES_API_TOKEN?.trim() ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('FINANCES_API_TOKEN must be a full personal API token (fpat_ followed by 43 characters), or set FINANCES_API_TOKEN_KEYCHAIN to log in from the browser');
  }
  return token;
}

export function loadConfig (env: NodeJS.ProcessEnv = process.env, readKeychain = readKeychainPassword): Config {
  const apiUrl = env.FINANCES_API_URL?.trim();
  if (!apiUrl) throw new Error('FINANCES_API_URL is required (e.g. http://localhost:3000/api). Set it in the environment, or create .env.<name> from .env.example and pass --env <name>.');
  const apiToken = resolveToken(env, readKeychain);
  const keychainService = env.FINANCES_API_TOKEN_KEYCHAIN?.trim() || undefined;

  const url = new URL(apiUrl);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new Error('FINANCES_API_URL must use https unless it points at localhost');
  }
  return { apiUrl: apiUrl.replace(/\/+$/, ''), apiToken, ...(keychainService ? { keychainService } : {}), timeoutMs: 10_000 };
}

/** The `--env <name>` value (the last one wins), or undefined. */
export function envName (argv: string[] = process.argv.slice(2)): string | undefined {
  return parseArgs({ args: argv, options: { env: { type: 'string' } } }).values.env;
}

/**
 * `--env <name>` loads `.env.<name>` from the repo root. Its values win over
 * the process environment so a stray exported var can't silently redirect
 * the server to another environment. Without `--env`, only process env is used.
 */
export function resolveEnv (argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, root = ROOT): NodeJS.ProcessEnv {
  const name = envName(argv);
  if (name === undefined) return env;
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`--env must be a simple name like local or staging, got "${name}"`);

  const file = `${root.replace(/\/$/, '')}/.env.${name}`;
  if (!existsSync(file)) throw new Error(`--env ${name}: ${file} not found (copy .env.example)`);
  return { ...env, ...parseEnv(readFileSync(file, 'utf8')) };
}
