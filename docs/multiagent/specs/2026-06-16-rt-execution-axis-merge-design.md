# R·T 통합 — 단일 실행 축(E) 설계 (R/T merge)

> L2 round1·round2가 반복 지적한 **"R(가역성)·T(권한/위험)·W(난이도)·V(검증깊이) 4계층 인지부하"**를 해소하는 통합안. R·T를 **단일 실행 축 E**로 합치되 정보 손실 없이(입력 보존), 검증 축 V와 대칭으로. 결과 = MAIA가 노출하는 정책 축 **4개 → 2개(E×V)**.
>
> - 날짜: 2026-06-16 / 작성: claude / 버전: **v0.3 (L2 round2 반영 — gemini PASS ∥ codex block; round1 BLOCKER 전건 resolved, round2 정밀성 결함 반영: R2셀 단일값 분해·DENY의 V null·마이그레이션 golden fixture+회귀가드·E2 deadline·분류기 SPOF 안전폴백)**
> - 지시: 대표 (2026-06-16, "통합안 설계+L2")
> - 선행: [[2026-06-13-c6-verification-over-approval-spec]] (§1.0 R / §1.1 T) / [[2026-06-11-maia-autonomy-overhaul-design]] (Decision Gate) / [[2026-06-16-verification-depth-axis-and-resilience-spec]] (V축)
> - 리뷰: [[2026-06-16-rt-execution-axis-merge-l2-aggregation]]
> - **★ 편입 완료(2026-06-16, 대표 결정)**: C6 **v0.3 코어 §1.1 실행 축 E**로 편입됨. C6 §1.0 R은 E의 1차 입력으로 유지, 구 T0~T3는 E로 치환. C6 스펙은 요약, 본 문서가 상세 SSOT.
> - 범위: C6 §1.0/§1.1 코어 taxonomy 재구조화 (✅ C6 v0.3 편입) + `~/.ai-bootstrap/{risk-classify.js,decision-policy.json}` 출력 전환
> - SSOT: 코드/spec=이 repo, 지식/결정=위키 + 위키링크

### v0.1 → v0.2 변경 (양 AI BLOCK 반영)
1. **[BLOCKER both] +1 escalator 산술 폐기** — 가역성은 카테고리형(git복구/시간지연/스냅샷)이라 선형 덧셈 불성립(v0.1 자체 모순). → **E는 R에 매핑하지 않고 독립 "실행 마찰" ladder로 정의**, `(R, riskFlags) → E` **2D 룩업 테이블**(§3·§4).
2. **[BLOCKER gemini + 중요 codex] facade 제거** — "E 하나만 읽는다"면서 `E0+esc` sidecar가 남던 모순. → 출력을 **구조화 레코드** `policyClassification`로(§5). 단일 ordinal은 정보손실 0 불가.
3. **[BLOCKER gemini + 중요 codex] E축 자동 하한 게이트** — R3를 R0로 허위신고해 자율 타는 도덕적 해이 방어. 분류기가 (E,V) 직접 산출, 에이전트는 복종(§5·§6).
4. **[BLOCKER codex] E1이 C6 T2(사전L2+스냅샷) 미수용** — E ladder에 실행 통제(requiredControls)를 인코딩(§3).
5. **[BLOCKER codex] deny-reason 마이그레이션** — 구 T3 deny를 일괄 E3로 낮추면 hard-deny가 실행후보화. → **deny reason 기준**(hard_deny=DENY 흡수 / r3_residual=지연큐)(§7).
6. **[중요 gemini] E2·E3 혼동** — 둘 다 "지연+veto" → **타임아웃 기본동작**(E2 timeout=자동실행 / E3 timeout=자동차단)으로 구분(§3).
7. **[제안 both] audit 원인 보존·태깅** — `E1 (R0 base + risk격상)`처럼 원인 명시, riskFlags·R 보존(§5·§8).

