import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';
import { openStore } from '../src/index.ts';

describe('openStore', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  test('binds topics, records session IDs, and clears them on rebind', () => {
    const store = openStore(':memory:');
    expect(store.findBinding(-100, 7)).toBeUndefined();

    store.bindTopic({ chatId: -100, threadId: 7, folder: '/work/shop', agent: 'dev' });
    expect(store.findBinding(-100, 7)).toEqual({ chatId: -100, threadId: 7, folder: '/work/shop', agent: 'dev' });
    expect(store.findBinding(-100, 8)).toBeUndefined();

    store.setSessionId(-100, 7, 'sess-1');
    expect(store.findBinding(-100, 7)?.cliSessionId).toBe('sess-1');

    store.bindTopic({ chatId: -100, threadId: 7, folder: '/work/shop', agent: 'qa' });
    expect(store.findBinding(-100, 7)).toEqual({ chatId: -100, threadId: 7, folder: '/work/shop', agent: 'qa' });
    store.close();
  });

  test('persists bindings and events to a file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-store-'));
    dirs.push(dir);
    const file = path.join(dir, 'state.db');

    const store = openStore(file);
    store.bindTopic({ chatId: 1, threadId: 0, folder: '/f', agent: 'a' });
    store.setSessionId(1, 0, 's');
    store.appendEvent({ type: 'turn', chatId: 1, threadId: 0, data: { text: 'hi' } });
    store.appendEvent({ type: 'boot' });
    store.close();

    const reopened = openStore(file);
    expect(reopened.findBinding(1, 0)).toEqual({ chatId: 1, threadId: 0, folder: '/f', agent: 'a', cliSessionId: 's' });
    reopened.close();

    const db = new DatabaseSync(file);
    const rows = db.prepare('SELECT type, chat_id, thread_id, data FROM events ORDER BY id').all();
    db.close();
    expect(rows).toEqual([
      { type: 'turn', chat_id: 1, thread_id: 0, data: '{"text":"hi"}' },
      { type: 'boot', chat_id: null, thread_id: null, data: null },
    ]);
  });
});
