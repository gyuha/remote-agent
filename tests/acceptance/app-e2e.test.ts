import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '@remote-agent/server';
import { keyboardButtons, startFakeTelegram, type Call, type FakeTelegram } from './fakes/fake-telegram';
import { FAKE_CLAUDE, FAKE_CODEX, bridgeCommand, killLogged, makeTmp, readLog, sleep, waitUntil, writeAgent } from './helpers';

const OWNER = 111;
const STRANGER = 222;
const GROUP = -1001234567890;
const CALLBACK_RE = /^ap:([^:]+):(allow|session|deny)$/;

let tg: FakeTelegram;
let app: { start(): Promise<void>; stop(): Promise<void>; bridgeUrl?: string } | undefined;
let root: string;
let shop: string;
let dataDir: string;
let log: string;
let savedLog: string | undefined;

beforeEach(async () => {
  root = makeTmp('e2e');
  shop = path.join(root, 'shop');
  fs.mkdirSync(shop);
  dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  log = path.join(root, 'fake.log');
  savedLog = process.env.FAKE_LOG;
  process.env.FAKE_LOG = log;

  writeAgent(shop, 'dev', 'cli: claude\nprofile: standard\nallow: ["npm test"]', '구현 담당');
  writeAgent(shop, 'w2', 'cli: claude\nprofile: standard', '두 번째 구현 담당');
  writeAgent(shop, 'ro', 'cli: claude\nprofile: readonly', '리뷰 담당');
  writeAgent(shop, 'lead', 'cli: claude\nprofile: standard\norchestrator: true', '오케스트레이터');
  writeAgent(shop, 'cx', 'cli: codex\nprofile: standard', 'Codex 구현 담당');

  tg = await startFakeTelegram();
});

