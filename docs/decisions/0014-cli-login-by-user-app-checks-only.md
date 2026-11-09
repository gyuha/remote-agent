---
author: gyuha
decided: 2026-11-09
---
# CLI 로그인은 사용자가 공식 방식으로 직접 하고, 앱은 상태 점검과 안내만 한다

앱은 CLI 로그인을 대신하지 않고 토큰도 저장하지 않는다. 사용자가 해당 머신에서(리눅스는 SSH로) 각 CLI의 공식 방법으로 로그인한다. 앱은 시작할 때와 웹 UI에서 CLI별 로그인 상태를 보여주고, 로그인이 안 되어 있으면 아래 방법을 안내한다. 이유: 공식 바이너리가 자기 로그인 정보를 스스로 관리하게 두어야, 우리 앱이 비밀을 관리하는 주체가 되지 않고 "토큰을 꺼내거나 중계하지 않는다"는 원칙(`docs/research/2026-11-09-references.md` §4)도 지킬 수 있다.

## 안내할 방법 (2026-11-09 공식 문서 기준)
- **Claude Code**: SSH 안에서 `claude`의 `/login`을 실행하고 `c`로 URL을 복사한 뒤, 로컬 브라우저에서 로그인하고 코드를 붙여 넣는다(`~/.claude/.credentials.json`, 자동 갱신). 다른 방법: `claude setup-token`(1년 토큰)을 `CLAUDE_CODE_OAUTH_TOKEN`으로 설정한다. 출처: https://code.claude.com/docs/en/authentication
- **Codex**: `codex login --device-auth`(베타, ChatGPT 보안 설정에서 먼저 켜야 함), 또는 `ssh -L 1455:localhost:1455`로 터널을 열고 `codex login`. `auth.json` 복사는 갱신 토큰 충돌 여부가 문서에 없어 권하지 않는다. 출처: https://learn.chatgpt.com/docs/auth

## 실행기 제약
- Claude는 `--bare`로 실행하지 않는다(OAuth를 무시함). 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN`을 제거한다(이 값들이 구독 로그인보다 우선함).
- `codex app-server`가 CLI와 같은 로그인 정보를 쓰는지는 첫 빌드에서 `account/read`로 확인한다.

## 기각한 대안
- 웹 UI의 로그인 도우미(setup-token 붙여넣기 칸, app-server 장치 코드 연동): 설치는 편해지지만 토큰을 앱이 저장하게 된다.
