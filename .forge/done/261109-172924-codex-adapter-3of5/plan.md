<!-- forge-slug: codex-adapter-3of5 -->
<!-- task: 3 -->
<!-- part: 3/5 -->
<!-- tdd: off -->
# Codex 어댑터 (app-server JSON-RPC)

## Goal / Non-goals
- Goal: `createCodexAdapter` — 폴더별 `codex app-server` 상주, thread/start·resume·turn/start, delta 조립, 승인 요청을 주입된 승인 콜백으로 중계, 프로필별 sandbox, close().
- Non-goals: 텔레그램 앱. 실제 codex 호출 금지.

## Source of truth
- Glossary terms: 세션 in .forge/CONTEXT.md
- Related ADRs: docs/decisions/0008, 0009
- Definition of Done:
  - `pnpm test:acceptance codex-adapter.test` → 통과 (baseline: 실패)
  - `pnpm -r build && pnpm lint && pnpm -r test` → exit 0

## Work slices
- [ ] S1. JSON-RPC stdio 클라이언트(요청/응답 매칭, 알림, 서버 요청 처리) + 단위 테스트 — completion criterion: 단위 테스트 통과
- [ ] S2. 어댑터: 프로세스 재사용, thread 관리, sandbox 매핑, approvalPolicy untrusted, 승인 콜백 → accept/acceptForSession/decline — completion criterion: codex-adapter.test 통과 (depends: S1)
