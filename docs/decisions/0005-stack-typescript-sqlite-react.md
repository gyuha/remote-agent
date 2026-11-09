---
author: gyuha
decided: 2026-11-09
---
# 기술 스택: TypeScript(Node) + SQLite + React(Vite), 하나의 저장소

서버와 관리 웹 UI를 TypeScript로 작성한다. 상태는 SQLite에 저장한다. 언어 하나로 에이전트 정의와 이벤트 스트림 타입을 서버와 UI가 공유할 수 있다. 메신저 라이브러리(grammY, discord.js, @slack/bolt)와 CLI 연동(Codex app-server JSON 스키마, OpenCode JS SDK, Claude Agent SDK TS판)도 TS 생태계가 가장 두텁다. 1인 전용 단일 프로세스이므로 SQLite로 충분하고, 별도 DB 서버가 없어 macOS와 Linux 설치가 단순하다.

## 기각한 대안
- Go + 별도 React: 단일 바이너리 배포가 장점이지만 언어가 둘이 된다.
- Python(FastAPI) + 별도 React: 언어가 둘이 되고, 메신저·CLI 연동의 이점이 없다.

## 결과
배포 시 Node 런타임이 필요하다(또는 단일 바이너리 패키징 방식을 따로 검토).
