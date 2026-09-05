# C5-0b 실행계획 — feat/* 한정 commit 자율(branch-aware Decision Gate)

> MAIA 자율화 로드맵 3단계. 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.C/§3 + 대표 승인 2026-06-11.
> - 날짜: 2026-06-11 / 작성: claude / 버전: **v4 (L2 3라운드 반영 — strict allowlist + explicitAllow 훅 + 전 쉘분리자 veto)**
> - SSOT: 정책=`~/.ai-bootstrap/decision-policy.json` / 분류기=`risk-classify.js` / 강제=`~/.claude/hooks/pre-risk-classify.js`
> - 선행: **C5-1a 완료**(L2 검증엔진 round2까지 가동 — 단일 AI 환각 차단). C5-0a enforce 실측 깨끗(audit 128건, 오탐 0).
> - 후속: C4B-1~3 / C5-1b/C5-2(durable bus) / **C5-0c = push allow**(마지막).

---

## 0. 한 줄 정의

Decision Gate에서 `git commit`을 **현재 브랜치가 `feat/*`일 때만 T2(ask)→T1(allow)로 하향**해 자율 커밋을 연다. main/master·detached·불명·기타 브랜치는 **T2(ask) 유지**. push·merge·force-push는 불변(C5-0c/DENY).

## 1. 목표 / 비목표

