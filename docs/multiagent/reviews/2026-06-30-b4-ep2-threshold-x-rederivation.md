---
type: analysis
project: mission-control
date: 2026-06-30
status: 확정(2벤더 L2 3R + corroborated 2 반영 + escalate 3 대표판정 완료 2026-06-30) — 진입점3 패치는 T3·대표 ! 대기
author: claude
phase: B.4 진입점2 — 임계 X 실데이터 재도출
decision_gate: 대표 ! (c6-ready 지표/임계 변경 = T3·A2 보호)
refs:
  - "[[SESSION-HANDOFF-b4-ep1-budget-impl-20260625]]"
  - "[[2026-06-25-b4-ready-metric-adaptive-verification-spec]]"
  - "[[b4-ready-verifier-budget-not-metric]]"
---

# B.4 진입점2 — 임계 X 실데이터 재도출

> 진입점1(검증 예산/미검증 회계 fail-closed)로 `verified` 3분리가 생산되기 시작 → 이제 **정직한 데이터**로
> "release-blocking 진짜 결함" 분포를 산출해 X(현 0.05 미근거 default)를 재도출한다. spec §9.3 #2 이행.

## 0. 결론 (TL;DR)
**X를 blockerRate 위에서 재튜닝하는 것은 불가능하고 무의미하다 — 지표 자체가 잘못된 계측기다.**
정직한 데이터(종단판정·verified·refuted 제외)로도 important+ blocker율은 **85.7%**, blocker-severity만 봐도 **42.9%**이며,
이 86%는 **전량 corroborated**(claude·gemini 양벤더 독립 동의, split/uncertain 0건)다. ⚠️ corroborated = **두 LLM의 합의**(강한 신호이나 적용-결과로 입증된 ground-truth는 아님, L2 `930d3c15`) — 단 단일-confronter 약신호가 아니라 **양벤더 합의 수준의 결함 후보**가 거의 모든 draft에 있다는 뜻이고, 이는 노이즈 바닥이 아니라
**L2가 draft 결함을 실제로 잡아내는 것**(설계대로 작동)으로 읽힌다. 따라서:
- (a) X 상향(노이즈를 임계로 덮기) = spec §1에서 이미 비채택. 86%를 통과시키려면 X≈0.9 → 게이트 무력화.
- (b) **`blockerRate < X` 글로벌 게이트는 "프로세스 성숙도" 계측기가 아니다.** "draft에서 결함을 얼마나 잡나"(=L2 생산성/draft 품질)를 재고 있을 뿐, "자율 확대해도 되는 신뢰 수준인가"(=결함 *유출*·롤백)를 재지 않는다.
- → **권고: blockerRate-X 게이트를 advisory로 강등**(폐기 아님 — 통째 제거는 데드락, §4·L2 `cc0358c6`). 성숙도 신호는 spec 결정 C·D(결함 유출률·대표 개입률 추세)로 대체하되, **유출률은 먼저 측정 배관을 구축**해야 의미를 가진다(현 유출=미측정, L2 `f75b053d`). 진입점3은 이 위에서 재작성.

## 1. 방법론
- **출처**: C5-2 durable bus(`l2_reviews`/`l2_rounds`, A2 — 구조화·정밀). 마크다운 파싱(A1)보다 정밀, fail-soft 불필요.
- **적격 코퍼스 = honest 집합만**: `canonical_items`에 `verified` 필드를 가진 라운드(=진입점1 이후 산출). legacy 130 deepen 라운드는 §9.4대로 예산소진/파싱실패/이견을 한 분자에 섞어(오염) X 도출에 부적격. → spec §9.3 #1("A1.3 이후 run만으로 재측정")의 귀결.
- **dedup**: artifact별 최신 review(c6-ready `parseL2Rate`와 동일 — 한 artifact의 N회 재검토 self-amplify 방지).
- **종단 분류**(§10 계약 준수): canonical id 단위 **최종 라운드** 상태(deepen이 initial supersede). `verified === false`만 미검증(legacy undefined 금지). severity **important+ 스코프**(게이트), blocker-only 별도.
- 이슈 1건 분류: corroborated/settled(verified) = 진짜결함 / split·uncertain·escalate(verified) = 미해결 진짜결함 후보(카운트) / refuted(verified) = 해소(제외) / verified===false = 미검증(예산·파싱, fail-closed이나 "진짜결함" 분자엔 미산입).
- 측정 스크립트(재현): `docs/multiagent/analysis/2026-06-30-derive-x.js` (durable bus JSON 덤프 입력).