afterEach(async () => {
  try {
    await app?.stop();
  } finally {
    app = undefined;
    await tg.stop();
    killLogged(log);
    if (savedLog === undefined) delete process.env.FAKE_LOG;
    else process.env.FAKE_LOG = savedLog;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function boot(extra: Record<string, unknown> = {}) {
  const created = createApp({
    dataDir,
    telegram: {
      token: tg.token,
      apiBase: tg.url,
      ownerId: OWNER,
      groupChatId: GROUP,
      defaultAgent: { folder: shop, name: 'dev' },
    },
    folders: [shop],
    cli: { claudeBin: FAKE_CLAUDE, codexBin: FAKE_CODEX },
    mcpBridge: bridgeCommand(),
    ...extra,
  } as any);
  app = created;
  await created.start();
}

const isSend = (c: Call) => c.method === 'sendMessage';
const inThread = (c: Call, tid: number) => Number(c.params.message_thread_id) === tid && Number(c.params.chat_id) === GROUP;
const textOf = (c: Call) => String(c.params.text ?? '');

/** 앱이 update_id까지 소비했다(다음 getUpdates의 offset이 그 뒤로 넘어갔다)는 것을 확인한다. */
function consumed(updateId: number) {
  return tg.waitFor((c) => c.method === 'getUpdates' && Number(c.params.offset) > updateId, 10000, `getUpdates offset > ${updateId}`);
}

/** 그룹에서 `/new <spec>` → 새 토픽 id. 새 토픽에 안내 메시지가 갈 때까지 기다린다. */
async function openTopic(spec: string): Promise<number> {
  const mark = tg.mark();
  tg.pushMessage({ fromId: OWNER, chatId: GROUP, text: `/new ${spec}` });
  const created = await tg.waitFor((c) => c.seq >= mark && c.method === 'createForumTopic', 10000, `createForumTopic for ${spec}`);
  expect(Number(created.params.chat_id)).toBe(GROUP);
  const tid = Number(created.result.message_thread_id);
  await tg.waitFor((c) => c.seq >= mark && isSend(c) && inThread(c, tid), 10000, `guidance in topic ${tid}`);
  return tid;
}

function say(tid: number, text: string): number {
  const mark = tg.mark();
  tg.pushMessage({ fromId: OWNER, chatId: GROUP, threadId: tid, text });
  return mark;
}

function reply(tid: number, includes: string, mark: number, timeoutMs = 10000): Promise<Call> {
  return tg.waitFor((c) => c.seq >= mark && isSend(c) && inThread(c, tid) && textOf(c).includes(includes), timeoutMs, `reply "${includes}" in topic ${tid}`);
}

async function keyboard(tid: number, mark: number): Promise<{ call: Call; id: string }> {
  const call = await tg.waitFor(
    (c) => c.seq >= mark && isSend(c) && inThread(c, tid) && keyboardButtons(c).some((b) => CALLBACK_RE.test(b.callback_data ?? '')),
    10000,
    `approval keyboard in topic ${tid}`,
  );
  const datas = keyboardButtons(call).map((b) => b.callback_data ?? '');
  const parsed = datas.map((d) => d.match(CALLBACK_RE));
  expect(parsed.every(Boolean), JSON.stringify(datas)).toBe(true);
  expect(new Set(parsed.map((m) => m![2]))).toEqual(new Set(['allow', 'session', 'deny']));
  const ids = new Set(parsed.map((m) => m![1]));
  expect(ids.size).toBe(1);
  return { call, id: [...ids][0] };
}

function press(tid: number, kb: { call: Call; id: string }, action: 'allow' | 'session' | 'deny', fromId = OWNER) {
  const mark = tg.mark();
  const cbId = tg.pushCallback({ fromId, chatId: GROUP, threadId: tid, data: `ap:${kb.id}:${action}`, messageId: kb.call.result.message_id });
  return { mark, cbId };
}

const keyboardsSince = (tid: number, mark: number) =>
  tg.calls('sendMessage').filter((c) => c.seq >= mark && inThread(c, tid) && keyboardButtons(c).length > 0);

describe('0001 소유자 한 명', () => {
  test('0001 소유자가 아닌 사용자의 DM과 /new는 무시한다(응답·토픽 생성·CLI 실행 없음)', async () => {
    await boot();
    tg.pushMessage({ fromId: STRANGER, chatId: STRANGER, text: 'hello' });
    const last = tg.pushMessage({ fromId: STRANGER, chatId: GROUP, text: '/new shop/dev' });
    await consumed(last);
    await sleep(1000);
    expect(tg.calls('sendMessage').filter((c) => Number(c.params.chat_id) === STRANGER)).toEqual([]);
    expect(tg.calls('createForumTopic')).toEqual([]);
    expect(readLog(log).filter((e) => e.kind === 'claude')).toEqual([]);
  });

  test('0001 웹훅 없이 getUpdates long polling을 쓴다', async () => {
    await boot();
    await tg.waitFor((c) => c.method === 'getUpdates' && Number(c.params.timeout) > 0, 10000, 'long poll getUpdates');
    expect(tg.calls('setWebhook')).toEqual([]);
  });
});

describe('0007 토픽 = 세션, DM = 기본 에이전트', () => {
  test('0007 /new shop/dev → 토픽 생성·안내, 토픽 메시지는 같은 토픽으로 응답', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const m = say(tid, 'hello');
    await reply(tid, 'claude:hello', m);
    const start = readLog(log).find((e) => e.kind === 'claude' && e.event === 'start' && e.prompt === 'hello');
    expect(start?.cwd).toBe(shop);
  });

  test('0007 같은 토픽의 두 번째 메시지는 같은 세션을 --resume으로 이어간다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    await reply(tid, 'claude:one', say(tid, 'one'));
    await reply(tid, 'claude:two', say(tid, 'two'));
    const entries = readLog(log).filter((e) => e.kind === 'claude');
    const sid = entries.find((e) => e.event === 'end' && e.text === 'claude:one')!.sessionId;
    const second = entries.find((e) => e.event === 'start' && e.prompt === 'two')!;
    const i = second.argv.indexOf('--resume');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(second.argv[i + 1]).toBe(sid);
  });

  test('0007 서로 다른 토픽은 서로 다른 세션이다', async () => {
    await boot();
    const t1 = await openTopic('shop/dev');
    const t2 = await openTopic('shop/dev');
    expect(t2).not.toBe(t1);
    await reply(t1, 'claude:a', say(t1, 'a'));
    await reply(t2, 'claude:b', say(t2, 'b'));
    const startB = readLog(log).find((e) => e.kind === 'claude' && e.event === 'start' && e.prompt === 'b')!;
    expect(startB.argv).not.toContain('--resume');
  });

  test('0007 앱을 다시 시작해도 토픽 바인딩과 세션이 유지된다(dataDir)', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    await reply(tid, 'claude:one', say(tid, 'one'));
    await consumed(tg.lastUpdateId());
    await app!.stop();
    app = undefined;
    await boot();
    await reply(tid, 'claude:two', say(tid, 'two'));
    const entries = readLog(log).filter((e) => e.kind === 'claude');
    const sid = entries.find((e) => e.event === 'end' && e.text === 'claude:one')!.sessionId;
    const second = entries.find((e) => e.event === 'start' && e.prompt === 'two')!;
    expect(second.argv[second.argv.indexOf('--resume') + 1]).toBe(sid);
  });

  test('0007 DM은 defaultAgent로 보낸다', async () => {
    await boot();
    const mark = tg.mark();
    tg.pushMessage({ fromId: OWNER, chatId: OWNER, text: 'ping' });
    await tg.waitFor(
      (c) => c.seq >= mark && isSend(c) && Number(c.params.chat_id) === OWNER && textOf(c).includes('claude:ping'),
      10000,
      'DM reply',
    );
    const start = readLog(log).find((e) => e.kind === 'claude' && e.event === 'start' && e.prompt === 'ping')!;
    expect(start.cwd).toBe(shop);
  });

  test('0007 4096자를 넘는 응답은 나눠 보낸다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const mark = say(tid, 'LONG 9000');
    const chunks = await waitUntil(() => {
      const cs = tg.calls('sendMessage').filter((c) => c.seq >= mark && inThread(c, tid) && /^x+$/.test(textOf(c)));
      return cs.reduce((n, c) => n + textOf(c).length, 0) >= 9000 ? cs : undefined;
    }, 10000, '9000 x chars');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(textOf(c).length).toBeLessThanOrEqual(4096);
  });
});