### v0.2 → v0.3 변경 (L2 round2: gemini PASS ∥ codex block — 정밀성)
1. **[BLOCKER codex] §4 R2 고위험 범위셀(E2/E3) 제거** — "단일 executionLevel"과 모순. **모든 셀 단일값**으로 + R2 모호성은 *가역성 분류 단계*로 이전(복구 보장이면 R2, 정합성 손실 크면 R3)(§4).
2. **[중요 codex] DENY의 verificationDepth** — V스펙은 DENY를 V축 비대상화. → 레코드에서 `executionLevel=DENY`면 `verificationDepth: not_applicable` 허용(§5).
3. **[중요 codex ∥ gemini Medium 교차] 마이그레이션 회귀가드** — hard_deny/r3_residual 분리 evidenceRule + **golden fixture** + **CI 회귀테스트**(구 DENY가 E0~E2로, hard_deny가 E2/E3로 내려가면 Hard Block)(§7).
4. **[중요 codex] E2 timeout 시점 정의** — `vetoDeadline·irreversibilityDeadline·scheduledExecutionAt` 레코드 필드 추가(R1이 발신 후 R3로 넘어가는 경계 명확화)(§3·§5).
5. **[제안 gemini] 분류기 SPOF** — `risk-classify.js` 파싱 실패/하네스 오류 시 **안전 폴백 `(DENY 또는 E3, V3)` 하드코딩**(§5·§9).

---

## 0. 배경 — 왜 통합인가

- **L2 반복 지적(gemini round1·round2)**: R·T 강결합인데 별도 0~3 사다리 2개 유지 = 4계층 인지부하.
- **C6가 이미 절반 흡수**: C6 §1.1이 T0~T3를 가역성 용어("준가역"·"비가역")로 재정의 → 본 설계가 흡수를 명시적으로 완성.
- **codex round1 단서**: "R/T는 직교 아닌 상관 입력. R gates execution, T gates authority." → base/lookup으로 구체화.

---

## 1. 진단 — R과 T는 하나로 합쳐도 되나?

★ **함부로 뭉개면 정보 손실.** 둘은 *다른 질문*:
- **T(위험)** = 피해 규모·확률.
- **R(가역성)** = 되돌릴 수 있나.

**발산 케이스(독립 증거):**
| 케이스 | T(위험) | R(가역성) | 함의 |
|---|---|---|---|
| auth 코드 편집 | 높음 | R0(git 가역) | 위험하지만 가역 |
| 일상 알림 메일 | 낮음 | R3(회수불가) | 안전하지만 비가역 |

→ 두 입력은 **독립 보존**. **통합 대상 = 입력이 아니라 출력**(실행 게이트는 하나).

★ **v0.1의 실패(L2)**: 출력 통합을 "E를 R에 매핑 후 위험 +1"로 구현 → (a) 가역성 형태가 카테고리형이라 +1이 의미 없고, (b) `E0+esc` sidecar가 "단일 출력"과 모순. **v0.2는 E를 R과 분리된 ladder로 정의하고 (R,위험)을 룩업으로 합친다.**

---

## 2. 설계 원칙 — "노출 축은 통합, 입력은 레코드로 보존"

- **E(실행 축)는 "실행 마찰(execution friction)" ladder** — *어떤 통제 하에 실행되나*. R 등급에 1:1 매핑하지 않는다.
- **(R 가역성, riskFlags) → E** 는 **2D 룩업**(카테고리 조합표). 산술 덧셈 아님.
- **출력은 단일 ordinal이 아니라 구조화 레코드** `policyClassification` — E·V·통제·deny사유·원인을 담아 정보손실 0.
- **검증 축 V와 대칭(입력 공유, base 분리)**:
```
정책 분류 레코드(분류기 단일 산출) ─┬─ reversibility + riskFlags → E (실행 게이트)
                                    └─ workClass    + riskFlags → V (리뷰 깊이)
```
위험(riskFlags)이 **E·V 양쪽 입력** — 이중계산이 아니라 다른 대응(실행 통제↑ vs 리뷰 깊이↑). audit에 **어느 등급이 위험 때문에 격상됐는지 태깅**(§8).

---

## 3. 실행 축 E 정의 — 실행 마찰 ladder (R 비매핑)