### 목표
- **feat/* 브랜치 자율 커밋**: 검증엔진(C5-1a) 가동 후, 가역(reset/revert 가능)·로컬(미push) 작업인 commit을 feat/*에 한해 자율화.
- **main 보호 불변**: protected 브랜치 commit은 ask 유지(대표 게이트).
- **Fail-safe**: 브랜치를 확정 못 하면(에러/detached/비-git) **게이트 유지**(C5-0a의 fail-open과 반대 — 권한 개방은 확신할 때만).
- **정책 SSOT 유지**: 브랜치 패턴·하향 클래스는 json에만. 분류기는 일반 `branchAllow` 메커니즘.

### 비목표
- push/merge allow = **C5-0c**(GitHub branch protection 병행). · commit 전 자동 test/diff 수집(§2.C 검증훅 비전) = 후속(MVP는 branch-gate만). · 비-conventional 브랜치 확장 = 실측 후 json 튜닝.

## 2. 메커니즘

### 분류기 (`risk-classify.js`) — **ALLOWLIST(blocklist 아님)**
- commandRule에 `branchAllow:{re,class,requireRe,denyIfRe}`. 하향(T2→T1) + **explicitAllow=true** 조건: ① `input.branch` ∈ `branchAllow.re`(`^feat/`) AND ② 명령이 **`requireRe` 매칭**(앵커 `^git commit … -m …`) AND ③ `denyIfRe` 미매칭. 하나라도 불충족 → 원 class(T2 ask). branch 부재 → 미적용.
- **`requireRe`(allowlist)** = `^\s*git\s+commit\b(?=…-m/--message/-F/--file…)`. **시작이 `git commit`이 아니면 전부 탈락** → env-prefix(`GIT_DIR=… commit`)·`-c core.hooksPath`·`git -C`·`cd;`·`checkout&&`가 앵커에서 자동 차단(우회 열거 불요). `-m` 없는 bare commit도 탈락(에디터 교착 방지).
- **`denyIfRe`(방어심화 veto)** = `--amend` `--no-verify`(이력재작성·훅우회) + **전 쉘 분리자/치환**: `&`(단일 &·백그라운드 포함) `|` `;` `$(` `<( >(`(프로세스 치환) 백틱 newline. case-sensitive. (L2-3 `40958ca1`: 단일 `&`로 `commit & curl evil` 가능 → 차단.)
- **explicitAllow 전파**: winner가 하향 escalator(최상위 class)일 때만 result.explicitAllow=true. 복합명령에서 push(T3)/rm(DENY)이 더 높으면 그쪽이 winner → explicitAllow=false(자율 안 됨). 타 escalator·denylist 불변.

### 훅 (`pre-risk-classify.js`)
- command가 `\bcommit\b`일 때만 `git rev-parse --abbrev-ref HEAD`(cwd=evt.cwd, timeout 2s)로 branch 산출 → classify 전달. 실패·`HEAD`(detached) → `null`(게이트). audit에 branch 기록.
- **★ explicitAllow 시 `permissionDecision='allow'` 방출**(L2 BLOCKER `6d8c4900` 수정). 종전 Bash T0/T1은 passthrough(settings allowlist 의존)뿐이라 분류만 T1로 내려도 자율 commit이 실제 성립 안 됨 → explicitAllow Bash는 훅이 직접 allow.

### 정책 (`decision-policy.json`)
```json
{ "id": "git-commit", "class": "T2", "re": "...commit\\b",
  "reason": "commit (feat/* 단순커밋 자율, 그 외 게이트)",
  "branchAllow": { "re": "^feat/", "class": "T1",
    "requireRe": "^\\s*git\\s+commit\\b(?=[^\\n]*(?:-m\\b|--message|-F\\b|--file|-[a-zA-Z]*m[a-zA-Z]*\\b))",
    "denyIfRe": "--amend|--no-verify|&|\\||;|\\$\\(|[<>]\\(|`|\\n" } }
```
- _meta.version → `c5-0b-v1`.

## 3. 안전 분석 (L2 2라운드 반영)
- **TOCTOU·repo리다이렉트 (round1 `4cfbfec3`/`52d6bfa9` + round2 `4be1d741`/`61fa1a57`/`c084666a`)**: 훅은 실행 *전* 브랜치 1회 평가 → 체인·cwd·`git -C`·**`GIT_DIR=… env prefix`**·**`-c core.hooksPath`**가 판정을 빌릴 위험. **해소 = allowlist**: `requireRe`가 명령 시작을 `git commit`으로 못박아 그 앞에 무엇(env/`-c`/`-C`/`cd`/`checkout`)이 와도 탈락 → ask. 우회 열거가 아니라 형태 강제라 미지 벡터에도 견고.
- **복합명령 하향 (round1 `6962c5e4`)**: requireRe 앵커 + denyIfRe `&&|;|\|` + 타 escalator 독립 상향. `commit && push`→T3, `commit; rm -rf`→DENY (테스트).
- **이력재작성·가역성 과장 (round1 `21516b65`/`57fd6e98`)**: `--amend`/`--no-verify` veto → 자율 commit은 **새 커밋(reset/revert 가역)만**.
- **★ 훅 allow 미방출 (round2 BLOCKER `6d8c4900`)**: 분류 T1만으론 Bash가 passthrough → 자율 미성립. **explicitAllow→`allow` 방출로 수정**(§2 훅).
- **에디터 교착 (round2 `640b8b85`)**: `-m`/`--message`/`-F` 없는 bare `git commit`은 requireRe lookahead 탈락 → ask(에이전트 hang 방지).
- **단일 `&`/프로세스 치환 (L2-3 BLOCKER `40958ca1`)**: denyIfRe에 `&` `[<>]\(` 추가 → `commit & curl`·`-F <(…)` 차단. 모든 분리자가 veto되므로 explicitAllow에 부수명령이 붙을 수 없음(`662ab9c2` 해소).
- **fail-safe 방향**: 브랜치 불명/detached/main → ask. 권한 개방은 확신할 때만.
- **측정**: audit에 branch+decision 기록 → `maia-audit --summary`로 오탐 점검.
- **층위 한계(문서화·수용)**: ① **프로세스간 HEAD 경합 TOCTOU (L2-3 `63a4e7c3`)** — 사전게이트 훅은 branch확인+commit을 원자결합 불가. 외부 프로세스가 판정 후 HEAD를 바꾸는 시나리오는 **단일 에이전트 세션에서 비현실적 + commit 가역**이라 잔여위험 수용(완전차단은 server-side branch protection=C5-0c 영역). ② **메시지 내 `&`/`|` 오발동 (L2-3 `df4c2dab`)** — regex가 commit 메시지 본문의 쉘문자를 구분 못 해 `-m "fix a & b"` 등이 ask로 오발동. **안전방향(ask는 무해)**이라 수용, 향후 인용부 제거로 정밀화 가능. ③ `-am` 원자성(`6e07e98c`) — `-a`는 추적파일만·가역, 수용.
- **🚩 대표 결정 (L2-3 `a8b00e53`, gemini가 blocker로 격상)**: **commit rate-limit 부재**. stateless 훅에서 세션 카운팅 불가 → TTL 상태파일 필요(C5-1a PreWrite hard-block과 동일 인프라). 스팸 마이크로커밋은 로컬·가역이나 push 전 운영자 리뷰부담·그래프오염 인정. → **선택지: (A) 무제한으로 라이브+사후 audit 측정 / (B) TTL rate-limit 먼저 구현 후 라이브 / (C) commit 게이트(ask) 유지.**

## 4. 검증 계획
- 분류기 golden(**63 통과**): commit -m feat→T1/allow+explicitAllow, -am→T1, main/master/chore/불명→T2/ask, **bare commit(no -m)→T2**, **GIT_DIR env / -c hooksPath / git -C / checkout&& / cd&&→T2**, **--amend / --no-verify→T2**, commit&&push→T3, commit;rm -rf→DENY, explicitAllow 배선(allow/ask/false).
- 훅: detached/비-git→null→ask. **explicitAllow commit→allow 방출**(flip 시 실 stdin 통합검증). 실 commit 1회 feat/*에서 자율 실행 확인.
- **L2 dogfood**: round1(v1)→BLOCKER2+important2+suggest2 / round2(v2)→BLOCKER2(env redirect·훅 allow)+important2(hooksPath·editor)+suggest1. 전부 v3 반영 → 재검증.

## 5. 롤백
- `decision-policy.json`의 git-commit `branchAllow` 키 제거(1줄) → **즉시** commit=T2 ask 복귀(loadPolicy 캐시 없음). 분류기·훅 코드는 inert(무해)로 잔존 가능.

## 6. L2 검증 결과 (dogfounding — 2026-06-11, C5-1a 엔진 실전)
- **L2-1 (v1 검증)**: 수정필요. round2 6건 corroborated. BLOCKER=TOCTOU(`4cfbfec3`/`52d6bfa9`)·복합명령(`6962c5e4`), important=amend/no-verify(`21516b65`/`57fd6e98`). 집계 [[2026-06-11-c5-0b-commit-allow-plan-l2-aggregation-20260611-214119]]. → v2(denyIfRe veto) 반영.
- **L2-2 (v2 검증)**: 수정필요. round3까지 — **신규 BLOCKER**: 훅 allow 미방출(`6d8c4900`, escalate)·env `GIT_DIR` 리다이렉트(`4be1d741`/`61fa1a57`), important: `-c core.hooksPath`(`c084666a`)·에디터 교착(`640b8b85`). 집계 [[2026-06-11-c5-0b-commit-allow-plan-l2-aggregation-20260611-214948]]. → **v3(strict allowlist + explicitAllow 훅) 반영**.
- **L2-3 (v3 검증)**: 수정필요. round2 6건 corroborated. **신규 실홀**: 단일 `&`/프로세스치환 veto 누락(`40958ca1`, BLOCKER) → **v4 반영**. 나머지(프로세스간 race `63a4e7c3` / 메시지 오발동 `df4c2dab` / rate-limit `a8b00e53`)는 층위한계·수용·대표결정으로 분류(§3). 집계 [[2026-06-11-c5-0b-commit-allow-plan-l2-aggregation-20260611-220222]].
- 엔진: 3라운드 정상 완주. **검증엔진이 권한개방 전 실 보안결함 5건(실 코드버그 1 포함: 훅 allow 미방출) 차단** — Verified Autonomy 설계 의도대로 작동. L2 수렴: 실 구현결함 소진, 잔여는 층위한계+대표결정.

## 7. 관련
- 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.C/§3 / 선행 [[c5-0a-decision-gate-ask-resolution-20260611]] / [[c5-1a-l2-loop-engine-20260611]]
