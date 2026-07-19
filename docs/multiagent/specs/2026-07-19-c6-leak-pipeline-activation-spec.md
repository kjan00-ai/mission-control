---
type: spec
project: mission-control
date: 2026-07-19
status: closed
author: claude
intent: spec
round: 1
verdict: "closed — leak 게이트는 현 운영 볼륨서 구조적 미측정. C6 shadow 유지(대표 2026-07-19)"
decision: "B 채택→L2 falsify→A′ 채택→A′도 표본 기아 실측→ 대표 '현 상태 수용'(C6 shadow + Verified Autonomy + `!`). leak 트랙 종결."
artifact_ref: "docs/multiagent/specs/2026-07-19-c6-leak-pipeline-activation-spec.md"
refs:
  - "[[2026-06-30-b4-ep4-leak-harvest-spec]]"
  - "[[c6-leak-harvest-join-blocker]]"
  - "[[b4-ready-verifier-budget-not-metric]]"
  - "[[2026-06-24-a1-a2-b-roadmap]]"
  - "[[c6-3-w5-hardblock-evidence-wall-convergence]]"
---

# 결함유출 측정배관 (결정 C) 활성화 spec — C6 활성화의 유일한 실질 관문

> ⚠️ **draft — L2 미검증.** §5 스코프 결정(대표) 확정 후 codex∥gemini 동기 L2 → 확정.

## 0. TL;DR (실측 반전)

`c6-ready`가 뱉는 **"결함유출 측정배관 미구축 (결정 C 선결)"** 은 이제 **오해 라벨**이다. 배관(`c6-leak.js`)은
**이미 구현·단위테스트·크론 배선 완료**이고 매일 산출물을 낸다. 진짜 블로커는 "코드가 없음"이 아니라 아래 셋:

1. **정책 플래그 `leakPipelineLive=false`** — flip은 대표 결재(T3). = **결정 C의 본체**. (플래그가 곧 게이트)
2. **표본량 부족** — 현재 `executed=9 < leakMinSamples=20`. 성숙창 롤링이라 **steady-state에서 20에 못 미칠 위험**.
3. **신호 품질 약함** — 배관 스스로 5개 caveat을 기록(도메인 commit-op 한정 ≈전체 자율 op의 0.2%, reset 미탐지,
   revert-proxy FP/FN, 롤링분산, 선택편향). "leakRate<5%"가 안전을 얼마나 보증하냐가 flip의 실질 쟁점.

즉 이 spec의 실제 질문은 **"배관을 만들자"가 아니라 "현 배관을 flip해도 되는 기준(결정 C)은 무엇이며, 신호를
믿을 만하게 하려면 무엇을 더 만들어야 하나"** 이다.

## 1. 현재 상태 실측 (2026-07-19)

| 요소 | 상태 |
|---|---|
| `c6-leak.js` (harvest 로직 + 순수코어 + IO shell) | ✅ 구현 (2026-06-30, 9.2KB) |
| `c6-leak.test.js` | ✅ 존재 |
| 크론 배선 | ✅ `c6-daily-batch.sh` (hermes cron `aeb49d8b9aa4`, `30 9 * * *`) 의 `[leak]` 스텝 |
| 산출물 `state/c6-leak.json` | ✅ 매일 갱신. 최신: `{executed:9, leaked:0, measured:false, leakRate:null}` |
| 소비 계약 `c6-ready.readLeak()` | ✅ `measured:true`+`leakRate:number` 만 신뢰, 아니면 fail-closed |
| 정책 플래그 `c6-policy.ready.leakPipelineLive` | ❌ **false** (flip 안 됨) |

**측정 정의(현행):**
- **분모** = 자율(`allow`/`cutover-allow`) **commit-op** 중 exec-results sidecar에 SHA가 포착되고(instrumented),
  성숙창(`now-37d ~ now-7d`) 안에 든 것. = opId 단위.
- **분자** = 분모 op 중 ⓐ `git revert`로 되돌려짐("This reverts commit <sha>" 푸터, SHA≥12hex 접두매칭) 또는
  ⓑ 대표 `--mark-fp` 표기된 것.
- **measured** = `executed ≥ leakMinSamples(20)`. 미만이면 `leakRate=null`(미측정, fail-closed 유지).

## 2. c6-ready 글로벌 게이트가 요구하는 것 (계약)

