---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.3 (구현 완료)
track: C6-2 (가역화 레이어 MVP)
status: implemented
l2_ref: "[[2026-06-21-c6-2-reversibility-layer-spec-l2-deepen-r3-20260621-142008]]"
impl: "done — c6-revpush.js + 게이트 deny-reason 신호 (ai-bootstrap d9d0d2a). e2e 로컬 bare remote 검증. 잔여(후속): gh PR 자동화·pre-push 투명 리다이렉트·다른 가역화 후보(soft-delete 등)·자동 gc 스케줄."
---

# C6-2 — 가역화 레이어 MVP (protected push → 브랜치 + PR)

> C6 §2.2 구현. "실행 후 결과검토"가 성립하려면 되돌릴 수 있어야 한다. 비가역 op를 **가역 형태로 변환(executor)**해 자율화한다. MVP 범위 = 스펙 1순위 **main/master 직접 push → 브랜치 push + PR**(머지가 진짜 게이트 = 모달 승인을 PR 리뷰로 대체). 가역화된 형태만 자율(낮은 E), **raw protected push는 게이트(E3) 유지**.
>
> - 선행: [[2026-06-13-c6-verification-over-approval-spec]] §2.2 / C6-0.2 분류기(reversibility·E 산출) / **C6-1 다이제스트(완료)**.
> - ★ L2 round3 codex: 가역화 결과는 E0~E1이 아닐 수 있다 — 후보마다 **resulting R + resulting E(§1.1 룩업)** 명시.
> - 환경 제약(확인): **gh CLI 없음**, push 자격 불확실(`ls-remote`=read OK). → graceful degradation 필수.
> - SSOT: 코드/spec=repo, 지식=위키. `[기획결정]` = 본 MVP 확정.

## 0. 목표 / 비목표
**목표**
- G1. **`c6-revpush` executor**: "현재 작업을 main에 반영" 의도를 받아 **(a) feature 브랜치 보장 → (b) 브랜치 push → (c) PR 생성/PR-intent 산출**으로 변환. main 무변경.
- G2. **resulting R/E 명시**: 변환 후 = **R0(PR 머지 전 무변경) → E1**(자율, 단 머지는 인간). raw protected push = E3 유지(불변).
- G3. **graceful degradation**: gh 있으면 `gh pr create`, 없으면 **compare URL + PR-intent 파일**(인간이 1클릭 PR). push 자격 없으면 **로컬 브랜치 + intent**까지(머지 전이라 안전).

**비목표**
- N1. raw `git push origin main` 게이트 완화 **아님**(C5 deny 유지 — 가역 경로는 별도 제공).
- N2. 자동 머지 **아님**(머지=인간 검토 게이트, C6 핵심).
- N3. 다른 가역화 후보(파일 soft-delete·migration·패키지·외부발신) = **후속**(MVP는 push 1종).
- N4. PreToolUse 훅이 명령을 **재작성하지 않음**(훅은 allow/deny/ask만 — 재작성 불가). 가역화는 **MAIA가 호출하는 executor**(컨벤션), 게이트는 그대로.

## 1. 통합 지점 — 게이트 강제 리다이렉트 (컨벤션 아님; L2 blocker `24c0dcd7`·`1982c25a`)
> ★ L2 교정: "agent 컨벤션"이면 가역화가 보장되지 않고(24c0dcd7), raw push 차단 시 대체경로 안내 없으면 교착(1982c25a). → **게이트 강제 + 신호로 재구성**:
- **(강제)** C5 게이트는 raw protected push를 **계속 deny**(불변) → raw 경로는 *불가능*. 즉 "안 쓰면 그만"인 컨벤션이 아니라, **raw가 막혀 있어 가역 경로가 유일한 sanctioned 통로**.
- **(신호·교착방지)** 그 **deny-reason이 `c6-revpush`를 명시 지시**하도록 갱신(`c6-policy.denyReasonByDenylistRule`의 protected-push 항목 + 게이트 출력 systemMessage). agent·인간이 차단 즉시 대체경로를 안다 → 무한루프/막힘 차단. **(이 deny-reason 갱신이 C6-2의 일부)**.
- `c6-revpush` 내부 **feature 브랜치 push는 protected 아님 → C5 통과(E1)**.
- C6-1 다이제스트가 실행 결과(PR/머지대기)를 **검토필요**로 노출(머지 전 veto).
- ★ **더 강한 강제(후속)**: git `pre-push` 훅으로 protected push를 *투명 리다이렉트*. MVP는 deny+신호(위)로 충분 — 훅 리다이렉트는 invasive해 별도 검토(H3).

