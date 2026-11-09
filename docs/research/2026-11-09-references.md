# 참고 조사 — 2026-11-09

조사 방법: 각 프로젝트 README·공식 문서를 웹에서 읽고 요약했다. 인용 출처는 각 절 끝에 있다. 신뢰 수준: [높음] 공식 문서 직접 확인 · [중간] 부분 확인/추론 · [낮음] 2차 출처.

## 1. cokacdir (github.com/kstost/cokacdir)

- Rust 단일 바이너리. 터미널 파일 매니저이자 채팅 봇. README: "cokacdir is not an AI agent" — LLM 없이 Claude Code · Codex · `agy` · OpenCode에 위임한다. MIT. [높음]
- 텔레그램 · 디스코드 · 슬랙 지원. 스트리밍 출력, 요청 큐(`/queue`, `/stop`), 예약 작업, 그룹 채팅에서 여러 봇이 컨텍스트 공유, "bot-to-bot messaging for multi-agent workflows". [높음]
- 관리는 `cokacctl` TUI. **웹 관리 UI 없음**. [높음]
- `agy` 호출: `agy --output-format stream-json --dangerously-skip-permissions`, 프롬프트는 stdin, 재개는 `--conversation <id>`. 다른 CLI의 호출 방식은 README에 없음. [높음]
- 보안: 세밀한 도구 제한(`/allowedtools`)은 Claude만 지원하고, 나머지는 CLI 기본 권한 그대로. 허용 사용자 설정 방식은 문서에서 확인 못 함. [중간]

**우리 요구와의 차이**: 웹 관리 UI, 폴더별 다중 에이전트 정의, 오케스트레이터가 없다. 나머지(메신저 × CLI 연결)는 이미 있다.

## 2. Hermes Agent (github.com/NousResearch/hermes-agent)

- Python. **자체 LLM 루프**를 돌리는 에이전트이며 외부 코딩 CLI에 위임하지 않는다(CLI 로그인 자격증명은 가져다 씀). [높음]
- 게이트웨이 구조: 플랫폼 어댑터 → `GatewayRunner._handle_message()` → 인가 → 세션 키 결정 → 에이전트 실행. 25개 이상 플랫폼. 세션은 SQLite(FTS5). [높음]
- 서브에이전트 위임(`delegate_tool`), 백그라운드 세션, cron. [높음]
- 보안 모델이 가장 정교함: 기본 거부, 플랫폼별 허용 목록(`TELEGRAM_ALLOWED_USERS`), DM 페어링 코드(8자, 1시간 TTL, 실패 5회 잠금), 승인 모드(smart/manual/off), 하드 블록리스트. [중간 — 페이지 일부 발췌]

**가져올 것**: 게이트웨이 → 인가 → 세션 키 흐름, 페어링·허용 목록 보안 모델.

## 3. CLI 헤드리스 인터페이스

| CLI | 1회 실행 | 스트리밍 | 재개 | 장기 실행/서버 모드 | 헤드리스 권한 처리 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude -p` | `--output-format stream-json` (NDJSON, 마지막 `result`에 `session_id`) | `--resume <id>` | `--input-format stream-json`, Agent SDK | 기본 수동→거부. `--allowedTools`, `--permission-mode`, `--permission-prompt-tool`(MCP) |
| Codex | `codex exec` | `--json` (JSONL) | `codex exec resume <id>` | `codex app-server` (JSON-RPC, 승인 요청을 클라이언트로 보냄) | 기본 read-only 샌드박스, `--sandbox workspace-write` |
| OpenCode | `opencode run --format json` | JSON 이벤트 | `-s <id>` | `opencode serve` (HTTP + SSE, OpenAPI, 승인 API) | `--auto` 또는 서버 승인 API |
| Antigravity | `agy -p` | `--output-format stream-json` | `--conversation <id>` | `--input-format stream-json`, Python SDK | 소프트 거부(종료 코드 0). `permissions.allow` 또는 `--dangerously-skip-permissions` |

신뢰 수준: Claude·Codex exec·OpenCode·agy 기본 플래그 [높음], `codex app-server` 세부 [중간], 버전별 플래그 위치 차이 있음 [중간]. Gemini CLI는 2026-06 이후 개인 사용자 대상으로 `agy`로 대체됨 [높음].

## 4. 약관(ToS) 위험

- **Anthropic** [높음]: 구독 OAuth는 "ordinary use of Claude Code"용. 본인이 수정하지 않은 `claude` 바이너리를 본인 구독으로 쓰는 것은 허용되고, 제3자가 사용자의 구독 자격증명으로 요청을 중계하는 것은 금지. 2026-01부터 서버 측 단속. → **본인 1인이 자기 머신에서 `claude -p`를 실행하는 구조는 방어 가능, 타인에게 봇을 열어주는 구조는 위험**.
- **Google** [중간]: 2026-02 서드파티 도구로 Antigravity OAuth 토큰을 쓴 계정 다수 정지. 공식 `agy` 바이너리 실행은 안전 경로.
- **OpenAI** [중간]: 가장 관대함. "Sign in with ChatGPT" 공식 프로그램 존재.
- Claude `-p` 사용분 별도 과금 계획은 보류됐다는 2차 보도만 있음 [낮음].

결론: 네 CLI 모두 **공식 바이너리를 사용자 본인 로그인으로 직접 실행**하고, 토큰은 절대 꺼내거나 중계하지 않는다.

## 출처

- https://github.com/kstost/cokacdir (README, docs/how-to-use-agy-antigravity.md)
- https://github.com/NousResearch/hermes-agent · https://hermes-agent.nousresearch.com/docs/developer-guide/architecture · …/user-guide/security
- https://code.claude.com/docs/en/headless.md · …/authentication.md · …/legal-and-compliance
- https://learn.chatgpt.com/docs/non-interactive-mode.md · https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- https://docs.opencode.ai/docs/cli · https://docs.opencode.ai/docs/server/
- https://antigravity.google/docs/cli/headless
- 2차: https://gigazine.net/gsc_news/en/20260224-google-gemini-openclaw-accounts-banned · https://letsdatascience.com/news/anthropic-pauses-claude-agent-sdk-billing-overhaul-1cff2071
