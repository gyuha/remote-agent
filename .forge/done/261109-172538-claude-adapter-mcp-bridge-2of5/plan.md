<!-- forge-slug: claude-adapter-mcp-bridge-2of5 -->
<!-- task: 2 -->
<!-- part: 2/5 -->
<!-- tdd: off -->
# Claude 어댑터 + MCP 브리지(approve 도구)

## Goal / Non-goals
- Goal: `createClaudeAdapter`(메시지마다 `claude -p` + `--resume` + `--permission-prompt-tool`)와 stdio MCP 서버 `src/mcp-bridge.ts`(approve 도구, 앱 HTTP 브리지로 중계)를 구현한다.
- Non-goals: list_agents/send_to_agent 실제 동작(part 5), 텔레그램 앱(part 4). 실제 claude 호출 금지.

## Source of truth
- Glossary terms: 세션 in .forge/CONTEXT.md
- Related ADRs: docs/decisions/0008, 0009, 0014
- Definition of Done:
  - `pnpm test:acceptance claude-adapter.test` → 통과 (baseline: 실패)
  - `pnpm -r build && pnpm lint && pnpm -r test` → exit 0

## Work slices
- [ ] S1. Claude 어댑터: argv 계약, 금지 플래그 없음, ANTHROPIC_API_KEY/AUTH_TOKEN 제거, stream-json 파싱, onEvent, mcp-config 임시 파일, close() — completion criterion: claude-adapter.test 통과
- [ ] S2. `src/mcp-bridge.ts`: 의존성 없는 MCP stdio JSON-RPC 서버(initialize, tools/list, tools/call), approve는 `REMOTE_AGENT_BRIDGE_URL`로 POST해 결정을 받아 permission-prompt-tool 응답 형식으로 반환, strip-types로 직접 실행 가능 + 단위 테스트 — completion criterion: 단위 테스트에서 가짜 HTTP 브리지로 allow/deny 왕복 확인 (depends: S1)
