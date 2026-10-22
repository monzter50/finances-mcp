import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/apiClient.js';
import { fail } from '../src/tools/result.js';

const textOf = (err: unknown) => fail(err).content[0]!.text;

describe('fail', () => {
  it.each([
    ['INVALID_TOKEN', 401, 'invalid, revoked or expired'],
    ['API_TOKEN_NOT_ALLOWED', 403, 'not available to API tokens'],
    ['RATE_LIMITED', 429, 'rate limit']
  ])('maps %s', (code, status, expected) => {
    expect(textOf(new ApiError(status, code, 'raw'))).toContain(expected);
  });

  it('keeps the scope the API says is missing', () => {
    const text = textOf(new ApiError(403, 'INSUFFICIENT_SCOPE', 'This API token is missing the "read" scope.'));
    expect(text).toContain('"read" scope');
  });

  it('treats any 429 as a rate limit', () => {
    expect(textOf(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'raw'))).toContain('rate limit');
  });

  it('falls back to code and message for unknown codes', () => {
    expect(textOf(new ApiError(404, 'NOT_FOUND', 'Budget not found'))).toBe('NOT_FOUND: Budget not found');
  });

  it('reports timeouts', () => {
    expect(textOf(new DOMException('timed out', 'TimeoutError'))).toBe('The finances API timed out.');
  });

  it('reports an unreachable API', () => {
    expect(textOf(new TypeError('fetch failed'))).toContain('Could not reach');
  });

  it('always flags the result as an error', () => {
    expect(fail(new Error('x')).isError).toBe(true);
  });
});
