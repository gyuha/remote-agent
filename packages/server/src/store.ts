import { DatabaseSync } from 'node:sqlite';

export interface TopicBinding {
  chatId: number;
  threadId: number;
  folder: string;
  agent: string;
  /** CLI session ID (Claude session_id / Codex threadId), set after the first turn. */
  cliSessionId?: string;
}

export interface StoreEvent {
  type: string;
  chatId?: number;
  threadId?: number;
  data?: unknown;
}

export interface Store {
  /** Binds a topic to an agent; rebinding replaces the agent and clears the CLI session. */
  bindTopic(binding: { chatId: number; threadId: number; folder: string; agent: string }): void;
  findBinding(chatId: number, threadId: number): TopicBinding | undefined;
  setSessionId(chatId: number, threadId: number, cliSessionId: string): void;
  /** Delegation topic (0011) of one (caller session, target agent) pair: its thread id in the group chat. */
  findDelegation(callerSession: string, agent: string): number | undefined;
  setDelegation(callerSession: string, agent: string, threadId: number): void;
  appendEvent(event: StoreEvent): void;
  close(): void;
}

/** Opens (and migrates) the SQLite store. `':memory:'` is allowed. */
export function openStore(file: string): Store {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bindings (
      chat_id INTEGER NOT NULL,
      thread_id INTEGER NOT NULL,
      folder TEXT NOT NULL,
      agent TEXT NOT NULL,
      cli_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      type TEXT NOT NULL,
      chat_id INTEGER,
      thread_id INTEGER,
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS delegations (
      caller_session TEXT NOT NULL,
      agent TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      PRIMARY KEY (caller_session, agent)
    );
  `);

  const upsertBinding = db.prepare(`
    INSERT INTO bindings (chat_id, thread_id, folder, agent) VALUES (?, ?, ?, ?)
    ON CONFLICT (chat_id, thread_id) DO UPDATE SET folder = excluded.folder, agent = excluded.agent, cli_session_id = NULL
  `);
  const selectBinding = db.prepare(
    'SELECT folder, agent, cli_session_id FROM bindings WHERE chat_id = ? AND thread_id = ?',
  );
  const updateSession = db.prepare('UPDATE bindings SET cli_session_id = ? WHERE chat_id = ? AND thread_id = ?');
  const selectDelegation = db.prepare('SELECT thread_id FROM delegations WHERE caller_session = ? AND agent = ?');
  const upsertDelegation = db.prepare(`
    INSERT INTO delegations (caller_session, agent, thread_id) VALUES (?, ?, ?)
    ON CONFLICT (caller_session, agent) DO UPDATE SET thread_id = excluded.thread_id
  `);
  const insertEvent = db.prepare('INSERT INTO events (type, chat_id, thread_id, data) VALUES (?, ?, ?, ?)');

  return {
    bindTopic({ chatId, threadId, folder, agent }) {
      upsertBinding.run(chatId, threadId, folder, agent);
    },
    findBinding(chatId, threadId) {
      const row = selectBinding.get(chatId, threadId) as
        | { folder: string; agent: string; cli_session_id: string | null }
        | undefined;
      if (!row) return undefined;
      return {
        chatId,
        threadId,
        folder: row.folder,
        agent: row.agent,
        ...(row.cli_session_id !== null && { cliSessionId: row.cli_session_id }),
      };
    },
    setSessionId(chatId, threadId, cliSessionId) {
      updateSession.run(cliSessionId, chatId, threadId);
    },
    findDelegation(callerSession, agent) {
      const row = selectDelegation.get(callerSession, agent) as { thread_id: number } | undefined;
      return row?.thread_id;
    },
    setDelegation(callerSession, agent, threadId) {
      upsertDelegation.run(callerSession, agent, threadId);
    },
    appendEvent({ type, chatId, threadId, data }) {
      insertEvent.run(type, chatId ?? null, threadId ?? null, data === undefined ? null : JSON.stringify(data));
    },
    close() {
      db.close();
    },
  };
}