## 2. 데이터 (honest 집합 = distinct artifact 7건)

| artifact | trigger | 이슈 | real(imp+) | real(blk) | refuted | 미검증(imp+) |
|---|---|--:|--:|--:|--:|--:|
| b4-ready-metric-...-spec-881d8fcb | auto | 8 | 0 | 0 | 0 | 5 |
| b4-ep1-budget-accounting-patch | manual | 7 | 3 | 0 | 2 | 0 |
| illustration-asset-rotation-design | auto | 7 | 2 | 0 | 1 | 1 |
| desktop-migration-plan-4cabdc25 | auto | 12 | 4 | 1 | 3 | 0 |
| design-spec-color-to-render-design | auto | 12 | 10 | 6 | 0 | 0 |
| brand-color-override-to-theme-design | auto | 8 | 3 | 1 | 1 | 0 |
| desktop-migration-plan-e2c3e29c | auto | 9 | 4 | 0 | 2 | 0 |

**분포:**
- hasBlocker(important+, 검증된 진짜결함): **6/7 = 85.7%**
- hasBlocker(blocker severity만): **3/7 = 42.9%**
- 미검증 보유(important+, fail-closed 대상): 2/7 = 28.6%
- 검증완료 & clean(real=0 ∧ 미검증=0): **0/7 = 0%**

**important+ 이슈 종단 분해(7 artifacts 합산 41건 중):**
- corroborated(양벤더 동의 확정): **26** · split: 0 · uncertain: 0 · refuted: 9 · 미검증: 6
- → 86%를 떠받치는 게 전부 corroborated. **단일-confronter 약신호(split) 0건** = trigger-happy 노이즈 아님.

**[대조] legacy 오염 집합**: N=69, escalate/unanimous 보유 81.2%(예산소진 미검증 포함) — 진입점1 이전 데이터로는 노이즈 바닥(80%대)만 재현, X 도출 불가 확인.

## 3. 해석 — 왜 X 재튜닝이 아니라 지표 폐기인가
1. **86%는 정직한 신호다.** 종단판정·refuted 제외·미검증 분리 후에도 86%, 전량 corroborated(=양벤더 합의 수준, ground-truth 아님 — §0 주). draft 1건당 평균 ~3.7개 양벤더-합의 important+ 결함 후보. = L2의 본업(적용 전 draft 결함 색출)이 작동하는 정황 증거(유출-입증은 별개, §3.3).
2. **`blockerRate`는 "성숙도"가 아니라 "L2 생산성"을 잰다.** c6-ready 헤더 전제("L2가 blocker를 계속 찾으면 프로세스가 미성숙")는 틀렸다 — blocker를 찾는 건 L2가 일하는 것이지 프로세스가 미숙한 게 아니다. 이 지표가 높을수록 오히려 L2가 잘 막고 있다는 뜻일 수 있다.
3. **자율 확대의 진짜 안전 질문**은 "draft에 결함이 있나"가 아니라 "결함이 L2를 **뚫고 적용물로 유출**돼 롤백/사고를 냈나"다. 그건 별개 지표(spec 결정 C: 유출→롤백 신호, 결정 D: 대표 개입률 추세). ⚠️ **현 코퍼스에서 유출/롤백은 "측정된 0"이 아니라 "미측정"**(L2 corroborated `f75b053d`): §5.4대로 유출 측정 배관(passive harvest)이 **미구축**이라 부재≠0 — 증거로 쓸 수 없고, 배관 구축이 신규 게이트의 **선결**이다.
4. **표본 자체가 X 정밀도출 불가**: honest N=7. 1건=14.3%p 해상도 → "5% vs 8%"를 가를 수 없다. l2MinSamples=5를 턱걸이 통과할 뿐 rate 임계의 통계적 근거 미達.

## 4. 권고 (진입점3 입력)
> ⚠️ R1~R4는 **순서가 있는 전환 시퀀스**다 (L2 corroborated `cc0358c6`: 무순서면 "유출률 낮을 때까지 fail-closed"인데 유출률 배관이 없어 해제조건 영구 미충족=자율확대 영구 데드락). 아래 단계 순으로만 유효.