describe('0009 텔레그램 승인', () => {
  test('0009 standard의 셸 명령은 인라인 키보드로 묻고, 소유자의 허용으로 진행한다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const m = say(tid, 'NEEDS_APPROVAL rm -rf build');
    const kb = await keyboard(tid, m);
    const { mark, cbId } = press(tid, kb, 'allow');
    await reply(tid, 'approved:rm -rf build', mark);
    await tg.waitFor((c) => c.method === 'answerCallbackQuery' && c.params.callback_query_id === cbId, 10000, 'answerCallbackQuery');
  });

  test('0009 거부를 누르면 거부 결과가 CLI로 돌아가고, 소유자가 아닌 사람의 버튼은 무시한다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const m = say(tid, 'NEEDS_APPROVAL rm -rf build');
    const kb = await keyboard(tid, m);
    const stranger = press(tid, kb, 'allow', STRANGER);
    await consumed(tg.lastUpdateId());
    await sleep(1000);
    expect(tg.calls('sendMessage').filter((c) => c.seq >= stranger.mark && textOf(c).includes('approved:'))).toEqual([]);
    const { mark } = press(tid, kb, 'deny');
    const r = await reply(tid, 'denied:rm -rf build', mark);
    expect(textOf(r)).not.toContain('approved:');
  });

  test('0009 응답이 없으면 approvalTimeoutMs 뒤 거부한다', async () => {
    await boot({ approvalTimeoutMs: 1500 });
    const tid = await openTopic('shop/dev');
    const m = say(tid, 'NEEDS_APPROVAL rm -rf build');
    await keyboard(tid, m);
    await reply(tid, 'denied:rm -rf build', m, 10000);
  });

  test('0009 "세션 동안 허용"은 같은 토픽의 같은 첫 단어 명령을 다시 묻지 않는다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const kb = await keyboard(tid, say(tid, 'NEEDS_APPROVAL rm -rf build'));
    await reply(tid, 'approved:rm -rf build', press(tid, kb, 'session').mark);

    const m2 = say(tid, 'NEEDS_APPROVAL rm -rf dist');
    await reply(tid, 'approved:rm -rf dist', m2);
    expect(keyboardsSince(tid, m2)).toEqual([]);

    const m3 = say(tid, 'NEEDS_APPROVAL git push');
    const kb3 = await keyboard(tid, m3);
    await reply(tid, 'denied:git push', press(tid, kb3, 'deny').mark);
  });

  test('0009 allow 목록의 명령은 키보드 없이 허용한다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const m = say(tid, 'NEEDS_APPROVAL npm test');
    await reply(tid, 'approved:npm test', m);
    expect(keyboardsSince(tid, m)).toEqual([]);
  });

  test('0009 readonly 에이전트의 셸 명령은 묻지 않고 거부한다', async () => {
    await boot();
    const tid = await openTopic('shop/ro');
    const m = say(tid, 'NEEDS_APPROVAL rm -rf build');
    await reply(tid, 'denied:rm -rf build', m);
    expect(keyboardsSince(tid, m)).toEqual([]);
  });
});

