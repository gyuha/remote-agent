import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadAgents } from '@remote-agent/server';
import { makeTmp, writeAgent } from './helpers';

describe('0006 에이전트 정의 로더', () => {
  let folder: string;
  beforeEach(() => {
    folder = makeTmp('agents');
  });
  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  test('0006 frontmatter·본문·이름을 읽는다', async () => {
    writeAgent(
      folder,
      'dev',
      `cli: codex
model: gpt-5
profile: trusted
allow: ["npm test", "git status"]
orchestrator: true`,
      '너는 구현 담당이다.\n테스트를 먼저 쓴다.',
    );
    const agents = await loadAgents(folder);
    expect(agents).toHaveLength(1);
    const a = agents[0];
    expect(a.name).toBe('dev');
    expect(a.folder).toBe(folder);
    expect(a.cli).toBe('codex');
    expect(a.model).toBe('gpt-5');
    expect(a.profile).toBe('trusted');
    expect(a.allow).toEqual(['npm test', 'git status']);
    expect(a.orchestrator).toBe(true);
    expect(a.prompt.trim()).toBe('너는 구현 담당이다.\n테스트를 먼저 쓴다.');
  });

  test('0006 생략한 필드는 기본값(profile standard, allow [], orchestrator false, model 없음)', async () => {
    writeAgent(folder, 'min', 'cli: claude', '최소 정의');
    const [a] = await loadAgents(folder);
    expect(a.name).toBe('min');
    expect(a.cli).toBe('claude');
    expect(a.profile).toBe('standard');
    expect(a.allow).toEqual([]);
    expect(a.orchestrator).toBe(false);
    expect(a.model).toBeUndefined();
    expect(a.prompt.trim()).toBe('최소 정의');
  });

  test('0006 이름순으로 정렬하고 .md가 아닌 파일은 무시한다', async () => {
    writeAgent(folder, 'zeta', 'cli: claude');
    writeAgent(folder, 'alpha', 'cli: codex');
    writeAgent(folder, 'mid', 'cli: claude');
    fs.writeFileSync(path.join(folder, '.remote-agent', 'agents', 'README.txt'), 'not an agent');
    const agents = await loadAgents(folder);
    expect(agents.map((a) => a.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  test('0006 선언 디렉토리가 없으면 빈 배열', async () => {
    await expect(loadAgents(folder)).resolves.toEqual([]);
    await expect(loadAgents(path.join(folder, 'does-not-exist'))).resolves.toEqual([]);
  });

  test('0006 잘못된 cli는 파일명이 담긴 Error로 거부한다', async () => {
    writeAgent(folder, 'good', 'cli: claude');
    writeAgent(folder, 'bad', 'cli: gemini');
    await expect(loadAgents(folder)).rejects.toThrow(/bad\.md/);
  });

  test('0006 잘못된 profile은 파일명이 담긴 Error로 거부한다', async () => {
    writeAgent(folder, 'weird', 'cli: claude\nprofile: yolo');
    await expect(loadAgents(folder)).rejects.toThrow(/weird\.md/);
  });
});
