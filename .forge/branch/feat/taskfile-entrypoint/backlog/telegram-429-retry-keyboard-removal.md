<!-- forge-slug: telegram-429-retry-keyboard-removal -->
<!-- task: 8 -->
<!-- tdd: off -->
# 텔레그램 429 retry_after 재시도 + 승인 뒤 키보드 제거

## Goal / Non-goals
- Goal: Bot API가 429와 `parameters.retry_after`를 돌려주면 그만큼 기다린 뒤 다시 보내 정확히 1번 전달한다. 승인 결정 뒤 승인 메시지의 인라인 키보드를 제거한다.
- Non-goals: 무한 재시도, 429 외 오류 재시도.

## Source of truth
- Related ADRs: docs/decisions/0007, 0009
- Definition of Done:
  - `pnpm test:acceptance -t "telegram 429"` → exit 0, 통과 ≥1 (기준선: 테스트 없음)
  - `pnpm -r test` → exit 0

## Work slices
- [ ] S1. qa: fake-telegram에 429 주입과 editMessageReplyMarkup 기록 추가, "telegram 429" 테스트 작성 — completion criterion: 구현 전 실패, 오케스트레이터 검토 통과
- [ ] S2. server: telegram.ts 재시도(상한 있음), app.ts 키보드 제거 + 단위 테스트 — completion criterion: S1 통과 (depends: S1)
- [ ] S3. docs: architecture.md 텔레그램 절 갱신 — completion criterion: 재시도·키보드 제거 동작 명시 (depends: S2)
