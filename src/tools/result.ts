// Maps the API's error envelope to messages the model can act on.
// Never include the token or the raw request in these messages.
import { ApiError } from '../apiClient.js';

export const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

const RATE_LIMITED = 'The finances API rate limit was hit. Wait a few minutes before making more calls.';

const MESSAGES: Record<string, string> = {
  INVALID_TOKEN: 'API token is invalid, revoked or expired. Create a new one in the app.',
  API_TOKEN_NOT_ALLOWED: 'This endpoint is not available to API tokens.',
  RATE_LIMITED
};

export function fail (err: unknown) {
  let text = 'Unexpected error calling the finances API.';
  if (err instanceof ApiError) {
    if (err.errorCode === 'INSUFFICIENT_SCOPE') {
      // The API names the missing scope ("read" or "write") in its message.
      text = `${err.message} Create a token with that scope in the app.`;
    } else {
      text = MESSAGES[err.errorCode] ?? (err.status === 429 ? RATE_LIMITED : `${err.errorCode}: ${err.message}`);
    }
  } else if (err instanceof Error && err.name === 'TimeoutError') {
    text = 'The finances API timed out.';
  } else if (err instanceof TypeError && err.message === 'fetch failed') {
    text = 'Could not reach the finances API. Check that it is running and FINANCES_API_URL is correct.';
  }
  return { isError: true, content: [{ type: 'text' as const, text }] };
}
