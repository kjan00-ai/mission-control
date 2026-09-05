---
type: review
project: mission-control
date: 2026-06-30
status: draft (동기 L2)
author: claude
phase: B.4 진입점4 — c6-ready readLeak() 연결 + cron + 임계 결재
refs:
  - "[[2026-06-30-b4-ep4-leak-harvest-spec]]"
  - "[[2026-06-30-b4-ep4-c6-leak-impl]]"
---

# 진입점4 통합: readLeak() 연결 + cron + c6-policy ready 결재 (동기 L2 대상)

## 1. c6-ready readLeak() 연결 (draft `c6-ready.readleak-draft.js`, T3·A2 → 대표 ! cp)
- 신규 `readLeak(BOOT)`: `state/c6-leak.json` 읽어 **measured 계약**(L2 f3ea73e6) — `measured!==true || typeof leakRate!=='number'` ⇒ `{leakRate:null, measured:false}`(파일부재 포함). null→0 오독 차단.
- ★ **손상 JSON 안전**(L2 `66194db0`): readLeak 전체가 `try/catch` — JSON.parse 예외(손상/부분 파일)도 catch→`{leakRate:null,measured:false}`(fail-closed), computeReadiness throw 불가. 생산측 c6-leak.js는 **atomic write**(`temp+rename`)라 부분파일 읽기 자체가 방지됨(2중 안전).
- computeReadiness: l2 빌드 후 `l2.leakRate = leak.measured ? leak.leakRate : null` 주입(+`l2.leakMeasured`). decideReady leak 게이트(ep3)가 소비: leakPipelineLive=false면 무관 fail-closed / true면 null⇒fail-closed.
- 검증: c6-leak.json(measured=false,executed=0) → readLeak→null → 게이트 fail-closed. draft --list 정상.

## 2. cron 등재 (c6-daily-batch.sh, 게이트 미대상 → 직접)
- `run leak c6-leak.js`를 `run ready` **직전**에 삽입 — c6-leak.json 갱신 후 c6-ready가 소비. 구문 OK. 멱등(advisory).

## 3. c6-policy ready 결재 (c6-policy.json, A2 → 대표 ! 적용)
- `ready` 섹션 신설(코드default→대표결재): nMin30·l2MinSamples5·l2WindowDays30·coverageMax0.20·l2BlockerRateMax0.05·leakMax0.05 + **leakMinSamples20·settleDays7·leakWindowDays30**(L2 `73efb577`).
- ★ **leakMinSamples를 policy canonical로**(L2 `73efb577`): flip 전제 `executed≥leakMinSamples`가 측정·집행 가능하려면 정본이 필요 → c6-leak.js를 **CLI arg > c6-policy.ready > default** precedence로 보강(c6-ready와 동일 정본 읽음, 기준 불일치 제거).
- ★ **leakPipelineLive=false 유지(flip 보류)**: 현 executed=0(instrumentation ramp-up) → 표본 성숙(executed≥leakMinSamples=20) + 배관 신뢰 확인 후에만 대표 flip. 지금 flip해도 leakRate=null→fail-closed라 무해하나, 의미있는 게이트가 아니므로 보류가 정직.

## 4. 안전 속성
- 모든 변경이 fail-closed 보존: readLeak 미측정/손상⇒null, leakPipelineLive 기본 false, 임계는 보수값. 라이브 enforcement 무변경(전부 advisory/shadow). c6-ready.js·c6-policy.json은 A2라 대표 ! 적용.

## 5. 동기 L2 (2026-06-30, claude∥gemini, 3R) — 반영
corroborated 2(반영): `73efb577`(leakMinSamples 정본 누락 → policy 추가 + c6-leak precedence 보강), `66194db0`(readLeak 손상 JSON 실패모드 → try/catch parse 안전 + atomic write 명시). escalate 2 — 대표 판정 완료(2026-07-01, 둘 다 대질자 손·현행): `7716c27b`(executed=0 measured 미핀고정 fail-open — **gemini 손**: leakPipelineLive false + measured=executed≥minSamples 불변식 이중방어라 fail-open 불가), `d1d0bbf3`(활성화 기준 모호 — **claude 손**: executed≥leakMinSamples 정량+대표 책임+지연 무해, 73efb577 정본화로 흡수). 변경 없음. 미검증0·파싱실패0. 집계 `reviews/...-readleak-wire-l2-deepen-r3-20260630-160114.md`. 재검증 22/22 pass.
