---
type: spec
project: mission-control
date: 2026-06-25
status: 진입점1 구현완료(§9.4→§10) · 진입점2/3 needs-rework (동기 L2가 결정 A 불충분 입증 — §9)
author: claude
phase: B.4 (검증-우선 증거 모델 활성화 전 보정)
refs:
  - "[[SESSION-HANDOFF-a1-bcycle-20260625]]"
  - "[[2026-06-24-a1-a2-b-roadmap]]"
  - "[[b1-evidence-ack-model]]"
decision_gate: 대표 ! (구현·적용) — 본 spec은 draft, 동기 L2 검증 후 확정
---

# B.4 ready 지표 보정 + 적응형 검증 사다리 (spec, draft)

> 2026-06-25 검토 세션 결론. `c6-ready.js`의 L2-blocker율 측정 결함(80.6% 영구 미달)을 바로잡고,
> L2 검증을 "사람으로 후퇴"가 아니라 **신뢰 가능 수준으로 강화**해 자율 확대를 가능케 한다.
> 본 spec은 draft — 확정 전 **동기 L2 검증**(codex/claude∥gemini) + 대표 `!`.

## 0. 제1 취지 (잊지 말 것 — 대표님 명시 2026-06-25)
1. **대표님 관여 최소화가 1순위.** 단 엉망 금지 — **AI가 최대한의 검증 위에서 정확히 구현.**
2. 따라서 정답은 "사람에게 되돌리기"가 **아니라**, **AI 검증을 믿을 수 있을 만큼 엄격하게** 만들어 사람 없이도 정확히 굴러가게 하는 것.
3. 안전은 *사람 상시검수*가 아니라 **가역성(롤백)·예산한도·rate-limit·저위험만 자율·고위험 게이트유지·활성화 1회 `!`** 로 확보.
4. ⚠️ 폐기된 방향: "AI 신호를 자문으로 강등하고 하드 게이트를 사람 결정으로" — 입문 문서(loop-engineering)의 사람-중심 프레임. 우리 취지와 정면 배치 → 채택 안 함.

## 1. 문제 (실측 근거)
- `c6-ready.js`의 글로벌 L2 게이트: `blockerRate < X(0.05)` 가 **영구 미달**. 첫 적립 실측 **80.6%**.
- 근본 원인 = **측정 대상이 틀림**:
  - c6-ready 정규식 `^(.+)-l2-aggregation-(\d{8})-(\d+)\.md$` 은 **round-1 집계만** 매칭. deepen(대질 후 최종) 집계 `*-l2-deepen-rN-*.md` **96건은 통째 무시**.
  - `hasBlocker = verdict==='수정필요' && /\*\*blocker\*\*/` → round-1에서 blocker 1개라도 제기되면 카운트.
  - L2 reviewer는 "최소 2건 능동 점검" 적대적 프롬프트 → round-1은 거의 항상 blocker.
  - 실측: round-1 집계 62건 중 50건 hasBlocker = **80.6%**. = "round-1이 트집 잡은 비율"일 뿐, "deepen 후 살아남은 진짜 결함"이 아님.
- 즉 (a) X 상향은 노이즈 바닥을 임계로 덮는 것 → L2 게이트 무력화. **비채택.**

## 2. 결정 A — hasBlocker 정밀화 (지표 수리)
**"살아남은 결함"을 라운드 번호가 아니라 *최종 판정 종류*로 센다.**

- 각 쟁점(canonical issue)의 **종단(terminal) 판정**을 본다 (round 2·3·4… 무관, 마지막 결론):
  - `settled / corroborated` (재대질서 전원 동의 = **확정된 진짜 결함**) → **카운트**
  - `escalate` (예산상한까지 미해결 → 대표 판정 대기 = 미해결 잔존) → **카운트**
  - `refuted` (대질자가 "결함 아님"으로 반박, 해소) → **제외**
