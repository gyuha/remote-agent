import { spawn, type ChildProcess } from 'node:child_process';
import { JsonRpcError, METHOD_NOT_FOUND, createJsonRpcClient, type JsonRpcClient } from './jsonrpc.ts';
import type { AgentDefinition, CliAdapter, Profile, RunTurnOptions, TurnEvent, TurnResult } from './types.ts';

/** What the app sees when app-server asks to run a command or apply a file change. */
export interface CodexApprovalRequest {
  agent: AgentDefinition;
  /** The thread ID (= session ID). */
  sessionId: string;
  chainId: string;
  kind: 'shell' | 'edit';
  command?: string;
  /** Set for edits that touch exactly one file; otherwise see `paths`. */
  path?: string;
  /** Every file a file change touches (as far as the adapter saw them). */
  paths?: string[];
  cwd?: string;
  reason?: string;
}

export type CodexApprovalDecision = 'allow' | 'allow_session' | 'deny';

export interface CodexAdapterOptions {
  bin?: string;
  /** Decides app-server approval requests. Absent → every request is declined. */
  onApproval?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision>;
}

const SANDBOX: Record<Profile, string> = {
  readonly: 'read-only',
  standard: 'workspace-write',
  trusted: 'danger-full-access',
};

const DECISION: Record<CodexApprovalDecision, string> = {
  allow: 'accept',
  allow_session: 'acceptForSession',
  deny: 'decline',
};

interface ActiveTurn {
  options: RunTurnOptions;
  threadId: string;
  /** Agent message text per item ID, in arrival order. */
  messages: Map<string, string>;
  /** Paths of fileChange items seen in this turn, by item ID. */
  fileChanges: Map<string, string[]>;
  resolve: (r: TurnResult) => void;
  reject: (e: Error) => void;
}

interface Connection {
  child: ChildProcess;
  rpc: JsonRpcClient;
  ready: Promise<void>;
  knownThreads: Set<string>;
  closed: Promise<void>;
}

