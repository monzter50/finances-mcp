// Read-only tools. Only routes that accept API tokens (authenticateUserOrApiToken).
// Input rules mirror the API validators so bad input fails here, not as a 400.
// Amounts come back as decimals (the API converts from amountCents).
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../apiClient.js';
import { ok, fail } from './result.js';

const uuid = z.uuid();
const year = z.number().int().min(2000).max(2100);
const month = z.number().int().min(1).max(12);
const RO = { readOnlyHint: true, openWorldHint: false };
const wrap = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return ok(await fn(a));
  } catch (e) {
    return fail(e);
  }
};

export function registerReadTools (server: McpServer, api: ApiClient) {
  server.registerTool('list_accounts', {
    title: 'List accounts',
    description: 'List the user\'s accounts with current balances (decimal currency units).',
    inputSchema: z.object({}),
    annotations: RO
  }, wrap(async () => await api.get('/accounts')));

  server.registerTool('list_transactions', {
    title: 'List transactions',
    description: 'List transactions, newest first. Dates are ISO 8601. Max 100 per page.',
    inputSchema: z.object({
      type: z.enum(['income', 'expense']).optional(),
      budgetId: uuid.optional(),
      startDate: z.iso.date().optional(),
      endDate: z.iso.date().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(25)
    }),
    annotations: RO
  }, wrap(async (q) => await api.get('/transactions', q)));

  server.registerTool('get_transaction', {
    title: 'Get transaction',
    description: 'A single transaction by id.',
    inputSchema: z.object({ id: uuid }),
    annotations: RO
  }, wrap(async ({ id }) => await api.get(`/transactions/${id}`)));

  server.registerTool('get_financial_summary', {
    title: 'Financial summary',
    description: 'Totals of income vs expense.',
    inputSchema: z.object({}),
    annotations: RO
  }, wrap(async () => await api.get('/transactions/summary')));

  server.registerTool('get_monthly_summary', {
    title: 'Monthly summary',
    description: 'Income/expense summary for a month. month is 1-12.',
    inputSchema: z.object({ year, month }),
    annotations: RO
  }, wrap(async ({ year, month }) => await api.get(`/transactions/monthly/${year}/${month}`)));

  server.registerTool('list_budgets', {
    title: 'List budgets',
    description: 'List budgets, optionally for a year/month. month is 1-12.',
    inputSchema: z.object({ year: year.optional(), month: month.optional() }),
    annotations: RO
  }, wrap(async ({ year, month }) =>
    // API quirk: /budgets takes 0-11 months (budget.validator.ts budgetQueryValidation)
    await api.get('/budgets', { year, month: month === undefined ? undefined : month - 1 })));

  server.registerTool('get_budget', {
    title: 'Get budget',
    description: 'A budget with its income and expense items.',
    inputSchema: z.object({ id: uuid }),
    annotations: RO
  }, wrap(async ({ id }) => await api.get(`/budgets/${id}`)));

  server.registerTool('get_budget_balance', {
    title: 'Budget balance',
    description: 'Planned vs actual for a budget, including overspend status.',
    inputSchema: z.object({ budgetId: uuid }),
    annotations: RO
  }, wrap(async ({ budgetId }) => await api.get(`/transactions/budget/${budgetId}/balance`)));

  server.registerTool('get_budget_stats', {
    title: 'Budget stats',
    description: 'Aggregate statistics across the user\'s budgets.',
    inputSchema: z.object({}),
    annotations: RO
  }, wrap(async () => await api.get('/budgets/stats')));
}
