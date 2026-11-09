# 아키텍처 — MVP 1단계 (코어 엔진)

결정 `decisions/0001`~`0014`를 코드 구조로 옮긴 문서다. **1단계 범위**는 코어 엔진(에이전트 로더, 저장소, 권한, 잠금, CLI 어댑터 2종, MCP 브리지, 텔레그램 게이트웨이, 오케스트레이터 도구)이다. 웹 UI(0012·0013), launchd/systemd 설치(0003), 로그인 점검 화면(0014)은 2단계로 미룬다.

아래 "공개 계약"은 `tests/acceptance/`의 고정 인수 테스트가 직접 호출한다. 계약을 바꾸려면 인수 테스트도 함께 바꿔야 하므로 사람의 결정이 필요하다.

## 저장소 구조

```
package.json              pnpm workspace 루트 (scripts: build, test, test:acceptance, lint)
pnpm-workspace.yaml
packages/server/          @remote-agent/server — 코어 엔진 (TypeScript, ESM, Node 22)
  src/index.ts            공개 계약 export
tests/acceptance/         고정 인수 테스트 (vitest) + fakes/
```

## 처리 흐름

텔레그램 메시지가 들어오면 소유자인지 확인하고, 토픽에 연결된 세션을 찾고, 폴더 잠금을 잡은 뒤 CLI 어댑터로 한 턴을 실행해 결과를 같은 토픽으로 돌려보낸다. 실행 중 도구 승인 요청은 MCP 브리지(Claude) 또는 app-server 요청(Codex)을 통해 승인 브로커로 들어가고, 권한 프로필이 `ask`로 판단한 것만 텔레그램 버튼으로 묻는다.

```mermaid
flowchart LR
  TG[텔레그램 업데이트] --> OWN{소유자?}
  OWN -- 아니오 --> DROP[무시]
  OWN -- 예 --> BIND[토픽 → 세션 조회]
  BIND --> LOCK[폴더 쓰기 잠금<br/>호출 체인 단위]
  LOCK --> AD{CLI}
  AD -- claude --> CL[claude -p 프로세스<br/>--resume]
  AD -- codex --> CX[codex app-server<br/>thread/turn]
  CL -- permission-prompt-tool --> MCP[MCP 브리지]
  CX -- requestApproval --> BR
  MCP --> BR[승인 브로커]
  BR --> POL{권한 프로필}
  POL -- allow --> OK[허용]
  POL -- deny --> NO[거부]
  POL -- ask --> BTN[텔레그램 버튼<br/>30분 뒤 거부]
  CL --> OUT[토픽에 응답]
  CX --> OUT
  MCP -- send_to_agent --> LOCK
  style DROP fill:#fdd
  style NO fill:#fdd
  style OK fill:#dfd
  style BTN fill:#ffd
```

## 공개 계약 (`@remote-agent/server`)

### 에이전트 정의 (0006)
`<작업 폴더>/.remote-agent/agents/<name>.md`. YAML frontmatter와 본문(역할 프롬프트)으로 이루어진다.

```md
---
cli: claude            # claude | codex
model: sonnet          # 선택
profile: standard      # readonly | standard | trusted (기본 standard)
allow: ["npm test", "git status"]   # 선택. 승인 없이 허용할 셸 명령 접두사
orchestrator: false    # 선택. true면 list_agents / send_to_agent 도구를 받는다
---
역할 프롬프트 본문
```

- `loadAgents(folder: string): Promise<AgentDefinition[]>` — 이름순 정렬. `AgentDefinition = { name, folder, cli, model?, profile, allow: string[], orchestrator: boolean, prompt }`. 파일이 없으면 `[]`, 잘못된 `cli`·`profile`은 `Error`(메시지에 파일명 포함).

### 저장소
- `openStore(file: string): Store` (`':memory:'` 허용). SQLite. 최소 기능: `bindTopic({chatId, threadId, folder, agent})`, `findBinding(chatId, threadId)`, `setSessionId(chatId, threadId, cliSessionId)`, `appendEvent(...)`, `close()`.

### 권한 (0009)
- `decidePermission(agent, request) → 'allow' | 'ask' | 'deny'`
  - `request = { kind: 'read' | 'edit' | 'shell' | 'network', path?: string, command?: string }`. `path`는 절대 경로다.
  - `readonly`: read → allow, 나머지 → deny
  - `standard`: read → allow. edit는 작업 폴더 **안**이면 allow, 밖이면 ask. shell은 `allow` 접두사와 일치하면 allow, 아니면 ask. network → ask
  - `trusted`: 전부 allow
- `createApprovalBroker({ timeoutMs = 30*60*1000 })`
  - `request(info) → Promise<'allow' | 'allow_session' | 'deny'>`. `timeoutMs`가 지나면 `'deny'`.
  - `respond(id, decision)`, `pending()` 목록, `on('request', cb)` 이벤트.
  - `allow_session`을 받으면 같은 세션의 같은 종류(같은 명령 첫 단어 또는 같은 kind) 요청은 이후 자동 허용한다.

