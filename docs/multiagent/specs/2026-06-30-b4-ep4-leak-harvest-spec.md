---
type: spec
project: mission-control
date: 2026-06-30
status: 설계확정(2벤더 L2 3R + corroborated 6 반영 + escalate 1 대표판정 대기 2026-06-30) — 구현은 대표 인가 후(§9)
author: claude
phase: B.4 진입점4 — 결함유출 harvest 배관 (결정 C)
decision_gate: 대표 ! (배관 가동·c6-policy leakPipelineLive flip = T2+·A2)
refs:
  - "[[2026-06-30-b4-ep3-c6-ready-rewrite-spec]]"
  - "[[2026-06-30-b4-ep2-threshold-x-rederivation]]"
  - "[[c6-4-exec-instrumentation]]"
---

# B.4 진입점4 — 결함유출 harvest 배관 (spec)

> 진입점3의 leak 게이트 placeholder(`leakPipelineLive=false`)를 실가동시키는 **측정 배관**. 진입점2 결정 C 구현.
> 핵심: 유출률을 **측정된 값**으로 만든다(진입점2 `f75b053d` — leak=0이 "미측정"이면 게이트 무의미). passive harvest만(새 결재 0).

## 0. 정의 — "결함 유출"
자율 파이프라인을 통과(게이트 allow + L2 통과)해 **실행된 op이 이후 롤백으로 드러난 것**. = "결함이 검증을 뚫고 적용물로 샌 비율." 자율 확대의 진짜 안전 신호(draft 결함율 blockerRate ≠ 이것, 진입점2).
- ★ **1차 측정 도메인 = 자율 commit-op 한정**(L2 `e5445c17`·`cbd160b0`): 분자(유출)와 분모(실행)를 **동일 도메인**으로 못 박는다 — instrumented SHA가 포착되는 commit-op만. 도메인을 어긋내면(분모=전체 op, 분자=commit-op만) leakRate가 구조적 과소측정→fail-closed 게이트가 실제 高유출에도 통과(unsafe-allow). 그래서 분모도 commit-op로 제한한다.

## 1. 신호원 (passive — 이미 발생, 새 결재 0)
- **분모(실행 op)**: 감사기록 `~/.ai-bootstrap/audit/risk-*.jsonl` 중 `decision ∈ {allow, cutover-allow}` **AND commit-op**(exec-results sidecar로 SHA 포착된 것 — 분자와 동일 도메인). opId = `c6-digest.opIdOf(rec)`.
- **분자(유출 op)** ⊆ 분모 (반드시 부분집합, L2 `cbd160b0`) — 2원천 합집합(dedup by opId):
  1. **객관 자동탐지(주)**: git **revert-commit**으로 되돌려진 instrumented SHA. exec-results sidecar(`exec-results-*.jsonl`, key→sha)로 op↔SHA 조인 → 그 SHA가 revert된 commit인지 **reverted-sha 역참조**로 판정. ★단, 그 op의 audit `decision ∈{allow,cutover-allow}`인 것만 가산(분자⊆분모 강제 — 非자율 op revert 배제). 수동 flag 없이도 측정(f75b053d).
     - ⚠️ **git `reset`은 탐지 불가**(L2 `95058d3f`·`63b5fa6b`): reset은 revert-commit·로그 마커를 안 남김(HEAD 이동·dangling) → reset 롤백은 미포착. "reset 탐지"는 비주장. §7 정직고지.
  2. **대표 명시(보조)**: `c6-rollback --mark-fp <opId>`(기존). ※ 여기서 FP = "게이트 allow 판단이 False Positive(통과시키지 말았어야 함)"=확정 유출 op이지 측정 오탐이 아님(L2 `506c3455` 명료화) — 단 가산 시에도 그 op이 분모(자율 commit-op)인지 확인.
- **창**(L2 `0ea99c89`): 분모 = **op 실행 ts** 기준 `[now-windowDays-settleDays, now-settleDays]`(성숙분만 — 유출은 지연신호라 갓 실행분은 유출 미표면). settleDays(기본 7) = 유출 표면화 유예. 분자 = 그 분모 op이 (revert ts 무관) 현재까지 revert된 것. → 늦게 드러난 유출의 분모 탈락 편향 완화.

## 2. 산출 — state/c6-leak.json (c6-ready 소비)
```
{ leakRate: <leaked/executed>, leaked: N, executed: M, samples: M, windowDays: 30, settleDays: 7,
  domain: 'autonomous-commit-op', ts: <epoch>, sources: { reverted: a, markedFp: b },
  caveats: ['commit-op only','reset-undetected','revert-proxy(FP/FN)'], generatedBy: 'c6-leak.js' }
```
- `executed < leakMinSamples`(기본 20) → c6-leak 은 `leakRate: null`(표본 부족 = 미측정, fail-closed 유지).
- fail-soft: 감사 디렉토리/파일 부재 → null(c6-ready가 fail-closed).

## 3. c6-ready 연결 (진입점3 placeholder 실가동)
- c6-ready `readBus` 옆에 `readLeak()` 추가: `state/c6-leak.json` 읽어 `l2.leakRate` 주입(없으면 null 유지).
  - ★ 소비자 계약(L2 f3ea73e6): c6-leak 출력 `measured:boolean`을 읽어 `measured===false || leakRate===null` ⇒ **fail-closed**(null→0 오독 차단). readLeak()는 파일 부재·measured false 모두 leakRate=null 주입.
- decideReady leak 게이트(이미 구현):
  - `leakPipelineLive=false`(기본) → 여전히 placeholder fail-closed (배관 신뢰 전 보수).
  - 대표가 배관 검증 후 `c6-policy.ready.leakPipelineLive=true` flip → `leakRate===null`(표본부족) = fail-closed / `leakRate ≥ leakMax` = fail-closed / else 통과.