## 2. 설계 — `c6-revpush.js`
```
입력: --base <main|master, 기본=remote HEAD> --title --body [--dry] [--gc]
① 사전조건: git repo? 원격 존재? 반영할 커밋 존재? (실패 → 안전 abort + 사유)
② 브랜치 보장(L2 `ddb32bed`): 결정적 브랜치명 `maia/<slug>` (slug=작업기반, 시각 미포함=멱등).
   - 현재 protected(main/master)이고 local이 origin/<base>보다 ahead면 → ahead 커밋을 feature 브랜치로 옮기고
     **local <base>를 origin/<base>로 reset** → local·remote <base> 모두 무변경 보장.
   - 이미 feature 브랜치면 그대로.
③ idempotent push(L2 `2935d8f7`·`35b97fb6`): `git ls-remote origin <branch>`로 원격 브랜치 선존 확인 →
   있으면 신규커밋만 push(기존 PR/intent 재사용·중복생성 0) / 없으면 신규 push.
④ push 검증(L2 `71b9c8eb`): push에 timeout, 직후 `git ls-remote origin <branch>`로 **원격 ref 실재 확인** →
   확인돼야 `pushed:true`. 미확인/timeout = `pushed:false` 강등(작업 손실 0).
⑤ PR: gh 있으면 `gh pr create`; 없으면(현 환경) compare URL + **PR-intent**(상태=open).
   ★ gh 부재 시 멱등성은 **로컬 intent 상태파일 + 원격 브랜치 존재**로 판정(gh PR 탐지 비의존).
⑥ 결과 레코드(JSON stdout): {branch, base, pushed, prUrl|intent, status, resultingR:'R0', resultingE:'E1', revertCmd}
```
- **resultingR=R0**(remote/local base 무변경) / **resultingE=E1**(자율 + 인간 머지).
- **롤백(L2 `7b223222` — 과장 금지)**: 머지 전 = 브랜치 삭제(`git push origin --delete <branch>` + 로컬 삭제)로 **base 무변경 유지·사실상 원복**. 단 **reflog·PR-intent 기록·이미 알림된 다이제스트 항목은 잔존**(완전 무흔적 아님). 머지 후 = R1(revert PR).

### 2.1 안전·멱등 (pre-L2 예상 쟁점)
- protected 판정: `--base` 또는 remote HEAD 기본브랜치. main/master 외 커스텀 보호브랜치는 설정(`c6-policy.protectedBranches` 재사용).
- 멱등: 같은 작업 재실행 시 동일 브랜치명(작업 slug 기반) → 중복 PR 방지(기존 브랜치/ PR 탐지 후 재사용).
- abort-safe: 어느 단계 실패도 **base 미변경 보장**(브랜치에서만 작업). 부분상태(브랜치 생성됐으나 push 실패)는 intent에 기록 → 재실행 안전.
- **자격/네트워크 실패는 deny가 아니라 강등**(로컬 브랜치+intent) — 작업 손실 0.
- **수명주기·정리(L2 `3576e85c`)**: PR-intent에 `status`(open/merged/abandoned) + `createdTs`. `--gc` 모드(또는 일배치)가 **머지된/오래된(예 14d) intent와 그 원격 feature 브랜치를 정리** → 위키·코드베이스 staleness 방지. intent 상태는 `git ls-remote`(브랜치 사라짐=merged/closed 추정)로 갱신. MVP는 status 필드+`--gc` 제공, 자동 스케줄은 후속.

## 3. 검증 계획 (GitHub 비의존)
- **로컬 bare remote** 픽스처: 임시 `git init --bare`를 origin으로 한 작업repo 생성 → main에 커밋 → `c6-revpush`가 (a)feature 브랜치 생성 (b)bare remote에 브랜치 push (c)main 무변경 (d)compare-intent 산출 검증.
- gh 부재 경로(현 환경) = compare URL + intent. gh 존재 경로는 mock/스킵.
- 멱등: 2회 실행 → 동일 브랜치 재사용, 중복 0.
- abort: 변경 없음/원격 없음 → 안전 abort 메시지.
- 순수 헬퍼(브랜치명·compare URL 구성)는 단위테스트.

## 4. 정직한 한계
- H1. **실 GitHub PR 생성은 gh 설치+인증 필요**(현 미충족) → MVP는 compare URL+intent까지. gh 도입은 별도.
- H2. push 자격 미설정 시 **로컬 브랜치까지만**(여전히 안전·무손실, 인간이 push/PR). 자격 설정=별도.
- H3. **발동 = 게이트 강제 리다이렉트**(§1): raw protected push는 C5 deny(불가) + deny-reason이 `c6-revpush` 지시 → 가역 경로가 유일 통로. 단 *투명* 리다이렉트(pre-push 훅)는 아님 — agent/인간이 신호 받고 `c6-revpush`를 호출. 투명화는 후속(invasive).
- H4. MVP는 push 1종. soft-delete·migration·외부발신 가역화 = 후속(각 resulting R/E 상이).

## 5. 매니페스트/SSOT
- `c6-revpush.js`·`c6-revpush.test.js` → shared.boot. 산출물(PR-intent)=위키 또는 stdout. 코드=repo.