### 쓰기 잠금 (0010, 0011)
- `createLockManager()` → `acquire(folder, chainId) → Promise<release()>`
  - 같은 `folder`에서 **다른** `chainId`는 FIFO로 기다린다.
  - **같은** `chainId`는 재진입한다. 바로 획득하고, 해제는 참조 카운트로 처리한다.
  - `readonly` 에이전트의 턴은 잠금을 잡지 않는다(호출하는 쪽 책임).

### CLI 어댑터 (0008, 0014)
공통 인터페이스 `CliAdapter.runTurn({ agent, prompt, sessionId?, chainId, onEvent }) → Promise<{ sessionId, text }>`.
`onEvent(e)`: `{type:'text', text}` · `{type:'tool', name}` · `{type:'done'}` · `{type:'error', message}`.

- `createClaudeAdapter({ bin = 'claude', mcp: { command, args, env } })`
  - 실행: `<bin> -p <prompt> --output-format stream-json --verbose --permission-prompt-tool mcp__remote_agent__approve --mcp-config <임시 JSON 파일>`. `sessionId`가 있으면 `--resume <id>`, 모델이 있으면 `--model <m>`, 역할 프롬프트는 `--append-system-prompt`, `cwd`는 작업 폴더.
  - **금지**: `--bare`, `--dangerously-skip-permissions`. 자식 환경에서 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN`을 제거한다.
  - stream-json: `system/init` → `assistant`(content[].text) … → `result`(`session_id`, `result`).
- `createCodexAdapter({ bin = 'codex' })`
  - 폴더마다 `<bin> app-server` 프로세스 하나를 상주시킨다(stdio, 줄 단위 JSON-RPC). `initialize` → `thread/start {cwd, approvalPolicy:'untrusted', sandbox}`(또는 `thread/resume {threadId}`) → `turn/start {threadId, input:[{type:'text', text}]}`.
  - 알림: `item/agentMessage/delta {delta}`, `turn/completed`.
  - 서버 요청 `item/commandExecution/requestApproval {command, cwd}`·`item/fileChange/requestApproval`은 승인 브로커를 거쳐 `{decision: 'accept' | 'acceptForSession' | 'decline'}`로 답한다.
  - sandbox: readonly → `read-only`, standard → `workspace-write`, trusted → `danger-full-access`.

### MCP 브리지 (0008, 0011)
`packages/server/dist/mcp-bridge.js`. Claude가 `--mcp-config`로 stdio 서버로 띄우는 프로세스다. 환경변수 `REMOTE_AGENT_BRIDGE_URL`(앱 내부 HTTP, 127.0.0.1)과 `REMOTE_AGENT_CHAIN_ID`로 앱에 중계한다.
- 도구 `approve({tool_name, input})` → 텍스트 JSON `{"behavior":"allow","updatedInput":input}` 또는 `{"behavior":"deny","message":…}`
- 오케스트레이터 에이전트에만: `list_agents()` → 같은 폴더의 에이전트 이름·cli·profile, `send_to_agent({name, message})` → 하위 에이전트의 턴 결과 텍스트(동기, 같은 `chainId`).

### 앱 (텔레그램 게이트웨이, 0001·0007)
`createApp(config) → { start(), stop(), bridgeUrl }`

```ts
config = {
  dataDir: string,
  telegram: { token, apiBase = 'https://api.telegram.org', ownerId: number, groupChatId: number, defaultAgent?: { folder, name } },
  folders: string[],
  cli: { claudeBin?, codexBin? },
  approvalTimeoutMs?: number,
}
```

- `getUpdates` long polling만 쓴다(웹훅 없음).
- `from.id !== ownerId`인 업데이트는 무시한다(응답하지 않음).
- 그룹에서 `/new <folder이름>/<agent>`를 받으면 `createForumTopic`으로 토픽을 만들고 바인딩한 뒤, 그 토픽에 안내 메시지를 보낸다.
- 바인딩된 토픽(`message_thread_id`)의 메시지는 그 세션으로 턴을 실행한다. 응답은 같은 `message_thread_id`로 `sendMessage`하고, 4096자 넘으면 나눠 보낸다.
- DM 메시지는 `defaultAgent`로 보낸다.
- 승인이 `ask`이면 토픽에 인라인 키보드(`허용` / `세션 동안 허용` / `거부`, `callback_data = "ap:<id>:allow|session|deny"`)를 보내고, `callback_query`로 응답한다.

## Codex app-server 프로토콜 근거
2026-11-09 설치본 `codex-cli 0.167.0`에서 `codex app-server generate-json-schema`로 확인했다:
- ServerRequest `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`. 결정값 `accept | acceptForSession | decline | cancel`
- ClientRequest `initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `account/read`
- ServerNotification `thread/started`, `turn/started`, `turn/completed`, `item/agentMessage/delta`, `item/completed`
- `AskForApproval`: `untrusted | on-request | never`. `SandboxMode`: `read-only | workspace-write | danger-full-access`
