// Keychain mode only: keeps a valid API token, logging in from the browser when
// there is none (or the API rejects it). Tools call require() before the API.
//
// Several processes share the Keychain item (Claude Code, Desktop, the Inspector),
// so before asking for a login a session re-reads it: another process may have
// logged in already, and its login revoked this process's token (same name).
import { ApiError, type ApiClient } from '../apiClient.js';
import { TOKEN_PATTERN } from '../config.js';
import { startLoginServer, type LoginServer } from './loginServer.js';

const TOKEN_TTL_DAYS = 90;

export class LoginRequiredError extends Error {
  constructor (public url: string | null) {
    super(url ? `Not logged in. Log in at ${url}` : 'Not logged in. A login page is opening in the browser.');
    this.name = 'LoginRequiredError';
  }
}

/** What the tools need from a session; servers without one use OPEN_GATE. */
export interface SessionGate {
  /** Resolves once the session is ready, or throws LoginRequiredError. */
  require: () => Promise<void>
  /** Turns an INVALID_TOKEN error into a LoginRequiredError (and starts a login); returns other errors unchanged. */
  check: (err: unknown) => unknown
}

export const OPEN_GATE: SessionGate = { require: async () => {}, check: (err) => err };

export interface SessionOptions {
  keychainService: string
  /** Also the key for revoking this machine's previous token on the next login. */
  tokenName: string
  scopes: Array<'read' | 'write'>
  openBrowser: (url: string) => void
  readKeychain: (service: string) => string | null
  writeKeychain: (service: string, token: string) => void
}

export interface Session extends SessionGate {
  start: () => Promise<void>
  /** Closes the login page if it is open. */
  stop: () => void
  readonly state: 'checking' | 'ready' | 'login'
  readonly loginUrl: string | null
}

export function createSession (api: ApiClient, opts: SessionOptions): Session {
  let state: Session['state'] = 'checking';
  let started: Promise<void> | null = null;
  let login: LoginServer | null = null;
  let opening: Promise<void> | null = null;
  // Tokens the API refused, so the Keychain isn't retried with them on every call.
  const rejected = new Set<string>();

  /** Switches to a token another process stored. True if the API accepts it. */
  async function adoptKeychainToken (): Promise<boolean> {
    const token = opts.readKeychain(opts.keychainService)?.trim() ?? '';
    if (!TOKEN_PATTERN.test(token) || rejected.has(token)) return false;
    api.setToken(token);
    try {
      await api.me();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      rejected.add(token);
      return false;
    }
    state = 'ready';
    login?.close();
    console.error('finances-mcp: using the token another process saved to the Keychain.');
    return true;
  }

  function rejectCurrentToken () {
    const token = api.token();
    if (token !== null) rejected.add(token);
  }

  async function completeLogin (email: string, password: string): Promise<void> {
    const jwt = await api.login(email, password);
    try {
      for (const t of await api.listTokens(jwt)) {
        if (t.name === opts.tokenName) await api.revokeToken(jwt, t.id);
      }
      const token = await api.createToken(jwt, { name: opts.tokenName, scopes: opts.scopes, expiresInDays: TOKEN_TTL_DAYS });
      opts.writeKeychain(opts.keychainService, token);
      api.setToken(token);
      state = 'ready';
      console.error(`finances-mcp: logged in, token saved to the Keychain (${opts.keychainService}).`);
    } finally {
      // The API allows one active session per user: free it for the web app.
      await api.logout(jwt).catch(() => {});
    }
  }

  async function openLogin (): Promise<void> {
    state = 'login';
    if (login !== null) return;
    opening ??= (async () => {
      try {
        login = await startLoginServer({ onSubmit: completeLogin, onClose: () => { login = null; } });
        console.error(`finances-mcp: connected, but no finances API session yet. Log in at ${login.url} (opened in the browser); tools answer "Not logged in" until then.`);
        opts.openBrowser(login.url);
      } finally {
        opening = null;
      }
    })();
    await opening;
  }

  async function check (): Promise<void> {
    if (api.token() === null) return await openLogin();
    try {
      await api.me();
      state = 'ready';
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        rejectCurrentToken();
        return await openLogin();
      }
      // API unreachable: keep the token, each tool call reports the real error.
      state = 'ready';
    }
  }

  async function recover (): Promise<void> {
    if (!await adoptKeychainToken()) await openLogin();
  }

  return {
    get state () { return state; },
    get loginUrl () { return login?.url ?? null; },
    start: async () => { await (started ??= check()); },
    stop: () => { login?.close(); },
    async require () {
      await (started ??= check());
      if (state === 'ready') return;
      await recover(); // also reopens the page after it timed out
      if ((state as Session['state']) === 'ready') return;
      throw new LoginRequiredError(login?.url ?? null);
    },
    check (err) {
      if (!(err instanceof ApiError) || err.errorCode !== 'INVALID_TOKEN') return err;
      rejectCurrentToken();
      state = 'login';
      recover().catch((e: unknown) => { console.error(`finances-mcp: could not recover the session: ${String(e)}`); });
      return new LoginRequiredError(login?.url ?? null);
    }
  };
}
