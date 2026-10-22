// The only file that talks HTTP to the finances API.
import type { Config } from './config.js';

export class ApiError extends Error {
  constructor (public status: number, public errorCode: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | undefined>;

export function createApiClient (cfg: Config) {
  async function request<T> (method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const url = new URL(cfg.apiUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
    const json = await res.json().catch(() => ({})) as { success?: boolean, data?: T, message?: string, errorCode?: string };
    if (!res.ok || json.success === false) {
      throw new ApiError(res.status, json.errorCode ?? 'UNKNOWN', json.message ?? `HTTP ${res.status}`);
    }
    return json as T; // full envelope: { success, data, pagination?, message }
  }

  return { get: async <T>(p: string, q?: Query) => await request<T>('GET', p, q) };
}

export type ApiClient = ReturnType<typeof createApiClient>;
