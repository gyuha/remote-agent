import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PermissionKind } from './permissions.ts';

export type ApprovalDecision = 'allow' | 'allow_session' | 'deny';

export interface ApprovalInfo {
  sessionId: string;
  /** `'tool'`: a tool with no permission kind (unknown Claude tool); scoped by the `tool` field. */
  kind: PermissionKind | 'tool';
  command?: string;
  path?: string;
  /** Extra display-only fields. */
  [key: string]: unknown;
}

export type PendingApproval = ApprovalInfo & { id: string };

export interface ApprovalBroker {
  request(info: ApprovalInfo): Promise<ApprovalDecision>;
  /** Returns false if `id` is unknown or already settled. */
  respond(id: string, decision: ApprovalDecision): boolean;
  pending(): PendingApproval[];
  on(event: 'request', listener: (request: PendingApproval) => void): void;
}

export interface ApprovalBrokerOptions {
  timeoutMs?: number;
}

interface Entry {
  request: PendingApproval;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** `allow_session` scope: shell → same first word of the command, tool → same tool name, otherwise same kind. */
function scopeKey(info: ApprovalInfo): string {
  if (info.kind === 'tool') return `tool ${String(info.tool)}`;
  if (info.kind !== 'shell') return info.kind;
  return `shell ${(info.command ?? '').trim().split(/\s+/)[0]}`;
}

export function createApprovalBroker({ timeoutMs = 30 * 60 * 1000 }: ApprovalBrokerOptions = {}): ApprovalBroker {
  const emitter = new EventEmitter();
  const entries = new Map<string, Entry>();
  const sessionGrants = new Map<string, Set<string>>();

  function settle(id: string, decision: ApprovalDecision): boolean {
    const entry = entries.get(id);
    if (!entry) return false;
    entries.delete(id);
    clearTimeout(entry.timer);
    if (decision === 'allow_session') {
      const { sessionId } = entry.request;
      if (!sessionGrants.has(sessionId)) sessionGrants.set(sessionId, new Set());
      sessionGrants.get(sessionId)!.add(scopeKey(entry.request));
    }
    entry.resolve(decision);
    return true;
  }

  return {
    request(info) {
      if (sessionGrants.get(info.sessionId)?.has(scopeKey(info))) return Promise.resolve('allow');
      // 32 hex chars: no ':' and well under Telegram's 64-byte callback_data limit.
      const id = randomUUID().replaceAll('-', '');
      const request: PendingApproval = { ...info, id };
      const promise = new Promise<ApprovalDecision>((resolve) => {
        entries.set(id, { request, resolve, timer: setTimeout(() => settle(id, 'deny'), timeoutMs) });
      });
      emitter.emit('request', request);
      return promise;
    },
    respond: settle,
    pending: () => [...entries.values()].map((e) => e.request),
    on(event, listener) {
      emitter.on(event, listener);
    },
  };
}
