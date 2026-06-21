---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.2 (L2 round1~3 반영 — blocker 3·important 5 전건 수정)
track: C6-3 Phase A (신뢰계측 — cutover 선행)
status: L2-converged
l2_ref: "[[2026-06-21-c6-3-phasea-trust-metrics-spec-l2-deepen-r3-20260621-143439]]"
---

# C6-3 Phase A — 신뢰계측 (모달→검증 cutover의 안전 선행)

> C6 §2.1 cutover("모달을 검증으로 교체")는 **인간 승인 폐지**라 비가역 정책결정. 스펙 C6-0: **신뢰 계측이 cutover에 선행**. 본 문서 = cutover를 **2단계로 staging**하고 그 1단계(섀도우 계측)를 정의한다. **라이브 enforcement는 0 변경.**
>
> - 선행: [[2026-06-13-c6-verification-over-approval-spec]] §2.1·§1.2 / C6-0.2 분류기(`policy-classify`) / C6-1 다이제스트 / C6-2 가역화.
> - SSOT: 코드/spec=repo, 지식=위키. `[기획결정]` = 본 MVP 확정.

## 0. Staging (★ 안전 경계)
- **Phase A (본 MVP)**: 섀도우 — 감사로그 각 op에 **C5 라이브 결정 vs C6 검증모델 결정**을 대조·집계. ★ **"cutover-ready"를 산출하지 않는다**(L2 blocker `96246977`·`7fabc03b`): 정책 합치만으로 인간 승인을 폐지하면 허위 신뢰. Phase A의 출력 = (a) **C5↔C6 합치/발산 통계**, (b) **🚨 발산 = 필수 인간 판정 목록**, (c) **인간라벨 수집 대상**(모달→C6자율 후보 위치). 라이브 게이트·모달 불변.
- **Phase A.5 (선결, 별도)**: **모달 응답 로깅** — 인간이 모달에서 실제 승인/거부한 결과를 기록. 이 라벨 없이는 진짜 신뢰계측(C6 vs 인간) 불가(H1). Phase A가 이 수집의 *대상*을 알려줌.
- **Phase B (이연·대표 게이트)**: 실제 모달 제거. **(a) Phase A.5 인간라벨로 카테고리별 C6=인간 합치 입증 + (b) 무회귀(🚨=0) + (c) 대표 명시 승인** 3조건. 에이전트 자율 flip 금지.

## 1. 목표 / 비목표
**목표**
- G1. **`c6-trust.js`**: 감사로그를 읽어 op별 {C5 decision, C6 effectiveDecision, V floor} 대조 → **합치/발산 집계 + 카테고리(ruleId)별 분포** 리포트(위키, 멱등·불변).
- G2. **발산 분리 집계**: "C5 stricter than C6"(🚨 C6가 더 느슨 — 필수 인간 판정) vs "C6 stricter"(🛡️ 잠재 안전강화) vs "합치". §2.1 셀.
- G3. **인간라벨 수집 대상 산출**(★ ready 아님): `C5 ask → C6 allow/delay` 위치를 **"Phase A.5 모달응답 로깅이 필요한 카테고리"**로 표기. **준비도(ready) 판정은 Phase A 비범위** — 인간라벨(Phase A.5) 확보 후 Phase B에서만.

**비목표**
- N1. 라이브 게이트/모달 변경 **아님**(섀도우 only).
- N2. 실제 L2 도구호출마다 실행 **아님**(스펙 §2.1: 풀 L2는 결정지점만 — 본 계측은 분류기 기반 경량, L2 결과는 가용시 조인).
- N3. 자동 cutover **아님**(Phase B는 대표 게이트).

## 2. 설계 — `c6-trust.js`
```
입력: --since <ts> --project <name>
① 감사로그 스캔 → op {tool,path,cmd,cls,decision(C5),ruleId,ts}
② C6 결정: policy-classify(op) → {executionLevel(E), effectiveDecision(C6), verificationDepth(V), riskFlags}
③ 대조 분류(§2.1)
④ 집계: 전체 일치율 + 카테고리(ruleId)별 {n, C5분포, C6분포, 발산종류} + cutover 후보
⑤ 위키 신뢰 리포트 + (선택) 요약 1줄
```

