# LOOP — roadmap의 서버 남은 작업 4건 구현 (allow_session 제어 문자, appendEvent, 429 재시도·키보드 제거, 위임 토픽 중복 생성)
started: 2026-11-10
replan-round: 0
replan-cap: 3
budget-tokens: none
budget-spent: 0 · since: 2026-11-10T00:00:00Z
wall: blocked-health (pnpm)

실행 방식: 각 태스크는 paseo 팀 역할에 위임한다 — qa(tests/acceptance)가 실패하는 인수 테스트를 먼저 쓰고 오케스트레이터가 검토 → server(packages/server) 구현 → docs(docs) 갱신 → qa가 `task check` 전체 확인. (사용자 결정, 2026-11-10)

## Stop-condition checks (ALL must pass)
- [ ] C1. `task check` → exit 0 (build·lint·단위·인수 테스트 전부, 회귀 방지)
- [ ] C2. `pnpm test:acceptance -t "allow_session control"` → exit 0, 통과 테스트 ≥1, 실패·skip 0. 내용: `npm test`를 allow_session한 뒤 `&&` `;` `||` `|` 백틱 `$(` `>` `<` 줄바꿈이 들어간 `npm …` 명령은 각각 새 승인 요청을 만든다(자동 허용 아님). 제어 문자가 든 명령을 allow_session해도 세션 허용이 생기지 않는다. `npm run build`는 여전히 자동 허용된다.
- [ ] C3. `pnpm test:acceptance -t "appendEvent"` → exit 0, 통과 ≥1. 내용: 가짜 텔레그램·CLI로 도구 호출과 승인이 포함된 턴을 1회 돌린 뒤 events 테이블에 수신 메시지, 어댑터 이벤트, 승인 요청·결정, 턴 결과 행이 해당 chat_id·thread_id와 함께 있다.
- [ ] C4. `pnpm test:acceptance -t "telegram 429"` → exit 0, 통과 ≥1. 내용: 가짜 텔레그램이 sendMessage에 429(retry_after=1)를 한 번 돌려주면 그 메시지가 정확히 1번 전달된다. 승인 결정 뒤 해당 승인 메시지의 인라인 키보드가 제거된다.
- [ ] C5. `pnpm test:acceptance -t "delegation topic dedup"` → exit 0, 통과 ≥1. 내용: 같은 (호출 세션, 대상 에이전트)로 send_to_agent를 동시에 2번 호출하면 createForumTopic이 정확히 1번 불린다.
- [ ] C6. 문서: `ls docs/decisions/0015-*.md`가 1개이고 그 파일이 0009를 참조한다(`grep -c 0009` ≥1). `grep -n "superseded\|대체" docs/decisions/0009-*.md` ≥1. `docs/architecture.md`의 allow_session 설명에 제어 문자 예외가 있다(`grep -c "제어 문자" docs/architecture.md` ≥1). `docs/roadmap.md`의 "1단계 구현 뒤 남은 작업"에 allow_session·appendEvent·429·토픽 중복 항목이 남아 있지 않다.

## Check progress
- C1: blocked ×1 · recheck 2026-11-10: `command -v pnpm` → 없음 (로그인 셸 포함) · last-evidence: "task check → `\"pnpm\": executable file not found in $PATH`, exit 201 (package.json packageManager pnpm@12.14.0, ~/Library/pnpm/.tools에는 8.0.0~10.12.1만 있음)"
- C2–C5: not run (pnpm 없음)
- C6: not run

## Authorized replan scope
- 실패한 체크로 직접 추적되는 fix-forward 태스크만. 수정 범위: packages/server, tests/acceptance(가짜 포함), docs
- 제외: packages/web(웹 UI), 실제 텔레그램·claude·codex 호출, 테스트 기대값 완화
- always-halt action classes: prod data mutation/deletion · deploy/release/publish · outbound external comms (email · messaging · third-party write APIs) · irreversible VCS/file destruction (force-push · history rewrite · mass deletion) · financial/payment · secret/permission change · privacy-data exposure

## Tasks
- allow-session-control-chars
- append-event-logging
- telegram-429-retry-keyboard-removal
- delegation-topic-dedup
- roadmap-architecture-sync
