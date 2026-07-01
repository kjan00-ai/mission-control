---
type: spec
project: mission-control
date: 2026-07-01
status: 설계확정(2벤더 L2 3R + corroborated 4 반영 + escalate 3 대표판정 2026-07-01) — 구현(c6-intervention.js)은 대표 인가 후
author: claude
phase: B.4 결정 D — 대표 개입률 지표화
decision_gate: 대표 ! (지표 배관 가동 = T2+·A2 인접)
refs:
  - "[[2026-06-30-b4-ep2-threshold-x-rederivation]]"
  - "[[2026-06-30-b4-ep4-leak-harvest-spec]]"
  - "[[transcript-modal-response-source]]"
---

# B.4 결정 D — 대표 개입률 지표화 (spec)

> 진입점2 §5 결정 D 구현. **대표 개입(escalation·활성화 !) 빈도를 추적 지표로** — 자율화가 실제로 개선되는지(개입 감소)를 측정.
> ⚠️ 목표 = "절대 0"이 아니라 **감소 추세**(진입점2 `b74758ac`: "개입률 0 수렴"은 "고위험 항상 게이트"와 Goodhart 모순 → 고위험 제외·감소추세로 정정).

## 0. 목적·성격
- 개입률이 시간 경과 **줄면** = 자율화 성공(AI 검증이 신뢰 쌓임). **안 줄면** = 과보수 게이트 신호(조사 대상).
- ★ **지표일 뿐 게이트 아님**(health signal). 라이브 enforcement 무변경. 새 결재 0(passive harvest).
- ★ 고위험(T3·비가역)은 구조적으로 항상 게이트 → 목표-0 대상에서 **제외**(별도 집계, 상시 non-zero 정상).

## 1. 신호원 (passive — 실데이터 확인)
- **개입① escalation(대표 판정 대기)**: durable bus. ★ **honest escalation만** — raw `escalation_count`는 예산소진(unverified) 오염(진입점2). `l2_rounds.canonical_items`에서 `verified===true ∧ status='escalate' ∧ resolution∈{split,uncertain}`(genuine 미합의)만. severity important+ 스코프.
- **개입② 활성화·승인 `!`**: audit엔 마커 없음(실측 0/1756) → **transcript 출처**. c6-label(human reject/executed 라벨, [[transcript-modal-response-source]])의 대표 결정 이벤트.
  - ★ **"개입" 정의(L2 `72b39862`)**: 대표가 게이트된 결정에 **손을 대야 했던 모든 이벤트** = reject **및** executed(=`!` 승인) **둘 다** 카운트(결과 무관 — 개입=대표 주의 소요). approve/reject 구분은 부가 필드로 보존하되 개입 총량엔 합산.
- **위험 층화**(L2 `1c4f0d47`): 각 개입 op의 risk 등급(risk-classify T0~T3)으로 분리 — T3/비가역="구조적 게이트"(제외), T0~T2="목표 대상".
  - ★ **op-mapping**: c6-label 이벤트는 **특정 op(tool/cmd)에 붙은 라벨**이므로 그 op의 command를 risk-classify에 넣어 T등급 산출. op/cmd가 없는 이벤트(모달만)는 **`unclassified` 버킷**(targetable도 structural도 아님 — 보수적 제외, caveat 노출). escalation(개입①)도 동일하게 원 op의 risk로 층화.

## 2. 지표 (state/c6-intervention.json)
```
{ window: {recent: <Nd>, prior: <Nd>},
  targetable: { recent: r1, prior: r0, trend: 'down'|'flat'|'up'|'insufficient', delta: r1-r0 }, // T0~T2(감소 목표)
  structural: { recent: s1, prior: s0 },        // T3/비가역(상시 게이트, 참고)
  unclassified: { recent: u1, prior: u0 },      // op 없는 이벤트(보수적 제외)
  sources: { escalation: e, ownerBang: b, ownerBangByOutcome: {approved: a, rejected: rj} },
  measured: <bool>,   // ★ targetable 표본 기준(L2 00ff3939): targetable(recent+prior) < targetableMinSamples ⇒ false
  caveats: [...], ts, generatedBy: 'c6-intervention.js' }
```
- **추세 판정 규칙(L2 `5b9dca28`)**: prior rate `r0` 대비 상대 band ε(기본 0.15). `measured===false || prior<targetableMinSamples` ⇒ `trend='insufficient'`(판정 보류). 아니면:
  - `delta ≤ -ε·max(r0,baseFloor)` ⇒ `'down'` / `delta ≥ +ε·max(r0,baseFloor)` ⇒ `'up'` / else `'flat'`. (baseFloor=저표본서 0 division 방지 최소 기준.)
