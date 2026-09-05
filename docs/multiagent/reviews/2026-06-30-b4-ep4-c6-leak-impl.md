---
type: review
project: mission-control
date: 2026-06-30
status: draft (동기 L2)
author: claude
phase: B.4 진입점4 — c6-leak.js 구현 검토
refs:
  - "[[2026-06-30-b4-ep4-leak-harvest-spec]]"
---

# 진입점4 c6-leak.js 구현 검토 (동기 L2 대상)

> spec(L2 corroborated 6 반영본)을 구현. 본 문서 = 구현 자체의 동기 L2 검토용.

## 구현 요약 (`~/.ai-bootstrap/c6-leak.js`)
- **pure core `harvestLeak(auditRecs, execResults, revertSet, marks, now, opts)`**:
  - 분모 = audit `decision∈{allow,cutover-allow}` ∧ **commit-op**(keyOf→exec SHA 조인 성공) ∧ **성숙 창**(`inWindow`: `[now-(W+S)d, now-Sd]`, S=settleDays 유예). 도메인=자율 commit-op(L2 e5445c17).
  - 분자 ⊆ 분모(L2 cbd160b0): 분모 op 중 ① sha∈revertSet(접두매칭) ② opId∈marks. dedup by opId(이중계수 방지).
  - `executed < minSamples` → `leakRate: null`(fail-closed). 산출에 domain·caveats·settleDays·sources 명시.
- **`parseRevertedShas`**: "This reverts commit <sha>" 역참조 추출(grep보다 정확, L2 권고).
- **`shaMatch`**: 접두 양방향 매칭(min 8 hex) — exec sha ↔ revert sha 길이 불일치 대비.
- **IO shell**: audit risk-*.jsonl(allow) + exec-results-*.jsonl(key→sha) + repo별 `git log --grep 'This reverts commit'` 역참조(revertSet) + marks → harvest → `state/c6-leak.json` atomic. `--dry`/`--list` 미작성 조회.

## 검증
- 단위테스트 7 pass: inWindow(성숙창)·parseRevertedShas·shaMatch(8hex 거부)·도메인필터·분자⊆분모·표본부족 null·mark dedup.
- 실데이터 진단: audit allow 1616 / exec-results 24 / **keyOf 조인 매칭 3건**(조인 작동 확인). 현 harvest=`executed 0`=정직 fail-closed — exec-instrumentation 6/24 시작+settleDays 7이라 **성숙 데이터 아직 없음**(ramp-up). 시간 경과로 채워짐.

## 비범위(spec §5·§7 후속)
- 非commit op 유출·forward-fix FN·git reset 미탐지(reset은 흔적 부재) — caveats 명시.
- c6-ready `readLeak()` 연결 = c6-ready.js(T3·A2) → 대표 ! 패치.
- cron 등재(hermes, c6-ready 직전) + leakMax/leakMinSamples 결재 + leakPipelineLive flip = 대표.

## 안전 속성 (L2 corroborated 반영)
- **대부분 과소측정 방향**이나 **예외 존재**(L2 `ce346f56`): shaMatch 접두충돌·marks 오설정은 분자 위양성(**과대측정**) 가능 → 단 과대측정은 **보수적=차단 방향**(unsafe 아님). shaMatch floor 8→**12**로 충돌확률 무시(16⁻¹²).
- **null=fail-closed는 소비자 계약으로 성립**(L2 `0acb35dd`): 본 모듈은 null을 *생산*만. 차단 효력은 c6-ready ep3 `decideReady`가 보증 — `leakPipelineLive=false`(기본)면 leakRate 무관 fail-closed, `true`면 `leakRate===null` → "결함유출률 미측정 — fail-closed"(ep3 구현 라인). 즉 null→leak0 fail-open 불가(소비자가 null을 block 처리). 본 구현은 그 계약의 생산측.
- **롤링 윈도 특성 고지**(L2 `21a575d9`): `[now-(W+S)d, now-Sd]` 슬라이딩이라 누적 아님 → 저표본(minSamples 부근)서 단일 revert가 leakRate 크게 흔들고 창 이탈 유출은 이력손실. caveats `rolling-window-variance` 추가. 완화=minSamples(저표본=null)+fail-closed.
- 종합: ① 표본부족=null=fail-closed(소비자 계약) ② leakPipelineLive 기본 false ③ flip은 대표 caveat 인지 후 — 측정 불완전이 자동활성으로 새지 않음.

## 동기 L2 (2026-06-30, claude∥gemini, 3R) — 반영
corroborated 3 반영(위): `ce346f56`(과대측정 예외+shaMatch 12), `0acb35dd`(null 소비자 계약 명시), `21a575d9`(롤링윈도 고지+caveat).

**escalate 3 — 대표 판정 완료(2026-06-30):**
- `49d1ded5`(계측 0.2% 선택편향): → **제기 반영.** caveats에 `selection-bias(instrumented-subset)` 추가(전체 자율 op 비대표 정직 고지).
- `f3ea73e6`(null 오해석): → **제기 반영(추가 방어).** 출력에 `measured:boolean` 신설 — 소비자는 leakRate 값이 아니라 `measured===false`로 미측정 판정(null→0 오독 차단). ★readLeak()(T3 후속) 계약: `measured===false || leakRate===null` ⇒ fail-closed.
- `b5e8a953`(git log 부하): → **대질자(claude) 손·현행.** 실규모 작고 실패=과소측정=안전방향, try/catch·timeout·since 기존. 변경 없음.

미검증0·파싱실패0. 집계 `reviews/...-l2-deepen-r3-20260630-153426.md`. 재검증 7/7 pass.
