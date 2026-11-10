<!-- auto-retro: fg-loop -->
# 2026-11-09 — Claude 어댑터 + MCP 브리지

## Plan vs actual
- What went as planned: 두 slice 모두 계약대로 구현됐다.
- Divergences: 없음. 앱 쪽 HTTP 경로를 구현자가 정했다(계약 공백).

## Learnings
- Do differently next time: 오래 걸리는 승인이나 위임을 HTTP로 기다릴 때는 fetch의 기본 헤더 대기 시간(5분)에 걸린다. node:http를 쓰거나 시간 제한을 명시한다.

## Doc updates
- 미검토 (auto retro)
