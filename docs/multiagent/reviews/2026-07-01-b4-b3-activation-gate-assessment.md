---
type: assessment
project: mission-control
date: 2026-07-01
status: 평가완료
author: claude
phase: B.4 B3 — B 카테고리 활성화 조건 평가
refs:
  - "[[2026-06-30-b4-ep3-c6-ready-rewrite-spec]]"
  - "[[2026-06-30-b4-ep2-threshold-x-rederivation]]"
---

# B.4 B3 — B 카테고리 활성화 조건 평가

> 현 상태에서 B 카테고리(cutover) 활성화가 가능한가 실측 평가. 설계 아닌 현황 진단.

## 결론
**활성화 현재 불가** — 4개 게이트 중 3개 미충족. 지배적 blocker = **per-category 증거(observedPositive 0/30)**. 설계상 의도된 보수(급하게 활성화 안 함).

## 게이트 현황 (실측 2026-07-01)
| 게이트 | 현재 | 임계 | 판정 | 성숙 경로 |
|---|--:|--:|:--:|---|
| 1. honest L2 표본 | 7 | ≥5 | ✅ PASS | (진입점1 이후 누적) |
| 2. 검증 커버리지(미검증율,artifact) | 28.6% | <20% | ❌ | 진입점1 예산수리 누적 → 미검증 하락(수 주) |
| 3. 결함유출(leakPipelineLive) | false | 가동+<5% | ❌ | B2 조인개선 → 표본성숙 → 대표 flip(수 주) |
| 4. per-category observedPositive | 0 | ≥30 | ❌ | c6-daily-batch 거부라벨 누적(카테고리당 30, **수개월**) |
| 4b. doubleDanger | git-commit:branch-gate=🚨🚨1 | =0 | ❌ | 그 카테고리 구조적 차단(안전 정상) |

## 분석
- **지배적 blocker = 게이트4(증거 축적)**: observedPositive는 카테고리당 30건 누적이 필요한데 현 전부 0. c6-daily-batch(매일 09:30)가 transcript 거부/실행 라벨을 누적하나 30 도달은 최장 축(수개월). = 활성화의 실질 병목.
- 게이트2·3은 진입점1/B2로 성숙 경로가 명확(수 주). 게이트4가 이들보다 훨씬 길다.
- `git-commit:branch-gate`의 🚨🚨1은 그 카테고리를 상시 차단(doubleDanger — 심각 안전신호). 정상 동작.
- ★ 이 다중 게이트 fail-closed는 진입점2/3 취지 그대로: **증거·검증·유출 신호 위에서만 자율 확대**. 현 미충족 = 아직 근거 부족 = 활성화 보류가 정직.

## 권고
1. **활성화 강행 금지** — 4게이트 전부 충족까지 대기(자연 누적). 강제는 대표 per-category `--force`(c6-activate)만, 알고서.
2. 성숙 촉진: 진입점1 데이터 누적(커버리지) + B2 구현(유출 표본) + c6-daily-batch 지속(증거) = 3축 병행.
3. 재평가 주기: 월 1회 c6-ready --list로 게이트 전이 관측(ready 전이 시 텔레그램 자동).
4. ⚠️ 관찰: observedPositive가 "거부 라벨" 축적 의존 → 자율화가 잘 될수록(거부 적음) 증거가 더디 쌓이는 긴장. 증거 정의(c6-evidence)의 축적원이 거부만인지 별도 검토 후보(후속).
