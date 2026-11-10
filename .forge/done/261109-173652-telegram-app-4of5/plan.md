<!-- forge-slug: telegram-app-4of5 -->
<!-- task: 4 -->
<!-- part: 4/5 -->
<!-- tdd: off -->
# 앱: 텔레그램 게이트웨이 + 토픽 바인딩 + 승인 버튼

## Goal / Non-goals
- Goal: `createApp` — getUpdates long polling, 소유자 확인, `/new <folder>/<agent>` 토픽 생성·바인딩, DM 기본 에이전트, 턴 실행(쓰기 잠금, readonly는 잠금 없음), 4096자 분할, 승인 인라인 키보드·callback, 내부 HTTP 브리지(127.0.0.1), dataDir 영속.
- Non-goals: 오케스트레이션 도구의 실제 위임(part 5). 실제 텔레그램 API 호출 금지(가짜 서버만).

## Source of truth
- Glossary terms: 소유자, 세션, 작업 폴더 in .forge/CONTEXT.md
- Related ADRs: docs/decisions/0001, 0007, 0009, 0010
- Definition of Done:
  - `pnpm test:acceptance app-e2e.test` → 오케스트레이터 케이스를 제외한 전부 통과 (baseline: 실패)
  - `pnpm -r build && pnpm lint && pnpm -r test` → exit 0

## Work slices
- [ ] S1. 텔레그램 클라이언트(fetch 기반, apiBase 주입) + 업데이트 루프(동시 처리) + 단위 테스트 — completion criterion: 단위 테스트 통과
- [ ] S2. 라우팅·바인딩·세션 영속·응답 분할 — completion criterion: e2e 비소유자/토픽/DM/재시작 케이스 통과 (depends: S1)
- [ ] S3. 승인 흐름(브로커 ↔ 키보드 ↔ callback, 브리지 HTTP, Codex 승인 연결) + 쓰기 잠금 — completion criterion: e2e 승인·잠금 케이스 통과 (depends: S2)
