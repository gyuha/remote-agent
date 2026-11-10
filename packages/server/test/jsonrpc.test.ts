import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { JsonRpcError, createJsonRpcClient, type JsonRpcClientOptions } from '../src/jsonrpc.ts';

/** A client wired to in-memory pipes; `peer` sends lines to it, `sent()` reads what it wrote. */
function setup(opts: Omit<JsonRpcClientOptions, 'input' | 'output'> = {}) {
  const toClient = new PassThrough();
  const fromClient = new PassThrough();
  let out = '';
  fromClient.setEncoding('utf8');
  fromClient.on('data', (c: string) => (out += c));
  const client = createJsonRpcClient({ input: toClient, output: fromClient, ...opts });
  const peer = (msg: unknown) => toClient.write(JSON.stringify(msg) + '\n');
  const sent = () => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tick = () => new Promise((r) => setImmediate(r));
  return { client, peer, sent, tick, toClient };
}

describe('createJsonRpcClient', () => {
  test('matches responses to requests by id, out of order', async () => {
    const { client, peer, sent } = setup();
    const a = client.request('a', { x: 1 });
    const b = client.request('b');
    expect(sent()).toEqual([{ id: 0, method: 'a', params: { x: 1 } }, { id: 1, method: 'b' }]);
    peer({ id: 1, result: 'B' });
    peer({ id: 0, result: { ok: true } });
    await expect(a).resolves.toEqual({ ok: true });
    await expect(b).resolves.toBe('B');
  });

  test('rejects with JsonRpcError on an error response', async () => {
    const { client, peer } = setup();
    const p = client.request('nope');
    peer({ id: 0, error: { code: -32601, message: 'method not found' } });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    expect((err as JsonRpcError).code).toBe(-32601);
  });

  test('delivers notifications and sends client notifications without an id', async () => {
    const got: unknown[] = [];
    const { client, peer, sent, tick } = setup({ onNotification: (m, p) => got.push([m, p]) });
    client.notify('initialized');
    peer({ method: 'item/agentMessage/delta', params: { delta: 'hi' } });
    await tick();
    expect(got).toEqual([['item/agentMessage/delta', { delta: 'hi' }]]);
    expect(sent()).toEqual([{ method: 'initialized' }]);
  });

  test('answers server requests with the handler result (async ok)', async () => {
    const { peer, sent, tick } = setup({ onRequest: async (m, p) => ({ echo: m, p }) });
    peer({ id: 7, method: 'ask', params: 1 });
    await tick();
    await tick();
    expect(sent()).toEqual([{ id: 7, result: { echo: 'ask', p: 1 } }]);
  });

  test('turns handler errors into JSON-RPC errors; no handler → method not found', async () => {
    const thrower = setup({
      onRequest: (m) => {
        if (m === 'unknown') throw new JsonRpcError(-32601, 'nope');
        throw new Error('boom');
      },
    });
    thrower.peer({ id: 1, method: 'unknown' });
    thrower.peer({ id: 2, method: 'other' });
    await thrower.tick();
    await thrower.tick();
    expect(thrower.sent()).toEqual([
      { id: 1, error: { code: -32601, message: 'nope' } },
      { id: 2, error: { code: -32603, message: 'boom' } },
    ]);

    const bare = setup();
    bare.peer({ id: 'x', method: 'anything' });
    await bare.tick();
    await bare.tick();
    expect(bare.sent()).toEqual([{ id: 'x', error: { code: -32601, message: 'method not found: anything' } }]);
  });

  test('handles lines split across chunks and ignores garbage', async () => {
    const { client, toClient } = setup();
    const p = client.request('a');
    toClient.write('not json\n{"id":0,');
    toClient.write('"result":42}\n');
    await expect(p).resolves.toBe(42);
  });

  test('rejects pending and later requests when the input ends or close() is called', async () => {
    const { client, toClient } = setup();
    const p = client.request('a');
    toClient.end();
    await expect(p).rejects.toThrow('connection closed');
    await expect(client.request('b')).rejects.toThrow('connection closed');

    const other = setup();
    const q = other.client.request('a');
    other.client.close(new Error('killed'));
    await expect(q).rejects.toThrow('killed');
  });
});
