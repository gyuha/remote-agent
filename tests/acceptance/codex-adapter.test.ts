import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createCodexAdapter } from '@remote-agent/server';
import { FAKE_CODEX, agent, killLogged, makeTmp, readLog } from './helpers';

type Adapter = ReturnType<typeof createCodexAdapter>;

describe('0008 Codex 어댑터 (app-server)', () => {
  let tmp: string;
  let log: string;
  let savedLog: string | undefined;
  const adapters: Adapter[] = [];

  const folderNamed = (name: string) => {
    const f = path.join(tmp, name);
    fs.mkdirSync(f, { recursive: true });
    return f;
  };
  const make = () => {
    const a = createCodexAdapter({ bin: FAKE_CODEX });
    adapters.push(a);
    return a;
  };
  const recv = (method: string) => readLog(log).filter((e) => e.event === 'recv' && e.msg.method === method);
  const spawns = () => readLog(log).filter((e) => e.event === 'spawn');

  beforeEach(() => {
    tmp = makeTmp('codex');
    log = path.join(tmp, 'fake.log');
    savedLog = process.env.FAKE_LOG;
    process.env.FAKE_LOG = log;
  });
  afterEach(async () => {
    for (const a of adapters.splice(0)) await a.close();
    killLogged(log);
    if (savedLog === undefined) delete process.env.FAKE_LOG;
    else process.env.FAKE_LOG = savedLog;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('0008 한 턴: delta를 이어 붙인 텍스트와 threadId(sessionId)를 돌려준다', async () => {
    const folder = folderNamed('shop');
    const adapter = make();
    const events: any[] = [];
    const r = await adapter.runTurn({
      agent: agent({ folder, cli: 'codex' }),
      prompt: 'hello world',
      chainId: 'c1',
      onEvent: (e: any) => events.push(e),
    });
    expect(r.text).toBe('codex:hello world');
    const turn = recv('turn/start')[0];
    expect(turn.msg.params.threadId).toBe(r.sessionId);
    expect(turn.msg.params.input).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(spawns()[0].argv).toEqual(['app-server']);
  });

  test('0008 initialize 후 thread/start {cwd, approvalPolicy: untrusted, sandbox}', async () => {
    const folder = folderNamed('shop');
    await make().runTurn({ agent: agent({ folder, cli: 'codex' }), prompt: 'hi', chainId: 'c1', onEvent: () => {} });
    const methods = readLog(log)
      .filter((e) => e.event === 'recv' && e.msg.id !== undefined && e.msg.method)
      .map((e) => e.msg.method);
    expect(methods[0]).toBe('initialize');
    expect(methods.indexOf('thread/start')).toBeGreaterThan(0);
    expect(methods.indexOf('turn/start')).toBeGreaterThan(methods.indexOf('thread/start'));
    const p = recv('thread/start')[0].msg.params;
    expect(p.cwd).toBe(folder);
    expect(p.approvalPolicy).toBe('untrusted');
    expect(p.sandbox).toBe('workspace-write');
  });

  test('0008 같은 폴더의 두 턴은 app-server 하나를 재사용하고 같은 thread를 이어간다', async () => {
    const folder = folderNamed('shop');
    const adapter = make();
    const a = agent({ folder, cli: 'codex' });
    const r1 = await adapter.runTurn({ agent: a, prompt: 'one', chainId: 'c1', onEvent: () => {} });
    const r2 = await adapter.runTurn({ agent: a, prompt: 'two', sessionId: r1.sessionId, chainId: 'c2', onEvent: () => {} });
    expect(r2.text).toBe('codex:two');
    expect(r2.sessionId).toBe(r1.sessionId);
    expect(spawns()).toHaveLength(1);
    expect(recv('initialize')).toHaveLength(1);
    expect(recv('thread/start')).toHaveLength(1);
    expect(recv('turn/start').map((e) => e.msg.params.threadId)).toEqual([r1.sessionId, r1.sessionId]);
  });

  test('0008 sessionId 없는 새 세션은 같은 프로세스에서 새 thread를 연다', async () => {
    const folder = folderNamed('shop');
    const adapter = make();
    const r1 = await adapter.runTurn({ agent: agent({ folder, cli: 'codex' }), prompt: 'a', chainId: 'c1', onEvent: () => {} });
    const r2 = await adapter.runTurn({ agent: agent({ folder, cli: 'codex', name: 'other' }), prompt: 'b', chainId: 'c2', onEvent: () => {} });
    expect(r2.sessionId).not.toBe(r1.sessionId);
    expect(spawns()).toHaveLength(1);
    expect(recv('thread/start')).toHaveLength(2);
  });

  test('0008 프로세스를 새로 띄운 뒤 기존 sessionId는 thread/resume으로 이어간다', async () => {
    const folder = folderNamed('shop');
    const first = make();
    const r1 = await first.runTurn({ agent: agent({ folder, cli: 'codex' }), prompt: 'one', chainId: 'c1', onEvent: () => {} });
    await first.close();
    const second = make();
    const r2 = await second.runTurn({
      agent: agent({ folder, cli: 'codex' }),
      prompt: 'two',
      sessionId: r1.sessionId,
      chainId: 'c2',
      onEvent: () => {},
    });
    expect(r2.text).toBe('codex:two');
    expect(r2.sessionId).toBe(r1.sessionId);
    const pids = spawns().map((e) => e.pid);
    expect(pids).toHaveLength(2);
    const inSecond = readLog(log).filter((e) => e.pid === pids[1] && e.event === 'recv');
    const resume = inSecond.find((e) => e.msg.method === 'thread/resume');
    expect(resume?.msg.params.threadId).toBe(r1.sessionId);
    expect(inSecond.some((e) => e.msg.method === 'thread/start')).toBe(false);
  });

  test('0008 폴더마다 app-server 하나, 프로필별 sandbox(readonly→read-only, standard→workspace-write, trusted→danger-full-access)', async () => {
    const adapter = make();
    const cases = [
      ['ro', 'readonly', 'read-only'],
      ['std', 'standard', 'workspace-write'],
      ['tr', 'trusted', 'danger-full-access'],
    ] as const;
    for (const [dir, profile] of cases) {
      const folder = folderNamed(dir);
      await adapter.runTurn({ agent: agent({ folder, cli: 'codex', profile }), prompt: dir, chainId: dir, onEvent: () => {} });
    }
    expect(spawns()).toHaveLength(3);
    const starts = recv('thread/start');
    expect(new Set(starts.map((e) => e.pid)).size).toBe(3);
    for (const [dir, , sandbox] of cases) {
      const start = starts.find((e) => e.msg.params.cwd === path.join(tmp, dir));
      expect(start, dir).toBeTruthy();
      expect(start!.msg.params.sandbox, dir).toBe(sandbox);
      expect(start!.msg.params.approvalPolicy, dir).toBe('untrusted');
    }
  });

  test('0008 close()는 app-server 프로세스를 끝낸다', async () => {
    const folder = folderNamed('shop');
    const adapter = createCodexAdapter({ bin: FAKE_CODEX });
    await adapter.runTurn({ agent: agent({ folder, cli: 'codex' }), prompt: 'hi', chainId: 'c1', onEvent: () => {} });
    const pid = spawns()[0].pid;
    await adapter.close();
    const deadline = Date.now() + 5000;
    let alive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(alive).toBe(false);
  });
});