`c6-ready` 글로벌 통과 = 아래 **전부** 충족(카테고리 활성화의 선결):
- honest L2 표본 ≥ `l2MinSamples(5)` — **현재 0**
- 미검증율 ≤ `coverageMax(20%)`
- **결함유출**: `leakPipelineLive=true` **그리고** `leakRate` 측정됨 **그리고** `leakRate < leakMax(5%)` — **현재 배관 flag off**
- 카테고리별: 관측 양성 ≥ `nMin(30)` **현재 0** · `🚨🚨(doubleDanger)=0`

→ 결함유출은 **3중 게이트 중 하나**일 뿐. 나머지(honest 표본·관측 양성)도 0이라, **결함유출만 풀려도 활성화
안 됨**. 이 spec은 그중 "코드 선결"로 분류돼 있던 축을 정확히 규명하는 것.

## 3. 실질 블로커 3가지 (상세)

### B-1. 플래그 flip 기준의 부재 (= 결정 C 본체)
`leakPipelineLive`는 대표 `!` 로만 켜는 T3 플래그다(A2 자기보호). 지금 **"언제 켜도 되는가"의 명문 기준이 없다.**
켜는 순간 c6-ready가 배관 산출을 신뢰하기 시작하므로, **배관이 틀리면(과소측정) unsafe-allow로 직결**된다.

### B-2. 표본량 — steady-state 도달 가능성 미확인
- 현재 `executed=9`. ~2주간 0→9 축적 = 약 0.6건/일.
- 성숙창이 롤링(창 37일)이라 steady-state ≈ 유입률 × 창. 0.6/일 × 37 ≈ 22 → **20 문턱 아슬아슬**하고,
  유입률이 조금만 낮아지면 **영구히 20 미만**에 고인다(= Option A 단독으론 활성화 불가능할 수 있음).
- 근본 원인은 **분모가 instrumented commit-op only** = 전체 자율 op의 ~0.2% (배관 caveat `selection-bias`).

### B-3. 신호 품질 — caveat 5종
| caveat | 의미 | 안전 영향 |
|---|---|---|
| commit-op only | 비-commit 자율 op(Edit/Write, 파괴적 Bash) 유출 미측정 | 과소측정 → unsafe |
| reset-undetected | history rewrite(reset/force-push)로 지운 유출 미탐지 | 과소측정 → unsafe |
| revert-proxy FP/FN | revert=유출 프록시. 비결함 revert(FP)·미revert 결함(FN) | 양방향 오차 |
| rolling-window-variance | 저표본 분산 | 불안정 |
| selection-bias | 분모=계측 부분집합, 비대표 | 대표성 결여 |

과소측정 방향(commit-op only, reset-undetected, selection-bias)이 문제 — leakRate가 실제보다 **낮게** 나와
"안전"으로 오판할 수 있다. flip 전에 이걸 얼마나 닫을지가 핵심 트레이드오프.

## 4. 결정 C 정의 (제안)

**결정 C = `leakPipelineLive=true` flip을 정당화하는 명문 기준.** 아래를 flip 선결로 제안:

1. **배관 정합성 1회 수동 검증** — 현 산출의 분모/분자를 손으로 대조(현재 9건 전수). exec-results→SHA 매핑,
   revert 역참조, 성숙창 경계가 spec대로인지 실증. (반나절, 코드 0)
2. **표본 문턱 도달** — `executed ≥ leakMinSamples`. 스코프에 따라 20 유지 or 조정(§5).
3. **도메인 커버리지 명문화** — flip 시 c6-ready 리포트/핸드오프에 "leak 측정범위 = <스코프>"를 **명시**해
   과소측정 caveat을 은폐하지 않음(§5 Option에 따라 commit-op-only or 확장).
4. **가역 확인** — flip은 정책 한 줄(true→false) 원복. cutover는 그 위에서 downgrade-only+홀드백+서킷브레이커.

## 5. Option B 확정 설계 (전 자율표면 커버리지 확장)

**목표**: leak 분모를 `commit-op only`(≈전체 자율 op의 0.2%)에서 **자율 파일변경까지 확장**해 (a) 표본량과
(b) 대표성을 동시에 끌어올린다. 분자(undo 신호)도 도메인별로 정의. **기존 인프라 최대 재사용**, 신규 계측 최소.

### 5.1 도메인 (denom) 정의 — 도메인별 harvest, 합산

