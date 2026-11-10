import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition, CliKind, Profile } from './types.ts';

const CLIS: readonly CliKind[] = ['claude', 'codex'];
const PROFILES: readonly Profile[] = ['readonly', 'standard', 'trusted'];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Loads `<folder>/.remote-agent/agents/*.md`, sorted by name. Missing directory → []. */
export async function loadAgents(folder: string): Promise<AgentDefinition[]> {
  const dir = path.join(folder, '.remote-agent', 'agents');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
    throw err;
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
  const agents = await Promise.all(
    files.map(async (file) => parseAgent(folder, file, await fs.readFile(path.join(dir, file), 'utf8'))),
  );
  return agents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function parseAgent(folder: string, file: string, source: string): AgentDefinition {
  const fail = (msg: string): never => {
    throw new Error(`${file}: ${msg}`);
  };
  const match = FRONTMATTER.exec(source);
  if (!match) fail('missing YAML frontmatter');
  let meta: unknown;
  try {
    meta = parseYaml(match![1]) ?? {};
  } catch (err) {
    fail(`invalid YAML frontmatter: ${(err as Error).message}`);
  }
  if (typeof meta !== 'object' || Array.isArray(meta)) fail('frontmatter must be a mapping');
  const m = meta as Record<string, unknown>;

  if (!CLIS.includes(m.cli as CliKind)) fail(`invalid cli ${JSON.stringify(m.cli)} (expected ${CLIS.join(' | ')})`);
  const profile = m.profile ?? 'standard';
  if (!PROFILES.includes(profile as Profile)) {
    fail(`invalid profile ${JSON.stringify(profile)} (expected ${PROFILES.join(' | ')})`);
  }
  if (m.model !== undefined && typeof m.model !== 'string') fail('model must be a string');
  const allow = m.allow ?? [];
  if (!Array.isArray(allow) || !allow.every((a) => typeof a === 'string')) fail('allow must be a list of strings');
  const orchestrator = m.orchestrator ?? false;
  if (typeof orchestrator !== 'boolean') fail('orchestrator must be a boolean');

  return {
    name: file.slice(0, -'.md'.length),
    folder,
    cli: m.cli as CliKind,
    ...(m.model !== undefined && { model: m.model as string }),
    profile: profile as Profile,
    allow: allow as string[],
    orchestrator: orchestrator as boolean,
    prompt: source.slice(match![0].length),
  };
}
