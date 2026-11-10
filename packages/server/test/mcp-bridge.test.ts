import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-bridge.ts');

interface Received {
  url: string;
  body: Record<string, unknown>;
}
type Reply = (url: string, body: Record<string, unknown>) => { status: number; json: object };

/** Minimal stand-in for the app's internal HTTP bridge. */
function fakeApp(reply: Reply) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data);
      received.push({ url: req.url ?? '', body });
      const r = reply(req.url ?? '', body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.json));
    });
  });
  return { server, received };
}

/** Spawns the bridge from source (as Claude would via --mcp-config) and speaks JSON-RPC to it. */
function startBridge(env: Record<string, string>) {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    ['--no-warnings', '--experimental-strip-types', BRIDGE],
    { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const waiters = new Map<number, (msg: Record<string, unknown>) => void>();
  let buf = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  const rpc = (method: string, params?: object) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-RPC replies are inspected ad hoc
    new Promise<Record<string, any>>((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async (name: string, args: object) => (await rpc('tools/call', { name, arguments: args })).result;
  return { child, rpc, call };
}

describe('mcp-bridge', () => {
  let app: ReturnType<typeof fakeApp>;
  let bridge: ReturnType<typeof startBridge>;
  let reply: Reply;

  beforeEach(async () => {
    reply = () => ({ status: 500, json: {} });
    app = fakeApp((url, body) => reply(url, body));
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const { port } = app.server.address() as AddressInfo;
    bridge = startBridge({ REMOTE_AGENT_BRIDGE_URL: `http://127.0.0.1:${port}`, REMOTE_AGENT_CHAIN_ID: 'chain-7' });
    const init = await bridge.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    expect(init.result.capabilities.tools).toBeDefined();
    bridge.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  });
  afterEach(async () => {
    bridge.child.kill();
    await new Promise((r) => app.server.close(r));
  });

  test('lists approve, list_agents, send_to_agent and answers ping', async () => {
    const list = await bridge.rpc('tools/list');
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['approve', 'list_agents', 'send_to_agent']);
    expect((await bridge.rpc('ping')).result).toEqual({});
  });

  test('approve allow: relays chainId/tool_name/input and returns updatedInput', async () => {
    reply = () => ({ status: 200, json: { behavior: 'allow' } });
    const input = { command: 'rm -rf build' };
    const r = await bridge.call('approve', { tool_name: 'Bash', input });
    expect(app.received).toEqual([{ url: '/approve', body: { chainId: 'chain-7', tool_name: 'Bash', input } }]);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({ behavior: 'allow', updatedInput: input });
  });

  test('approve deny: returns behavior deny with the app message', async () => {
    reply = () => ({ status: 200, json: { behavior: 'deny', message: 'owner said no' } });
    const r = await bridge.call('approve', { tool_name: 'Bash', input: { command: 'rm -rf /' } });
    expect(JSON.parse(r.content[0].text)).toEqual({ behavior: 'deny', message: 'owner said no' });
  });

  test('approve fails closed when the app errors', async () => {
    reply = () => ({ status: 500, json: { error: 'boom' } });
    const r = await bridge.call('approve', { tool_name: 'Bash', input: { command: 'ls' } });
    expect(JSON.parse(r.content[0].text).behavior).toBe('deny');
  });

  test('send_to_agent forwards to the app and returns its text', async () => {
    reply = () => ({ status: 200, json: { text: 'claude:hello' } });
    const r = await bridge.call('send_to_agent', { name: 'dev', message: 'hello' });
    expect(app.received[0]).toEqual({
      url: '/tools/send_to_agent',
      body: { chainId: 'chain-7', arguments: { name: 'dev', message: 'hello' } },
    });
    expect(r).toEqual({ content: [{ type: 'text', text: 'claude:hello' }] });
  });

  test('app refusal becomes an MCP tool error (isError)', async () => {
    reply = () => ({ status: 403, json: { error: 'not an orchestrator' } });
    const r = await bridge.call('list_agents', {});
    expect(app.received[0].url).toBe('/tools/list_agents');
    expect(r).toEqual({ content: [{ type: 'text', text: 'not an orchestrator' }], isError: true });
  });

  test('unknown tool is a JSON-RPC error', async () => {
    const r = await bridge.rpc('tools/call', { name: 'nope', arguments: {} });
    expect(r.error.code).toBe(-32602);
  });
});
