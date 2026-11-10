// Minimal Telegram Bot API client over global fetch (no runtime deps).

/** Telegram's hard limit for one message's text. */
export const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramUser {
  id: number;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  message_thread_id?: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export class TelegramError extends Error {
  readonly method: string;
  readonly code: number | undefined;
  constructor(method: string, code: number | undefined, description: string) {
    super(`telegram ${method} failed${code ? ` (${code})` : ''}: ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
  }
}

export interface TelegramClientOptions {
  token: string;
  apiBase?: string;
  /** Per-request timeout for ordinary calls. getUpdates adds its own long-poll timeout on top. */
  requestTimeoutMs?: number;
}

export interface TelegramClient {
  call<T = unknown>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
  /** Long poll. `timeoutSec` is Telegram's server-side wait; the HTTP request is allowed that much plus a margin. */
  getUpdates(offset: number | undefined, timeoutSec: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
}

export function createTelegramClient({
  token,
  apiBase = 'https://api.telegram.org',
  requestTimeoutMs = 30_000,
}: TelegramClientOptions): TelegramClient {
  const base = apiBase.replace(/\/+$/, '');

  async function request<T>(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`${base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    let body: { ok?: boolean; result?: unknown; error_code?: number; description?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new TelegramError(method, res.status, `non-JSON response (HTTP ${res.status})`);
    }
    if (!body.ok) throw new TelegramError(method, body.error_code ?? res.status, body.description ?? 'unknown error');
    return body.result as T;
  }

  return {
    call: (method, params = {}, signal) => request(method, params, requestTimeoutMs, signal),
    getUpdates(offset, timeoutSec, signal) {
      const params: Record<string, unknown> = { timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] };
      if (offset !== undefined) params.offset = offset;
      return request<TelegramUpdate[]>('getUpdates', params, timeoutSec * 1000 + requestTimeoutMs, signal);
    },
  };
}

/**
 * Splits text into chunks of at most `max` UTF-16 units, preferring to break after a newline
 * in the second half of a chunk, and never splitting a surrogate pair.
 */
export function splitMessage(text: string, max = MAX_MESSAGE_LENGTH): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max - 1) + 1;
    if (cut <= max / 2) {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut--;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0 || chunks.length === 0) chunks.push(rest);
  return chunks;
}
