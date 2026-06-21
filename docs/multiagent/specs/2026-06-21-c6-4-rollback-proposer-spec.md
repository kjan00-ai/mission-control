---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.3 (구현 완료)
track: C6-4 Phase 1 (사후 롤백 제안기)
status: implemented
l2_ref: "[[2026-06-21-c6-4-rollback-proposer-spec-l2-deepen-r3-20260621-165709]]"
artifact_ref: 2026-06-21-c6-4-rollback-proposer-spec
impl: "done — c6-rollback.js(proposeRollback R0~R3·deriveCommand·selectCandidates·--scan·--mark-fp, 9 픽스처). R=audit 원본 ruleId 도출(드리프트 안전), exact→derivable+확인필수, anomaly트리거 폐기(실행된 op만), Telegram=대표 mark만. L2 3R 수렴(5 settled+3 에스컬 전부 기술해소). ★ 실행 0(제안만). e2e: 합성 cutover→pnpm remove 도출·실 --mark-fp→active 검증. 회귀 36/36·drift 0. ★ 지연큐(E2/E3)=Phase 2 이연(핸니스 충돌)."
---

> **v0.2 변경(L2 3R 수렴, 5 settled + 3 에스컬 전부 기술해소)**: (B `682dac95`) 건강한 cutover op마다 알림=경보피로 → **Telegram은 대표 mark-fp만**, cutover-allow는 리포트에 passive 롤백준비만. (B `4e29f9b7`/`446aacb8`) anomaly는 deny기반인데 deny op은 실행 안 됨(롤백 불요)=모순 → **anomaly 트리거 폐기**, 후보=실행된 op(cutover-allow + mark-fp). (`897b6e9b`) 현재 재분류=드리프트 → **R을 audit 원본 `ruleId`에서 `reversibilityByCommandRule`로 도출**(원분류 보존)+policy_version 스탬프. (`7af100f4`/`1408dbe2`) `exact:true` 과장(mv 덮어쓰기·pkg lockfile/전이) → **`exact`→`derivable`, 항상 "확인 후 실행"**. (`da858feb`/`cec77dbd` 워딩) "op 실행 0"(대상 op 미실행)으로 명확화, 리포트 frontmatter+`projects/{p}/rollbacks/` 유지.

# C6-4 Phase 1 — 사후 롤백 제안기

> C6 안전 서사의 마지막 고리. C6-1(다이제스트)은 "뭔가 이상"을 알리지만 **되돌리는 구체 행동**은 안 줬다. 자율 실행(Phase B cutover·일반 allow)된 op이 사후 FP/anomaly로 드러나면 **클래스별 구체 롤백 명령**을 제시하고 대표에게 경보. ★ **실행 안 함 — 제안만(advisory)**. C6-1/2/3 규율(default-safe, 대표 게이트) 답습.
>
> - 선행: [[2026-06-16-c6-0.1-policy-taxonomy]](가역성 R0~R3) / [[2026-06-21-c6-1-result-digest-spec]](ROLLBACK 맵·anomaly·sendTelegram) / [[2026-06-21-c6-3-phaseB-cutover-spec]](cutover FP가 최우선 롤백 후보). SSOT: 코드/spec=repo.