type Params = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One long-lived `codex app-server` per folder; a session is a thread (0008). */
export function createCodexAdapter(options: CodexAdapterOptions = {}): CliAdapter {
  const bin = options.bin ?? 'codex';
  const connections = new Map<string, Connection>();
  /** Running turns by thread ID (thread IDs are unique across processes). */
  const turns = new Map<string, ActiveTurn>();

  function connect(folder: string): Connection {
    const existing = connections.get(folder);
    if (existing) return existing;

    const child = spawn(bin, ['app-server'], { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    const knownThreads = new Set<string>();
    const rpc = createJsonRpcClient({
      input: child.stdout!,
      output: child.stdin!,
      onNotification: (method, params) => onNotification(method, params as Params),
      onRequest: (method, params) => onServerRequest(method, params as Params),
    });

    const closed = new Promise<void>((resolve) => {
      const onGone = (reason: string) => {
        if (connections.get(folder) === conn) connections.delete(folder);
        const error = new Error(`${bin} app-server ${reason}${stderr ? `: ${stderr.trim()}` : ''}`);
        rpc.close(error);
        for (const [threadId, turn] of turns) {
          if (knownThreads.has(threadId)) failTurn(turn, error.message);
        }
        resolve();
      };
      child.on('error', (err) => onGone(`failed to start: ${err.message}`));
      child.on('close', (code, signal) => onGone(`exited (code=${code} signal=${signal})`));
    });
    child.stdin!.on('error', () => {
      /* the child went away; 'close' reports it */
    });

    const ready = (async () => {
      await rpc.request('initialize', { clientInfo: { name: 'remote-agent', version: '0.0.0' } });
      rpc.notify('initialized');
    })();
    // A process that cannot initialize is useless: kill it so the next turn spawns a fresh one.
    ready.catch(() => child.kill('SIGTERM'));

    const conn: Connection = { child, rpc, ready, knownThreads, closed };
    connections.set(folder, conn);
    return conn;
  }

  function finishTurn(turn: ActiveTurn) {
    if (turns.get(turn.threadId) === turn) turns.delete(turn.threadId);
  }

  function failTurn(turn: ActiveTurn, message: string) {
    finishTurn(turn);
    turn.options.onEvent({ type: 'error', message });
    turn.reject(new Error(message));
  }

  function onNotification(method: string, params: Params) {
    const turn = turns.get(str(params?.threadId) ?? '');
    if (!turn) return;
    const emit = (e: TurnEvent) => turn.options.onEvent(e);
    switch (method) {
      case 'item/agentMessage/delta': {
        const itemId = str(params?.itemId) ?? '';
        const delta = str(params?.delta) ?? '';
        turn.messages.set(itemId, (turn.messages.get(itemId) ?? '') + delta);
        if (delta) emit({ type: 'text', text: delta });
        return;
      }
      case 'item/started': {
        const item = params?.item as { type?: string; id?: string; changes?: { path?: unknown }[] } | undefined;
        if (item?.type === 'fileChange' && typeof item.id === 'string') {
          turn.fileChanges.set(item.id, (item.changes ?? []).map((c) => str(c?.path)).filter((p): p is string => !!p));
        }
        if (item?.type === 'commandExecution') emit({ type: 'tool', name: 'shell' });
        else if (item?.type === 'fileChange') emit({ type: 'tool', name: 'edit' });
        return;
      }
      case 'turn/completed': {
        const t = params?.turn as { status?: string; error?: { message?: unknown } } | undefined;
        if (t?.status && t.status !== 'completed') {
          failTurn(turn, str(t.error?.message) ?? `codex turn ${t.status}`);
          return;
        }
        finishTurn(turn);
        emit({ type: 'done' });
        turn.resolve({ sessionId: turn.threadId, text: [...turn.messages.values()].filter(Boolean).join('\n\n') });
        return;
      }
    }
  }

  async function onServerRequest(method: string, params: Params): Promise<unknown> {
    let kind: 'shell' | 'edit';
    if (method === 'item/commandExecution/requestApproval') kind = 'shell';
    else if (method === 'item/fileChange/requestApproval') kind = 'edit';
    else throw new JsonRpcError(METHOD_NOT_FOUND, `method not found: ${method}`);

    const turn = turns.get(str(params?.threadId) ?? '');
    if (!turn || !options.onApproval) return { decision: 'decline' };
    const request: CodexApprovalRequest = {
      agent: turn.options.agent,
      sessionId: turn.threadId,
      chainId: turn.options.chainId,
      kind,
    };
    const cwd = str(params?.cwd);
    if (cwd) request.cwd = cwd;
    const reason = str(params?.reason);
    if (reason) request.reason = reason;
    if (kind === 'shell') {
      const command = str(params?.command);
      if (command !== undefined) request.command = command;
    } else {
      // A grantRoot asks for write access to a whole tree: leave `path` unset so the app has to ask.
      const paths = turn.fileChanges.get(str(params?.itemId) ?? '') ?? [];
      request.paths = paths;
      if (paths.length === 1 && params?.grantRoot == null) request.path = paths[0];
    }
    let decision: CodexApprovalDecision;
    try {
      decision = await options.onApproval(request);
    } catch {
      decision = 'deny';
    }
    return { decision: DECISION[decision] ?? 'decline' };
  }

  /** Connects, then opens, resumes or reuses the thread. */
  async function prepare({ agent, sessionId }: RunTurnOptions): Promise<{ conn: Connection; threadId: string }> {
    const conn = connect(agent.folder);
    await conn.ready;
    const threadParams: Record<string, unknown> = {
      cwd: agent.folder,
      approvalPolicy: 'untrusted',
      sandbox: SANDBOX[agent.profile],
    };
    if (agent.model) threadParams.model = agent.model;

    let threadId = sessionId;
    if (!threadId) {
      if (agent.prompt) threadParams.developerInstructions = agent.prompt;
      const res = (await conn.rpc.request('thread/start', threadParams)) as { thread?: { id?: unknown } } | undefined;
      threadId = str(res?.thread?.id);
      if (!threadId) throw new Error('codex thread/start returned no thread id');
      conn.knownThreads.add(threadId);
    } else if (!conn.knownThreads.has(threadId)) {
      await conn.rpc.request('thread/resume', { threadId, ...threadParams });
      conn.knownThreads.add(threadId);
    }
    if (turns.has(threadId)) throw new Error(`a turn is already running on codex thread ${threadId}`);
    return { conn, threadId };
  }

  async function runTurn(turnOptions: RunTurnOptions): Promise<TurnResult> {
    let prepared: { conn: Connection; threadId: string };
    try {
      prepared = await prepare(turnOptions);
    } catch (err) {
      turnOptions.onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    const { conn, threadId } = prepared;
    // Registered before turn/start so no notification can slip past.
    let turn!: ActiveTurn;
    const done = new Promise<TurnResult>((resolve, reject) => {
      turn = { options: turnOptions, threadId, messages: new Map(), fileChanges: new Map(), resolve, reject };
    });
    turns.set(threadId, turn);
    conn.rpc.request('turn/start', { threadId, input: [{ type: 'text', text: turnOptions.prompt }] }).catch((err: Error) => {
      if (turns.get(threadId) === turn) failTurn(turn, `codex turn/start failed: ${err.message}`);
    });
    return done;
  }

  async function close(): Promise<void> {
    await Promise.all(
      [...connections.values()].map((conn) => {
        conn.child.stdin?.end();
        conn.child.kill('SIGTERM');
        return conn.closed;
      }),
    );
  }

  return { runTurn, close };
}
