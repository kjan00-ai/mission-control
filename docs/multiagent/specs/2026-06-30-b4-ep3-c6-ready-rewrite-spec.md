---
type: spec
project: mission-control
date: 2026-06-30
status: 확정(2벤더 L2 3R + corroborated 3 반영 + escalate 3 대표판정 완료 2026-06-30) — draft 검증완료, 적용은 대표 ! (§9)
author: claude
phase: B.4 진입점3 — c6-ready 지표 재작성 (진입점2 방향 구현)
decision_gate: 대표 ! (c6-ready.js = T3·A2 게이트자기보호 → 대표 직접 패치)
refs:
  - "[[2026-06-30-b4-ep2-threshold-x-rederivation]]"
  - "[[2026-06-25-b4-ready-metric-adaptive-verification-spec]]"
  - "[[a2-gate-self-protection]]"
---

# B.4 진입점3 — c6-ready 지표 재작성 (spec)

> 진입점2 결론(blockerRate=잘못된 계측기, advisory 강등 + 검증커버리지/유출률 게이트로 전환)을 c6-ready.js에 구현.
> c6-ready.js는 게이트자기보호(T3·A2) → 본 spec+draft 검증 후 **대표 `!` 직접 패치**. 에이전트는 draft 파일만 생산.

## 1. 현행 결함 (진입점2 실증 재확인)
- 데이터: round-1 집계 markdown만 스캔(`*-l2-aggregation-*.md`), deepen terminal 무시.
- hasBlocker = round-1 verdict 수정필요 ∧ /blocker/ → "round-1이 트집 잡은 비율"(80%대 노이즈 바닥).
- 게이트: `total ≥ minSamples ∧ blockerRate < X(0.05)`. X는 코드 default(미결재) → 영구 미달.
- 진입점2: 정직 데이터로도 86%(전량 corroborated=양벤더 합의) → **blockerRate는 성숙도가 아니라 L2 생산성 측정** = 잘못된 게이트.

## 2. 데이터 출처 결정 — A2 (durable bus) 채택
- **A1(markdown deepen terminal)**: 포터블(DB 무의존)이나 honest 판별자(post-진입점1 vs legacy)가 흐림 → 오염 legacy 계수 위험. 마크다운 헤더 파싱 취약.
- **A2(durable bus `l2_rounds.canonical_items`)**: `verified` 필드로 honest 판별 견고, 구조화 정밀. §10 계약(`verified===false`만 미검증)이 A2 소비자용으로 작성됨. 진입점2가 A2로 검증 완료.
- **제약·완화**: DB+better-sqlite3 의존 추가. **fail-soft**(l2-db-writer 패턴 미러: no-db/no-driver → 빈 데이터 → fail-closed). Windows(MC DB 부재)·드라이버 불일치 = **fail-closed = 안전**(MC 카테고리 미활성). 오염 markdown으로 **폴백 금지**(fail-closed가 안전).

## 3. 신규 지표 (진입점2 R1~R4 = 순서 시퀀스)
honest 코퍼스 = `canonical_items`에 `verified` 필드 보유 라운드를 가진 review만. artifact별 최신(dedup). 종단 분류(§10 계약):
- per-issue TERMINAL(deepen parent_item_id가 initial supersede), **important+ 스코프**, `verified === false`만 미검증(legacy undefined 금지).
- 분류: corroborated/settled(verified) ∨ split·uncertain·escalate(verified) = real defect(advisory) / refuted(verified) = 제외 / verified===false = 미검증(커버리지 게이트).

**글로벌 게이트(decideReady globalReasons):**
1. **honest 표본 부족**: honestTotal < l2MinSamples → fail-closed.
2. **검증 커버리지 게이트(신설, fail-closed)**: 미검증율(미검증 보유 artifact / honestTotal, **artifact-level**) ≥ coverageMax → fail-closed. = "L2가 실제로 검증을 *수행*하는가" 신호.
   - ⚠️ **단위 명시(L2 corroborated `1b73adf9`)**: 게이트는 **artifact-level**(미검증 important+ 이슈를 1개라도 가진 artifact 비율)로 잰다. 진입점2의 14.6%는 **issue-level**(미검증 이슈/전체 이슈)이라 단위가 다르다 — 임계는 artifact-level로 보정해야 한다. 실측 artifact-level = **28.6%**(7중 2). issue-level(14.6%)은 advisory(`unverifiedIssueRate`)로 별도 노출해 보정 참고만.