### 2.1 대조 셀 (C5 decision × C6 effectiveDecision)
| C5(라이브) \ C6 | allow | delay_* | deny |
|---|---|---|---|
| **allow** | ✅ 합치 | 🛡️ C6 보수 | 🛡️ C6 안전강화 |
| **ask**(모달) | 🏷️ 라벨대상(모달→자율) | 🏷️ 라벨대상(모달→지연) | ↔ 보수 합치 |
| **deny** | 🚨 발산(완화) | 🚨 발산(완화) | ✅ 합치 |

- 🏷️ = **인간라벨 수집 대상**(cutover "후보"가 아님 — 인간 모달응답 라벨 확보 후에야 판정, L2 `96246977`).
- 🚨 = **C5 deny인데 C6 not-deny(allow OR delay)** = C6가 하드블록을 완화(L2 `05eb56c8`로 delay까지 포함). ★ **"영구 차단"이 아니라 "필수 인간 판정"**(L2 `f6a8ba77`): 정당한 C5 false-positive 완화일 수도, 분류기 갭일 수도 → **인간이 건별 판정**(자동 영구블록 금지). 판정결과는 Phase A.5 라벨로 축적.

### 2.2 출력 (★ ready 미산출 — 발산분석 + 라벨대상)
- 카테고리(ruleId)별: `{n, C5분포, C6분포, 🏷️수, 🚨수, V floor 분포}`. **window=전기간(또는 `--since`), 분모=해당 ruleId의 C5 op 수**(L2 `3bd8c8f6` 측정가능화).
- 🏷️ 카테고리 = "Phase A.5 라벨링 우선순위" 목록(n 높은 순). **ready 플래그 없음.**
- **V floor 게이트(L2 `cb23fdac`)**: 🏷️ 항목이 장차 cutover되려면 C6 경로가 **실제 검증(V≥V1) + 통과기준**을 포함해야 함을 명시 — `C6 allow + V0(검증없음)`은 "인간도 검증도 없는 자율"이라 **라벨대상에서 제외**(별도 ⚠️로 표기). 본 리포트는 각 🏷️의 V floor를 노출해 "검증 없는 완화"를 가림.

### 2.3 멱등·수명주기 (L2 `7479645c`·`50e63393`)
C6-1과 동형: opId(`sha1(ts|tool|path|cmd)`) 중복제거 + hard-link 락 + tmp+rename + 워터마크 성공후 전진. 리포트 = **불변 일자별 run 파일**(`trust/C6-TRUST-{date}-{run}.md`), 재실행은 신규 파일(기존 미변경 → 운영자 메모 보존·중복 0).

## 3. ★ 정직한 한계 (핵심)
- **H1 (결정적)**: 감사로그는 **C5 정책 결정**(ask/deny/allow)만 기록하고 **모달에 대한 인간의 실제 응답(승인/거부)은 미기록**. 따라서 본 계측은 **"C6 vs C5-정책" 합치도**이지 **"C6 vs 인간 판단"이 아니다.** 스펙 C6-0이 요구한 진짜 신뢰계측(L2 vs 인간)에는 **모달 응답 로깅(별도, Phase A.5)** 이 필요 → 본 MVP는 그 전제로서 정책합치 + 발산탐지를 제공하고, 인간라벨 수집을 **Phase B 선결로 명시**.
- H2. policy-classify는 advisory(C5 데이터 사후 재구성, [[C6-1]] H1과 동일) → 등급은 정책버전 스탬프.
- H3. L2 실판정 조인은 산출물 op 한정(C6-1과 동일).

## 4. 검증 계획
- 골든 픽스처: 합성 op(C5 allow/ask/deny × C6 allow/delay/deny 조합) → 대조 셀·집계·cutover 후보·🚨 탐지 정확성 단위테스트.
- 종단: 실제 감사로그 → 리포트 1건(일치율·카테고리·후보·🚨).
- read-only(워터마크 외 부작용 0). maia-deploy drift 0.

## 5. 매니페스트/SSOT
- `c6-trust.js`·`c6-trust.test.js` → shared.boot. 리포트=위키. 코드=repo.
