<!-- forge-slug: append-event-logging -->
<!-- task: 7 -->
<!-- tdd: off -->
# appendEvent로 세션 이벤트를 events 테이블에 기록

## Goal / Non-goals
- Goal: 수신 메시지, 어댑터 이벤트(0008), 승인 요청·결정, 턴 결과를 chat_id·thread_id와 함께 events 테이블에 남긴다. 0013 로그 보기의 전제다.
- Non-goals: 웹 UI 로그 화면, 이벤트 조회 API(웹 역할이 요청할 때 별도로 다룸).

## Source of truth
- Related ADRs: docs/decisions/0008, 0013
- Definition of Done:
  - `pnpm test:acceptance -t "appendEvent"` → exit 0, 통과 ≥1 (기준선: 테스트 없음)
  - `pnpm -r test` → exit 0

## Work slices
- [ ] S1. qa: app-e2e에 "appendEvent" 테스트 추가 (events 행 종류와 chat/thread id를 단언) — completion criterion: 구현 전 실패, 오케스트레이터 검토 통과
- [ ] S2. server: app.ts에서 appendEvent 호출 연결 + 단위 테스트 — completion criterion: S1 통과 (depends: S1)
- [ ] S3. docs: architecture.md의 이벤트 기록 설명 갱신 — completion criterion: architecture.md에 기록되는 이벤트 종류 명시 (depends: S2)