- ★ 진입점3 데드락 해소의 실질 완성: 이제 해제경로(배관)가 **실재·측정**. flip은 대표 결재(표본·정밀 확인 후).

## 4. 신규 모듈 c6-leak.js (배관)
- pure core: `harvestLeak(auditRecs, execResults, revertSet, marks, now, windowDays, settleDays, minSamples)` → §2 산출 객체. 분자⊆분모 강제(자율 commit-op 도메인). 테스트 가능(IO 분리).
- IO shell: 감사 jsonl + exec-results sidecar + repo별 git log 읽어 **reverted-sha 역참조**(`git -C <repo> log --format='%H %P' --all` 등으로 revert가 가리키는 원 SHA 집합 = revertSet) → harvest → state/c6-leak.json atomic write. cron(hermes, c6-ready 직전).
- revert 탐지: reverted-sha **역참조 우선**(`Revert "msg"` grep은 보조 — merge revert·squash 누락). 대상 repo = 자율 op 실행 repo(audit `cwd`). 복수 repo → repo별 스캔.

## 5. 미결(대표·동기 L2 확정)
1. leakMax 임계·leakMinSamples·settleDays — 대표 결재(배관 가동·표본 누적 후).
2. 사고(롤백 아닌 장애) 신호 편입 여부 — 1차 제외(롤백만), 후속.
3. 非commit op 유출 측정(파일편집 등 SHA 미포착분) — 1차 스코프 밖, 후속(§7 caveat).
4. forward-fix(revert 없는 결함수정) FN 보정 — 별도 신호 필요, 후속.

## 6. 적용 흐름
draft spec → 동기 L2 → 대표 ! (c6-leak.js 구현·배포 + cron 등재) → 표본 누적 관찰 → 대표 leakPipelineLive flip(배관 신뢰 후) → leak 게이트 실가동.

## 7. 스코프 정직 고지 (L2 corroborated 반영)
1차 배관의 측정 한계를 c6-leak.json `caveats` + 리포트에 명시(silent 과소측정 금지 — 과소측정이 fail-closed 게이트를 통과시키면 unsafe-allow):
- **commit-op 한정**(`e5445c17`): 분자·분모 동일 도메인(자율 commit-op). 非commit op(파일편집 등) 유출은 미측정 → 별도 후속.
- **reset 미탐지**(`95058d3f`·`63b5fa6b`): git reset 롤백은 로그 흔적 부재로 미포착. revert-commit만 탐지 → reset 선호 워크플로면 과소측정. (완화: 자율 commit 되돌림은 revert가 표준.)
- **revert-proxy 불완전**(`a36b5d48`): revert가 곧 "결함 유출"은 아님. 非결함 revert(기획변경·실험철회·머지충돌)=FP(보수적 과대=안전 방향) / forward-fix된 결함(revert 없이 수정)=FN(과소=unsafe 방향). → leakRate는 근사. (완화: 게이트 fail-closed + 대표 flip 전 정밀 검토 + minSamples.)
- **지연 편향**(`0ea99c89`): settleDays 유예로 완화하나 settleDays보다 늦게 표면화된 유출은 누락 가능.
- ★ 종합 안전장치: 위 한계 전부 **과소측정 가능성** → `leakPipelineLive` flip은 대표가 위 caveat 인지 후에만(자동 flip 금지). 표본부족=null=fail-closed. 의심 시 더 보수적(낮은 leakMax).

## 8. 동기 L2 검증 결과 (2026-06-30, claude∥gemini, 3R) — 반영
> 진짜 2벤더(둘 다 parser=ok) · corroborated 6 · escalate 1 · **미검증 0·파싱실패 0** · 적응형 예산 8→9(진입점1 fix 실증). 집계: `reviews/...-l2-deepen-r3-20260630-151704.md`.

**corroborated 6건 — 반영 완료(설계 결함 사전 차단):**
- `e5445c17`(★안전방향): 분자(commit-op)/분모(전체op) 도메인 불일치→leakRate 과소측정→fail-closed 게이트 unsafe-allow. → §0·§1 **분모도 자율 commit-op로 도메인 일치**.
- `cbd160b0`: 분자⊄분모(非자율 op revert 집계). → §1 분자에 `decision∈{allow,cutover-allow}` 필터(부분집합 강제).
- `95058d3f`+`63b5fa6b`: git reset 탐지 불가(로그 흔적 부재). → "reset 탐지" 비주장, §7 정직고지.
- `0ea99c89`: 창 기준시점 미정의→지연유출 하향편향. → §1 settleDays(성숙분만) + 실행ts 기준.
- `a36b5d48`: revert==유출 프록시 미검증(非결함revert=FP/forward-fix=FN). → §7 프록시 한계 명시 + 안전장치.

**escalation 1건 — 대표 판정 필요(refuted):**
- `506c3455`(blocker, gemini 제기→claude refute): "--mark-fp(FP=False Positive)를 분자로 쓰는 건 모순." claude=FP는 "게이트 allow가 오탐=통과시키지 말았어야 할 확정 유출"이지 측정 오탐 아님(약어 nit). → §1.2에 명료화 반영. 대표 판정.

## 9. 적용 절차 (대표 ! — 후속)
1. (대표 인가 후) c6-leak.js + test 구현(harvestLeak pure core + IO) → 단위테스트 → 동기 L2.
2. c6-ready readLeak() 연결(c6-ready.js=T3·A2 → 대표 ! 패치).
3. maia-deploy 동기 + cron 등재.
4. 표본 누적 관찰 → 대표 caveat 인지 후 leakPipelineLive flip.
