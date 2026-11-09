---
author: gyuha
decided: 2026-11-09
---
# MVP 범위: 텔레그램 하나 + Claude Code·Codex

첫 빌드의 메신저는 텔레그램 하나, CLI는 Claude Code와 Codex 두 개로 한다. 텔레그램은 설정이 가장 적고(BotFather, long polling), 인라인 키보드로 권한 승인 UI를 바로 만들 수 있다. CLI를 처음부터 두 개 넣는 이유는 어댑터 추상화가 한 CLI에만 맞춰지는 것을 막기 위해서다. Claude Code와 Codex는 화면 없이 실행하는 모드의 문서와 승인 위임 장치가 가장 잘 갖춰져 있다 (`docs/research/2026-11-09-references.md` §3).

## 결과
- 메신저와 CLI 모두 내부 인터페이스로 추상화한다. 디스코드·슬랙·OpenCode·`agy`는 2차에 붙인다.
- 실제 주 사용 메신저가 슬랙이나 디스코드라면 이 순서를 다시 검토한다.
