# RUN — telegram-app-4of5

- S1 텔레그램 클라이언트 (`src/telegram.ts`) + 메시지 분할 + 단위 테스트 8개 — ✅ 계획대로
- S2 라우팅·바인딩·세션 영속·분할 (`src/app.ts`) — ✅ 계획대로 (DM은 (ownerId, 0) 키로 지연 바인딩)
- S3 승인 흐름·쓰기 잠금·HTTP 브리지 — ⚠ 승인 브로커에 `'tool'` kind 추가(approvals.ts, 하위 호환). 같은 토픽의 턴은 차례로 실행(토픽별 큐). list_agents도 미리 구현

## DoD baseline → after
- app-e2e(오케스트레이터 위임 제외): 실패 → 전부 통과
- 전체 인수 테스트: 48 → 66 passed (67). 남은 1개는 task 5 대상(send_to_agent). 3회 연속 같은 결과
- build·lint·unit: exit 0 (unit 27 passed). 끝난 뒤 남은 가짜 프로세스 없음

## Rulings
- 단일 구현 서브에이전트로 직접 실행
- 같은 토픽의 턴을 직렬화함: Codex는 겹치는 턴을 거부하고, Claude는 `--resume`이 겹치면 세션이 갈라지기 때문

## 남은 작업 (follow-up 후보)
- 0010의 "대기 순서를 메신저에 표시" 미구현
- 텔레그램 429 `retry_after` 재시도 미구현
- 승인 버튼을 누른 뒤 키보드 제거 미구현 (두 번째 누르면 "이미 처리됨"으로 응답)
- `appendEvent` 이벤트 기록 미구현 (2단계 웹 UI의 로그 보기에 필요)
