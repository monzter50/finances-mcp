import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectClient, requestedUrl, stubFetch } from './helpers.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('read tools', () => {
  it('registers all 9 tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('list_budgets converts month 1-12 to the API\'s 0-11', async () => {
    const fetchMock = stubFetch({ success: true, data: [] });
    const client = await connectClient();
    await client.callTool({ name: 'list_budgets', arguments: { year: 2026, month: 1 } });
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe('/api/budgets');
    expect(url.searchParams.get('month')).toBe('0');
    expect(url.searchParams.get('year')).toBe('2026');
  });

  it('get_monthly_summary keeps month as 1-12', async () => {
    const fetchMock = stubFetch({ success: true, data: {} });
    const client = await connectClient();
    await client.callTool({ name: 'get_monthly_summary', arguments: { year: 2026, month: 12 } });
    expect(requestedUrl(fetchMock).pathname).toBe('/api/transactions/monthly/2026/12');
  });

  it('list_transactions applies the default page size and sends the token', async () => {
    const fetchMock = stubFetch({ success: true, data: [] });
    const client = await connectClient();
    await client.callTool({ name: 'list_transactions', arguments: {} });
    expect(requestedUrl(fetchMock).searchParams.get('limit')).toBe('25');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fpat_test');
  });

  it('rejects limits over 100 without calling the API', async () => {
    const fetchMock = stubFetch({ success: true, data: [] });
    const client = await connectClient();
    const res = await client.callTool({ name: 'list_transactions', arguments: { limit: 500 } });
    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a readable error from the API envelope', async () => {
    stubFetch({ success: false, errorCode: 'INSUFFICIENT_SCOPE', message: 'This API token is missing the "read" scope.' }, 403);
    const client = await connectClient();
    const res = await client.callTool({ name: 'list_accounts', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('"read\\" scope');
    expect(JSON.stringify(res.content)).not.toContain('fpat_');
  });
});
