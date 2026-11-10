// 텔레그램 Bot API 가짜 서버. /bot<token>/<method> 로 들어오는 호출을 흉내 내고 모두 기록한다.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Call {
  /** 전체 호출 중 순번(0부터). 특정 시점 이후의 호출만 보려면 mark()와 비교한다. */
  seq: number;
  method: string;
  params: Record<string, any>;
  result: any;
  t: number;
}

export interface FakeTelegram {
  url: string;
  token: string;
  calls(method?: string): Call[];
  /** 지금까지의 호출 수. 이후 호출만 고를 때 `c.seq >= mark` 로 쓴다. */
  mark(): number;
  pushMessage(m: { fromId: number; chatId: number; threadId?: number; text: string }): number;
  pushCallback(c: { fromId: number; chatId: number; threadId?: number; data: string; messageId: number }): string;
  waitFor(pred: (c: Call) => boolean, timeoutMs?: number, label?: string): Promise<Call>;
  lastUpdateId(): number;
  stop(): Promise<void>;
}

const BOT_ID = 999000;

function normalize(params: Record<string, any>, fromForm: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && k !== 'text' && (fromForm || k === 'reply_markup')) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        /* 문자열 그대로 */
      }
    }
    out[k] = v;
  }
  return out;
}

export async function startFakeTelegram(token = '123456:TEST-TOKEN'): Promise<FakeTelegram> {
  const calls: Call[] = [];
  let queue: any[] = [];
  let nextUpdateId = 1;
  let nextMessageId = 1;
  let nextThreadId = 1000;
  let nextCallbackId = 1;
  let stopped = false;
  const pollWaiters = new Set<() => void>();
  const callWaiters = new Set<() => void>();

  const notifyPoll = () => {
    for (const w of [...pollWaiters]) w();
  };
  const record = (method: string, params: Record<string, any>): Call => {
    const c: Call = { seq: calls.length, method, params, result: undefined, t: Date.now() };
    calls.push(c);
    for (const w of [...callWaiters]) w();
    return c;
  };
  const settle = (c: Call, result: any) => {
    c.result = result;
    for (const w of [...callWaiters]) w();
  };

  async function handle(method: string, p: Record<string, any>, c: Call): Promise<{ ok: boolean; result?: any; error_code?: number; description?: string }> {
    switch (method) {
      case 'getMe':
        return { ok: true, result: { id: BOT_ID, is_bot: true, first_name: 'Fake', username: 'fake_bot' } };
      case 'deleteWebhook':
      case 'answerCallbackQuery':
      case 'sendChatAction':
        return { ok: true, result: true };
      case 'getUpdates': {
        const offset = p.offset === undefined ? undefined : Number(p.offset);
        const timeoutSec = Math.min(Number(p.timeout ?? 0) || 0, 50);
        const limit = Number(p.limit ?? 100) || 100;
        if (offset !== undefined) queue = queue.filter((u) => u.update_id >= offset);
        if (queue.length === 0 && timeoutSec > 0 && !stopped) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              pollWaiters.delete(done);
              resolve();
            };
            const timer = setTimeout(done, timeoutSec * 1000);
            pollWaiters.add(done);
          });
        }
        return { ok: true, result: stopped ? [] : queue.slice(0, limit) };
      }
      case 'sendMessage': {
        const text = p.text;
        if (p.chat_id === undefined) return { ok: false, error_code: 400, description: 'Bad Request: chat_id is empty' };
        if (typeof text !== 'string' || text.length === 0)
          return { ok: false, error_code: 400, description: 'Bad Request: message text is empty' };
        if (text.length > 4096) return { ok: false, error_code: 400, description: 'Bad Request: message is too long' };
        const msg: any = {
          message_id: nextMessageId++,
          date: Math.floor(Date.now() / 1000),
          from: { id: BOT_ID, is_bot: true, first_name: 'Fake' },
          chat: { id: Number(p.chat_id), type: Number(p.chat_id) < 0 ? 'supergroup' : 'private' },
          text,
        };
        if (p.message_thread_id !== undefined) {
          msg.message_thread_id = Number(p.message_thread_id);
          msg.is_topic_message = true;
        }
        if (p.reply_markup !== undefined) msg.reply_markup = p.reply_markup;
        return { ok: true, result: msg };
      }
      case 'editMessageText':
        return {
          ok: true,
          result: {
            message_id: Number(p.message_id),
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(p.chat_id) },
            text: p.text,
          },
        };
      case 'createForumTopic':
        if (p.chat_id === undefined || !p.name) return { ok: false, error_code: 400, description: 'Bad Request: name is empty' };
        return { ok: true, result: { message_thread_id: nextThreadId++, name: String(p.name), icon_color: 7322096 } };
      default:
        return { ok: true, result: true };
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
    const chunks: Buffer[] = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const send = (status: number, body: unknown) => {
        if (res.writableEnded) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
      if (m[1] !== token) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      const method = m[2];
      let params: Record<string, any> = normalize(Object.fromEntries(url.searchParams), true);
      const raw = Buffer.concat(chunks).toString('utf8');
      const ctype = String(req.headers['content-type'] ?? '');
      if (raw) {
        if (ctype.includes('application/json')) {
          try {
            params = { ...params, ...normalize(JSON.parse(raw), false) };
          } catch {
            return send(400, { ok: false, error_code: 400, description: 'Bad Request: invalid JSON' });
          }
        } else if (ctype.includes('application/x-www-form-urlencoded')) {
          params = { ...params, ...normalize(Object.fromEntries(new URLSearchParams(raw)), true) };
        }
      }
      const c = record(method, params);
      const out = await handle(method, params, c);
      settle(c, out.ok ? out.result : { error: out.description });
      send(out.ok ? 200 : (out.error_code ?? 400), out);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const api: FakeTelegram = {
    url: `http://127.0.0.1:${port}`,
    token,
    calls: (method?: string) => (method ? calls.filter((c) => c.method === method) : [...calls]),
    mark: () => calls.length,
    lastUpdateId: () => nextUpdateId - 1,
    pushMessage({ fromId, chatId, threadId, text }) {
      const update_id = nextUpdateId++;
      const message: any = {
        message_id: nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        from: { id: fromId, is_bot: false, first_name: `user${fromId}` },
        chat:
          chatId < 0
            ? { id: chatId, type: 'supergroup', title: 'remote-agent', is_forum: true }
            : { id: chatId, type: 'private', first_name: `user${fromId}` },
        text,
      };
      if (threadId !== undefined) {
        message.message_thread_id = threadId;
        message.is_topic_message = true;
      }
      const cmd = text.match(/^\/\S+/);
      if (cmd) message.entities = [{ type: 'bot_command', offset: 0, length: cmd[0].length }];
      queue.push({ update_id, message });
      notifyPoll();
      return update_id;
    },
    pushCallback({ fromId, chatId, threadId, data, messageId }) {
      const update_id = nextUpdateId++;
      const id = `cbq${nextCallbackId++}`;
      const message: any = {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        from: { id: BOT_ID, is_bot: true, first_name: 'Fake' },
        chat: chatId < 0 ? { id: chatId, type: 'supergroup', is_forum: true } : { id: chatId, type: 'private' },
        text: 'approval',
      };
      if (threadId !== undefined) {
        message.message_thread_id = threadId;
        message.is_topic_message = true;
      }
      queue.push({
        update_id,
        callback_query: {
          id,
          from: { id: fromId, is_bot: false, first_name: `user${fromId}` },
          chat_instance: 'ci1',
          message,
          data,
        },
      });
      notifyPoll();
      return id;
    },
    waitFor(pred, timeoutMs = 10000, label = 'telegram call') {
      return new Promise<Call>((resolve, reject) => {
        const check = () => {
          // getUpdates는 long poll이라 응답 전(요청 시점)에도 매칭한다. 나머지는 응답이 정해진 뒤 매칭한다.
          const hit = calls.find((c) => (c.result !== undefined || c.method === 'getUpdates') && pred(c));
          if (hit) {
            cleanup();
            resolve(hit);
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          const summary = calls
            .slice(-15)
            .map((c) => `${c.seq}:${c.method} ${JSON.stringify(c.params).slice(0, 200)}`)
            .join('\n  ');
          reject(new Error(`timeout ${timeoutMs}ms waiting for ${label}. recent calls:\n  ${summary}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          callWaiters.delete(check);
        };
        callWaiters.add(check);
        check();
      });
    },
    async stop() {
      stopped = true;
      notifyPoll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return api;
}

/** sendMessage 호출의 인라인 키보드 버튼을 평탄화해 돌려준다. */
export function keyboardButtons(c: Call): Array<{ text: string; callback_data?: string }> {
  const kb = c.params.reply_markup?.inline_keyboard;
  return Array.isArray(kb) ? kb.flat() : [];
}
