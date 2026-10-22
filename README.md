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

### 1. Create a read-only API token

Tokens can only be created with a session, so log in first:

```sh
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

# The raw token is shown only once
curl -s -X POST http://localhost:3000/api/users/tokens -H "Authorization: Bearer <JWT>" \
  -H 'Content-Type: application/json' -d '{"name":"mcp-local","scopes":["read"],"expiresInDays":90}'
```

Revoke a token with `DELETE /api/users/tokens/:id`.

### 2. Configure an environment per API endpoint

Create one file per environment from the example. Each needs its own token, because tokens are per API instance:

```sh
cp .env.example .env.local        # FINANCES_API_URL=http://localhost:3000/api
cp .env.example .env.staging      # FINANCES_API_URL=https://<staging-host>/api
cp .env.example .env.production   # FINANCES_API_URL=https://<production-host>/api
```

`--env <name>` selects `.env.<name>`, and values in that file take priority over your shell. Non-localhost URLs must use https. These files are gitignored.

### 3. Build and try it

```sh
pnpm install
pnpm build
pnpm inspect --env local   # MCP Inspector
```

### 4. Add it to Claude Code

Register each environment as its own server:

```sh
claude mcp add finances-local -- node /Volumes/KINGSTON/projects/finances-mcp/dist/index.js --env local
claude mcp add finances-prod  -- node /Volumes/KINGSTON/projects/finances-mcp/dist/index.js --env production
```

This keeps tokens in the gitignored `.env.*` files instead of your Claude config. You can still pass `-e FINANCES_API_URL=... -e FINANCES_API_TOKEN=...` without `--env`, but then the token is stored in `~/.claude.json`. Use read-only tokens everywhere.

## Development

```sh
pnpm typecheck && pnpm lint && pnpm test
```

The finances API applies a global rate limit to `/api/`, so long chains of tool calls can hit 429s.
