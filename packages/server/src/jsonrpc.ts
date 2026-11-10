import type { Readable, Writable } from 'node:stream';

/** A JSON-RPC error; thrown by request handlers to choose the error code sent back. */
export class JsonRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

type Id = number | string;

interface Message {
  id?: Id;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcClientOptions {
  /** Lines from the peer. */
  input: Readable;
  /** Lines to the peer. */
  output: Writable;
  onNotification?: (method: string, params: unknown) => void;
  /** Handles a peer → us request. Throw JsonRpcError to pick the error code; any other throw becomes -32603. */
  onRequest?: (method: string, params: unknown) => unknown;
}

export interface JsonRpcClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  /** Rejects every pending request with `error`; later requests reject immediately. */
  close(error?: Error): void;
}

/**
 * Line-delimited JSON-RPC over a stream pair. Messages omit the `"jsonrpc": "2.0"` field,
 * matching `codex app-server`'s wire format.
 */
export function createJsonRpcClient(options: JsonRpcClientOptions): JsonRpcClient {
  const { input, output } = options;
  const pending = new Map<Id, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 0;
  let closedWith: Error | undefined;
  let buf = '';

  const write = (msg: Message) => {
    if (closedWith || !output.writable) return;
    output.write(JSON.stringify(msg) + '\n');
  };

  const handleRequest = async (id: Id, method: string, params: unknown) => {
    try {
      if (!options.onRequest) throw new JsonRpcError(METHOD_NOT_FOUND, `method not found: ${method}`);
      const result = await options.onRequest(method, params);
      write({ id, result: result ?? null });
    } catch (err) {
      const e = err instanceof JsonRpcError ? err : new JsonRpcError(INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
      write({ id, error: e.data === undefined ? { code: e.code, message: e.message } : { code: e.code, message: e.message, data: e.data } });
    }
  };

  const handleLine = (line: string) => {
    let msg: Message;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg === null || typeof msg !== 'object') return;
    if (typeof msg.method === 'string') {
      if (msg.id !== undefined) void handleRequest(msg.id, msg.method, msg.params);
      else options.onNotification?.(msg.method, msg.params);
      return;
    }
    if (msg.id === undefined) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new JsonRpcError(msg.error.code, msg.error.message, msg.error.data));
    else waiter.resolve(msg.result);
  };

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) handleLine(line);
    }
  });
  input.on('end', () => close(new Error('connection closed')));

  function request(method: string, params?: unknown): Promise<unknown> {
    if (closedWith) return Promise.reject(closedWith);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      write(params === undefined ? { id, method } : { id, method, params });
    });
  }

  function notify(method: string, params?: unknown): void {
    write(params === undefined ? { method } : { method, params });
  }

  function close(error = new Error('connection closed')): void {
    if (closedWith) return;
    closedWith = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  }

  return { request, notify, close };
}