- **R1. `blockerRate < X` 게이트를 폐기하지 말고 advisory로 강등** (즉시). "성숙도=낮은 blocker율" 프레임은 철회(X 재튜닝 중단, spec §1 (a) 재확인+본 데이터)하되, 지표를 통째 제거하면 §5.4 데드락이 생기므로 **신규 게이트가 설 때까지 자율 enforcement에서 빼고 신호만 노출**. → 자율확대는 이 단계에서 fail-closed 유지(공백창 없음).
- **R2. 결함-유출 harvest 배관 먼저 구축**(선결, 결정 C): L2 통과(clean) 산출물이 이후 롤백/사고로 이어졌는지 passive harvest(c6-rollback 신호 연결). 이게 없으면 §3.3대로 "유출=미측정"이라 어떤 유출률 게이트도 vacuous. **이 배관이 진짜 해제경로** — 데드락 탈출의 1단계.
- **R3. 배관+표본 누적 후 신규 글로벌 게이트 전환**: ready = B.1 증거원장(observedPositive ≥ N_min ∧ doubleDanger=0) + **검증 커버리지 게이트**(미검증=verified===false 비율 상한, fail-closed, 현 important+ 14.6%) + **결함 유출률 게이트**(측정된 유출률 < 임계, 배관 가동 후에야 non-vacuous). blocker율은 advisory-only 잔존.
- **R4. 전환 완료까지 보수(fail-closed) 유지 — 단 해제경로 명시**: honest N=7로 작으므로 신규 게이트도 "유출 표본 충분 ∧ 측정 유출률 낮음"까지 자율확대 보류. ★단 이건 R2 배관 구축→표본 누적이라는 **정의된 단조 진행 경로**가 있는 보수이지, `cc0358c6`이 지적한 무한 데드락이 아니다(전환 순서가 공백/영구미충족을 제거).

## 5. 미결(진입점3·동기 L2서 확정)
1. R2의 "검증 커버리지" 임계 수치(미검증 비율 상한) · "결함 유출률" 임계.
2. blocker율을 완전 폐기 vs advisory 강등 — 후자면 어디에 노출.
3. honest 표본 충분 기준(현 7 → 글로벌 게이트 신뢰까지 필요한 N).
4. 결함 유출(L2 통과 후 롤백) passive harvest 배관 — c6-rollback 신호와 연결(결정 C 구현 범위).

## 6. 적용 흐름
본 분석 = draft → **동기 L2 검증**(claude∥gemini) → 결함 반영(§7) → 대표 `!`로 방향 확정(blockerRate 게이트 advisory 강등 + 유출배관 선구축 승인) → 진입점3(c6-ready 재작성, c6-ready.js=T3·A2 → 대표 `!` 패치).

## 7. 동기 L2 검증 결과 (2026-06-30, claude∥gemini, 3R) — 반영
> 진짜 2벤더 L2 완결(둘 다 parser=ok, 쿼터 정상). settled=2 corroborated · escalate=3 이견 · **미검증 0 · 파싱실패 0**(진입점1 예산수리로 띄운 결함 전부 대질). 집계: `reviews/2026-06-30-b4-ep2-threshold-x-rederivation-l2-deepen-r3-20260630-141717.md`.

**corroborated 2건 — 반영 완료:**
- `f75b053d`: "유출/롤백=0"이 §5.4 배관 미구축이라 "측정된 0"이 아닌 **미측정** → §0·§3.3·§4 R2 정정(부재≠0, 배관 선결).
- `cc0358c6`: R1(폐기)/R2(유출률 대체)/R4(유출률 낮을 때까지 fail-closed)가 유출배관 부재로 **영구 데드락** → §4를 **순서 있는 전환 시퀀스**로 재작성(R1=advisory 강등·폐기 아님 / R2=유출배관 선구축 / R3=표본 후 전환 / R4=정의된 단조 해제경로). 데드락 해소.

**escalation 3건 — 대표 판정 완료(2026-06-30):**
- `930d3c15`(claude 제기, gemini refute): "corroborated=진짜결함 등치는 과장." → **대표 판정: 제기 반영(문구 완화).** §0·§3.1의 corroborated 표현을 "양벤더 LLM 합의(≠ground-truth)"로 명시 완화. 적용 완료.
- `82d02b10`(gemini 제기, claude refute): N=7이 신규 rate-게이트도 무효화. → **대표 판정: 대질자(claude) 손·현행.** 신규 게이트는 fail-closed/leak=0 설계라 작은 N에 둔감(§4 R4). 변경 없음.
- `66410bdd`(gemini 제기, claude refute): 검증 커버리지 게이트 초기 임계 부재. → **대표 판정: 대질자(claude) 손·현행.** 임계 확정은 T3·대표 ! 게이트라 draft 단독 확정이 규약 위반, 출발점 14.6% 제공. 변경 없음.
