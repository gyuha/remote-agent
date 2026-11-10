# RUN — codex-adapter-3of5

- S1 JSON-RPC stdio 클라이언트 (`src/jsonrpc.ts`) + 단위 테스트 7개 — ✅ 계획대로
- S2 Codex 어댑터 (`src/codex.ts`) — ⚠ `item/started`를 처리해 tool 이벤트를 내고, fileChange 경로를 기록하도록 추가함(승인 요청에 경로가 없어서). 메시지 항목이 여러 개면 빈 줄로 이어 붙임

## DoD baseline → after
- codex-adapter.test: 실패 → 통과 (5개 파일 48 passed)
- 전체 인수 테스트: 41 → 48 passed (67)
- build·lint·unit: exit 0 (unit 19 passed)

## 구현자 미확인 → 메인 세션이 스키마로 확인함 (codex-cli 0.167.0 generate-json-schema)
- `thread/resume`에 cwd·approvalPolicy·sandbox·model을 함께 보냄 → ThreadResumeParams에 해당 필드가 있음 (확인됨)
- 에이전트 프롬프트를 `developerInstructions`로 보냄 → ThreadStartParams에 해당 필드가 있음 (확인됨)
- `"jsonrpc"` 필드 생략 → JSONRPCRequest의 required는 `id`, `method`뿐 (확인됨)

## Rulings
- 단일 구현 서브에이전트로 직접 실행
- 여러 파일을 고치는 승인 요청에는 path를 넘기지 않아 ask로 처리 (보수적 기본값)

## 남은 위험
- 승인 브로커의 allow_session 범위는 thread 단위인데, 계약은 토픽 단위다. task 4에서 토픽 키를 넘겨 맞춤