- 데이터 출처(둘 중 택1, 동기 L2서 결정):
  - (A1) deepen 집계 `*-l2-deepen-rN-*.md` 의 per-issue `status`/`resolution` 파싱 + round-1 settled-blocker 병합. (마크다운, fail-soft 유지)
  - (A2) C5-2 durable bus `l2_rounds.status/severity` 직접 집계 (구조화, 정밀 / DB 의존 추가)
- 종단 보장: l2-loop는 라운드/예산 상한 도달 시 잔여 pending을 **강제 escalate**(`deepen-budget 소진`) → 흐지부지 누락 없음. (l2-loop.js:743 확인)

## 3. 결정 B — 적응형 검증 사다리 (검증 강화, 사람 후퇴 아님)
3개 레버를 **항상 다 켜지 않고**, (위험등급 × 심각도 × 이견정도 × 게이트중요도)로 **강도를 자동 상향**. 검증 자원을 위험한 곳에 집중.

| 단계 | 추가 | 진입 트리거 |
|---|---|---|
| **L0 기본** | 2벤더(claude+gemini)·R1·근거강제 | 기본값 — 저위험·일상 |
| **L1 +심화라운드** | 이견 쟁점 라운드 추가 | important+/blocker 쟁점이 현 상한서 미해결 |
| **L2 +악마의변호인** | 합의에 반대측 1명 강제 | 고위험(T2+)·비가역 산출물에 blocker인데 **너무 쉬운 만장일치** |
| **L3 +3번째 벤더** | 독립 벤더 추가(공통맹점 차단) | L1 후에도 split 지속, 또는 고-stakes(활성화 가르는 판정·T3·비가역) |
| **L4 → 대표님** | 사람 판정 | 검증예산 상한까지 미해결 = **점점 줄어드는 최후수단** |

- 신호 출처: risk-classify의 T등급 / L2 severity·consensus / 활성화 여부(gate-stakes).
- 안전장치: **검증 예산 상한**(폭주 차단, 글의 "예산 한도") + **자율 판정이 푸는 건 저위험·가역만**(고위험·비가역은 등급상 항상 게이트).
- 대표님 우려("합의≠진실/쉬운 다수결") 직격: 중대·고위험 합의는 **악마의변호인(L2)+3벤더(L3)** 통과해야만 인정 → 쉬운 만장일치는 중대사안서 자동 불신.

## 4. 결정 C — 자기보정 (새 질문 0)
- L2 실제 정밀도를 **실제 결과로 측정**: escalation/판정이 이후 **롤백·사고로 이어졌는가**(1차 신호) + 대표 escalation 최종판정(어쩌다 생기는 것만 수동 줍기).
- 목적: "AI 합의를 믿을 근거"를 추측 아닌 **누적 데이터**로. 정밀도 낮으면 사다리 강도↑(벤더추가), 높으면 신뢰.
- ⚠️ 새 결재·질문 생성 금지. 이미 발생하는 신호만 passive harvest.

## 5. 결정 D — 개입률 지표화
- **대표님 개입률**(escalation 빈도·활성화 `!` 빈도)을 추적 지표로. **목표 = 시간 경과 0 수렴.**
- 안 줄면 = 설계 실패 신호(과보수 게이트). 사람은 최후 안전망 + 1회성 교사, 상시 검수자 아님.

## 6. 범위·비범위
- 범위: c6-ready hasBlocker 재정의(결정 A) + 검증 사다리 모델(결정 B) 명세. 자기보정·개입률(C·D)은 후속 측정 레이어.
- 비범위: 라이브 enforcement 변경 없음(B축 전체가 shadow/도구). 활성화는 B.4 대표 `!`.
- 제약: `c6-ready.js`·`c6-policy`·l2 파이프라인 = gate-self-protection(T3) → 구현=대표 `!` 패치.

## 7. 미결(동기 L2서 확정할 경계)
1. 데이터 출처 A1(마크다운) vs A2(durable bus) — fail-soft vs 정밀.
2. "너무 쉬운 만장일치"(L2 트리거) 정량 기준.
3. 검증 예산 상한 수치(라운드·콜 상한).
4. refuted를 "해소"로 보는 것의 위험(대질자가 틀리게 반박했을 가능성) — L3 3벤더가 완화하나 경계 명시 필요.
5. hasBlocker 종단판정 병합 시 round-1 settled-blocker(대질 안 거친 만장일치 blocker)의 처리.

