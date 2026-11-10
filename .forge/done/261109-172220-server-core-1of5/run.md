# RUN — server-core-1of5

- S1 패키지 골격·루트 스크립트·eslint — ⚠ TS 7에 JS API가 없어 typescript-eslint가 실패. 루트 `typescript`를 TS 6 API 별칭(`npm:@typescript/typescript6`)으로, TS 7은 `@typescript/native`로 함께 설치
- S2 loadAgents — ✅ 계획대로 (cli 필수, 오류 메시지는 `<file>.md:`로 시작)
- S3 decidePermission + 승인 브로커 — ✅ 계획대로
- S4 쓰기 잠금 — ✅ 계획대로 (체인 넘김 시 같은 체인의 대기 요청 동시 획득)
- S5 openStore(node:sqlite) + 단위 테스트 — ✅ 계획대로

실행 방식: 구현 서브에이전트 1개가 직렬로 실행했다. 결과는 메인 세션이 독립적으로 재검증했다.

## DoD baseline → after
- build: 패키지 없음 → `tsc -p .` exit 0
- 인수 테스트 agents/permissions/lock: 실패 → 33 passed (33)
- `pnpm -r test`: 없음 → 2 passed
- `pnpm lint`: 없음 → exit 0 (typescript-eslint 적용, `any` 넣은 임시 파일로 규칙 동작 확인)

## Rulings
- Dynamic Workflow 대신 단일 구현 서브에이전트로 직접 실행 — 규모가 단일 에이전트에 맞고, 워크플로 승인은 무인 실행을 멈추기 때문 (fg-run "작으면 직접 처리")
- 계약에 없는 세부(appendEvent 형태, id 형식 등)는 구현자 판단을 그대로 수용

## 남은 위험 (사용자 판단 필요)
- `allow_session`은 명령의 첫 단어로 매칭한다. 그래서 `npm run build`를 세션 동안 허용하면 `npm test && rm -rf /`도 자동 허용된다. 계약을 바꾸는 문제라 루프 범위 밖이며, docs/roadmap.md에 기록할 예정