describe('0008 Codex 에이전트 종단 간', () => {
  test('0008 codex 토픽: 응답과 승인 키보드가 같은 경로로 동작한다', async () => {
    await boot();
    const tid = await openTopic('shop/cx');
    await reply(tid, 'codex:hi', say(tid, 'hi'));
    const kb = await keyboard(tid, say(tid, 'NEEDS_APPROVAL rm -rf build'));
    await reply(tid, 'approved:rm -rf build', press(tid, kb, 'allow').mark);

    const kb2 = await keyboard(tid, say(tid, 'NEEDS_APPROVAL rm -rf dist'));
    await reply(tid, 'denied:rm -rf dist', press(tid, kb2, 'deny').mark);

    const codex = readLog(log).filter((e) => e.kind === 'codex');
    expect(codex.filter((e) => e.event === 'spawn')).toHaveLength(1);
    const start = codex.find((e) => e.event === 'recv' && e.msg.method === 'thread/start')!;
    expect(start.msg.params.cwd).toBe(shop);
    expect(start.msg.params.sandbox).toBe('workspace-write');
    expect(start.msg.params.approvalPolicy).toBe('untrusted');
  });
});

describe('0011 오케스트레이터', () => {
  test('0011 send_to_agent: 하위 에이전트의 결과를 동기로 받는다(같은 폴더 잠금에서 교착 없음)', async () => {
    await boot();
    const tid = await openTopic('shop/lead');
    const m = say(tid, 'DELEGATE dev hello');
    await reply(tid, 'lead got:claude:hello', m, 15000);
    const devStart = readLog(log).find((e) => e.kind === 'claude' && e.event === 'start' && e.prompt === 'hello')!;
    expect(devStart.cwd).toBe(shop);
  });

  test('0011 list_agents는 같은 폴더의 에이전트를 나열한다', async () => {
    await boot();
    const tid = await openTopic('shop/lead');
    const r = await reply(tid, 'agents:', say(tid, 'LIST_AGENTS'));
    for (const name of ['dev', 'lead', 'cx', 'ro', 'w2']) expect(textOf(r)).toContain(name);
  });

  test('0011 오케스트레이터가 아닌 에이전트는 send_to_agent를 쓸 수 없다', async () => {
    await boot();
    const tid = await openTopic('shop/dev');
    const m = say(tid, 'DELEGATE lead LIST_AGENTS');
    const r = await tg.waitFor(
      (c) => c.seq >= m && isSend(c) && inThread(c, tid) && /tool error|lead got/.test(textOf(c)),
      10000,
      'tool error or delegation result',
    );
    expect(textOf(r)).not.toContain('lead got:');
    expect(readLog(log).some((e) => e.kind === 'claude' && e.event === 'start' && e.prompt === 'LIST_AGENTS')).toBe(false);
  });
});

describe('0010 폴더 쓰기 잠금 (앱 수준)', () => {
  test('0010 같은 폴더의 쓰기 에이전트 턴은 차례로, readonly 턴은 막히지 않는다', async () => {
    await boot();
    const tA = await openTopic('shop/dev');
    const tB = await openTopic('shop/w2');
    const tR = await openTopic('shop/ro');

    say(tA, 'SLEEP 2000 a');
    await waitUntil(() => readLog(log).find((e) => e.event === 'start' && e.prompt === 'SLEEP 2000 a'), 10000, 'a started');
    say(tB, 'SLEEP 10 b');
    say(tR, 'SLEEP 10 r');

    const entries = await waitUntil(() => {
      const es = readLog(log).filter((e) => e.kind === 'claude');
      const ends = es.filter((e) => e.event === 'end').map((e) => e.text);
      return ['slept:a', 'slept:b', 'slept:r'].every((t) => ends.includes(t)) ? es : undefined;
    }, 15000, 'all three turns');
    const at = (event: string, key: string, val: string) => entries.find((e) => e.event === event && e[key] === val)!.t as number;
    const aEnd = at('end', 'text', 'slept:a');
    const bStart = at('start', 'prompt', 'SLEEP 10 b');
    const rStart = at('start', 'prompt', 'SLEEP 10 r');
    expect(bStart).toBeGreaterThanOrEqual(aEnd);
    expect(rStart).toBeLessThan(aEnd);
  });
});
