import path from 'node:path';
import type { AgentDefinition } from './types.ts';

export type PermissionKind = 'read' | 'edit' | 'shell' | 'network';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface PermissionRequest {
  kind: PermissionKind;
  /** Absolute path. */
  path?: string;
  command?: string;
}

// Shell control characters: ; & | ` $( > < and line breaks.
const SHELL_META = /[;&|`<>\r\n]|\$\(/;

/** Static decision table per profile (ADR 0009). */
export function decidePermission(
  agent: Pick<AgentDefinition, 'folder' | 'profile' | 'allow'>,
  request: PermissionRequest,
): PermissionDecision {
  const { profile } = agent;
  if (profile === 'trusted') return 'allow';
  const inside = request.path !== undefined && isInside(agent.folder, request.path);

  if (request.kind === 'read') {
    if (request.path === undefined || inside) return 'allow';
    return profile === 'readonly' ? 'deny' : 'ask';
  }
  if (profile === 'readonly') return 'deny';

  switch (request.kind) {
    case 'edit':
      return inside ? 'allow' : 'ask';
    case 'shell':
      return request.command !== undefined && isAllowedCommand(agent.allow, request.command) ? 'allow' : 'ask';
    default:
      return 'ask';
  }
}

/** True if `target` (after resolving `..`) is `folder` itself or below it. */
function isInside(folder: string, target: string): boolean {
  const base = path.resolve(folder);
  const resolved = path.resolve(base, target);
  return resolved === base || resolved.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

/** Whole-word prefix match; any shell control character forces approval. */
function isAllowedCommand(allow: readonly string[], command: string): boolean {
  if (SHELL_META.test(command)) return false;
  return allow.some((prefix) => prefix !== '' && (command === prefix || command.startsWith(prefix + ' ')));
}
