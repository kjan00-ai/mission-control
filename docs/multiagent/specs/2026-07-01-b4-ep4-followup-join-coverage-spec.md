---
type: spec
project: mission-control
date: 2026-07-01
status: 설계확정(2벤더 L2 3R + corroborated 4 반영 + escalate 2 2026-07-01) — 구현(c6-leak 완화조인·audit branch hook)은 대표 인가 후
author: claude
phase: B.4 진입점4 후속 — 조인 커버리지 개선 + ep4 §5 잔여
decision_gate: 대표 ! (c6-leak 조인=T1 / audit branch=A2 hook)
refs:
  - "[[2026-06-30-b4-ep4-leak-harvest-spec]]"
  - "[[2026-06-30-b4-ep4-c6-leak-impl]]"
  - "[[c6-4-exec-instrumentation]]"
---

# B.4 진입점4 후속 — keyOf 조인 커버리지 개선 (spec)

> A1(flip 조건 실측)에서 발견: leak harvest의 `executed`가 0에 정체 = **flip의 실질 blocker**.
> 근본 = keyOf 조인 저조(selection-bias caveat의 실체). 본 spec = 그 근본 수리 + ep4 §5 잔여 항목 처리.

## 1. 근본 진단 (실측)
- exec-results(PostToolUse instrument): `{ts,key,tool,cmd,cwd,branch,sha}`, key=keyOf(tool::cmd::cwd::**branch**). branch 실측=`master`·`feat/c4b0-agent-id`(전부 non-empty).
- audit(PreToolUse): `{ts,tool,path,cmd,cwd,cls,ruleId,decision}` — **`branch` 필드 없음** → keyOf에서 branch='' → exec와 키 불일치.
- 실측 조인율: 기존 keyOf(엄격) allow-commit **3건** vs **완화조인**(tool+정규화cmd, branch/cwd 무시) **7/15(~47%)** = **~2배**.
- ⚠️ **원인 격리 한계(L2 `8c2d6114`)**: 완화조인 실험이 branch·cwd를 **동시** 무시 → 이 결과만으론 branch 단독을 주범으로 격리 불가. 정확히는 "**branch 및/또는 cwd 불일치**"가 저조인 원인(branch는 실측 전부 non-empty로 유력 후보이나 단정 아님). 구현 전 branch만/cwd만 각각 무시한 A/B 측정으로 기여도 분리 필요.
- ★ 이 저조인이 c6-leak 분모(executed)를 0에 묶어 flip 지연 위험. c6-rollback도 같은 조인 쓰므로 **동일 결함 공유**.

## 2. 결정 A — 즉시: c6-leak 완화 조인 폴백 (T1, 훅 무변경)
- ★ **commit 도메인 엄격 스코프(L2 `bf91064a`)**: 완화조인은 **진짜 commit-생성 op에만** 적용. 자격 = (audit cmd가 commit 패턴) **AND** (exec 항목의 sha가 그 parent와 상이 = 실제 새 커밋). 비commit exec 항목(HEAD 불변 sha)은 완화조인 대상서 **배제** → SHA 앵커 없는 항목이 분모(executed)를 오염시키는 것 차단.
- 조인 순서: **① 엄격 keyOf 우선** → 미스면 **② 완화키(tool + 정규화cmd, branch·cwd 무시)** 폴백. **둘 다 commit 도메인 내에서만.**
- **정규화 규칙 확정(L2 `89cd0b4a`, 미결 아님)**: (a) whitespace collapse(`\s+`→` `) (b) 선행 `cd <path>` + (`&&`|`;`) 접두 1회 제거 (c) `~`/`$HOME`→home 절대경로 전개. 그 외 변형 없음(보수적).
- **과매칭 억제**: 완화조인 다중 매칭 시 **sha별 dedup(opId 기준)** + commit 도메인 한정으로 비commit 오귀속 원천 차단. 유출 판정은 항상 sha∈revertSet(조인은 autonomy 귀속만).
- 효과: executed↑(실측 완화 여지 3→7) → flip 표본 도달 가속. caveat `selection-bias`는 "완화조인+commit스코프 적용"으로 갱신.