| 도메인 | 분모(denom) | 분자(undo=leak) 신호 | 데이터 소스(실재) | 상태 |
|---|---|---|---|---|
| **D1 commit-op** | 자율 `allow`/`cutover-allow` commit-op ∧ exec SHA 포착 ∧ 성숙창 | ⓐ`git revert` 역참조(SHA≥12hex) ∪ ⓑ대표 mark-fp | `audit/exec-results-*.jsonl` · `audit/risk-*.jsonl` · `state/c6-rollback-marks.json` | 기존(유지) |
| **D2 file-op** | 자율 reversible Edit/Write/MultiEdit/NotebookEdit ∧ pre-image 원장 엔트리 보유 ∧ 성숙창 | ⓐ변경 담은 commit이 revert됨(파일→commit→revert 조인) ∪ ⓑ현재 파일내용이 pre-image로 복귀(blob 대조=변경 전면취소) ∪ ⓒ자율편집 후 파일 삭제 ∪ ⓓmark-fp | `evidence/preimage-ledger.jsonl`(+postSha 바인딩) · `evidence/preimage/` blobs · git | **신규(B 본체)** |
| **D3 destructive-bash** | 자율 `rm`/`mv` op | 삭제/이동 경로가 이후 복원됨 | pre-image 미포착(신규 계측 필요) | **B-phase2 이연**(§5.5) |

- **불변식**: 각 도메인 내 분자 ⊆ 분모. 도메인 태그로 union(중복 opId dedup). D2 pre-image 원장은
  **reversibility-downgrade 활성 시에만 적재**(`post-exec-instrument.js` (B) 계약) → **활성 아니면 D2 표본 0**
  = 자연 fail-closed(과대측정 없음).
- **성숙창**: D1과 동일(`now-(window+settle) ~ now-settle`, 기본 30+7d). 유출은 지연신호.

### 5.2 D2 file-op 조인 로직 (핵심 신규)
1. pre-image 원장에서 성숙창 내 **자율 편집 엔트리** 추출(ruleId=자율, tuid·path·preSha(blob 해시)·postSha 바인딩).
2. 각 엔트리에 undo 신호 판정:
   - **commit-revert 조인**: postSha가 든 commit → 그 commit이 revert 대상인지(D1의 revertSet 재사용).
   - **pre-image 복귀**: 현재 파일내용 해시 == preSha ⇒ 변경 전면취소(단, 이후 재편집 없었을 때만; postSha와
     현재 해시 대조로 "그 사이 변화 있었나" 구분 — 원장의 postSha 바인딩이 정확히 이 용도).
   - **삭제**: 파일이 repo/디스크에서 사라짐.
3. **보수 편향(안전=차단 방향)**: 판정 불가(파일 소재 불명·원장 손상·git 접근 실패)는 **leak으로 계상**하지
   않되(과대측정 회피) **measured 표본에서 제외**(미측정 취급). 즉 *모호분은 분모에서 빼서* leakRate를 오염
   안 시키고, 제외율을 리포트에 노출. (← L2 쟁점: "모호=leak" vs "모호=제외" 중 후자 채택 근거는 §7.)

### 5.3 harvestLeak 리팩터 & 산출 스키마
- `harvestLeak`를 **도메인별 순수함수 + 합산**으로 재구성(D1은 현행 로직 그대로 이관, 회귀 0 목표).
- `state/c6-leak.json` 스키마 확장(하위호환: 기존 `leakRate/measured/executed/leaked` 유지 + 추가):
  ```
  { leakRate, measured, executed, leaked,          // 합산(union)
    byDomain: { commitOp:{executed,leaked,measured}, fileOp:{...} },
    coverage: ["commit-op","file-op"],             // 계측 도메인 명시(과소측정 caveat 은폐 방지)
    excludedAmbiguous: <n>, caveats:[...], ts, domain:"autonomous(multi)" }
  ```
- **measured(합산)** = `executed(union) ≥ leakMinSamples`. 도메인별 최소표본은 advisory로 병기.

### 5.4 c6-ready / 결정 C 연동
- `c6-ready.readLeak()`는 스키마 확장에 하위호환(기존 필드 그대로 읽음). `coverage` 배열을 ready 리포트에
  **표기**해 flip 시점의 측정범위를 대표가 인지.