| E등급 | 실행 통제(requiredControls) | 타임아웃 기본동작 | 성격 |
|---|---|---|---|
| **E0** | 자율 실행 + 사후검증 | — (즉시) | 완전가역·저위험 |
| **E1** | 자율 실행 + **사전 가드(스냅샷·드라이런·사전 L2)** | — (즉시, 가드 후) | C6 T2의 "자율+사전L2+스냅샷" 인코딩 |
| **E2** | **지연 실행 + veto창(opt-out)**, timeout → **자동 실행** | 자동 실행 | 회수창 가역(R1)·되돌림 쉬움 |
| **E3** | **지연 실행 + 승인창(approval, opt-in)**, timeout → **자동 차단/명시승인 대기** | 자동 차단 | 비가역 잔여(R3 residual) |

★ **E2 시점 정의(L2 round2 codex)**: E2 레코드는 `vetoDeadline`(veto 마감)·`scheduledExecutionAt`(실제 실행 예정시각)·`irreversibilityDeadline`(이 시점 넘으면 R3로 전이)을 갖는다. 외부발신처럼 `vetoDeadline = irreversibilityDeadline`(발신=비가역)이면 timeout 자동실행이 곧 R3 진입이므로, 그런 작업은 E2가 아니라 **E3로 분류**(발신 전 차단 기본). E2는 "창 만료 후에도 되돌릴 수 있는" 경우에만.
| **DENY** | **즉시 차단**(absorbing) | — | hard-deny(force push·secret 등) |

★ E2/E3는 **타임아웃 기본동작으로 구분**(gemini 중요): E2=veto창(opt-out, 무응답=진행) ≠ E3=승인창(approval, opt-in, 무응답=차단). 둘 다 "veto"라 부르면 의미 혼동(C6-0.1 L2 codex 지적) → E2만 veto, E3는 approval. 운영자에게 "이 지연은 풀리면 실행되나 막히나"가 명확.

---

## 4. (R, 위험) → E 2D 룩업 (기본값 — 정책 튜닝 대상)

★ **모든 셀은 단일값 결정함수**(L2 round2 codex BLOCKER — 범위값 금지). R2의 모호성은 *룩업 셀*이 아니라 **가역성 분류 단계**에서 해소한다(아래 ※).

| 가역성 R \ 위험 | 저위험 | 고위험 | always-deny 플래그 |
|---|---|---|---|
| **R0** 완전가역 | E0 | **E1** | DENY |
| **R1** 시간제한가역(회수창) | E2 | E2 | DENY |
| **R2** 부분복구(복구 보장됨) | E1 | **E2** | DENY |
| **R3** 비가역(사회·물리·정합성 손실) | E3 | E3 | DENY |

- **§1 발산 케이스 검증**:
  - auth 편집(고위험·R0) → **E1**(자율 실행 + 스냅샷·사전 L2). ✅ C6 T2와 일치(round1 codex BLOCKER 해소 — E1에 사전L2 인코딩됨).
  - 일상 메일(저위험·R3) → **E3**(지연+veto, timeout 차단). ✅ 회수불가라 정당.
- ※ **R2 분해(round2 codex)**: "부분복구"의 모호성은 셀이 아니라 **R 분류기**가 흡수한다 — *복구가 보장*되면 R2(고위험=E2), *down 미보장·정합성 손실 가능성이 크면* 안전측으로 **R3 판정(E3)**. migration은 이 기준으로 R2/R3 중 택일(범위값 아님). E2의 `irreversibilityDeadline` 초과 가능성도 R3 신호.
- **always-deny 플래그**는 R 무관 DENY 흡수(force push·main push·rm -rf·secret 전송·외부발신 악용).
- 표는 `decision-policy.json`의 룩업으로 구현(코딩 아닌 데이터). 임계·셀은 정책 변경만으로 조정. **셀 결과는 항상 단일 E**.

---

## 5. 출력 = 구조화 분류 레코드 (단일 ordinal 폐기)

분류기(`risk-classify.js`)는 boolean이 아니라 **단일 레코드**를 산출하고, 에이전트/게이트는 이것만 consume(계산 안 함·복종):

