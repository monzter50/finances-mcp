# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A stdio MCP server that exposes the user's finances API (sibling repo `../api-gamification-finances`) as read-only tools. It authenticates with a personal API token (`fpat_...`). That API's `openapi-schema.json` is the contract between the two repos: if a field or route changes there, the tools here break silently.

## Commands

Package manager is pnpm (pinned via `packageManager` in `package.json`); don't use npm or add a `package-lock.json`.

- `pnpm dev`: run the server from source over stdio (tsx) with `--env local` (`.env.local`); `pnpm dev --env staging` overrides it, since the last `--env` wins
- `pnpm build`: compile `src/` to `dist/` (uses `tsconfig.build.json`)
- `pnpm typecheck` / `pnpm lint` / `pnpm test`: the CI gates, along with `pnpm audit --prod --audit-level high` and gitleaks
- Single test file: `pnpm vitest run test/read.test.ts`; single test by name: `pnpm vitest run -t "list_budgets"`
- `pnpm inspect --env local`: MCP Inspector against the source server

Required env (see `.env.example`), with no fallbacks; `loadConfig()` throws at startup if either is missing:
- `FINANCES_API_URL`, e.g. `http://localhost:3000/api`. Must be https unless it points at localhost.
- `FINANCES_API_TOKEN`, must start with `fpat_`

Environments: `--env <name>` (`resolveEnv()` in `src/config.ts`) loads `.env.<name>` from the repo root, whatever the cwd. Values in that file override the process env, so an exported variable can't redirect the server to another environment. Without `--env`, only the process env is used. All `.env.*` files except `.env.example` are gitignored. Each environment is registered in Claude Code as its own server (e.g. `finances-local`, `finances-prod`).

## Architecture

TypeScript ESM on the v2 MCP SDK (`@modelcontextprotocol/server`, plus `@modelcontextprotocol/client` for tests only) with zod 4.

- `src/index.ts`: entry and `bin`. Builds one API client from `loadConfig()`, then `serveStdio(() => createServer(api))`.
- `src/server.ts`: `createServer(api)` registers all tools. It's transport-agnostic so tests can connect it over `InMemoryTransport`.
- `src/apiClient.ts`: the only file that talks HTTP. It unwraps the API's `{ success, data, message, errorCode }` envelope and throws `ApiError(status, errorCode, message)` on `!res.ok` or `success: false`. Tools return the full envelope (including `pagination`).
- `src/tools/result.ts`: `ok()` / `fail()`. `fail()` turns `ApiError` codes, 429s, timeouts and unreachable-API errors into messages the model can act on. Messages must never contain the token or the raw request.
- `src/tools/read.ts`: the 9 read tools, each wrapped with `wrap()` so errors become `isError` results instead of throwing.

## Rules when adding or changing tools

- Only wrap API routes that use `authenticateUserOrApiToken` in the API repo. Routes using `authenticateJWT` reject tokens.
- Mirror the API's express-validator rules in the zod `inputSchema` (UUIDs, `limit` ≤ 100, year 2000–2100) so bad input fails locally instead of costing a 400 round-trip.
- Month convention: tools always take months 1–12. `/budgets` expects 0–11 (`budgetQueryValidation`), so `list_budgets` subtracts 1; `/transactions/monthly/:year/:month` takes 1–12 as-is.
- Amounts are already decimals (the API converts from `amountCents`); never expose cents.
- Keep `list_transactions`' default `limit` at 25 so responses don't flood the model's context.
- stdout is the protocol channel: use `console.error` only. ESLint's `no-console` enforces this in `src/`.
- Write tools (phase 2) are blocked until the API accepts an `Idempotency-Key` header on `POST /api/transactions`. When they're added, register them only when `FINANCES_MCP_ENABLE_WRITES=true`, send a fresh UUID key per call, annotate `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true }`, and don't expose deletes.

## Conventions

- Code style is neostandard with semicolons (2-space indent, single quotes, no trailing commas, a space before function parens). `eslint.config.mjs` is copied from the API repo; `pnpm lint:fix` fixes most issues.
- ESM with `NodeNext` resolution: relative imports need the `.js` extension.
- TypeScript is pinned to 6.x because typescript-eslint doesn't support TS 7 yet.
- Tests live in `test/`. `test/helpers.ts` provides `stubFetch()` (via `vi.stubGlobal`) and `connectClient()`, which exercises tools end to end through a real MCP `Client`.