- **결정 C flip 선결(§4)** 갱신: ① 배관 정합성 수동검증(D1+D2 각 표본 손대조) ② `executed(union) ≥ 20`
  ③ coverage에 최소 `["commit-op","file-op"]` 포함 ④ 가역 확인. 충족 시 대표 `!` 로 `leakPipelineLive=true`.

### 5.5 명시적 out-of-scope (B 1차) — 은폐 금지, 리포트에 노출
- **D3 destructive-bash**(rm/mv): pre-image 미포착 → B-phase2(신규 PostToolUse 캡처 필요).
- **reset/force-push(history rewrite)**: reflog 기반 탐지는 취약(오탐/미탐) → 하드신호 미채택, 문서화된 한계로 유지.
- **gitignored·DB·외부상태 변경**: git/파일 기반 undo 신호로 관측 불가 → 영구 커버리지 밖(명시).

### 5.6 사이징
| 작업 | 규모 |
|---|---|
| D2 file-op harvest(조인·blob대조·보수제외·테스트) | ~1.5일 |
| harvestLeak 도메인 리팩터 + 스키마확장 + c6-ready coverage 표기(회귀 0) | ~0.5일 |
| 정합성 수동검증 + 결정 C 기준 문서화 | ~0.5일 |
| **B 1차 합계 (D1+D2)** | **~2.5일** |
| (선택) D3 destructive-bash 계측+harvest | +~1일 (B-phase2) |

### 대안 기각 기록
- **Option A(현 commit-op 수용)**: B-2(표본 20 영구미달 위험)·B-3(과소측정)이 같은 뿌리(선택편향)라 미봉 → 기각.
- **Option C(라벨드-truth 상시검증)**: revert-proxy FP/FN 축소엔 유효하나 상시 운영부담 과다, B 정착 후 필요시.

## 6. 실행 순서 (Option B 확정)

1. **harvestLeak 도메인 리팩터** — D1 로직 무손실 이관 + 도메인 합산 골격 + 스키마확장(회귀 테스트 우선).
2. **D2 file-op harvest** — pre-image 원장 조인·blob 대조·삭제 탐지·보수제외, 단위테스트(FP/FN 반증 픽스처).
3. **c6-ready coverage 표기** + `c6-leak.js` main 배선(크론 그대로), 정합성 수동검증.
4. **결정 C 기준 문서화**(§5.4) → 표본·coverage 충족 시 대표 `!` flip.
- 급히 몰 이유 없음: C6 활성화는 나머지 두 축(honest L2 표본 0·관측 양성 0)도 0이라 결함유출만 풀어도 즉시 활성화
  안 됨. 본 트랙은 3중 게이트 중 "코드 선결" 축을 닫는 것.
- **확정 게이트**: 본 spec = codex∥gemini 동기 L2 통과 후 구현 착수.

## 7. 리스크 / 가역성

- flip은 정책 1줄 원복(가역). 배관은 passive harvest(op 실행 0·결재 0) — 켜도 부작용 없음, 소비측만 신뢰 전환.
- 최대 리스크 = **과소측정 leakRate로 unsafe-allow**. → Option B로 과소측정 축소 + flip 시 커버리지 명시 + cutover
  downgrade-only/홀드백/서킷브레이커가 2차 방어.
- 모호분(판정 불가) 처리는 **§5.2-3/§8-2 = "제외(미측정)"로 통일**(과대측정 회피). reset/force-push는 하드신호
  미채택(§5.5). (L2 0617cfcd: 초안의 "불확실=유출 취급" 표현이 §5.2-3과 모순 → 제거·통일.)

## 8. 미해결 질문

1. ~~스코프~~ → **B 확정(대표 2026-07-19)**.
2. **모호분 처리**(§5.2-3): "모호=제외(미측정)" 채택 — L2 검토 대상(과소측정 회피 vs 표본손실 트레이드오프).
3. **우선순위**(대표): 결함유출 B 지금 착수 vs GLM 후속 3건(§6-3·concordance·보험금융) 뒤로 — 미정.
4. D2 measured 최소표본을 도메인별로도 강제할지(현: 합산 20 + 도메인별 advisory).

## 9. L2 검증 결과 (round 1–3, 2026-07-19) — 수정필요

reviewers: claude ∥ gemini · evidenceEligible=true · canonical 11 · settled 4 · 대표 에스컬 6.
원본: `wiki .../reviews/2026-07-19-c6-leak-pipeline-activation-spec-l2-aggregation-20260719-164034.md`(+deepen r2/r3).

