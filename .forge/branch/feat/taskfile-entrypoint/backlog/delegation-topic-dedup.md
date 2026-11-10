<!-- forge-slug: delegation-topic-dedup -->
<!-- task: 9 -->
<!-- tdd: off -->
# 첫 위임이 동시에 와도 위임 토픽을 1개만 만들기

## Goal / Non-goals
- Goal: 같은 (호출 세션, 대상 에이전트)의 send_to_agent가 동시에 와도 createForumTopic은 1번만 불리고 두 호출이 같은 토픽을 쓴다.
- Non-goals: Codex 오케스트레이터의 위임 지원(MCP 도구 없음).

## Source of truth
- Related ADRs: docs/decisions/0011
- Definition of Done:
  - `pnpm test:acceptance -t "delegation topic dedup"` → exit 0, 통과 ≥1 (기준선: 테스트 없음)
  - `pnpm -r test` → exit 0

## Work slices
- [ ] S1. qa: "delegation topic dedup" 테스트 작성 — completion criterion: 구현 전 실패, 오케스트레이터 검토 통과
- [ ] S2. server: app.ts delegate()에서 토픽 생성을 키별 single-flight로 + delegation.test 갱신 — completion criterion: S1 통과 (depends: S1)