```
policyClassification = {
  reversibility: R0|R1|R2|R3,
  riskFlags: [...],            // 고위험 경로/작업 (E·V 공통 입력)
  workClass: W0|W1|W2|W3,
  intentClass: ...,            // task-intent (V 하한, 검증축 스펙)
  denyReason: null|hard_deny|r3_residual|...,
  executionLevel: E0|E1|E2|E3|DENY,   // (R, riskFlags) 룩업 결과 (단일값)
  requiredControls: [snapshot, dryrun, preL2, vetoWindow, ...],
  // E2 전용 시점(round2 codex): 외부발신 등 R3 경계 명확화
  vetoDeadline?, scheduledExecutionAt?, irreversibilityDeadline?,
  verificationDepth: V0|V1|V2|V3|not_applicable,   // DENY면 not_applicable (round2 codex — V스펙 DENY 비대상 정합)
  escalatedBy: { E: 'risk'|'baseR', V: 'risk'|'baseW' },  // audit 원인 태깅
  confidence: 0..1
}
```
- "E 하나만 읽는다"는 모순(codex 중요) 해소 — **executionLevel + requiredControls + denyReason**이 실행 통제를 완전 인코딩. sidecar 없음.
- **DENY의 verificationDepth = `not_applicable`**(round2 codex): V스펙이 DENY를 V축 비대상화한 것과 정합. 실행 안 되는 작업에 리뷰 깊이 부여 안 함.
- 노출은 (E, V) 2축이되 레코드가 원인(R·riskFlags·denyReason)을 보존 → 정보손실 0·audit 설명력 유지(both 제안).
- ★ **분류기 SPOF 안전폴백(round2 gemini)**: `risk-classify.js` 파싱 실패·하네스 오류로 레코드 산출 실패 시, 오케스트레이션은 **무조건 `executionLevel=DENY(또는 E3), verificationDepth=V3`로 강제 귀결**(fail-safe, fail-open 금지). 분류기가 단일 정책 산출점이라 폴백 필수.

---

## 6. 자동 하한 게이트 (E축 도덕적 해이 방어)

★ **gemini BLOCKER**: V축처럼 E축도 에이전트 자기선언만으론 R3→R0 허위신고 위험. →
- **분류기/오케스트레이터가 작업 종류로 가역성을 자동 판정**: push·merge·외부발신·migration·rm·secret = 비가역/위험 자동 인식 → R/E 하한 강제. 에이전트가 R0를 신고해도 시스템이 하한 위로 올린다.
- 에이전트는 (E,V) **복종만**, R/T/W를 직접 계산하지 않음 → 인지부하 실질 이전(gemini "facade" 비판 해소).
- V축 자동 하한 게이트(검증축 스펙 §2.5)와 **동일 분류기·동일 escalator 신호 공유**(SSOT).

---

## 7. 마이그레이션 — deny-reason 기준 (T-label 아님)

★ **codex BLOCKER**: 구 T3 deny를 일괄 E3로 바꾸면 hard-deny가 실행후보(E3 지연큐)로 격하됨. → **deny reason 기준 분리**:

| 구 분류 | 판정 | 신 E |
|---|---|---|
| T0/T1 (자율·가역) | — | E0/E1 |
| T2 (위험·준가역) | reversible_after_guard | **E1**(스냅샷·사전L2) 또는 룩업 |
| T3 deny — **r3_residual** (가역화 불가 잔여, veto 가능) | r3_residual | **E3**(지연+veto, timeout 차단) |
| T3/DENY — **hard_deny** (force push·secret·외부발신 악용) | hard_deny | **DENY**(즉시 차단·absorbing) |

- `risk-classify.js`·190 회귀케이스는 **deny reason으로 재라벨링**(T-label 아님). hard_deny 흡수상태 보존 검증.
- denylist(항상-DENY)는 그대로. 롤백 = 레코드의 executionLevel→구 T 매핑 역변환.