## 8. 적용 흐름
draft → **동기 L2 검증**(claude∥gemini, 본 spec 대상) → L2 결함 반영 → 대표 `!` 확정 → 패치 스크립트 → 패치 동기 L2 → 대표 `!` 적용.

---

## 9. 동기 L2 검증 결과 (2026-06-25, claude∥gemini, 3라운드) — 결정 A 불충분 입증

> 본 spec을 dogfooding으로 L2에 걸어, **결정 A가 그대로면 문제를 못 고친다**는 게 실측으로 드러남.
> L2 산출: `projects/multiagent/reviews/...-l2-aggregation/deepen-r2/r3-20260625-175441.md` (+ auto-L2 `...-881d8fcb-...175723`).
> ⚠️ project 추론 분기: manual run=`multiagent`, auto-L2=`mission-control` 로 갈림(별도 finding).

### 9.1 실측 (기존 96 deepen 데이터 + 본 run)
- 기존 round-1 지표: 80.8% / (b) 단순(escalate+corroborated): **88.5%(악화)** / (b) strict(parser-fail 제외): **69.2%**. 전부 X=5% 한참 초과 → **결정 A 단독으로는 영구 미달 해소 못 함.**
- escalation 55건 중 **54건(98%)이 parser-fail(unresolved)** = 대질 응답 미파싱 자동 escalate. caveat: 과거 전체(A1.3 이전 포함) 기준, 현 run은 ~40-50%.

### 9.2 L2 확정(corroborated) 결함 — 반영 대상
- `047442ea`: 예산소진 강제 escalate를 blocker로 카운트 → 예산 낮으면 noise floor 위치만 이동·재현. "진짜 결함"과 "예산미달"을 한 분자에 섞지 말 것.
- `6872ae14`/`e2a5167a`: L0 단일 confronter의 refute가 blocker를 게이트지표서 조용히 제거(저위험 경로 게이밍). refuted=해소 처리의 은폐 위험.
- `b74758ac`: 결정 D "개입률 0 수렴"이 "고위험 항상 게이트"와 모순 → Goodhart. **"고위험 제외, 감소 추세"로 정정.**
- `e8a7df3f`/`cd9485a3`: 결정 B 점수함수·진입임계(`너무 쉬운 만장일치`·split`지속`) 정량 미정 → 현재 구현 불가. 정량화 or 별도 후속 분리.
- `7b941009`: 효과 미입증 — 실데이터로 계산하라(→ 9.1에서 실행, 불충분 확인).
- `01f1b0d7`: escalation *빈도*만 보고 건당 *인지부하* 간과 → 개입 비용은 빈도×복잡도.
- `0e143054`: 데이터출처 A1은 round-1 만장일치 settled-blocker 누락 위험 → settled-blocker 병합 필수·명시.

### 9.3 재설계 우선순위 (결론)
1. **검증자 신뢰성 우선 수리** — 대질 parser-fail(스탠스 미파싱). 2차 검증이 작동해야 상위 지표가 의미를 가짐. A1.3 이후 run만으로 재측정.
2. **임계 데이터 기반 재도출** — 96 실데이터로 "release-blocking 진짜 결함" 분포 산출 → X 결정(5%는 미근거 default).
3. **그 다음** hasBlocker 정의·적응형 사다리 정량화 확정.

→ 본 spec status=needs-rework. §2~5는 방향은 유효하나 §9 반영해 재작성 필요. **구현 착수 보류**(대표 인지).

