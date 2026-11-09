---
author: gyuha
decided: 2026-11-09
---
# CLI 구동: CLI마다 가장 적합한 방식, 공통 어댑터로 감싼다

- **Claude Code**: 메시지마다 `claude -p --output-format stream-json --verbose`를 실행하고 `--resume <session_id>`로 이어간다. 승인 요청은 `--permission-prompt-tool`로 우리 서버의 MCP 도구가 받는다.
- **Codex**: `codex app-server`(JSON-RPC, stdio) 프로세스를 상주시키고, 세션은 `thread`로 다룬다(`thread/start`·`turn/start`·`thread/resume`). app-server가 보내는 승인 요청을 서버가 받는다.
- **공통 어댑터 인터페이스**: 메시지 보내기 → 이벤트 스트림(텍스트, 도구 사용, 승인 요청, 완료, 오류), 승인 응답, 중단.

목적은 원격에서 도구 실행을 텔레그램 버튼으로 승인할 수 있게 하는 것이다.

## cokacdir와 다른 점 (의도적 이탈)
cokacdir는 두 CLI 모두 메시지마다 실행하고 권한 검사를 전부 끈다(`claude --dangerously-skip-permissions --tools …`, `codex exec --dangerously-bypass-approvals-and-sandbox`; 2026-11-09 소스 확인). 단순하지만 메시지 하나가 무승인 원격 셸이 된다. 이 경로로 "단순화"하지 말 것. 또 cokacdir는 Codex 내부의 `rollout-*.jsonl`과 SQLite를 직접 고치지만, 우리는 CLI 내부 저장 형식에 의존하지 않는다.

## 결과
- 실행 모델이 두 가지다. app-server가 죽으면 재시작하고 진행 중인 thread를 이어가는 처리가 필요하다.
- app-server JSON-RPC 스키마는 설치된 버전에서 `codex app-server generate-json-schema`로 생성해 쓴다.