## 3. 결정 B — 근본: audit에 branch 기록 (A2 hook, 대표 !)
- PreToolUse(pre-risk-classify.js)가 audit 레코드에 **`branch` 추가**(exec instrument와 동일 산출) → keyOf 네이티브 일치(go-forward). c6-rollback 조인도 동시 개선.
- ⚠️ **스코프 한계(L2 `669a450e`)**: branch를 **변경하는 op**(git checkout/switch/reset)는 PreToolUse branch ≠ PostToolUse branch → strict keyOf 재불일치. 단 **leak 도메인=commit op은 branch 안정**(커밋 중 브랜치 불변)이라 결정 B가 commit 조인엔 유효. branch변경 op은 leak 대상 아니므로 실영향 없음(명시).
- A2 보호 훅 → 대표 ! 패치. go-forward만(과거 audit엔 branch 없음 → 완화조인 폴백이 legacy 보전).
- ★ 결정 A(완화조인)는 legacy+go-forward 모두 커버, 결정 B는 commit op go-forward 정밀화 → **둘 다 채택**(A 먼저, B는 대표 hook 결재).

## 4. ep4 §5 잔여 — 처리 방침
- **非commit op 유출**(파일편집 등 SHA 미포착): PostToolUse instrument가 commit만 sha 포착 → 파일편집 op는 유출 미측정. 1차 스코프 밖 유지(별도 후속 — 파일 스냅샷/해시 비교 필요, 큼). caveat 유지.
- **git reset 탐지**: reset은 흔적 부재 → 구조적 미탐지. 완화 불가(caveat 유지). 자율 되돌림은 revert가 표준이라 실영향 작음.
- **forward-fix FN**(revert 없는 결함수정): 별도 신호(예: 후속 커밋이 직전 자율커밋 라인 수정) 필요 → 복잡·오탐 큼, 후속 보류. caveat 유지.
- **사고(롤백 아닌 장애) 신호**: 헬스워치/서비스 다운 이벤트 편입 후보 → 결정 C 확장 후속(범위 큼). 1차 제외.

## 5. 미결(대표·동기 L2)
1. ~~완화조인 정규화 규칙~~ → §2 확정(3규칙 + commit스코프 + sha dedup).
2. 결정 B hook 패치 승인(A2) — go-forward branch 기록.
3. branch만/cwd만 각각 무시한 A/B 측정으로 저조인 기여도 분리(구현 전, `8c2d6114`).
4. 잔여(非commit·forward-fix·사고)는 별도 진입점(범위 큼) — 본 spec은 방침만.

## 7. 동기 L2 검증 (2026-07-01, claude∥gemini, 3R) — 반영
> corroborated 4 · escalate 2 · 미검증0·파싱실패0. 집계 `reviews/...-followup-join...-deepen-r3-20260701-220848.md`.

**corroborated 4 — 반영:**
- `8c2d6114`: branch·cwd 동시 무시라 branch 단독 격리 불가 → §1 "주범 확정"→"branch 및/또는 cwd", A/B 측정 미결 추가.
- `669a450e`: 결정 B가 branch변경 op서 재불일치 → §3 commit op(branch안정)에 한정 유효 명시.
- `bf91064a`: SHA 앵커 commit 전용 → §2 **commit 도메인 엄격 스코프**(비commit 배제, 분모오염 차단).
- `89cd0b4a`: 정규화 규칙 미정의 → §2 3규칙 확정 + 과매칭 억제(sha dedup).

**escalate 2 — 대표 판정 완료(2026-07-01, 전부 claude 손·현행):**
- `7c62312c`: 다단 조인 인지부하 → claude refute(의도된 계층 폴백, 결정 B가 완화조인 sunset, SHA 앵커 관심사 분리).
- `c6d54cd4`: 정규화 과매칭 → claude refute + `89cd0b4a`로 규칙 정의됨, SHA+dedup 억제, 15건 규모라 영향 미미.

## 6. 적용 흐름
draft → 동기 L2 → 대표 ! : 결정 A(c6-leak 완화조인, 구현·테스트·deploy) → 결정 B(audit branch hook, A2 대표 패치) → executed 누적 가속 관측 → 표본 성숙 시 A1 flip.