### ★ 확정 blocker — §5(Option B) 재사용 전제 falsify
- **5e39c024 (settled)**: D2 원장은 reversibility-downgrade 활성 시에만 적재 → 현행 R0·비활성이고 `evidence/preimage-ledger.jsonl` **파일 부재** → B가 표본 0 증가(자기부정).
- **19b46f39 (code-verified, gemini=uncertain은 문서 미기재 탓)**: pre-image 원장 TTL **3d(max 7d)** 프룬(`preimage-prune.js:45`) vs leak 성숙창 **7–37d** → 측정 전 삭제 → **D2 분모 구조적 0**.
- **ac8849fe**: 위 둘로 §5.1 '데이터소스 실재' 표기·§5.6 사이징(~2.5일)·§6 실행순서 성립 불가.
- **함의**: pre-image 원장 재사용 = 불가. 진짜 D2 = **성숙창(37d+) 내구 전용 계측 신규 구축** 필요(재설계).

### settled(합의) 반영 대상
- **5389244a**: 조인 스키마 오류 — `ruleId` 없음(audit에만), 필드=`preSha256`(≠preSha) → 조인은 audit 경유 재작성.
- **0617cfcd**: 모호분 §7↔§5.2-3↔§8-2 모순 → **§7 통일 반영 완료**.
- **01002578**: pre-image 복귀 판정이 no-op 편집(preSha==postSha)·동일세션 자기되돌림을 위양성 계상 → 배제규칙 필요.

### 대표 에스컬(이견, 판정 필요) — 요지
- **58f3a973**: D1+D2 단일 leakRate 합산 → 저위험 도메인 희석으로 게이트 완화(claude) vs 과소측정 시정이 목적(gemini). → **도메인별 leakMax/가중** 도입으로 봉합 가능.
- **9dd57319**: cross-env(Windows) 경로 harvest 오판(claude) vs §5.2-3 제외로 방지(gemini). → cross-env 경로 도달성 명시 필요.
- **65ce4303 / 7c7ed64b**: 도메인별 최소표본 advisory·모호제외 복합영향 — 이미 byDomain/excludedAmbiguous로 계측·공개(refuted, 경미).

### 결론
Option B는 **방향은 유효하나 §5의 구현 경로(pre-image 원장 재사용)가 코드로 falsify됨.** 재설계 방향(전용 내구
계측 신규 구축 vs 다른 접근)은 규모·전제가 크게 달라져 **대표 결정 게이트**. §10에 재설계 옵션 정리.

## 10. 재설계 옵션 (L2 후 — 대표 결정)

L2 발견이 **A vs B 재계산을 유발**한다: pre-image 재사용이 죽었으니 B는 "싸게 재사용"이 아니라 "전용 내구 계측
신규 구축"이 된다.

### B′ — 전용 내구 file-op leak 원장 (진짜 B)
- 신규 PostToolUse 캡처: 자율 Edit/Write류 → append-only 사이드카(`audit/fileop-*.jsonl`, 성숙창+ 보존, **프룬
  제외**), pre-image/다운그레이드 시스템과 **독립**(지금 상태로도 적재).
- undo 탐지: 담은 commit revert / 파일 삭제 / 편집 전 내용으로 복귀(편집 전 해시 별도 포착 필요).
- **규모 ~3~4일.** ★ 한계: **커밋된 file-op은 이미 D1(commit-op)과 중복**이고, 진짜 신규 커버리지(미커밋·폐기
  편집)는 git 흔적이 없어 관측 자체가 어렵다 → 대표성 이득이 생각보다 작을 수 있음.

### A′ — commit-op이 "유의미 변경"엔 이미 대표적 (재고 권장)
- **핵심 재프레이밍**: MAIA 안전모델(게이트·L2·증거) 전부가 **commit 단위로 동작**한다. 유의미한 자율 변경은
  결국 커밋된다 → commit-op leak은 *유의미 변경 표면*을 대표한다. "0.2%"의 대부분은 미커밋 잡음(임시·읽기).
- 이 관점이면 진짜 블로커는 대표성이 아니라 **① 표본량(commit-op 캡처 완결성 점검·확대) ② flip 기준 문서화**.
- **규모 ~0.5~1일** + 표본 대기. L2 발견이 이 옵션을 오히려 **강화**한다(B의 비용대비 이득 의문).

