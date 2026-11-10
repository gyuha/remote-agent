import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const FAKE_CLAUDE = path.join(here, 'fakes', 'fake-claude.mjs');
export const FAKE_CODEX = path.join(here, 'fakes', 'fake-codex.mjs');
export const BRIDGE_SRC = path.join(ROOT, 'packages', 'server', 'src', 'mcp-bridge.ts');

/** MCP 브리지를 소스(TS)에서 바로 띄우는 명령. Node 22의 --experimental-strip-types를 쓴다. */
export function bridgeCommand(): { command: string; args: string[] } {
  return { command: process.execPath, args: ['--no-warnings', '--experimental-strip-types', BRIDGE_SRC] };
}

/** 임시 디렉토리(실제 경로로 정규화: macOS의 /var → /private/var). */
export function makeTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ra-${prefix}-`)));
}

export function writeAgent(folder: string, name: string, frontmatter: string, body = `${name} 역할 프롬프트`): void {
  const dir = path.join(folder, '.remote-agent', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), `---\n${frontmatter.trim()}\n---\n${body}\n`);
}

export type LogEntry = Record<string, any>;

export function readLog(file: string): LogEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** fn()이 참 같은 값을 돌려줄 때까지 기다린다. */
export async function waitUntil<T>(fn: () => T | undefined | null | false, timeoutMs = 10000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout ${timeoutMs}ms waiting for ${label}`);
    await sleep(25);
  }
}

/** 로그에 남은 가짜 CLI 프로세스 중 끝나지 않은 것을 정리한다(구현이 자식을 놓쳤을 때의 안전망). */
export function killLogged(file: string): void {
  const entries = readLog(file);
  const finished = new Set(entries.filter((e) => e.event === 'end' || e.event === 'exit').map((e) => e.pid));
  const pids = new Set(entries.filter((e) => e.event === 'start' || e.event === 'spawn').map((e) => e.pid));
  for (const pid of pids) {
    if (finished.has(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 이미 종료됨 */
    }
  }
}

export interface AgentLike {
  name: string;
  folder: string;
  cli: 'claude' | 'codex';
  model?: string;
  profile: 'readonly' | 'standard' | 'trusted';
  allow: string[];
  orchestrator: boolean;
  prompt: string;
}

export function agent(partial: Partial<AgentLike> & { folder: string }): AgentLike {
  return {
    name: 'dev',
    cli: 'claude',
    profile: 'standard',
    allow: [],
    orchestrator: false,
    prompt: '',
    ...partial,
  };
}
