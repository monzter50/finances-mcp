import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectClient, requestedUrl, stubFetch } from './helpers.js';

afterEach(() => { vi.unstubAllGlobals(); });

const ACCOUNT = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const row = { day: 23, month: 10, time: '10:10', rawDescriptor: 'OXXO Centro', amount: 59, type: 'expense' };
let dir: string;
let shot1: string;
let shot2: string;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finances-mcp-'));
  shot1 = join(dir, 'IMG_0001.PNG');
  shot2 = join(dir, 'IMG_0002.jpg');
  await writeFile(shot1, 'image-one');
  await writeFile(shot2, 'image-two');
});

const textOf = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text;
const sentBody = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

describe('screenshot import tools', () => {
  it('are not registered unless writes are enabled', async () => {
    const readOnly = await connectClient();
    expect((await readOnly.listTools()).tools.map((t) => t.name)).not.toContain('import_screenshots');

    const writable = await connectClient({ enableWrites: true });
    const tools = (await writable.listTools()).tools;
    expect(tools).toHaveLength(11);
    expect(tools.find((t) => t.name === 'import_screenshots')?.annotations).toMatchObject({
      readOnlyHint: false, destructiveHint: false, idempotentHint: true
    });
  });

  it('import_screenshots hashes the files itself and posts rows grouped by image', async () => {
    const fetchMock = stubFetch({ success: true, data: { inserted: 2, skippedAsDuplicate: 1, skippedImages: 0 } }, 201);
    const client = await connectClient({ enableWrites: true });
    const result = await client.callTool({
      name: 'import_screenshots',
      arguments: { accountId: ACCOUNT, images: [{ path: shot1, rows: [row, row] }, { path: shot2, rows: [row] }] }
    });

    expect(result.isError).toBeFalsy();
    expect(requestedUrl(fetchMock).pathname).toBe('/api/transactions/import/screenshots');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
    expect(sentBody(fetchMock)).toEqual({
      accountId: ACCOUNT,
      images: [{ sha256: sha('image-one'), rows: [row, row] }, { sha256: sha('image-two'), rows: [row] }]
    });
    expect(textOf(result)).toContain('"inserted":2');
  });

  it('check_screenshots maps the imported hashes back to paths', async () => {
    const fetchMock = stubFetch({ success: true, data: { imported: [sha('image-two')] } });
    const client = await connectClient({ enableWrites: true });
    const result = await client.callTool({ name: 'check_screenshots', arguments: { paths: [shot1, shot2] } });

    expect(sentBody(fetchMock)).toEqual({ sha256s: [sha('image-one'), sha('image-two')] });
    expect(JSON.parse(textOf(result))).toEqual([
      { path: shot1, alreadyImported: false },
      { path: shot2, alreadyImported: true }
    ]);
  });

  it('refuses relative paths, non-images and missing files without calling the API', async () => {
    const fetchMock = stubFetch({ success: true, data: {} });
    const client = await connectClient({ enableWrites: true });
    for (const [path, message] of [['IMG_0001.PNG', 'absolute path'], ['/etc/passwd', 'Not an image'], [join(dir, 'nope.png'), 'File not found']]) {
      const result = await client.callTool({ name: 'check_screenshots', arguments: { paths: [path] } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(message);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a bad time before calling the API', async () => {
    const fetchMock = stubFetch({ success: true, data: {} });
    const client = await connectClient({ enableWrites: true });
    const result = await client.callTool({
      name: 'import_screenshots',
      arguments: { accountId: ACCOUNT, images: [{ path: shot1, rows: [{ ...row, time: '25:00' }] }] }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a read-only token gets an actionable scope message', async () => {
    stubFetch({ success: false, errorCode: 'INSUFFICIENT_SCOPE', message: 'This token needs the "write" scope.' }, 403);
    const client = await connectClient({ enableWrites: true });
    const result = await client.callTool({ name: 'check_screenshots', arguments: { paths: [shot1] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('write');
  });
});
