# 고정 인수 테스트 (frozen acceptance suite)

`docs/architecture.md`의 "공개 계약"을 바깥에서 검사하는 독립 검사기다. 구현(`packages/server`)을 쓰는 에이전트는 이 디렉토리를 **고치지 않는다**. 구현과 같은 손이 테스트를 고치면 "테스트를 구현에 맞추는" 일이 생기므로, 계약을 바꿔야 하면 사람이 결정하고 `architecture.md`와 이 테스트를 함께 바꾼다.

## 무엇이 고정되는가
- `*.test.ts` — 결정 번호별 인수 테스트(테스트 이름 앞의 `0006`~`0011` 등이 근거 결정)
- `fakes/` — 텔레그램 Bot API, `claude -p`, `codex app-server`를 흉내 내는 가짜. 외부 네트워크·실제 로그인 없이 돈다
- `helpers.ts`, `vitest.config.ts`, `tsconfig.json`

## 고정 방식
이 디렉토리 전체의 sha256 다이제스트를 `.forge/loop.md`에 기록한다. 루프는 매 반복마다 다시 계산해 기록값과 다르면 멈춘다.

```
find tests/acceptance -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256
```

## 실행
```
pnpm install
pnpm test:acceptance
```
`@remote-agent/server`는 vitest alias로 `packages/server/src/index.ts`(소스)에 연결된다. MCP 브리지는 `node --experimental-strip-types packages/server/src/mcp-bridge.ts`로 띄운다.

테스트 → 가짜 → 구현의 관계:
```
vitest → createApp/어댑터(구현) → fake-claude.mjs / fake-codex.mjs (FAKE_LOG에 기록)
                ↓                          ↓ MCP stdio
         fake-telegram (HTTP)       mcp-bridge.ts(구현) → 앱 HTTP
```