3. **결함 유출 게이트(pending placeholder, fail-closed 보수)**: `leakPipelineLive=false`(기본) → "결함유출 측정배관 미구축(결정 C 선결) — fail-closed 보수" globalReason 상시. 배관 구축 후 대표가 c6-policy로 flip → 측정 유출률 < leakMax 게이트 활성.
   - ⚠️ **정직 정정(L2 corroborated `8b1adad2`·`d6abfaa6`)**: 이 placeholder는 진입점2 데드락 `cc0358c6`을 "해소"한 게 **아니다** — 결정 C가 미구축인 한 사유만 바뀐 채 **영구 not-ready**다(데드락 재배치). 진짜 탈출은 둘 중 하나여야 한다:
     - **(i) 결정 C를 즉시 후속 진입점4로 스케줄**(유출 harvest 배관, c6-rollback 신호 연결) — 본 spec이 이를 명시 약속. 배관 미예정이면 본 게이트는 정당화 안 됨(차라리 leak 게이트 미도입).
     - **(ii) 대표 per-category `--force`**(c6-activate.js:127 기존) = 배관 전 압력밸브. 특정 ruleId만 대표가 알고 강제 활성(자율 아님·대표 결재).
   - 즉 기본 fail-closed는 진입점2 R4의 **의도된 보수**(유출 미측정 상태서 자동 활성 금지)이되, **(i)scheduled 배관 + (ii)owner force**라는 실해제경로 2종이 있어야 "데드락 아님"이 성립. 둘 다 없으면 leak 게이트를 빼고 coverage+표본만으로 가야 한다(덜 안전, 별도 결재).
4. **blockerRate = 게이트 아님(advisory)**: 계속 계산·리포트 노출하되 globalReasons에서 제외. "L2 생산성" 참고치.

## 4. 임계 (c6-policy.ready — 미설정 시 코드 default, 전부 대표 ! 결재 대상)
- `l2MinSamples`(honest): 기존 5 유지(보수). honest 누적 적으니(진입점2 N=7) 상향 후보는 대표 결재.
- `coverageMax`(**artifact-level** 미검증율 상한): **default 0.20**(잠정). 실측 artifact-level 28.6% > 0.20 → 현재 fail-closed(정상 — 진입점1 예산수리 누적 시 하락). 단위는 artifact-level(L2 `1b73adf9`). 확정=대표 !.
- `leakPipelineLive`: default **false**(배관 미구축). `leakMax`: 배관 가동 후 결재.
- ⚠️ 모든 임계는 코드 default=미결재 → B.4 활성화는 c6-policy.ready(A2 보호) 결재 + c6-ready.js A2 보호 후에만(현행 §6 유지).

## 5. DRY·호환 (회귀 방지)
- `computeReadiness()` 반환 shape 유지: `{verdict:{byRule,l2,thresholds,globalReasons}, ledger, l2, thr, thrProvenance, curPolicyVersion}`. c6-activate가 `verdict.globalReasons`·`verdict.byRule`·`l2` 소비(c6-activate.js:72/94/127) → 무변경 동작.
- `l2` 객체에 advisory 필드 추가: `{honestTotal, blockerArtifacts, blockerRate(advisory), unverifiedArtifacts, unverifiedRate, leakRate:null}`. 기존 `{total,withBlocker,rate}` 키는 honestTotal/blockerArtifacts/blockerRate로 매핑 유지(리포트 호환).
- 단위테스트 `c6-ready.test.js` 갱신: terminal 분류·커버리지 게이트·leak placeholder·legacy 버전가드(verified===undefined 미산입)·DRY shape.

## 6. 산출물·적용 흐름
- 에이전트 생산: `~/.ai-bootstrap/c6-ready.ep3-draft.js`(검토용, 라이브 c6-ready.js 미덮어쓰기) + 본 spec + 갱신 test draft.
- 검증: 단위테스트(draft) + **동기 L2**(claude∥gemini).
- 적용(대표 `!`): draft→c6-ready.js 치환 + test 치환 + `maia-deploy`(Windows 동기) + cron 1회 실행 검증. A2 보호라 **대표만**.

