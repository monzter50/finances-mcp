import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/apiClient.js';
import { createSession, LoginRequiredError, type Session } from '../src/auth/session.js';
import { connectClient, TEST_CONFIG } from './helpers.js';

// Built at runtime so gitleaks' fpat_ rule doesn't flag a literal fixture.
const OLD_TOKEN = 'fpat_' + 'o'.repeat(43);
const NEW_TOKEN = 'fpat_' + 'n'.repeat(43);
const JWT = 'jwt-123';
const TOKEN_NAME = 'mcp-local-test-host';

type Route = (init?: RequestInit) => [number, unknown];

const realFetch = globalThis.fetch;
const sessions: Session[] = [];

/**
 * Stubs the finances API by "METHOD /path". Requests to 127.0.0.1 (the login
 * page) go to the real network. Returns the API calls made, with their bearer.
 */
function stubApi (routes: Record<string, Route>) {
  const calls: Array<{ route: string, auth: string | null, body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return await realFetch(input, init);
    const route = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api/, '')}`;
    const auth = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? null;
    calls.push({ route, auth, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const handler = routes[route];
    if (!handler) return new Response(JSON.stringify({ success: false, errorCode: 'NOT_FOUND' }), { status: 404 });
    const [status, body] = handler(init);
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

const LOGIN_ROUTES: Record<string, Route> = {
  'POST /auth/login': () => [200, { success: true, token: JWT, expiresIn: 86400 }],
  'GET /users/tokens': () => [200, { success: true, data: [{ id: 'old-id', name: TOKEN_NAME }, { id: 'web-id', name: 'my phone' }] }],
  'DELETE /users/tokens/old-id': () => [200, { success: true }],
  'POST /users/tokens': () => [201, { success: true, data: { id: 'new-id', name: TOKEN_NAME, token: NEW_TOKEN } }],
  'POST /auth/logout': () => [200, { success: true }],
  'GET /accounts': () => [200, { success: true, data: [] }]
};

const bearer = (init?: RequestInit) => new Headers(init?.headers).get('authorization')?.replace('Bearer ', '');

/** `keychain.value` is the item every process shares; set it to play "another process logged in". */
function setup (apiToken: string | null, scopes: Array<'read' | 'write'> = ['read']) {
  const keychain = { value: apiToken };
  const api = createApiClient({ ...TEST_CONFIG, apiToken, keychainService: 'finances-test' });
  const openBrowser = vi.fn<(url: string) => void>();
  const writeKeychain = vi.fn((_service: string, token: string) => { keychain.value = token; });
  const session = createSession(api, {
    keychainService: 'finances-test',
    tokenName: TOKEN_NAME,
    scopes,
    openBrowser,
    readKeychain: () => keychain.value,
    writeKeychain
  });
  sessions.push(session);
  return { api, session, openBrowser, writeKeychain, keychain };
}

const postForm = async (url: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  await realFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });

const textOf = (result: Awaited<ReturnType<Awaited<ReturnType<typeof connectClient>>['callTool']>>) =>
  (result.content as Array<{ text: string }>)[0]!.text;

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); }); // status lines on stderr

afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session start', () => {
  it('is ready without opening the browser when /auth/me accepts the token', async () => {
    const calls = stubApi({ 'GET /auth/me': () => [200, { success: true, data: {} }] });
    const { session, openBrowser } = setup(OLD_TOKEN);

    await session.start();

    expect(session.state).toBe('ready');
    expect(openBrowser).not.toHaveBeenCalled();
    expect(calls).toEqual([{ route: 'GET /auth/me', auth: OLD_TOKEN, body: undefined }]);
  });

  it('opens the login page when the API rejects the token', async () => {
    stubApi({ 'GET /auth/me': () => [401, { success: false, errorCode: 'INVALID_TOKEN', message: 'Invalid token' }] });
    const { session, openBrowser } = setup(OLD_TOKEN);

    await session.start();

    expect(session.state).toBe('login');
    expect(openBrowser).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/login\/[\w-]{43}$/));
    expect(session.loginUrl).toBe(openBrowser.mock.calls[0]![0]);
  });

  it('opens the login page without calling the API when there is no token', async () => {
    const calls = stubApi({});
    const { session, openBrowser } = setup(null);

    await session.start();

    expect(openBrowser).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });

  it('stays ready when the API is unreachable, so tools report the real error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const { session, openBrowser } = setup(OLD_TOKEN);

    await session.start();

    expect(session.state).toBe('ready');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('require() rejects with the login URL while logged out', async () => {
    stubApi({});
    const { session } = setup(null);

    const err = await session.require().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LoginRequiredError);
    expect((err as LoginRequiredError).url).toBe(session.loginUrl);
  });
});

describe('login page', () => {
  it('logs in, replaces this machine\'s token, stores it and frees the web session', async () => {
    const calls = stubApi(LOGIN_ROUTES);
    const { session, writeKeychain } = setup(null, ['read', 'write']);
    await session.start();
    const url = session.loginUrl!;

    const form = await realFetch(url);
    expect(form.status).toBe(200);
    expect(form.headers.get('content-security-policy')).toContain("default-src 'none'");
    // no-referrer would make browsers post `Origin: null`, which the Origin check rejects.
    expect(form.headers.get('referrer-policy')).toBe('same-origin');
    expect(await form.text()).toContain('type="password"');

    const done = await postForm(url, { email: 'me@example.com', password: 'hunter2' });
    expect(await done.text()).toContain('Done');

    expect(calls.map((c) => [c.route, c.auth])).toEqual([
      ['POST /auth/login', null],
      ['GET /users/tokens', JWT],
      ['DELETE /users/tokens/old-id', JWT],
      ['POST /users/tokens', JWT],
      ['POST /auth/logout', JWT]
    ]);
    expect(calls[0]!.body).toEqual({ email: 'me@example.com', password: 'hunter2' });
    expect(calls[3]!.body).toEqual({ name: TOKEN_NAME, scopes: ['read', 'write'], expiresInDays: 90 });
    expect(writeKeychain).toHaveBeenCalledWith('finances-test', NEW_TOKEN);
    expect(session.state).toBe('ready');
    expect(session.loginUrl).toBeNull(); // the page closed itself
  });

  it('lets tools run with the new token once logged in', async () => {
    const calls = stubApi(LOGIN_ROUTES);
    const { api, session } = setup(null);
    const client = await connectClient({ session }, api);
    await session.start();

    const before = await client.callTool({ name: 'list_accounts', arguments: {} });
    expect(before.isError).toBe(true);
    expect(textOf(before)).toContain(session.loginUrl!);

    await postForm(session.loginUrl!, { email: 'me@example.com', password: 'hunter2' });
    const after = await client.callTool({ name: 'list_accounts', arguments: {} });

    expect(after.isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({ route: 'GET /accounts', auth: NEW_TOKEN });
  });

  it('shows the single-session error and stores nothing', async () => {
    stubApi({
      'POST /auth/login': () => [409, { success: false, errorCode: 'SESSION_ALREADY_ACTIVE', message: 'Active session' }]
    });
    const { session, writeKeychain } = setup(null);
    await session.start();

    const res = await postForm(session.loginUrl!, { email: 'me@example.com', password: 'hunter2' });

    expect(await res.text()).toContain('Log out of the web app');
    expect(writeKeychain).not.toHaveBeenCalled();
    expect(session.state).toBe('login');
    expect(session.loginUrl).not.toBeNull(); // still open for another try
  });

  it('shows wrong credentials and keeps the email, escaped', async () => {
    stubApi({ 'POST /auth/login': () => [401, { success: false, errorCode: 'INVALID_CREDENTIALS', message: 'Invalid' }] });
    const { session } = setup(null);
    await session.start();

    const html = await (await postForm(session.loginUrl!, { email: '"><script>x</script>', password: 'nope' })).text();

    expect(html).toContain('Incorrect email or password.');
    expect(html).not.toContain('<script>x');
  });

  it('logs out even when creating the token fails', async () => {
    const calls = stubApi({
      ...LOGIN_ROUTES,
      'POST /users/tokens': () => [409, { success: false, errorCode: 'API_TOKEN_LIMIT_REACHED', message: 'Limit' }]
    });
    const { session, writeKeychain } = setup(null);
    await session.start();

    const html = await (await postForm(session.loginUrl!, { email: 'me@example.com', password: 'hunter2' })).text();

    expect(html).toContain('limit of active tokens');
    expect(calls.at(-1)!.route).toBe('POST /auth/logout');
    expect(writeKeychain).not.toHaveBeenCalled();
  });

  it('rejects a wrong path, a foreign Host and a cross-site post', async () => {
    stubApi({});
    const { session } = setup(null);
    await session.start();
    const url = new URL(session.loginUrl!);

    expect((await realFetch(`${url.origin}/login/guess`)).status).toBe(404);
    expect((await postForm(url.href, { email: 'a@b.c', password: 'x' }, { Origin: 'https://evil.example' })).status).toBe(403);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      request({ host: '127.0.0.1', port: url.port, path: url.pathname, headers: { Host: `evil.example:${url.port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject).end();
    });
    expect(status).toBe(403);
  });
});

