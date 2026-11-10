// Telegram gateway (0001, 0007): long polling → topic binding → folder lock → CLI turn → reply,
// with tool approvals (0009) relayed to an inline keyboard and an internal HTTP bridge for the MCP bridge.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { loadAgents } from './agents.ts';
import { createApprovalBroker, type ApprovalDecision, type PendingApproval } from './approvals.ts';
import { createClaudeAdapter } from './claude.ts';
import { createCodexAdapter } from './codex.ts';
import { createLockManager } from './locks.ts';
import { decidePermission, type PermissionRequest } from './permissions.ts';
import { openStore, type Store } from './store.ts';
import {
  createTelegramClient,
  splitMessage,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from './telegram.ts';
import type { AgentDefinition, CliAdapter } from './types.ts';

export interface AppConfig {
  dataDir: string;
  telegram: {
    token: string;
    apiBase?: string;
    ownerId: number;
    groupChatId: number;
    defaultAgent?: { folder: string; name: string };
  };
  folders: string[];
  cli?: { claudeBin?: string; codexBin?: string };
  approvalTimeoutMs?: number;
  /** How Claude launches the MCP bridge. Default: `node <this package>/dist/mcp-bridge.js`. */
  mcpBridge?: { command: string; args: string[] };
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Internal HTTP bridge (127.0.0.1) once started. */
  readonly bridgeUrl: string | undefined;
}

/** Where a session's output goes. `threadId` is unset for DMs. */
interface Target {
  chatId: number;
  threadId?: number;
}

/** One turn's call chain: who is calling the bridge / Codex approvals, and where to ask. */
interface Chain {
  agent: AgentDefinition;
  target: Target;
  /** `allow_session` scope = one topic binding (0009). */
  sessionKey: string;
  /** Write-lock owner (0011): the chainId of the user turn that started this call chain. */
  root: string;
  /** Agents that delegated down to this turn, outermost first (self/cycle guard for send_to_agent). */
  callers: string[];
}

/** A send_to_agent refusal: surfaced to the calling agent as a tool error. */
class ToolError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const POLL_TIMEOUT_SEC = 30;
/** Store key for the DM session: (owner chat, thread 0). */
const DM_THREAD = 0;
const CALLBACK = /^ap:([^:]+):(allow|session|deny)$/;
const DECISION_LABEL: Record<ApprovalDecision, string> = { allow: '허용함', allow_session: '세션 동안 허용함', deny: '거부함' };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Claude tool → permission request (architecture "MCP 브리지"). Unknown tools → undefined (always ask). */
function claudeRequest(tool: string, input: Record<string, unknown>): PermissionRequest | undefined {
  if (tool === 'Bash') return { kind: 'shell', command: str(input.command) };
  if (EDIT_TOOLS.has(tool)) return { kind: 'edit', path: str(input.file_path) ?? str(input.notebook_path) };
  if (READ_TOOLS.has(tool)) return { kind: 'read', path: str(input.file_path) ?? str(input.path) };
  if (NETWORK_TOOLS.has(tool)) return { kind: 'network' };
  return undefined;
}

function defaultBridge(): { command: string; args: string[] } {
  return { command: process.execPath, args: [fileURLToPath(new URL('../dist/mcp-bridge.js', import.meta.url))] };
}

export function createApp(config: AppConfig): App {
  const { ownerId, groupChatId, defaultAgent } = config.telegram;
  const folders = config.folders.map((f) => path.resolve(f));
  const tg = createTelegramClient({ token: config.telegram.token, apiBase: config.telegram.apiBase });
  const broker = createApprovalBroker({ timeoutMs: config.approvalTimeoutMs });
  const locks = createLockManager();
  const chains = new Map<string, Chain>();
  /** Per-session turn queue: turns of one session never overlap (one CLI session, one turn at a time). */
  const sessionQueues = new Map<string, Promise<void>>();
  /** Update handlers and turns still running; stop() waits for them before closing the store. */
  const inflight = new Set<Promise<void>>();
  const abort = new AbortController();

  let store: Store;
  let server: http.Server;
  let claude: CliAdapter;
  let codex: CliAdapter;
  let pollLoop: Promise<void> | undefined;
  let bridgeUrl: string | undefined;
  let started = false;
  let stopped = false;

  const logError = (what: string) => (err: unknown) => {
    if (!stopped) console.error(`[remote-agent] ${what}:`, err instanceof Error ? err.message : err);
  };

  function track(p: Promise<unknown>): void {
    const settled = p.then(() => undefined, logError('update handler'));
    inflight.add(settled);
    void settled.finally(() => inflight.delete(settled));
  }

  async function send(target: Target, text: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    let last: unknown;
    for (const chunk of splitMessage(text)) {
      if (!chunk.trim()) continue;
      last = await tg.call('sendMessage', {
        chat_id: target.chatId,
        ...(target.threadId !== undefined && { message_thread_id: target.threadId }),
        text: chunk,
        ...extra,
      });
    }
    return last;
  }

  // ---- approvals ----------------------------------------------------------------------------

  /** Profile table first (0009); only 'ask' reaches the owner. */
  function authorize(chain: Chain, request: PermissionRequest | undefined, tool: string, detail?: string): Promise<ApprovalDecision> {
    const decision = request ? decidePermission(chain.agent, request) : 'ask';
    if (decision !== 'ask') return Promise.resolve(decision);
    if (stopped) return Promise.resolve('deny');
    return broker.request({
      sessionId: chain.sessionKey,
      kind: request?.kind ?? 'tool',
      ...(request?.command !== undefined && { command: request.command }),
      ...(request?.path !== undefined && { path: request.path }),
      tool,
      agent: chain.agent.name,
      target: chain.target,
      ...(detail !== undefined && { detail }),
    });
  }

  broker.on('request', (req: PendingApproval) => {
    const target = req.target as Target;
    const subject = req.command ?? req.path ?? (req.detail as string | undefined) ?? '';
    const text = `승인 요청 · ${String(req.agent)} · ${req.kind === 'tool' ? String(req.tool) : req.kind}\n${subject}`.slice(0, 4000);
    const button = (label: string, action: string) => ({ text: label, callback_data: `ap:${req.id}:${action}` });
    send(target, text, {
      reply_markup: { inline_keyboard: [[button('허용', 'allow'), button('세션 동안 허용', 'session'), button('거부', 'deny')]] },
    }).catch((err: unknown) => {
      logError('approval keyboard')(err);
      broker.respond(req.id, 'deny');
    });
  });

  async function onCallback(cb: TelegramCallbackQuery): Promise<void> {
    if (cb.from.id !== ownerId) return;
    const m = CALLBACK.exec(cb.data ?? '');
    let text = '알 수 없는 버튼입니다';
    if (m) {
      const decision: ApprovalDecision = m[2] === 'session' ? 'allow_session' : (m[2] as 'allow' | 'deny');
      text = broker.respond(m[1], decision) ? DECISION_LABEL[decision] : '이미 처리되었거나 만료된 요청입니다';
    }
    await tg.call('answerCallbackQuery', { callback_query_id: cb.id, text });
  }

  // ---- turns --------------------------------------------------------------------------------

  function enqueue(sessionKey: string, job: () => Promise<void>): Promise<void> {
    const next = (sessionQueues.get(sessionKey) ?? Promise.resolve()).then(job).catch(logError('turn'));
    sessionQueues.set(sessionKey, next);
    track(next);
    void next.finally(() => {
      if (sessionQueues.get(sessionKey) === next) sessionQueues.delete(sessionKey);
    });
    return next;
  }

  /**
   * Runs one CLI turn of the session stored at (target.chatId, storeThread) and returns its final text.
   * `parent` is the delegating turn's chain (send_to_agent); the sub-turn gets its own chainId for the
   * bridge but locks with the parent's root, so the lock re-enters instead of deadlocking (0011).
   */
  async function turn(target: Target, storeThread: number, prompt: string, parent?: Chain): Promise<string> {
    const binding = store.findBinding(target.chatId, storeThread);
    if (!binding) throw new Error('이 토픽은 세션에 연결되어 있지 않습니다.');
    const agent = (await loadAgents(binding.folder)).find((a) => a.name === binding.agent);
    if (!agent) throw new Error(`에이전트 ${binding.agent}을(를) ${binding.folder}에서 찾을 수 없습니다.`);
    const chainId = randomUUID();
    chains.set(chainId, {
      agent,
      target,
      sessionKey: `${target.chatId}:${storeThread}`,
      root: parent?.root ?? chainId,
      callers: parent ? [...parent.callers, parent.agent.name] : [],
    });
    let release: (() => void) | undefined;
    try {
      // Write turns hold the folder lock until the CLI process is gone (0010); readonly turns run in parallel.
      if (agent.profile !== 'readonly') release = await locks.acquire(agent.folder, parent?.root ?? chainId);
      if (stopped) throw new Error('remote-agent is stopping');
      const adapter = agent.cli === 'codex' ? codex : claude;
      const result = await adapter.runTurn({
        agent,
        prompt,
        ...(binding.cliSessionId !== undefined && { sessionId: binding.cliSessionId }),
        chainId,
        onEvent: () => {},
      });
      if (result.sessionId) store.setSessionId(target.chatId, storeThread, result.sessionId);
      return result.text;
    } finally {
      release?.();
      chains.delete(chainId);
    }
  }

  /** A user turn: runs it and replies to `target`. */
  async function runTurn(target: Target, storeThread: number, prompt: string): Promise<void> {
    if (stopped) return;
    try {
      const text = await turn(target, storeThread, prompt);
      if (!stopped) await send(target, text.trim() ? text : '(빈 응답)');
    } catch (err) {
      if (!stopped) await send(target, `오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * send_to_agent (0011): one synchronous turn of `name` (same folder) in the delegation topic of
   * (caller session, target agent), created on first use so the sub-agent's session resumes across delegations.
   */
  async function delegate(caller: Chain, name: string, message: string): Promise<string> {
    if (!name || !message) throw new ToolError(400, 'send_to_agent needs non-empty "name" and "message"');
    const folder = caller.agent.folder;
    const agent = (await loadAgents(folder)).find((a) => a.name === name);
    if (!agent) throw new ToolError(404, `no agent "${name}" in ${folder} (send_to_agent only reaches agents in the same folder)`);
    if (name === caller.agent.name) throw new ToolError(409, `an agent cannot send_to_agent itself ("${name}")`);
    if (caller.callers.includes(name)) {
      throw new ToolError(409, `delegation cycle: "${name}" is already waiting in this call chain (${[...caller.callers, caller.agent.name].join(' → ')})`);
    }

    let threadId = store.findDelegation(caller.sessionKey, name);
    const bound = threadId === undefined ? undefined : store.findBinding(groupChatId, threadId);
    if (threadId === undefined || bound?.folder !== folder || bound.agent !== name) {
      const topic = await tg.call<{ message_thread_id: number }>('createForumTopic', {
        chat_id: groupChatId,
        name: `${caller.agent.name} → ${name}`,
      });
      threadId = topic.message_thread_id;
      store.bindTopic({ chatId: groupChatId, threadId, folder, agent: name });
      store.setDelegation(caller.sessionKey, name, threadId);
    }
    const thread = threadId;
    const target: Target = { chatId: groupChatId, threadId: thread };
    const key = `${groupChatId}:${thread}`;
    // Never wait on a busy sub-session: the turn holding it may itself wait for this chain's lock.
    if (sessionQueues.has(key)) throw new ToolError(409, `agent "${name}" is busy with another turn in its delegation topic; try again later`);

    const outcome: { text?: string; error?: unknown } = {};
    await enqueue(key, async () => {
      try {
        await send(target, `📨 ${caller.agent.name}:\n${message}`);
        const text = await turn(target, thread, message, caller);
        outcome.text = text;
        if (!stopped) await send(target, text.trim() ? text : '(빈 응답)');
      } catch (err) {
        outcome.error = err;
        if (!stopped) await send(target, `오류: ${err instanceof Error ? err.message : String(err)}`).catch(logError('delegation reply'));
      }
    });
    if (outcome.text === undefined) throw outcome.error ?? new Error('delegated turn did not run');
    return outcome.text;
  }

  async function createTopic(target: Target, spec: string): Promise<void> {
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(spec);
    if (!m) {
      await send(target, '사용법: /new <폴더>/<에이전트>');
      return;
    }
    const [, folderName, agentName] = m;
    const folder = folders.find((f) => path.basename(f) === folderName);
    if (!folder) {
      await send(target, `알 수 없는 폴더: ${folderName} (가능: ${folders.map((f) => path.basename(f)).join(', ')})`);
      return;
    }
    const agents = await loadAgents(folder);
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) {
      await send(target, `${folderName}에 에이전트 ${agentName}이(가) 없습니다 (가능: ${agents.map((a) => a.name).join(', ')})`);
      return;
    }
    const topic = await tg.call<{ message_thread_id: number }>('createForumTopic', { chat_id: groupChatId, name: spec });
    store.bindTopic({ chatId: groupChatId, threadId: topic.message_thread_id, folder, agent: agentName });
    await send(
      { chatId: groupChatId, threadId: topic.message_thread_id },
      `새 세션: ${spec}\n이 토픽의 메시지는 ${agent.cli} 에이전트 ${agentName}(${agent.profile})이 ${folder}에서 처리합니다.`,
    );
  }

  async function onMessage(msg: TelegramMessage): Promise<void> {
    const text = msg.text;
    if (msg.from?.id !== ownerId || !text) return;
    if (msg.chat.id === groupChatId) {
      const threadId = msg.message_thread_id;
      const target: Target = { chatId: groupChatId, ...(threadId !== undefined && { threadId }) };
      const cmd = /^\/new(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
      if (cmd) return createTopic(target, (cmd[1] ?? '').trim()).catch(async (err: unknown) => {
        await send(target, `토픽을 만들지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      });
      if (threadId === undefined) return; // General topic: no session lives here
      if (!store.findBinding(groupChatId, threadId)) {
        await send(target, '이 토픽은 세션에 연결되어 있지 않습니다. /new <폴더>/<에이전트>로 새 토픽을 만드세요.');
        return;
      }
      enqueue(`${groupChatId}:${threadId}`, () => runTurn(target, threadId, text));
      return;
    }
    if (msg.chat.type === 'private') {
      const target: Target = { chatId: msg.chat.id };
      if (!defaultAgent) {
        await send(target, 'defaultAgent가 설정되지 않았습니다. 그룹에서 /new <폴더>/<에이전트>를 쓰세요.');
        return;
      }
      const folder = path.resolve(defaultAgent.folder);
      const existing = store.findBinding(msg.chat.id, DM_THREAD);
      if (existing?.folder !== folder || existing.agent !== defaultAgent.name) {
        store.bindTopic({ chatId: msg.chat.id, threadId: DM_THREAD, folder, agent: defaultAgent.name });
      }
      enqueue(`${msg.chat.id}:${DM_THREAD}`, () => runTurn(target, DM_THREAD, text));
    }
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return onCallback(update.callback_query);
    if (update.message) return onMessage(update.message);
  }

  /** Long polling (0001): handlers are not awaited, so a long turn never blocks other topics or buttons. */
  async function poll(): Promise<void> {
    let offset: number | undefined;
    while (!stopped) {
      let updates: TelegramUpdate[];
      try {
        updates = await tg.getUpdates(offset, POLL_TIMEOUT_SEC, abort.signal);
      } catch (err) {
        if (stopped) return;
        logError('getUpdates')(err);
        await sleep(1000, undefined, { signal: abort.signal }).catch(() => {});
        continue;
      }
      for (const update of updates) {
        offset = update.update_id + 1;
        track(handleUpdate(update));
      }
    }
  }

  // ---- internal HTTP bridge (contract: mcp-bridge.ts header) -------------------------------

  const reply = (res: http.ServerResponse, status: number, body: object) => {
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    let data = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 1_000_000) throw new Error('request body too large');
    }
    const parsed: unknown = JSON.parse(data || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  }

  async function onBridgeRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' });
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch (err) {
      return reply(res, 400, { error: (err as Error).message });
    }
    const chain = chains.get(String(body.chainId ?? ''));
    switch (req.url) {
      case '/approve': {
        if (!chain) return reply(res, 200, { behavior: 'deny', message: 'remote-agent: unknown call chain' });
        const tool = String(body.tool_name ?? '');
        const input = body.input && typeof body.input === 'object' ? (body.input as Record<string, unknown>) : {};
        const request = claudeRequest(tool, input);
        const detail = request ? (request.kind === 'network' ? (str(input.url) ?? str(input.query)) : undefined) : JSON.stringify(input).slice(0, 1000);
        const decision = await authorize(chain, request, tool, detail);
        return reply(res, 200, decision === 'deny' ? { behavior: 'deny', message: 'Denied by remote-agent' } : { behavior: 'allow' });
      }
      case '/tools/list_agents':
      case '/tools/send_to_agent': {
        const name = req.url.slice('/tools/'.length);
        if (!chain) return reply(res, 404, { error: 'remote-agent: unknown call chain' });
        if (!chain.agent.orchestrator) return reply(res, 403, { error: `${name} is only available to orchestrator agents` });
        if (name === 'list_agents') {
          const agents = await loadAgents(chain.agent.folder);
          return reply(res, 200, { text: agents.map((a) => `${a.name} (${a.cli}, ${a.profile})`).join('\n') });
        }
        const args = body.arguments && typeof body.arguments === 'object' ? (body.arguments as Record<string, unknown>) : {};
        try {
          return reply(res, 200, { text: await delegate(chain, str(args.name) ?? '', str(args.message) ?? '') });
        } catch (err) {
          const status = err instanceof ToolError ? err.status : 500;
          return reply(res, status, { error: `send_to_agent: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      default:
        return reply(res, 404, { error: `unknown route ${req.url}` });
    }
  }

  // ---- lifecycle ----------------------------------------------------------------------------

  return {
    get bridgeUrl() {
      return bridgeUrl;
    },

    async start() {
      if (started) throw new Error('app already started');
      started = true;
      fs.mkdirSync(config.dataDir, { recursive: true });
      store = openStore(path.join(config.dataDir, 'remote-agent.db'));

      server = http.createServer((req, res) => {
        onBridgeRequest(req, res).catch((err: unknown) => reply(res, 500, { error: err instanceof Error ? err.message : String(err) }));
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      bridgeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const bridge = config.mcpBridge ?? defaultBridge();
      claude = createClaudeAdapter({
        bin: config.cli?.claudeBin,
        mcp: { command: bridge.command, args: bridge.args, env: { REMOTE_AGENT_BRIDGE_URL: bridgeUrl } },
      });
      codex = createCodexAdapter({
        bin: config.cli?.codexBin,
        onApproval: async (req) => {
          const chain = chains.get(req.chainId);
          if (!chain) return 'deny';
          const request: PermissionRequest = { kind: req.kind, command: req.command, path: req.path };
          return authorize(chain, request, req.kind, req.paths?.join(', '));
        },
      });

      pollLoop = poll();
    },

    async stop() {
      if (!started || stopped) return;
      stopped = true;
      abort.abort();
      await pollLoop;
      for (const p of broker.pending()) broker.respond(p.id, 'deny');
      await Promise.all([claude.close(), codex.close()]);
      while (inflight.size > 0) await Promise.all([...inflight]);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
