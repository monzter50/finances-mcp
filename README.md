# finances-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude read-only access to your finances API (accounts, transactions and budgets).

## Tools

| Tool | API route |
| --- | --- |
| `list_accounts` | `GET /accounts` |
| `list_transactions` | `GET /transactions` (filters: type, budgetId, date range; 25 per page by default, 100 max) |
| `get_transaction` | `GET /transactions/:id` |
| `get_financial_summary` | `GET /transactions/summary` |
| `get_monthly_summary` | `GET /transactions/monthly/:year/:month` |
| `list_budgets` | `GET /budgets` |
| `get_budget` | `GET /budgets/:id` |
| `get_budget_balance` | `GET /transactions/budget/:budgetId/balance` |
| `get_budget_stats` | `GET /budgets/stats` |

All tools take months as 1–12.

## Setup

These steps work for anyone with an account on a finances API instance. Each person uses their own token, so nobody shares credentials.

Requirements: Node.js 20.12+ and pnpm (`corepack enable` installs the pinned version).

### 1. Install and build

```sh
git clone https://github.com/monzter50/finances-mcp.git
cd finances-mcp
pnpm install
pnpm build
```

Note the absolute path of `dist/index.js` (`echo "$PWD/dist/index.js"`). The Claude configs below need it.

### 2. Create a read-only API token

You can only create tokens from a logged-in session, so log in first. Replace the host with the API you use:

```sh
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

# The raw token (fpat_...) is shown only once
curl -s -X POST http://localhost:3000/api/users/tokens -H "Authorization: Bearer <JWT>" \
  -H 'Content-Type: application/json' -d '{"name":"mcp-local","scopes":["read"],"expiresInDays":90}'
```

Revoke a token with `DELETE /api/users/tokens/:id`. Tokens belong to one API instance, so local, staging and production each need their own.

### 3. Configure an environment

Create one file per API instance from the example:

```sh
cp .env.example .env.local        # FINANCES_API_URL=http://localhost:3000/api
cp .env.example .env.production   # FINANCES_API_URL=https://<production-host>/api
```

In each file, set the token one of two ways:

- **macOS Keychain (recommended).** The token never sits in a file:
  ```sh
  security add-generic-password -s finances-local -a "$USER" -w   # paste the token at the prompt
  ```
  Then put `FINANCES_API_TOKEN_KEYCHAIN=finances-local` in `.env.local` and leave `FINANCES_API_TOKEN` empty.
- **Plain value.** Set `FINANCES_API_TOKEN=fpat_...`. These files are gitignored.

`--env <name>` loads `.env.<name>` from the repo root, and its values take priority over your shell. Non-localhost URLs must use https.

Check it with the MCP Inspector:

```sh
pnpm inspect --env local
```

Click **Connect**, then **Tools → List Tools**. If the server can't start (missing `.env.<name>`, bad token, no Keychain item, http on a remote host), it exits with a single `finances-mcp failed to start: ...` line explaining what to fix. That line appears in the Inspector's stderr / Server Notifications panel.

### 4a. Add it to Claude Code

Register each environment as its own server, using your path from step 1:

```sh
claude mcp add finances-local -- node /absolute/path/to/finances-mcp/dist/index.js --env local
claude mcp add finances-prod  -- node /absolute/path/to/finances-mcp/dist/index.js --env production
```

Add `--scope user` to make the server available in every project, not just the current directory. Run `claude mcp list` to check it connects.

### 4b. Add it to Claude Desktop

Open **Settings → Developer → Edit Config** in Claude Desktop, or edit the file directly:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add an entry under `mcpServers` (merge it with any servers already there):

```json
{
  "mcpServers": {
    "finances-local": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/finances-mcp/dist/index.js", "--env", "local"]
    },
    "finances-prod": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/finances-mcp/dist/index.js", "--env", "production"]
    }
  }
}
```

Claude Desktop doesn't load your shell's `PATH`, so use the full path to `node` (`which node`). This matters most with nvm, fnm or Homebrew. Fully quit Claude Desktop (Cmd+Q, not just closing the window) and reopen it. The tools appear under the tools icon in the chat input. If the server fails, check the logs in `~/Library/Logs/Claude/mcp-server-finances-local.log` (on Windows, `%APPDATA%\Claude\logs`).

On Windows, the Keychain option isn't available, so use `FINANCES_API_TOKEN` in the `.env.*` file.

### Without `.env` files

You can pass the variables directly instead of `--env`, e.g. `claude mcp add finances -e FINANCES_API_URL=... -e FINANCES_API_TOKEN=... -- node .../dist/index.js`, or an `"env": { ... }` block in the Desktop config. The token is then stored in plain text in `~/.claude.json` or `claude_desktop_config.json`, so prefer `--env` with the Keychain.

### Screenshot import (optional, write access)

`check_screenshots` and `import_screenshots` register only when `FINANCES_MCP_ENABLE_WRITES=true` is set in the `.env.*` file. They need a token created with the `write` scope. Use a separate environment and token for this so your everyday server stays read-only.

## Development

```sh
pnpm typecheck && pnpm lint && pnpm test
```

The finances API applies a global rate limit to `/api/`, so long chains of tool calls can hit 429s.