describe('several processes sharing the Keychain', () => {
  it('picks up a token another process stored instead of asking again', async () => {
    stubApi({ 'GET /auth/me': (init) => bearer(init) === NEW_TOKEN ? [200, { success: true, data: {} }] : [401, { success: false, errorCode: 'INVALID_TOKEN' }] });
    const { session, openBrowser, keychain } = setup(null);
    await session.start();
    expect(openBrowser).toHaveBeenCalledOnce();

    keychain.value = NEW_TOKEN; // logged in from the other process's page
    await session.require();

    expect(session.state).toBe('ready');
    expect(session.loginUrl).toBeNull(); // this process's page closed
    expect(openBrowser).toHaveBeenCalledOnce();
  });

  it('switches to the new token when another process\'s login revoked this one', async () => {
    const calls = stubApi({
      'GET /auth/me': () => [200, { success: true, data: {} }], // OLD_TOKEN is still valid at startup
      'GET /accounts': (init) => bearer(init) === NEW_TOKEN ? [200, { success: true, data: [] }] : [401, { success: false, errorCode: 'INVALID_TOKEN', message: 'Revoked' }]
    });
    const { api, session, openBrowser, keychain } = setup(OLD_TOKEN);
    const client = await connectClient({ session }, api);
    await session.start();
    keychain.value = NEW_TOKEN;

    const first = await client.callTool({ name: 'list_accounts', arguments: {} });
    await vi.waitFor(() => { expect(session.state).toBe('ready'); });
    const second = await client.callTool({ name: 'list_accounts', arguments: {} });

    expect(first.isError).toBe(true);
    expect(second.isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({ route: 'GET /accounts', auth: NEW_TOKEN });
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('does not retry a token the API already refused', async () => {
    const calls = stubApi({ 'GET /auth/me': () => [401, { success: false, errorCode: 'INVALID_TOKEN' }] });
    const { session } = setup(OLD_TOKEN); // the Keychain still holds the refused token
    await session.start();

    await session.require().catch(() => {});
    await session.require().catch(() => {});

    expect(calls.filter((c) => c.route === 'GET /auth/me')).toHaveLength(1);
  });
});

describe('tools with a session', () => {
  it('reopen the login page when the token stops working mid-session', async () => {
    stubApi({
      'GET /auth/me': () => [200, { success: true, data: {} }],
      'GET /accounts': () => [401, { success: false, errorCode: 'INVALID_TOKEN', message: 'Revoked' }]
    });
    const { api, session, openBrowser } = setup(OLD_TOKEN);
    const client = await connectClient({ session }, api);

    const result = await client.callTool({ name: 'list_accounts', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Not logged in');
    await vi.waitFor(() => { expect(openBrowser).toHaveBeenCalledOnce(); });
    expect(session.state).toBe('login');
  });
});
