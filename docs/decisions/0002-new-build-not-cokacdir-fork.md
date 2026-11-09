---
author: gyuha
decided: 2026-11-09
---
# 새로 구축한다. cokacdir는 포크하지 않고 참고만 한다

cokacdir(MIT, Rust)는 CLI 4종과 메신저 3종 연결을 이미 구현했다. 그래도 새 코드베이스로 시작한다. 웹 관리 UI, 폴더별 다중 에이전트 정의, 오케스트레이터는 cokacdir의 "채팅 하나 = 작업 폴더 하나" 모델을 바꾸는 작업이다. 그런데 그 코드는 거대한 단일 파일 위에 서 있다(2026-11-09 확인: `src/services/telegram.rs` 1.43MB, `main.rs` 224KB, Rust 합계 약 6MB이며 상당 부분이 파일 매니저 TUI). 또 cokacdir에는 외부 제어 API가 문서화되어 있지 않아, 엔진으로 감싸 쓰는 방법도 불확실하다.

## 참고 방식
CLI 어댑터(`src/services/claude.rs`, `codex.rs`, `agy.rs`, `opencode.rs`)를 버전별 플래그, 세션 ID, 스트림 파싱의 참고 자료로 읽는다. 코드를 그대로 옮겨 오면 MIT 저작권 고지를 함께 남긴다.

## 결과
CLI 버전 변화로 생기는 문제를 직접 감당해야 한다. 기술 스택 선택이 Rust에 묶이지 않는다.