- **measured = targetable 모집단 기준**(L2 `00ff3939`): structural이 표본을 채워도 targetable 표본이 얕으면 measured=false → 노이즈 추세 확정 방지. (총 개입 아님.)
- 목표 = `targetable.trend==='down'` 지속. `up` 지속이면 과보수 신호 → 리포트 경보(텔레그램은 **연속 up N회**일 때만, 노이즈 억제).

## 3. 신규 모듈 c6-intervention.js
- pure core `computeIntervention(escRecs, labelEvents, now, windows, minSamples)` → §2 산출. 위험 층화·honest 필터·추세. 테스트 가능(IO 분리).
- IO shell: durable bus(honest escalation) + c6-label state(대표 개입) 읽어 harvest → state/c6-intervention.json atomic + advisory 리포트(위키 `interventions/`). cron(c6-daily-batch, ready 부근).
- fail-soft: DB/label 부재 → measured:false(추세 보류, 게이트 아니라 fail-closed 개념 없음 — 단 과신 금지).

## 4. b74758ac 정정 반영 (Goodhart 회피)
- 절대 0 목표 금지 → **감소 추세**가 KPI. 고위험 제외로 "개입 줄이려 게이트 약화" 유인 차단(고위험은 지표에서 빠지므로 게이트 유지가 지표에 불리하지 않음).
- 지표를 **최적화 대상 아닌 관측 신호**로: 개입률 자체를 낮추려 게이트를 함부로 열면 안 됨(그건 유출률↑로 드러남 — 결정 C/진입점4와 교차검증).

## 5. 미결(대표·동기 L2 확정)
1. window 크기(recent/prior 각 며칠, 기본 14/14 제안) + targetableMinSamples(제안 10) + band ε(0.15) + baseFloor — 수치 대표 결재.
2. ~~개입② 이벤트 식별~~ → §1 해소(reject+executed 둘 다=개입).
3. ~~추세 판정 통계~~ → §2 해소(상대 band ε 규칙).
4. escalation honest 필터가 진입점1 이후 데이터만 → 초기 표본 작음(진입점2 N=7 제약). insufficient 추세로 정직 표기.

## 6-L2. 동기 L2 검증 (2026-07-01, claude∥gemini, 3R) — 반영
> corroborated 4 · escalate 3 · 미검증0·파싱실패0 · 적응형예산 8→9. 집계 `reviews/...-decisiond-...-deepen-r3-20260701-214751.md`.

**corroborated 4 — 반영(설계 구현가능화):**
- `5b9dca28`(blocker): trend 판정규칙 부재 → §2 상대 band ε 규칙 + `insufficient` 상태 정의.
- `00ff3939`: measured 모집단 불일치(총 개입 vs targetable 추세) → §2 measured=**targetable** 기준.
- `1c4f0d47`: 개입② op-mapping 부재 → §1 c6-label 이벤트의 원 op를 risk-classify, op 없으면 `unclassified` 버킷.
- `72b39862`: 개입 정의 미정 → §1 reject+executed 둘 다=개입(대표 주의 소요), outcome은 부가 보존.

**escalate 3 — 대표 판정 완료(2026-07-01, 전부 claude 손·현행, refuted·corroborated로 흡수):**
- `6dbc963c`(blocker): 개입② 정의 모호 → claude refute + `72b39862` 반영으로 해소(개입=reject+executed). severity=blocker 과장.
- `746bd3d6`: severity important+ 불분명 → claude refute(실필터 verified∧escalate∧split/uncertain 완전정의, severity 표준 enum).
- `e8e58079`: 추세 통계 미결 → claude refute + `5b9dca28` band 규칙으로 해소.

## 6. 적용 흐름
draft → 동기 L2 → 대표 ! (c6-intervention.js 구현·cron) → 표본 누적 → 추세 관측(개입 감소=자율화 성공 지표). 결정 C(유출)와 함께 = "자율 확대해도 안전한가"의 2대 신호(유출률↓ ∧ 개입률↓추세).