### 9.4 parser-fail 정체 진단 (2026-06-25, 코드추적+산술 확정) — 실은 "검증 예산 소진"
- 본 run의 escalation 3건 = **parser-fail이 아니라 maxCalls 예산 소진**. `maxCalls=8`, 검증자 2 → round-1이 2콜 → 대질 가용 6콜뿐인데 round-1이 **9쟁점** 띄움 → 6개만 대질, **나머지 3개는 호출조차 안 하고 escalate**(`resolveDeepen(item,[],false)`, l2-loop.js:698). claude 대질 raw 부재 = claude 고장 아니라 **한 번도 안 불림**. gemini 대질 6건은 전부 정상 파싱 → **검증자 vendor 자체는 정상.**
- ★ 출력상 3가지가 동일하게 "응답없음/escalate"로 표시되어 구분 불가: ①진짜 파싱실패 ②**예산소진=미검증** ③진짜 이견. §9.1의 "98% parser-fail"도 대부분 **②미검증**으로 추정.
- = 시스템이 **띄운 결함 수만큼 검증할 예산이 없어, 안 본 것을 escalate로 방출.** 이를 지표서 제외하면 = 미검증 작업을 통과로 둔갑(대표 지적: "검증 없이 진행한 것과 동일", 안전 치명).
- **수리(안전 필수, 9.3보다 선행)**:
  1. 검증 예산을 결함 수에 맞춤(maxCalls 상향) 또는 **미검증 건 명시 표기**(silent 누락 금지) — 띄운 결함 전부 실제 대질.
  2. **"미검증(예산)" / "파싱실패" / "진짜 이견" 3분리** — 현재 구분 불가 → 지표 무의미. (durable bus의 resolveDeepen note 활용 후보)
  3. **fail-closed** — 미검증=게이트 닫음, 통과·제외 금지.

---

## 10. 진입점1 구현 완료 (2026-06-25, §9.4 수리) — 검증 예산/미검증 회계 fail-closed

> 코드: `~/.ai-bootstrap/l2-schema.js`·`l2-loop.js`(T1 직접편집·maia-deploy 동기 완료, WSL↔Windows byte-identical). 패치 검토 아티팩트 = `docs/multiagent/reviews/2026-06-25-b4-ep1-budget-accounting-patch.md`(동기 L2 3R 산출).

**구현(대표 승인 2026-06-25 — 적응형 예산+하드캡 / 데이터층 3분리+fail-closed 계약):**
- ⓐ `resolveDeepen` 3분리 + `verified:boolean`: `unverified`(예산소진=대질 안 함) / `parser_fail`(대질했으나 파싱실패) / genuine(split·refuted·uncertain) 구분. 미검증=verified:false.
- ⓑ 적응형 예산: round-1 결함 전부 대질하도록 maxCalls 자동 상향(needed), `MAIA_L2_MAX_CALLS_CAP`(기본24, floor=설정 maxCalls) 하드캡. 캡 초과분만 fail-closed 미검증.
- ⓒ fail-closed 회계: bus/run-level `unverified`/`parserFail` 분리(run-level=authoritative 총계), `verified` 영속(canonical_items JSON, 무마이그레이션), 미검증=escalation→clean pass 불가. deepenAggMd 정직 라벨(예산소진≠파싱실패≠이견).
- ★계약(진입점3 소비자): `verified===false`만 미검증(`!verified` 금지=legacy undefined 오판), per-issue TERMINAL 읽기(deepen이 initial supersede), severity 스코프(게이트=important+만, suggest=advisory), self-deepen=비독립.

**동기 L2 dogfooding(claude∥gemini, 3R)**: 11 findings 반영(자가도입 blocker `5cab813a` `!!c.consensus`→fail-OPEN 포함). ⚠️ **gemini 3R 연속 429로 2벤더 미완** → claude 단독(부분 자기검토). **2벤더 재검증 = 쿼터 회복 후 carry**(차기 진입점). 단위 49 pass(l2-schema 24·l2-loop 12·l2-db-writer 13).

**비범위(진입점2/3 잔존)**: c6-ready 지표 재정의(round-1→terminal)·X 임계 재도출·적응형 사다리 정량화. 본 패치는 `verified` 데이터를 **생산만**, 소비(게이트 차단)는 계약대로 진입점3.