## 7. 미결(대표 확정)
1. A2 채택 승인(vs A1 포터블). 권고=A2.
2. coverageMax 임계(0.20 잠정, **artifact-level**).
3. 결함 유출 배관(결정 C) = **진입점4로 스케줄**(§3 gate3 정직정정 — 미예정이면 leak 게이트 부당). 본 spec은 placeholder만.
4. honest 표본 충분 기준(현 7).
5. leak 게이트 채택 여부: (i)진입점4 배관 + (ii)대표 --force 밸브 전제 시만 정당 / 둘 다 불가면 leak 게이트 제외하고 coverage+표본만(덜 안전).

## 8. 동기 L2 검증 결과 (2026-06-30, claude∥gemini, 3R) — 반영
> 진짜 2벤더(둘 다 parser=ok) · corroborated 3 · escalate 3(전부 gemini 제기·claude refute, 아래 corroborated와 동일 주제) · **미검증 0·파싱실패 0**. 집계: `reviews/...-881d8fcb-l2-deepen-r3-20260630-145045.md`.

**corroborated 3건 — 반영 완료:**
- `1b73adf9`(coverageMax 단위 불일치 issue↔artifact): §3.2·§4 단위 명시 + 코드에 `unverifiedIssueRate` advisory 추가. 게이트=artifact-level 확정.
- `8b1adad2`(leak placeholder=데드락 재배치, 영구 not-ready): §3 gate3 정직정정 — "해소" 철회, 결정 C=진입점4 스케줄 + 대표 --force 밸브 2종 실해제경로 명시. 둘 다 없으면 leak 게이트 빼야 함.
- `5666ebcc`(honest 코퍼스 round/item 입도): `classifyReviewTerminal` honest 판별을 ANY→**ALL item verified**로 엄격화(부분 마이그레이션 혼입 차단). 코드+테스트 반영.

**escalation 3건 — 대표 판정 완료(2026-06-30): 전부 대질자(claude) 손·현행:**
- `26f64e68`(blocker): Windows fail-closed가 "기능적 배포 원천 차단" (gemini) vs "게이트는 배포 아님·보수 정상, WSL canonical엔 DB 존재, 폴백/fail-open이 더 위험" (claude refute). → **대표: claude 손·현행.** 변경 없음.
- `0fd03953`: verified undefined 미검증 과소평가 (gemini) vs "분모도 honest 한정→undefined는 분자분모 동시 배제, 의도된 버전가드" (claude refute). → **대표: claude 손·현행.** `5666ebcc`(ALL verified)가 보강.
- `d6abfaa6`: leak 영구 비활성화 (gemini) vs "정의된 해제경로 존재" (claude refute). → **대표: claude 손 — 진입점4(유출배관) 스케줄 확정으로 해소.** 결정 C를 진입점4로 약속(§7.3).

## 9. 적용 절차 (대표 ! — c6-ready.js A2 보호)
1. (대표 `!`) draft→라이브 치환: `cp ~/.ai-bootstrap/c6-ready.ep3-draft.js ~/.ai-bootstrap/c6-ready.js` + `cp ...ep3-draft.test.js ...c6-ready.test.js`.
2. (대표 `!`) 단위테스트: `node --test ~/.ai-bootstrap/c6-ready.test.js` (8 pass 기대) + 기존 c6-activate.test.js 회귀 확인.
3. (대표 `!`) `node ~/.ai-bootstrap/maia-deploy.js` (Windows byte-identical 동기) + manifest 등재 확인.
4. (대표 `!`) cron 1회 실행 검증: `node ~/.ai-bootstrap/c6-ready.js --list` → 글로벌 게이트 ✗(커버리지 28.6%+유출배관) 표시 확인.
5. ai-bootstrap commit(T2) + push(T3 대표). 본 spec·진입점2 분석 = MC repo docs commit.
6. **차기 = 진입점4**: 결함유출 harvest 배관(c6-rollback 신호 → 유출률 측정), leak 게이트 활성화 전제.
