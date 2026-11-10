import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClaudeAdapter } from '@remote-agent/server';
import { FAKE_CLAUDE, agent, killLogged, makeTmp, readLog } from './helpers';

const MCP = { command: process.execPath, args: ['-e', '0'], env: { MARK: 'from-test' } };

/** argv에서 `name value` 쌍이 연속으로 있는지 */
function pair(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

describe('0008/0014 Claude 어댑터', () => {
  let tmp: string;
  let folder: string;
  let log: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = makeTmp('claude');
    folder = path.join(tmp, 'shop');
    fs.mkdirSync(folder);
    log = path.join(tmp, 'fake.log');
    for (const k of ['FAKE_LOG', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) saved[k] = process.env[k];
    process.env.FAKE_LOG = log;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-should-not-leak';
  });
  afterEach(() => {
    killLogged(log);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const dev = () => agent({ name: 'dev', folder, cli: 'claude', model: 'sonnet', prompt: '너는 dev다.' });

  test('0008 한 턴: 텍스트와 sessionId를 돌려주고 onEvent로 text·done을 보낸다', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    const events: any[] = [];
    const r = await adapter.runTurn({ agent: dev(), prompt: 'hello', chainId: 'chain-1', onEvent: (e: any) => events.push(e) });
    expect(r.text).toBe('claude:hello');
    const end = readLog(log).find((e) => e.event === 'end');
    expect(end).toBeTruthy();
    expect(r.sessionId).toBe(end!.sessionId);
    expect(events.some((e) => e.type === 'text' && String(e.text).includes('claude:hello'))).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.findIndex((e) => e.type === 'done')).toBe(events.length - 1);
  });

  test('0008 실행 인자: -p <prompt>, stream-json, --verbose, permission-prompt-tool, mcp-config, model, append-system-prompt', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    await adapter.runTurn({ agent: dev(), prompt: 'hello', chainId: 'chain-1', onEvent: () => {} });
    const start = readLog(log).find((e) => e.event === 'start')!;
    const argv: string[] = start.argv;
    expect(pair(argv, '-p')).toBe('hello');
    expect(pair(argv, '--output-format')).toBe('stream-json');
    expect(argv).toContain('--verbose');
    expect(pair(argv, '--permission-prompt-tool')).toBe('mcp__remote_agent__approve');
    expect(pair(argv, '--mcp-config')).toBeTruthy();
    expect(pair(argv, '--model')).toBe('sonnet');
    expect(pair(argv, '--append-system-prompt')).toContain('너는 dev다.');
    expect(argv).not.toContain('--resume');
  });

  test('0008 금지 플래그: --bare, --dangerously-skip-permissions를 쓰지 않는다', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    await adapter.runTurn({ agent: dev(), prompt: 'hello', chainId: 'chain-1', onEvent: () => {} });
    const argv: string[] = readLog(log).find((e) => e.event === 'start')!.argv;
    expect(argv).not.toContain('--bare');
    expect(argv.some((a) => a.includes('dangerously'))).toBe(false);
    expect(argv.some((a) => a.startsWith('--permission-mode') || a === 'bypassPermissions')).toBe(false);
  });

  test('0008 --mcp-config는 remote_agent 서버(mcp.command/args/env + REMOTE_AGENT_CHAIN_ID)를 담는다', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    await adapter.runTurn({ agent: dev(), prompt: 'hello', chainId: 'chain-42', onEvent: () => {} });
    const cfg = readLog(log).find((e) => e.event === 'start')!.mcpConfig;
    const srv = cfg?.mcpServers?.remote_agent;
    expect(srv, JSON.stringify(cfg)).toBeTruthy();
    expect(srv.command).toBe(MCP.command);
    expect(srv.args).toEqual(MCP.args);
    expect(srv.env.MARK).toBe('from-test');
    expect(srv.env.REMOTE_AGENT_CHAIN_ID).toBe('chain-42');
  });

  test('0008 cwd는 에이전트의 작업 폴더', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    await adapter.runTurn({ agent: dev(), prompt: 'hello', chainId: 'chain-1', onEvent: () => {} });
    expect(readLog(log).find((e) => e.event === 'start')!.cwd).toBe(folder);
  });

  test('0014 자식 환경에서 ANTHROPIC_API_KEY·ANTHROPIC_AUTH_TOKEN을 제거한다(부모 환경은 그대로)', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    await adapter.runTurn({ agent: dev(), prompt: 'hello', chainId: 'chain-1', onEvent: () => {} });
    const start = readLog(log).find((e) => e.event === 'start')!;
    expect(start.env.ANTHROPIC_API_KEY).toBe(false);
    expect(start.env.ANTHROPIC_AUTH_TOKEN).toBe(false);
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-should-not-leak');
  });

  test('0008 두 번째 턴은 --resume <첫 sessionId>로 이어간다', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    const r1 = await adapter.runTurn({ agent: dev(), prompt: 'one', chainId: 'c1', onEvent: () => {} });
    const r2 = await adapter.runTurn({ agent: dev(), prompt: 'two', sessionId: r1.sessionId, chainId: 'c2', onEvent: () => {} });
    expect(r2.text).toBe('claude:two');
    expect(r2.sessionId).toBe(r1.sessionId);
    const starts = readLog(log).filter((e) => e.event === 'start');
    expect(starts).toHaveLength(2);
    expect(starts[0].argv).not.toContain('--resume');
    expect(pair(starts[1].argv, '--resume')).toBe(r1.sessionId);
  });

  test('0008 모델이 없으면 --model을 넘기지 않는다', async () => {
    const adapter = createClaudeAdapter({ bin: FAKE_CLAUDE, mcp: MCP });
    await adapter.runTurn({ agent: agent({ folder, cli: 'claude' }), prompt: 'hi', chainId: 'c1', onEvent: () => {} });
    expect(readLog(log).find((e) => e.event === 'start')!.argv).not.toContain('--model');
  });
});