### C′ — leak 트랙 보류
- C6 활성화는 3중 게이트(honest L2 표본 0·관측 양성 0·leak)라 **leak만 풀어도 활성화 안 됨**. leak이 단독
  병목이 아니므로, 더 높은 레버리지(다른 두 축 or Verified Autonomy 경로)에 자원을 두고 leak은 A′ 최소선만.

### 권고
**A′ 재고 또는 C′.** L2가 밝힌 사실(전용 계측 필요 + 커밋된 file-op은 D1 중복 + 미커밋은 관측난)로 인해 B′의
비용대비 이득이 약하다. "유의미 변경 = 커밋"이라는 전제가 받아들여지면 commit-op leak으로 충분하고, 자원은
표본량·flip 기준·다른 두 게이트 축에 두는 게 합리적. 최종은 대표 판단.

### ★ A′ 실측 (대표 A′ 선택 후, 2026-07-19) — A′도 표본 기아
`node c6-leak.js --dry` = **0/0**(measured=false). 원인 실측:
- **audit 보존 < 성숙창**: risk-*.jsonl 잔존 4개(07-05·06·15·19). 성숙창 06-12~07-12에 드는 audit = 07-05·06 뿐,
  그 이전(06-12~07-04)은 로테이션 삭제 → denom이 iterate할 audit 레코드가 창에서 소멸.
- **audit↔exec 조인 붕괴**: audit allow 키 **420** ∩ exec 키 **64** = **1**. 포착 commit 63개는 조인 안 됨
  (대부분 대표 `!` commit=게이트 우회=정당한 비자율, 또는 keyOf 불일치 [[c6-leak-harvest-join-blocker]] 재현).
- **함의**: A′도 현 운영에선 leak 표본이 20에 **도달 불가**. A′를 실제로 살리려면 (ⓐ audit 보존 ≥ 성숙창(37d+)
  연장 + ⓑ audit↔exec keyOf 조인 수정), 그래도 자율 commit 실volume에 종속(대표 `!` 지배면 근본 기아).

### 메타 결론 (전 트랙 공통)
B(pre-image 프룬)·A′(audit 프룬+조인+저volume) 모두 **"37일 지연 leak 신호를 버틸 배관이 없고, 자율 commit
volume 자체가 낮다"** 는 동일 뿌리. leak 게이트는 **현 인프라·운영에선 구조적으로 미측정**. 이는 C6 활성화 3중
게이트(honest L2 표본 0·관측 양성 0·leak 미측정) 전부가 "보수적 운영(대표 인더루프)→증거 미축적" 이라는
[[2026-06-24-a1-a2-b-roadmap]]·[[c6-3-w5-hardblock-evidence-wall-convergence]] 진단과 일치. → 진짜 결정은
"leak 배관 보강(ⓐⓑ, ~1~2일)" vs "leak 미측정 수용 + C6 shadow 유지·Verified Autonomy 경로 의존".

## 11. 종결 (대표 2026-07-19) — 현 상태 수용

**결정: leak/증거 기반 C6 자동 활성화는 현 운영 볼륨서 도달 불가 → 추적 종결.** C6는 shadow(구축완료·미활성)로
유지하고, 이미 글로벌 flip된 **Verified Autonomy 경로 + 대표 `!`** 로 운영. 코드 변경 0(leak 배관 보강 안 함).

- **프레이밍 정정**: 기존 "증거 성숙·수개월 대기"는 부정확. 실측상 **현 운영(대표 인더루프·commit=`!`)에선
  자율 증거가 원리적으로 안 쌓임** → "대기"가 아니라 "현 볼륨서 미측정". 재개하려면 운영 패턴 변화(자율 commit
  볼륨↑) 또는 활성화 근거 자체를 증거 아닌 다른 것으로 전환해야 함.
- **재개 트리거(참고)**: ① 자율 commit 볼륨이 유의미해지면(예: relay 자율화 확대) leak 배관 보강(audit 보존≥37d
  + audit↔exec keyOf 조인 수정)이 의미 생김 / ② 또는 대표가 저위험 카테고리 1개 의도적 실험 활성화(증거맹목,
  가역·다운그레이드·홀드백·서킷브레이커 의존) 선택 시.
- 본 spec = 그 판단의 근거 기록(전 과정·L2 raw·실측). 코드/정책 무변경.
