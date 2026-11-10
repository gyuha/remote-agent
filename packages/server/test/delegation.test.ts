// send_to_agent (0011) at app level, driven by the acceptance fakes (read-only reuse, nothing modified there).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp, type App } from '../src/app.ts';
import { startFakeTelegram, type Call, type FakeTelegram } from '../../../tests/acceptance/fakes/fake-telegram.ts';
import { FAKE_CLAUDE, FAKE_CODEX, bridgeCommand, killLogged, makeTmp, readLog, writeAgent } from '../../../tests/acceptance/helpers.ts';

const OWNER = 111;
const GROUP = -1001;

let tg: FakeTelegram;
let app: App;
let root: string;
let log: string;

beforeEach(async () => {
  root = makeTmp('delegation');
  const shop = path.join(root, 'shop');
  fs.mkdirSync(shop);
  log = path.join(root, 'fake.log');
  process.env.FAKE_LOG = log;
  writeAgent(shop, 'dev', 'cli: claude\nprofile: standard');
  writeAgent(shop, 'lead', 'cli: claude\nprofile: standard\norchestrator: true');
  writeAgent(shop, 'lead2', 'cli: claude\nprofile: standard\norchestrator: true');
  tg = await startFakeTelegram();
  app = createApp({
    dataDir: path.join(root, 'data'),
    telegram: { token: tg.token, apiBase: tg.url, ownerId: OWNER, groupChatId: GROUP },
    folders: [shop],
    cli: { claudeBin: FAKE_CLAUDE, codexBin: FAKE_CODEX },
    mcpBridge: bridgeCommand(),
  });
  await app.start();
});

afterEach(async () => {
  try {
    await app.stop();
  } finally {
    await tg.stop();
    killLogged(log);
    delete process.env.FAKE_LOG;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const sendIn = (tid: number, includes: string) => (c: Call) =>
  c.method === 'sendMessage' && Number(c.params.message_thread_id) === tid && String(c.params.text).includes(includes);

async function openTopic(spec: string): Promise<number> {
  const mark = tg.mark();
  tg.pushMessage({ fromId: OWNER, chatId: GROUP, text: `/new ${spec}` });
  const created = await tg.waitFor((c) => c.seq >= mark && c.method === 'createForumTopic');
  const tid = Number(created.result.message_thread_id);
  await tg.waitFor((c) => c.seq >= mark && sendIn(tid, '새 세션')(c));
  return tid;
}

async function say(tid: number, text: string, includes: string): Promise<string> {
  const mark = tg.mark();
  tg.pushMessage({ fromId: OWNER, chatId: GROUP, threadId: tid, text });
  const r = await tg.waitFor((c) => c.seq >= mark && sendIn(tid, includes)(c), 15000, includes);
  return String(r.params.text);
}

const started = (prompt: string) => readLog(log).filter((e) => e.event === 'start' && e.prompt === prompt);

test('an orchestrator cannot delegate to itself', async () => {
  const tid = await openTopic('shop/lead');
  const text = await say(tid, 'DELEGATE lead hi', 'tool error:');
  expect(text).toContain('itself');
  expect(started('hi')).toEqual([]);
});

test('a delegation cycle is refused instead of deadlocking', async () => {
  const tid = await openTopic('shop/lead');
  const text = await say(tid, 'DELEGATE lead2 DELEGATE lead hi', 'lead got:');
  expect(text).toContain('tool error:');
  expect(text).toContain('cycle');
  expect(started('hi')).toEqual([]);
});

test('unknown targets are refused', async () => {
  const tid = await openTopic('shop/lead');
  expect(await say(tid, 'DELEGATE nobody hi', 'tool error:')).toContain('same folder');
});

test('delegations from one topic reuse one delegation topic and resume the sub-session', async () => {
  const tid = await openTopic('shop/lead');
  await say(tid, 'DELEGATE dev one', 'lead got:claude:one');
  await say(tid, 'DELEGATE dev two', 'lead got:claude:two');

  const topics = tg.calls('createForumTopic').filter((c) => c.params.name === 'lead → dev');
  expect(topics).toHaveLength(1);
  const sub = Number(topics[0].result.message_thread_id);
  const texts = tg.calls('sendMessage').filter((c) => Number(c.params.message_thread_id) === sub).map((c) => String(c.params.text));
  expect(texts).toEqual(['📨 lead:\none', 'claude:one', '📨 lead:\ntwo', 'claude:two']);

  const [first] = started('one');
  const [second] = started('two');
  expect(first.argv).not.toContain('--resume');
  expect(second.argv).toContain('--resume');
});