★ **의미보존 절차(L2 round2 codex ∥ gemini 교차)**: 재라벨링 자체가 리스크. 다음을 선행:
1. **evidenceRule 명시**: 구 T3 각 케이스를 `hard_deny` vs `r3_residual`로 나누는 *근거 규칙*을 명문화(force-push/secret/외부발신악용=hard_deny / 가역화 불가하나 veto 가능=r3_residual). 직관 분류 금지.
2. **golden fixture**: 케이스별 `{oldLabel, newExecutionLevel, denyReason, evidenceRule, expectedControls}` 고정 픽스처.
3. **CI 회귀가드(Hard Block)**: ① 구 DENY가 `E0~E2`(자동실행 가능)로 매핑되면 빌드 실패 ② `hard_deny`가 `E2/E3`로 내려가면 빌드 실패. 재라벨링 PR은 이 가드 통과 필수.

---

## 8. 최종 MAIA 정책 모델 = 2축 (E × V) + 보존 레코드

| 축(노출) | 입력 | 출력 |
|---|---|---|
| **실행 축 E** | reversibility + riskFlags (룩업) | 실행 게이트(자율/가드/지연·veto/차단) |
| **검증 축 V** | workClass + riskFlags | 리뷰 깊이 V0~V3 |
| (보존, 비노출) | reversibility·riskFlags·denyReason·escalatedBy | audit·다이제스트 설명력 |

- 노출 축 = **2개**(gemini "4계층→2D" 충족). 한 작업 정책 = (E, V) 쌍 + 원인 레코드.
- **audit 원인 태깅**(both 제안): 다이제스트에 `E1 (R0 base, risk 격상)` / `V3 (W2 base, risk 격상)`처럼 위험 개입을 명시 → "왜 격상됐나" 추적 가능.

---

## 9. 난제 / 정직한 한계 (L2 후 갱신)

1. **R2/R3 분류 경계**: "부분복구"의 모호성은 룩업 셀이 아니라 **가역성 분류기**가 흡수(§4 ※ — 복구보장=R2/E2, 정합성손실 가능=R3/E3). 분류기의 R2-R3 판정 정확도가 안전의 관건. 보수 기본(애매하면 R3).
2. **분류기 = E·V·R·W·intent 단일 SSOT 레코드**: 분기되면 두 축 불일치(codex 중요). 단일 `policyClassification` 산출 강제.
3. **E3 실행(지연큐/veto window) 미구현**: C6-4 로드맵. *축·레코드 정의*는 즉시 가능하나 *실행*은 C6 의존.
4. **마이그레이션 검증 비용**: 190 회귀케이스 deny-reason 재라벨링 + hard_deny/r3_residual 분리 정확도. 의미보존 회귀 필수.
5. **E·V 약결합(위험 공유)**: 완전 독립 아님(base는 R vs W로 분리). audit 태깅으로 원인 분해 — "상관 있는 분리 차원" 원칙 계승.

---

## 10. 메타 정합성 (자기적용)

본 설계는 **W3(코어 taxonomy 재구조화)** → V3(풀 L2) 필수.
- **round1**: Codex∥Gemini **둘 다 BLOCK**(핵심 메커니즘 +1 escalator 결함) → v0.2 전면 재설계(2D 룩업·구조화 레코드·자동게이트·deny-reason).
- **round2**(v0.2): **gemini PASS ∥ codex block** — round1 BLOCKER 전건 resolved 확인. codex block은 신규 정밀성(R2 범위셀·DENY의 V·마이그레이션 절차·E2 deadline) → **v0.3 반영**. gemini 제안(SPOF 폴백·CI 회귀가드) 반영.
- 리뷰 [[2026-06-16-rt-execution-axis-merge-l2-aggregation]]. v0.3은 메커니즘 변경 없는 정밀화라 수렴 판단(round3는 선택).

## 관련
- [[2026-06-13-c6-verification-over-approval-spec]] / [[2026-06-16-verification-depth-axis-and-resilience-spec]] / [[2026-06-16-verification-depth-axis-l2-aggregation]] / [[2026-06-11-maia-autonomy-overhaul-design]]
