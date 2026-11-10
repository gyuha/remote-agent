import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { createCodexAdapter, type CodexApprovalRequest } from '../src/index.ts';
import type { AgentDefinition, CliAdapter } from '../src/types.ts';

const FAKE_CODEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/acceptance/fakes/fake-codex.mjs');

describe('createCodexAdapter approvals', () => {
  const adapters: CliAdapter[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const a of adapters.splice(0)) await a.close();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const agentIn = (): AgentDefinition => {
    const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ra-codex-unit-')));
    dirs.push(folder);
    return { name: 'cx', folder, cli: 'codex', profile: 'standard', allow: [], orchestrator: false, prompt: '' };
  };

  test('routes command approvals to onApproval and maps the decision', async () => {
    const seen: CodexApprovalRequest[] = [];
    const answers = ['allow', 'allow_session', 'deny'] as const;
    const adapter = createCodexAdapter({
      bin: FAKE_CODEX,
      onApproval: async (req) => {
        seen.push(req);
        return answers[seen.length - 1];
      },
    });
    adapters.push(adapter);
    const agent = agentIn();
    const r1 = await adapter.runTurn({ agent, prompt: 'NEEDS_APPROVAL ls', chainId: 'c1', onEvent: () => {} });
    expect(r1.text).toBe('approved:ls');
    const r2 = await adapter.runTurn({ agent, prompt: 'NEEDS_APPROVAL ls', sessionId: r1.sessionId, chainId: 'c2', onEvent: () => {} });
    expect(r2.text).toBe('approved:ls');
    const r3 = await adapter.runTurn({ agent, prompt: 'NEEDS_APPROVAL rm', sessionId: r1.sessionId, chainId: 'c3', onEvent: () => {} });
    expect(r3.text).toBe('denied:rm');
    expect(seen[0]).toMatchObject({ agent, sessionId: r1.sessionId, chainId: 'c1', kind: 'shell', command: 'ls', cwd: agent.folder });
    expect(seen.map((s) => s.chainId)).toEqual(['c1', 'c2', 'c3']);
  });

  test('declines when no onApproval is given or it throws', async () => {
    const plain = createCodexAdapter({ bin: FAKE_CODEX });
    const throwing = createCodexAdapter({
      bin: FAKE_CODEX,
      onApproval: async () => {
        throw new Error('broker down');
      },
    });
    adapters.push(plain, throwing);
    for (const adapter of [plain, throwing]) {
      const r = await adapter.runTurn({ agent: agentIn(), prompt: 'NEEDS_APPROVAL ls', chainId: 'c', onEvent: () => {} });
      expect(r.text).toBe('denied:ls');
    }
  });

  test('fails the turn with an error event when the process cannot start', async () => {
    const adapter = createCodexAdapter({ bin: path.join(os.tmpdir(), 'no-such-codex-binary') });
    adapters.push(adapter);
    const events: unknown[] = [];
    await expect(adapter.runTurn({ agent: agentIn(), prompt: 'hi', chainId: 'c', onEvent: (e) => events.push(e) })).rejects.toThrow();
    expect(events).toEqual([expect.objectContaining({ type: 'error' })]);
  });
});
