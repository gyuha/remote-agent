import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CliAdapter, RunTurnOptions, TurnResult } from './types.ts';

export interface McpServerCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClaudeAdapterOptions {
  bin?: string;
  /** How Claude should launch the remote_agent MCP bridge. */
  mcp: McpServerCommand;
}

/** The subset of Claude's stream-json lines the adapter reads. */
interface StreamMessage {
  type?: string;
  subtype?: string;
  session_id?: unknown;
  is_error?: boolean;
  result?: unknown;
  message?: { content?: { type?: string; text?: unknown; name?: unknown }[] };
}

/** Removed from the child environment so Claude uses the subscription login (0014). */
const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/** One `claude -p` process per turn; `--resume` carries the session across turns (0008). */
export function createClaudeAdapter(options: ClaudeAdapterOptions): CliAdapter {
  const bin = options.bin ?? 'claude';
  const children = new Set<ChildProcess>();

  async function runTurn({ agent, prompt, sessionId, chainId, onEvent }: RunTurnOptions): Promise<TurnResult> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-mcp-'));
    const configFile = path.join(dir, 'mcp.json');
    const server = { command: options.mcp.command, args: options.mcp.args, env: { ...options.mcp.env, REMOTE_AGENT_CHAIN_ID: chainId } };
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { remote_agent: server } }));

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'mcp__remote_agent__approve',
      '--mcp-config', configFile,
    ];
    if (sessionId) args.push('--resume', sessionId);
    if (agent.model) args.push('--model', agent.model);
    if (agent.prompt) args.push('--append-system-prompt', agent.prompt);

    const env = { ...process.env };
    for (const key of STRIPPED_ENV) delete env[key];

    const child = spawn(bin, args, { cwd: agent.folder, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);

    let result: { sessionId: string; text: string; isError: boolean } | undefined;
    let lastSessionId = sessionId;
    let stderr = '';
    let buf = '';

    const handleLine = (line: string) => {
      let msg: StreamMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof msg.session_id === 'string') lastSessionId = msg.session_id;
      if (msg.type === 'assistant') {
        for (const part of msg.message?.content ?? []) {
          if (part?.type === 'text' && typeof part.text === 'string') onEvent({ type: 'text', text: part.text });
          else if (part?.type === 'tool_use' && typeof part.name === 'string') onEvent({ type: 'tool', name: part.name });
        }
      } else if (msg.type === 'result') {
        result = {
          sessionId: typeof msg.session_id === 'string' ? msg.session_id : (lastSessionId ?? ''),
          text: typeof msg.result === 'string' ? msg.result : '',
          isError: msg.is_error === true || (typeof msg.subtype === 'string' && msg.subtype !== 'success'),
        };
      }
    };

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleLine(line);
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    // Resolve on process exit, not on the `result` line: the caller holds the folder lock until the CLI is gone.
    return new Promise<TurnResult>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        onEvent({ type: 'error', message });
        reject(new Error(message));
      };
      child.on('error', (err) => {
        children.delete(child);
        fs.rmSync(dir, { recursive: true, force: true });
        fail(`failed to start ${bin}: ${err.message}`);
      });
      child.on('close', (code, signal) => {
        children.delete(child);
        fs.rmSync(dir, { recursive: true, force: true });
        if (buf.trim()) handleLine(buf.trim());
        if (result && !result.isError) {
          if (settled) return;
          settled = true;
          onEvent({ type: 'done' });
          resolve({ sessionId: result.sessionId, text: result.text });
        } else if (result) {
          fail(result.text || 'claude reported an error');
        } else {
          fail(`claude exited without a result (code=${code} signal=${signal})${stderr ? `: ${stderr.trim()}` : ''}`);
        }
      });
    });
  }

  async function close(): Promise<void> {
    await Promise.all(
      [...children].map(
        (child) =>
          new Promise<void>((resolve) => {
            child.once('close', () => resolve());
            child.kill('SIGTERM');
          }),
      ),
    );
  }

  return { runTurn, close };
}
