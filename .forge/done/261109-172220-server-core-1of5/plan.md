<!-- forge-slug: server-core-1of5 -->
<!-- task: 1 -->
<!-- part: 1/5 -->
<!-- priority: high -->
<!-- tdd: off -->
# 서버 패키지 골격 + 에이전트 로더 + 저장소 + 권한 + 쓰기 잠금

## Goal / Non-goals
- Goal: `packages/server`(@remote-agent/server) 골격을 만들고 `loadAgents`, `openStore`, `decidePermission`, `createApprovalBroker`, `createLockManager`를 계약(docs/architecture.md)대로 구현한다. 루트 build/test/lint 스크립트와 typescript-eslint 설정을 갖춘다.
- Non-goals: CLI 어댑터, MCP 브리지, 텔레그램 앱(이후 part). tests/acceptance/** 수정 금지.

## Source of truth
- Glossary terms: 에이전트, 세션, 작업 폴더 in .forge/CONTEXT.md
- Related ADRs: docs/decisions/0005, 0006, 0009, 0010, 0011
- Definition of Done:
  - `pnpm install && pnpm -r build` → exit 0 (baseline: 패키지 없음)
  - `pnpm test:acceptance agents.test permissions.test lock.test` → 3 files 전부 통과 (baseline: 실패)
  - `pnpm -r test` → exit 0, 단위 테스트 1개 이상
  - `pnpm lint` → exit 0, eslint.config에 typescript-eslint

## Work slices
- [ ] S1. pnpm workspace 패키지 `packages/server` 생성 (ESM, TS strict, tsc로 dist 빌드, 상대 import는 `.ts` 확장자 + `rewriteRelativeImportExtensions`/`allowImportingTsExtensions` 등으로 strip-types 실행 가능하게, vitest 단위 테스트, 루트 scripts build/test/lint, 루트 devDependency `@remote-agent/server: workspace:*`, eslint flat config + typescript-eslint) — completion criterion: build·lint·`pnpm -r test` exit 0
- [ ] S2. `loadAgents` (YAML frontmatter, 기본값, 정렬, 오류 메시지) — completion criterion: agents.test 통과 (depends: S1)
- [ ] S3. `decidePermission` + `createApprovalBroker` (30분 기본 타임아웃, allow_session) — completion criterion: permissions.test 통과 (depends: S1)
- [ ] S4. `createLockManager` (FIFO, 같은 chainId 재진입, 참조 카운트) — completion criterion: lock.test 통과 (depends: S1)
- [ ] S5. `openStore` (node:sqlite, 바인딩·세션 ID·이벤트) + 단위 테스트 — completion criterion: 단위 테스트 통과 (depends: S1)
