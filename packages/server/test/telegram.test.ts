import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { TelegramError, createTelegramClient, splitMessage } from '../src/telegram.ts';

describe('splitMessage', () => {
  test('short text is one chunk; empty text stays one empty chunk', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
    expect(splitMessage('')).toEqual(['']);
    expect(splitMessage('x'.repeat(4096))).toEqual(['x'.repeat(4096)]);
  });

  test('hard-cuts text without newlines at the limit', () => {
    const chunks = splitMessage('x'.repeat(9000));
    expect(chunks.map((c) => c.length)).toEqual([4096, 4096, 808]);
    expect(chunks.join('')).toBe('x'.repeat(9000));
  });

  test('prefers breaking after a newline in the second half of a chunk', () => {
    const text = 'a'.repeat(7) + '\n' + 'b'.repeat(5);
    expect(splitMessage(text, 10)).toEqual(['aaaaaaa\n', 'bbbbb']);
    // A newline too early in the chunk is ignored in favour of a full chunk.
    expect(splitMessage('a\n' + 'b'.repeat(12), 10)).toEqual(['a\nbbbbbbbb', 'bbbb']);
  });

  test('never splits a surrogate pair', () => {
    const chunks = splitMessage('abc😀def', 4);
    expect(chunks).toEqual(['abc', '😀de', 'f']);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4);
  });
});

describe('createTelegramClient', () => {
  let server: http.Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
  });

  async function serve(handler: (method: string, body: Record<string, unknown>, res: http.ServerResponse) => void) {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = data ? JSON.parse(data) : {};
        seen.push({ url: req.url ?? '', body });
        handler((req.url ?? '').split('/').pop()!, body, res);
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
  }

  const json = (res: http.ServerResponse, status: number, body: object) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

  test('POSTs JSON params to /bot<token>/<method> and returns result', async () => {
    const { url, seen } = await serve((_m, _b, res) => json(res, 200, { ok: true, result: { message_id: 5 } }));
    const tg = createTelegramClient({ token: 'T:1', apiBase: url + '/' });
    const result = await tg.call('sendMessage', { chat_id: 1, text: 'hi', reply_markup: { inline_keyboard: [] } });
    expect(result).toEqual({ message_id: 5 });
    expect(seen).toEqual([
      { url: '/botT:1/sendMessage', body: { chat_id: 1, text: 'hi', reply_markup: { inline_keyboard: [] } } },
    ]);
  });

  test('ok:false becomes a TelegramError with the code and description', async () => {
    const { url } = await serve((_m, _b, res) => json(res, 400, { ok: false, error_code: 400, description: 'Bad Request: x' }));
    const tg = createTelegramClient({ token: 't', apiBase: url });
    const err = await tg.call('sendMessage', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect((err as TelegramError).code).toBe(400);
    expect((err as TelegramError).message).toContain('Bad Request: x');
  });

  test('getUpdates sends offset and a positive timeout, and can be aborted mid-poll', async () => {
    const { url, seen } = await serve(() => {
      /* never answers: a long poll with no updates */
    });
    const tg = createTelegramClient({ token: 't', apiBase: url });
    const ctrl = new AbortController();
    const pending = tg.getUpdates(42, 30, ctrl.signal);
    await new Promise((r) => setTimeout(r, 100));
    ctrl.abort();
    await expect(pending).rejects.toThrow();
    expect(seen[0].body).toMatchObject({ offset: 42, timeout: 30 });
  });

  test('omits offset on the first poll', async () => {
    const { url, seen } = await serve((_m, _b, res) => json(res, 200, { ok: true, result: [{ update_id: 1 }] }));
    const tg = createTelegramClient({ token: 't', apiBase: url });
    expect(await tg.getUpdates(undefined, 1)).toEqual([{ update_id: 1 }]);
    expect(seen[0].body).not.toHaveProperty('offset');
  });
});
