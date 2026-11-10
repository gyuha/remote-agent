<!-- forge-slug: orchestrator-tools-5of5 -->
<!-- task: 5 -->
<!-- part: 5/5 -->
<!-- tdd: off -->
# 오케스트레이터 도구 (list_agents, send_to_agent) + 호출 체인 잠금

## Goal / Non-goals
- Goal: MCP 브리지에 orchestrator 에이전트 전용 `list_agents`, `send_to_agent`를 추가하고, 앱이 같은 chainId로 하위 턴을 실행해 데드락 없이 결과를 돌려준다. 비오케스트레이터 호출은 도구 오류.
- Non-goals: 비동기 위임·병렬 팬아웃(로드맵).

## Source of truth
- Glossary terms: 에이전트 in .forge/CONTEXT.md
- Related ADRs: docs/decisions/0011, 0010
- Definition of Done:
  - `pnpm test:acceptance` → 67 passed (67) (baseline: part 4 이후 오케스트레이터 케이스만 실패)
  - `pnpm -r build && pnpm lint && pnpm -r test` → exit 0

## Work slices
- [ ] S1. 브리지 도구 노출 조건(오케스트레이터만), 앱의 send_to_agent 처리(같은 폴더 한정, chainId 전파, 하위 세션 토픽 유지) — completion criterion: e2e 오케스트레이터 케이스 통과 + 전체 인수 테스트 67/67
