<!-- auto-retro: fg-loop -->
# 2026-11-09 — 오케스트레이터 위임

## Plan vs actual
- What went as planned: 동기 위임, 호출 체인 잠금 재진입, 하위 에이전트 전용 토픽을 구현했다.
- Divergences: 대상 토픽이 사용 중이면 기다리지 않고 바로 거절한다(교착 방지).

## Learnings
- Do differently next time: 토픽별 큐와 폴더 잠금처럼 잠금이 두 겹이면 교착 경로를 계획 단계에서 표로 정리한다. 이번에는 구현자가 실행 중에 발견했다.

## Doc updates
- 미검토 (auto retro)