## 0. ★ 범위 (핸니스 제약 — 대표 결정 "롤백 제안기 먼저")
- **지연큐(E2 veto/E3 승인창)=Phase 2 이연**: 동기 PreToolUse 훅은 tool-call을 *지연-재실행* 불가 → 진짜 지연큐는 **별도 비동기 실행채널**이고 R3(가장 위험)에 *실행경로를 추가*. 별도 무거운 설계.
- **자동실행 롤백 아님**: 자동실행=위험 채널 + 감사로그는 **명령만** 기록(결과 SHA·PR#·PID 없음) → 정확 타깃 도출 불확실. ⇒ **MVP=제안기**. 자동실행은 후속(대표 게이트, cutover처럼 activated 플래그).

## 1. 목표 / 비목표
**목표**
- G1. **`proposeRollback(opRecord)`**: audit op → 가역성(R) 재산출 → 클래스별 **구체 롤백 제안**{action, command, manual, exact}.
- G2. **`--scan`**: recent audit에서 롤백 후보 선별(cutover 자율실행 > anomaly > 대표 mark) → 제안 산출.
- G3. **단일 롤링 리포트 + R2/R3 신규시 Telegram 경보**. 멱등·read-only(실행 0).

**비목표**
- N1. 롤백 **실행 아님**(제안만). N2. 지연큐/veto 아님(Phase 2). N3. 마법 FP탐지 아님(신호=cutover/anomaly/mark). N4. R3 자동롤백 아님(원천 불가).

## 2. 설계 — `c6-rollback.js`

### 2.1 pure core `proposeRollback(opRecord)`
audit 레코드(`{tool,path,cmd,ruleId,decision,cutover,...}`). ★ R은 **audit에 기록된 원본 `ruleId`**에서 도출(`897b6e9b` 드리프트 방어): `reversibilityByCommandRule[ruleId]`(원분류 보존). ruleId가 맵에 없으면 `classifyPolicy(op).reversibility`로 advisory 폴백 + `policy_version` 스탬프. `ROLLBACK` 맵(c6-digest 재사용)으로 클래스 행동:
| R | 의미 | action | command (도출시) | derivable |
|---|---|---|---|---|
| **R0** | 재생성/국소 | `none` | (조치 불요) | n/a |
| **R1** | 시간제한 가역 | `revert` | `git revert <sha>` / `git reset` | false(SHA 불명) |
| **R2** | 역연산 존재 | `reverse-op` | 클래스별(§2.2) | 일부 true |
| **R3** | 비가역 | `manual` | null — 자동 불가, 영향점검 | false |
- 반환 `{ opId, ruleId, R, action, command, manual:boolean, derivable:boolean, note }`.
- ★ **`derivable` ≠ 정확보장**(`7af100f4`/`1408dbe2`): command가 audit에서 *문법적으로 도출 가능*한지일 뿐, 실행 정확성 보장 아님. **모든 제안에 "확인 후 실행" 캐비엇 필수** — audit엔 사후상태(덮어쓰기·충돌·lockfile·전이의존)가 없음.

### 2.2 R2 클래스별 역연산 도출 (derivable이어도 검증 필수)
- **move-rename**(`mv a b`): 역 `mv b a` — derivable:true. ⚠️ 단 b가 기존파일 덮어썼으면 원복 불가(확인 필수).
- **pkg-install**(`pnpm add X`): `pnpm remove X`(패키지명 파싱) — derivable:true. ⚠️ **lockfile·전이의존·dev/prod·버전은 미복원**(확인 필수).
- **migration**: "down 마이그레이션 확인 필요" — derivable:false(타깃 버전·DROP 불명).
- **process-kill**: "종료된 프로세스/서비스 재시작 필요" — derivable:false(PID/서비스 불명).
- **git-push**: c6-revpush PR revert / `git revert` 안내 — derivable:false. (C6-2 연계.)
- **infra/remote-run**: "역연산 수동 확인" — derivable:false.

### 2.3 `--scan` 트리거 (★ 실행된 op만 — anomaly 폐기)
recent audit(`risk-*.jsonl`, `--since`) → **실행된 op**(decision `allow` OR `cutover:'allow'`) 중:
1. **대표 mark** — `--mark-fp <opId>` 상태파일(`state/c6-rollback-marks.json`) 등재분 → **active**(제안+경보).
2. **`cutover:'allow'`** — Phase B 자율실행(인간 승인 0) → **passive**(리포트에 롤백준비만 나열, 경보 없음). (현재 default-off → 0.)
- ★ **anomaly(deny기반) 트리거 폐기**(`4e29f9b7`/`446aacb8`): anomaly는 deny 클러스터인데 deny op은 실행 안 됨=롤백 불요 → 모순. 롤백 후보는 **실행된 op만**.
- ★ FP는 마법탐지 아님 — active 경보는 **대표 mark만**. (executed-then-errored 자동신호는 트랜스크립트 조인 필요 → Phase 2.)

### 2.4 출력 / 경보 / 수명주기
- 위키 **단일 롤링** `wiki/projects/{project}/rollbacks/C6-ROLLBACK-{project}.md`(0b2f1628 교훈, overwrite). **frontmatter(type/project/date)** 포함 → 5필터·그래프 정합(`cec77dbd`). active(mark) + passive(cutover) 분리 섹션, R·action·command·derivable·캐비엇.
- **Telegram = active(대표 mark-fp) 신규분만**(`682dac95` 경보피로 해소): 건강한 cutover/passive·R0·이미본 것=**무음**. c6-digest `sendTelegram` 재사용, fail-soft, `--no-telegram`.
- ★ **"op 실행 0"**(`da858feb` 명확화): 제안기는 리포트·상태·알림을 *쓰지만*, **대상 op·롤백 명령을 절대 실행하지 않음**(read-only는 이 의미). 멱등: opId dedup 워터마크(`state/c6-rollback.json`). lock+tmp+rename. 파싱실패 skip.

## 3. ★ 정직한 한계
- H-R1: command는 **advisory·확인필수** — audit에 사후상태(SHA/PR#/PID/버전·덮어쓰기·lockfile·전이의존) 없어 `derivable:true`도 **정확 보장 아님**. 모든 제안에 캐비엇.
- H-R2: FP 탐지는 마법 아님 — active 경보 신호 = **대표 mark만**. cutover는 passive 준비만. "성공했지만 의미상 틀린" op은 대표 판단.
- H-R3: **R3=자동롤백 원천 불가**(비가역, 사회적 가역성≠디지털). alert+영향점검 안내만.
- H-R4: **롤백/대상 op 실행은 비범위**(제안기는 리포트·상태·알림만 씀). 자동실행=후속 대표 게이트.
- H-R5: R은 audit 원본 ruleId 도출(원분류 보존). ruleId 미매핑 op은 classifyPolicy advisory 폴백 + `policy_version` 스탬프(드리프트 노출).

## 4. 검증 계획
- 골든픽스처(`c6-rollback.test.js`): R0(none)·R1(revert)·R2(move-rename 역도출 exact·pkg 파싱·migration down)·R3(manual) 제안 / scan 후보선별(cutover>anomaly>mark, deny 제외) / dedup / 경보 R2R3-only.
- e2e: 실 audit `--scan`(cutover 0 → anomaly/mark 경로) + 합성 cutover op → R2 제안+command 육안. 멱등 재실행 0.
- read-only(op 실행 0) 입증. maia-deploy drift 0.

## 5. 매니페스트/SSOT
- `c6-rollback.js`·`c6-rollback.test.js` → manifest shared.boot. 제안/마크=local·위키. 코드=repo.
