// Screenshot import tools. Registered only when FINANCES_MCP_ENABLE_WRITES=true
// and they need a token with the `write` scope (both API routes are POST).
//
// The model does the OCR: it reads each BBVA "Movimientos" screenshot and
// passes the rows. The file hashes are computed HERE from the bytes on disk,
// never taken from the model, because they are the API's "same image" key.
// Only hashes leave this process, never file contents.
//
// Idempotency is the API's job (count reconciliation per fingerprint), so a
// retried or repeated call inserts nothing new: no Idempotency-Key needed.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../apiClient.js';
import { ok, fail } from './result.js';

// Mirror the API validator (screenshotImport.validator.ts).
const MAX_IMAGES = 50;
const MAX_ROWS_PER_IMAGE = 100;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.heic', '.webp']);

export class ScreenshotFileError extends Error {
  constructor (message: string) {
    super(message);
    this.name = 'ScreenshotFileError';
  }
}

/** sha256 of an image file. Rejects anything that isn't an absolute path to a reasonably sized image. */
export async function hashImage (path: string): Promise<string> {
  if (!isAbsolute(path)) throw new ScreenshotFileError(`Use an absolute path: ${path}`);
  if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new ScreenshotFileError(`Not an image file (png, jpg, heic, webp): ${path}`);
  }
  const info = await stat(path).catch(() => { throw new ScreenshotFileError(`File not found: ${path}`); });
  if (!info.isFile()) throw new ScreenshotFileError(`Not a file: ${path}`);
  if (info.size > MAX_IMAGE_BYTES) throw new ScreenshotFileError(`Image larger than 25 MB: ${path}`);
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

const paths = z.array(z.string().min(1)).min(1).max(MAX_IMAGES);

const row = z.object({
  day: z.number().int().min(1).max(31).describe('Day of month from the day header ("23 de octubre" → 23)'),
  month: z.number().int().min(1).max(12).describe('Month from the day header, 1-12 ("octubre" → 10)'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('Time shown on the row, HH:mm 24h'),
  rawDescriptor: z.string().min(1).max(200).describe('Merchant text exactly as shown, e.g. "Stripe *unicef mx"'),
  amount: z.number().positive().describe('Amount as a positive decimal, e.g. 59 or 1234.50'),
  type: z.enum(['income', 'expense']).describe('expense for payments/charges ("Pago con tarjeta"), income for deposits'),
  description: z.string().max(500).optional().describe('Only a note the user gave you. Never the category label ("Quiero", "Necesito")')
});

const failFile = (e: unknown) => e instanceof ScreenshotFileError
  ? { isError: true, content: [{ type: 'text' as const, text: e.message }] }
  : fail(e);

export function registerImportTools (server: McpServer, api: ApiClient) {
  server.registerTool('check_screenshots', {
    title: 'Check screenshots',
    description:
      'Before reading bank screenshots, check which image files were already imported so you can skip them. ' +
      'Takes absolute file paths; returns each path with alreadyImported.',
    inputSchema: z.object({ paths }),
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ paths }) => {
    try {
      const hashed = await Promise.all(paths.map(async (path) => ({ path, sha256: await hashImage(path) })));
      const res = await api.post<{ data: { imported: string[] } }>(
        '/transactions/import/screenshots/check',
        { sha256s: [...new Set(hashed.map((h) => h.sha256))] }
      );
      const imported = new Set(res.data.imported);
      return ok(hashed.map(({ path, sha256 }) => ({ path, alreadyImported: imported.has(sha256) })));
    } catch (e) {
      return failFile(e);
    }
  });

  server.registerTool('import_screenshots', {
    title: 'Import bank screenshots',
    description:
      'Import movements read from BBVA México "Movimientos" screenshots into one account. ' +
      'Send every row you read, grouped by the image file it came from, even rows that overlap with other screenshots ' +
      'or look identical (two identical purchases in one screenshot are two purchases). The API de-duplicates: ' +
      're-importing or overlapping screenshots adds nothing, so this is safe to retry. ' +
      'Dates have no year (the API infers it) and times are local. The budget is chosen from the date. ' +
      'Returns inserted, skippedAsDuplicate, skippedImages and unbudgeted (rows whose month has no budget).',
    inputSchema: z.object({
      accountId: z.uuid().describe('Account the screenshots belong to (see list_accounts)'),
      images: z.array(z.object({
        path: z.string().min(1).describe('Absolute path of the screenshot file the rows were read from'),
        rows: z.array(row).max(MAX_ROWS_PER_IMAGE)
      })).min(1).max(MAX_IMAGES)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ accountId, images }) => {
    try {
      const withHashes = await Promise.all(images.map(async (image) => ({ sha256: await hashImage(image.path), rows: image.rows })));
      return ok(await api.post('/transactions/import/screenshots', { accountId, images: withHashes }));
    } catch (e) {
      return failFile(e);
    }
  });
}
