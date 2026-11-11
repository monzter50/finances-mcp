// One-shot login page on 127.0.0.1 for the browser login (src/auth/session.ts).
// The password goes from the form straight to onSubmit: never log it, or the token.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError } from '../apiClient.js';

const MAX_BODY_BYTES = 10_000;

export interface LoginServer { url: string, close: () => void }

export interface LoginServerOptions {
  /** Logs in and stores the token; throw (ApiError) to show the error on the form. */
  onSubmit: (email: string, password: string) => Promise<void>
  onClose: () => void
  /** Closes the page after this long without requests. */
  idleMs?: number
}

const ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  SESSION_ALREADY_ACTIVE: 'You already have an active session on another device. Log out of the web app, or wait a few minutes and try again.',
  ACCOUNT_DEACTIVATED: 'This account is deactivated.',
  API_TOKEN_LIMIT_REACHED: 'You reached the limit of active tokens. Revoke one in the app and try again.'
};

function errorMessage (err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    return ERRORS[err.errorCode] ?? `API error: ${err.message}`;
  }
  if (err instanceof TypeError && err.message === 'fetch failed') return 'Could not reach the API. Is it running?';
  return 'Unexpected error while logging in.';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page (body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Finances MCP</title><style>
body{font-family:system-ui,sans-serif;max-width:22rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a;background:#fafafa}
h1{font-size:1.25rem}label{display:block;margin:.75rem 0 .25rem;font-size:.9rem}
input{width:100%;box-sizing:border-box;padding:.5rem;font-size:1rem;border:1px solid #bbb;border-radius:6px}
button{margin-top:1rem;width:100%;padding:.6rem;font-size:1rem;border:0;border-radius:6px;background:#1a1a1a;color:#fff;cursor:pointer}
.error{color:#b00020;font-size:.9rem}
@media (prefers-color-scheme:dark){body{color:#eee;background:#161616}input{background:#222;color:#eee;border-color:#444}button{background:#eee;color:#161616}.error{color:#ff6b7f}}
</style></head><body>${body}</body></html>`;
}

function formPage (email = '', error = ''): string {
  return page(`<h1>Connect Claude to Finances</h1>
<p>Log in to create an access token for the MCP. It is saved to your Mac's Keychain.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form method="post"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}" autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Connect</button></form>`);
}

const DONE_PAGE = page('<h1>Done</h1><p>Claude can now use your finances. You can close this tab and go back to Claude.</p>');

async function readBody (req: IncomingMessage): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startLoginServer ({ onSubmit, onClose, idleMs = 15 * 60_000 }: LoginServerOptions): Promise<LoginServer> {
  // The random path keeps other local pages from finding the form.
  const path = `/login/${randomBytes(32).toString('base64url')}`;
  let origin = '';
  let idle: NodeJS.Timeout | undefined;
  let busy = false;

  const send = (res: ServerResponse, status: number, html: string) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      // Not no-referrer: with it browsers send `Origin: null` on the form post, which the Origin check rejects.
      'Referrer-Policy': 'same-origin'
    });
    res.end(html);
  };

  async function handle (req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Host check blocks DNS rebinding; Origin check blocks cross-site form posts.
    if (`http://${req.headers.host ?? ''}` !== origin) return send(res, 403, page('<p>Forbidden</p>'));
    if (req.url !== path) return send(res, 404, page('<p>Not found</p>'));
    resetIdle();
    if (req.method === 'GET') return send(res, 200, formPage());
    if (req.method !== 'POST') return send(res, 405, page('<p>Method not allowed</p>'));
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return send(res, 403, page('<p>Forbidden</p>'));

    const raw = await readBody(req);
    if (raw === null) return send(res, 413, page('<p>Request too large</p>'));
    const form = new URLSearchParams(raw);
    const email = form.get('email')?.trim() ?? '';
    const password = form.get('password') ?? '';
    if (!email || !password) return send(res, 400, formPage(email, 'Enter your email and password.'));
    if (busy) return send(res, 409, formPage(email, 'A login is already in progress.'));

    busy = true;
    try {
      await onSubmit(email, password);
    } catch (err) {
      return send(res, 200, formPage(email, errorMessage(err)));
    } finally {
      busy = false;
    }
    send(res, 200, DONE_PAGE);
    close();
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, page('<p>Error</p>')); });
  });

  let closed = false;
  function close () {
    if (closed) return;
    closed = true;
    clearTimeout(idle);
    server.close();
    server.closeIdleConnections();
    onClose();
  }
  function resetIdle () {
    clearTimeout(idle);
    idle = setTimeout(close, idleMs);
    idle.unref();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetIdle();
  return { url: origin + path, close };
}
