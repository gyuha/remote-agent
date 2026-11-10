<!-- forge-slug: allow-session-control-chars -->
<!-- task: 6 -->
<!-- priority: high -->
<!-- tdd: off -->
# allow_session을 제어 문자가 든 셸 명령에 적용하지 않기

## Goal / Non-goals
- Goal: 셸 명령에 `&&` `;` `||` `|` 백틱 `$(` `>` `<` 줄바꿈이 있으면 세션 허용으로 자동 허용하지 않고, 그런 명령에 allow_session을 눌러도 세션 허용을 만들지 않는다(그 1회만 허용).
- Non-goals: 셸 파싱으로 체인 조각별 허용(사용자가 기각), trusted 프로필의 절대 차단 목록(roadmap 2차 후보).

## Source of truth
- Glossary terms: 세션 in .forge/CONTEXT.md
- Related ADRs: docs/decisions/0009 → 새 0015로 부분 대체
- Definition of Done:
  - `pnpm test:acceptance -t "allow_session control"` → exit 0, 통과 ≥1 (기준선: 테스트 없음 → 먼저 실패 상태 확인)
  - `pnpm -r test` → exit 0
  - `docs/decisions/0015-*.md` 존재, 0009에 superseded(부분) 표시

## Work slices
- [ ] S1. qa: tests/acceptance/permissions.test.ts에 "allow_session control" 테스트 추가 — completion criterion: 구현 전 실패, 오케스트레이터 검토 통과
- [ ] S2. server: approvals.ts의 scopeKey/grant에 제어 문자 예외 + 단위 테스트 — completion criterion: S1 테스트 통과 (depends: S1)
- [ ] S3. docs: ADR 0015 작성, 0009 표시, architecture.md 83행 갱신 — completion criterion: C6 중 해당 grep 통과 (depends: S2)
