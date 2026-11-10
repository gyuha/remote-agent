#!/usr/bin/env node
// `claude -p <prompt> --output-format stream-json ...` 를 흉내 내는 가짜 CLI.
// 동작은 프롬프트 텍스트로 고른다:
//   (기본)                       → "claude:<prompt>"
//   NEEDS_APPROVAL <command>     → MCP approve 도구 호출 → "approved:<command>" | "denied:<command>"
//   DELEGATE <name> <message>    → MCP send_to_agent 호출 → "lead got:<결과 텍스트>"
//   LIST_AGENTS                  → MCP list_agents 호출 → "agents:<결과 텍스트>"
//   SLEEP <ms> <text>            → ms 동안 잔 뒤 "slept:<text>"
//   LONG <n>                     → "x" n개
// MCP 도구 오류는 "tool error:<메시지>"로 답한다.
// FAKE_LOG 파일에 start/end 이벤트를 JSON 한 줄씩 남긴다.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

setTimeout(() => process.exit(97), 60000).unref();

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const prompt = flag('-p') ?? '';
const resume = flag('--resume');
const sessionId = resume ?? randomUUID();

let mcpConfig = null;
const mcpArg = flag('--mcp-config');
if (mcpArg !== undefined) {
  try {
    mcpConfig = JSON.parse(fs.readFileSync(mcpArg, 'utf8'));
  } catch {
    try {
      mcpConfig = JSON.parse(mcpArg);
    } catch (e) {
      mcpConfig = { error: String(e) };
    }
  }
}

function log(entry) {
  if (!process.env.FAKE_LOG) return;
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ kind: 'claude', pid: process.pid, t: Date.now(), ...entry }) + '\n');
}
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

log({
  event: 'start',
  argv,
  cwd: process.cwd(),
  prompt,
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY !== undefined,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN !== undefined,
  },
  mcpConfig,
});

async function withMcp(fn) {
  const srv = mcpConfig?.mcpServers?.remote_agent;
  if (!srv || !srv.command) throw new Error('no mcpServers.remote_agent in --mcp-config');
  const child = spawn(srv.command, srv.args ?? [], {
    env: { ...process.env, ...(srv.env ?? {}) },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiters = new Map();
  let nextId = 1;
  let buf = '';
  let dead = null;
  const failAll = (err) => {
    dead = err;
    for (const [, w] of waiters) w.reject(err);
    waiters.clear();
  };
  child.on('error', (e) => failAll(e));
  child.on('exit', (code, sig) => failAll(new Error(`mcp server exited (code=${code} signal=${sig})`)));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.method !== undefined && msg.id !== undefined) {
        // 서버 → 클라이언트 요청(ping 등)
        const reply = msg.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'not supported' } };
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...reply }) + '\n');
      } else if (msg.id !== undefined && waiters.has(msg.id)) {
        waiters.get(msg.id).resolve(msg);
        waiters.delete(msg.id);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      if (dead) return reject(dead);
      const id = nextId++;
      waiters.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fake-claude', version: '0.0.0' },
    });
    if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return await fn(async (name, args) => {
      const r = await rpc('tools/call', { name, arguments: args });
      if (r.error) return { error: r.error.message ?? 'error' };
      const text = (r.result?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      if (r.result?.isError) return { error: text || 'isError' };
      return { text };
    });
  } finally {
    child.removeAllListeners('exit');
    child.stdin.end();
    child.kill();
  }
}

async function main() {
  out({ type: 'system', subtype: 'init', session_id: sessionId, cwd: process.cwd(), tools: [], mcp_servers: [] });
  let text;
  try {
    if (prompt.startsWith('NEEDS_APPROVAL ')) {
      const command = prompt.slice('NEEDS_APPROVAL '.length);
      const r = await withMcp((call) => call('approve', { tool_name: 'Bash', input: { command } }));
      if (r.error) text = `tool error:${r.error}`;
      else {
        let d = {};
        try {
          d = JSON.parse(r.text);
        } catch {
          /* 잘못된 응답 */
        }
        if (d.behavior === 'allow' && d.updatedInput?.command === command) text = `approved:${command}`;
        else if (d.behavior === 'deny') text = `denied:${command}`;
        else text = `malformed approve result:${r.text}`;
      }
    } else if (prompt.startsWith('DELEGATE ')) {
      const [, name, ...rest] = prompt.split(' ');
      const r = await withMcp((call) => call('send_to_agent', { name, message: rest.join(' ') }));
      text = r.error ? `tool error:${r.error}` : `lead got:${r.text}`;
    } else if (prompt === 'LIST_AGENTS') {
      const r = await withMcp((call) => call('list_agents', {}));
      text = r.error ? `tool error:${r.error}` : `agents:${r.text}`;
    } else if (prompt.startsWith('SLEEP ')) {
      const [, ms, ...rest] = prompt.split(' ');
      await new Promise((res) => setTimeout(res, Number(ms)));
      text = `slept:${rest.join(' ')}`;
    } else if (prompt.startsWith('LONG ')) {
      text = 'x'.repeat(Number(prompt.slice(5)));
    } else {
      text = `claude:${prompt}`;
    }
  } catch (e) {
    text = `tool error:${e?.message ?? e}`;
  }
  out({ type: 'assistant', session_id: sessionId, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  // end 로그는 result 줄보다 먼저 남긴다: 어댑터가 result를 읽자마자 잠금을 풀어도 다음 턴의 start보다 앞선다.
  log({ event: 'end', sessionId, text });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: text });
}

main().catch((e) => {
  log({ event: 'end', error: String(e) });
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
