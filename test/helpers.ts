import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { vi } from 'vitest';
import { createApiClient } from '../src/apiClient.js';
import { createServer } from '../src/server.js';

export const TEST_CONFIG = { apiUrl: 'http://api.test/api', apiToken: 'fpat_test', timeoutMs: 1000 };

/** Stubs global fetch with a single JSON response and returns the mock. */
export function stubFetch (body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function requestedUrl (fetchMock: ReturnType<typeof stubFetch>): URL {
  return fetchMock.mock.calls[0]![0];
}

export async function connectClient () {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(createApiClient(TEST_CONFIG)).connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}
