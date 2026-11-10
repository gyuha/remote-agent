#!/usr/bin/env node
// `codex app-server` 를 흉내 내는 가짜 CLI. stdio 위의 줄 단위 JSON-RPC.
// 받은 메시지는 모두 FAKE_LOG 에 {kind:'codex', event:'recv', pid, msg} 로 남긴다.
// turn/start 의 입력 텍스트가 "NEEDS_APPROVAL <cmd>" 이면 먼저 서버 요청
// item/commandExecution/requestApproval 을 보내고, 결정이 accept|acceptForSession 이면
// "approved:<cmd>", 아니면 "denied:<cmd>" 로 답한다. 그 밖에는 "codex:<text>".
import fs from 'node:fs';
import readline from 'node:readline';

setTimeout(() => process.exit(97), 60000).unref();

function log(entry) {
  if (!process.env.FAKE_LOG) return;
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ kind: 'codex', pid: process.pid, t: Date.now(), ...entry }) + '\n');
}

if (process.argv[2] !== 'app-server') {
  process.stderr.write('fake-codex: only `app-server` is supported\n');
  process.exit(2);
}

log({ event: 'spawn', argv: process.argv.slice(2), cwd: process.cwd() });

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const notify = (method, params) => send({ method, params });
const threads = new Set();
let threadSeq = 0;
let turnSeq = 0;
let itemSeq = 0;
let serverReqSeq = 0;
const pendingServerRequests = new Map();

function serverRequest(method, params) {
  const id = serverReqSeq++;
  return new Promise((resolve) => {
    pendingServerRequests.set(id, resolve);
    send({ id, method, params });
  });
}

async function runTurn(threadId, turnId, text) {
  notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress', items: [] } });
  let reply;
  if (text.startsWith('NEEDS_APPROVAL ')) {
    const command = text.slice('NEEDS_APPROVAL '.length);
    const resp = await serverRequest('item/commandExecution/requestApproval', {
      threadId,
      turnId,
      itemId: `item_${++itemSeq}`,
      startedAtMs: Date.now(),
      command,
      cwd: process.cwd(),
    });
    const decision = resp.result?.decision;
    reply = decision === 'accept' || decision === 'acceptForSession' ? `approved:${command}` : `denied:${command}`;
  } else {
    reply = `codex:${text}`;
  }
  const itemId = `item_${++itemSeq}`;
  const a = Math.floor(reply.length / 3);
  const b = Math.floor((2 * reply.length) / 3);
  for (const delta of [reply.slice(0, a), reply.slice(a, b), reply.slice(b)]) {
    if (delta) notify('item/agentMessage/delta', { threadId, turnId, itemId, delta });
  }
  notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', id: itemId, text: reply } });
  notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
}

function handleRequest(msg) {
  const { id, method, params = {} } = msg;
  const ok = (result) => send({ id, result });
  const err = (code, message) => send({ id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return ok({ userAgent: 'fake-codex/0.0.0' });
    case 'account/read':
      return ok({ account: { type: 'chatgpt', email: 'owner@example.com' }, requiresOpenaiAuth: false });
    case 'thread/start': {
      const tid = `thr_${++threadSeq}`;
      threads.add(tid);
      return ok({
        thread: { id: tid, preview: '', createdAt: Math.floor(Date.now() / 1000) },
        model: params.model ?? 'fake-model',
        cwd: params.cwd ?? process.cwd(),
        approvalPolicy: params.approvalPolicy ?? 'on-request',
        sandbox: params.sandbox ?? 'workspace-write',
      });
    }
    case 'thread/resume': {
      if (!params.threadId) return err(-32602, 'threadId required');
      threads.add(params.threadId);
      return ok({ thread: { id: params.threadId, preview: '' }, model: 'fake-model' });
    }
    case 'turn/start': {
      const threadId = params.threadId;
      if (!threads.has(threadId)) return err(-32600, `thread not found: ${threadId}`);
      const text = (params.input ?? [])
        .filter((i) => i.type === 'text')
        .map((i) => i.text)
        .join('');
      const turnId = `turn_${++turnSeq}`;
      ok({ turn: { id: turnId, status: 'inProgress', items: [] } });
      runTurn(threadId, turnId, text);
      return;
    }
    case 'turn/interrupt':
      return ok({});
    default:
      return err(-32601, `method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log({ event: 'bad-json', line });
    return;
  }
  log({ event: 'recv', msg });
  if (msg.method !== undefined && msg.id !== undefined) handleRequest(msg);
  else if (msg.method !== undefined) {
    /* 클라이언트 알림(initialized 등): 무시 */
  } else if (msg.id !== undefined && pendingServerRequests.has(msg.id)) {
    pendingServerRequests.get(msg.id)(msg);
    pendingServerRequests.delete(msg.id);
  }
});
rl.on('close', () => {
  log({ event: 'exit' });
  process.exit(0);
});
