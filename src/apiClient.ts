// The only file that talks HTTP to the finances API.
import type { Config } from './config.js';

export class ApiError extends Error {
  constructor (public status: number, public errorCode: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | undefined>;

export interface ApiTokenInfo { id: string, name: string }

interface RequestOptions {
  query?: Query
  body?: unknown
  /** Bearer to send instead of the API token: a login JWT, or null for none. */
  auth?: string | null
}

export function createApiClient (cfg: Config) {
  let apiToken = cfg.apiToken;

  async function request<T> (method: string, path: string, { query, body, auth = apiToken }: RequestOptions = {}): Promise<T> {
    const url = new URL(cfg.apiUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
    const json = await res.json().catch(() => ({})) as { success?: boolean, data?: T, message?: string, errorCode?: string };
    if (!res.ok || json.success === false) {
      throw new ApiError(res.status, json.errorCode ?? 'UNKNOWN', json.message ?? `HTTP ${res.status}`);
    }
    return json as T; // full envelope: { success, data, pagination?, message }
  }

  return {
    get: async <T>(p: string, query?: Query) => await request<T>('GET', p, { query }),
    post: async <T>(p: string, body: unknown) => await request<T>('POST', p, { body }),
    token: () => apiToken,
    setToken: (token: string) => { apiToken = token; },

    // Login flow (src/auth). Token management routes accept only a session JWT.
    me: async () => { await request('GET', '/auth/me'); },
    login: async (email: string, password: string) =>
      (await request<{ token: string }>('POST', '/auth/login', { body: { email, password }, auth: null })).token,
    logout: async (jwt: string) => { await request('POST', '/auth/logout', { auth: jwt }); },
    listTokens: async (jwt: string) => (await request<{ data: ApiTokenInfo[] }>('GET', '/users/tokens', { auth: jwt })).data,
    revokeToken: async (jwt: string, id: string) => { await request('DELETE', `/users/tokens/${id}`, { auth: jwt }); },
    createToken: async (jwt: string, body: { name: string, scopes: Array<'read' | 'write'>, expiresInDays: number }) =>
      (await request<{ data: { token: string } }>('POST', '/users/tokens', { body, auth: jwt })).data.token
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
