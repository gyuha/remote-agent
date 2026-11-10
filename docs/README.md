# remote-agent 문서

텔레그램·디스코드·슬랙에서, 로그인된 코딩 CLI(Claude Code · Codex · OpenCode · Antigravity `agy`)를 폴더 단위 에이전트로 불러 쓰고, 오케스트레이터가 여러 에이전트를 관리하는 시스템의 설계 문서 모음.

## 구조

| 경로 | 내용 |
| --- | --- |
| `research/` | 참고 프로젝트·외부 도구 조사. 날짜가 붙은 스냅샷이며 사실이 바뀌면 새 파일로 추가 |
| `decisions/` | 확정된 설계 결정. 한 결정당 한 파일 (`NNNN-제목.md`) |
| `../.forge/CONTEXT.md` | 용어집 (에이전트, 세션, 작업 폴더, 소유자 등) |
| `roadmap.md` | MVP 이후 검토 항목, 흐릿한 주제, 범위 밖 |
| `architecture.md` | 1단계 코어 엔진의 구조와 공개 계약 (`tests/acceptance/`가 검증) |

## 진행 방식

아직 내리지 않은 결정은 `.forge/agenda.md`(forge 의제 파일, 로컬 작업 상태)에서 하나씩 해결한다. 결정이 나면 `decisions/`에 기록하고, 빌드 가능한 단위가 되면 빌드 계획으로 넘어간다.

```
의제(.forge/agenda.md)의 열린 질문 → 결정 → docs/decisions/ 기록 → 빌드 계획 → 구현
```

## MVP 결정 요약 (2026-11-09)

| # | 결정 |
| --- | --- |
| [0001](decisions/0001-single-owner.md) | 본인 1인 전용 |
| [0002](decisions/0002-new-build-not-cokacdir-fork.md) | 신규 구축, cokacdir는 참고만 |
| [0003](decisions/0003-macos-and-linux-first-class.md) | macOS·Linux 둘 다 1급 지원 |
| [0004](decisions/0004-mvp-telegram-claude-codex.md) | MVP: 텔레그램 + Claude Code·Codex |
| [0005](decisions/0005-stack-typescript-sqlite-react.md) | TypeScript(Node) + SQLite + React(Vite) |
| [0006](decisions/0006-agent-definition-in-folder-files.md) | 에이전트 정의는 `<작업 폴더>/.remote-agent/agents/*.md`, 실행 상태는 SQLite |
| [0007](decisions/0007-telegram-topic-per-session.md) | 포럼 토픽 하나 = 세션 하나, DM = 기본 에이전트 |
| [0008](decisions/0008-cli-runner-per-cli-optimal.md) | Claude는 메시지마다 + resume + permission-prompt-tool, Codex는 app-server |
| [0009](decisions/0009-permission-profiles.md) | 권한 프로필 readonly/standard/trusted, 30분 뒤 자동 거부 |
| [0010](decisions/0010-folder-write-lock.md) | 폴더 단위 쓰기 잠금(턴 단위) |
| [0011](decisions/0011-orchestrator-as-agent-with-mcp.md) | 오케스트레이터 = MCP 도구를 받은 에이전트, 호출 체인 잠금 |
| [0012](decisions/0012-admin-ui-localhost-telegram-login.md) | 웹 UI는 127.0.0.1, 텔레그램 일회용 로그인 링크 |
| [0013](decisions/0013-admin-ui-scope-config-and-observe.md) | 웹 UI는 설정과 관찰만, 입력은 메신저로만 |
| [0014](decisions/0014-cli-login-by-user-app-checks-only.md) | CLI 로그인은 사용자가 직접, 앱은 점검과 안내만 |
