# RUN — claude-adapter-mcp-bridge-2of5

- S1 Claude 어댑터 (`src/claude.ts`) — ✅ 계획대로. 턴은 프로세스가 끝날 때 resolve되고(잠금 유지 목적), 공통 어댑터 타입은 types.ts에 둠
- S2 MCP 브리지 (`src/mcp-bridge.ts`) — ✅ 계획대로. 외부 의존성 없음. approve는 실패하면 거부(fail-closed)하고, 세 도구는 항상 노출(오케스트레이터 판정은 앱이 함). 30분 대기를 위해 fetch 대신 node:http 사용

## DoD baseline → after
- claude-adapter.test: 실패 → 8 passed (8)
- 전체 인수 테스트: 33 → 41 passed (67)
- build·lint·unit: exit 0 (unit 9 passed)

## Rulings
- 단일 구현 서브에이전트로 직접 실행 (task 1과 같은 이유)
- 앱이 제공할 HTTP 경로(`POST /approve`, `/tools/list_agents`, `/tools/send_to_agent`)를 구현자가 정함 → task 4/5의 입력 계약

## 남은 위험
- [낮음] Claude Code 자체의 MCP 도구 호출 시간 제한이 30분보다 짧을 수 있다. 실제 바이너리로 확인이 필요하다 (`MCP_TOOL_TIMEOUT` 후보)
