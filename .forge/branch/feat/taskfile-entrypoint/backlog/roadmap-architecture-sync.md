<!-- forge-slug: roadmap-architecture-sync -->
<!-- task: 10 -->
<!-- priority: low -->
<!-- tdd: off -->
# roadmap·architecture를 구현 결과에 맞추기

## Goal / Non-goals
- Goal: roadmap.md의 "1단계 구현 뒤 남은 작업"에서 끝난 4건을 지우고 architecture.md가 실제 동작과 맞는지 확인한다.
- Non-goals: 남은 다른 항목(대기 순서 표시, MCP 타임아웃, 수동 E2E, 2단계)의 내용 변경.

## Source of truth
- Definition of Done:
  - C6 전체 통과 (loop.md)
  - `task check` → exit 0

## Work slices
- [ ] S1. docs: roadmap.md에서 4건 제거, architecture.md 최종 점검 — completion criterion: C6 grep 통과
- [ ] S2. qa: `task check` 전체 실행 후 결과 보고 — completion criterion: exit 0 (depends: S1)
