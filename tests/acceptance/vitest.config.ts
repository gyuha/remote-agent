import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  resolve: {
    alias: {
      // 인수 테스트는 빌드 산출물이 아니라 소스(TS)를 직접 검사한다.
      '@remote-agent/server': path.join(root, 'packages/server/src/index.ts'),
    },
  },
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
    // 타이밍(잠금 순서)·프로세스 환경(FAKE_LOG)을 다루므로 파일 간 병렬 실행을 끈다.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
