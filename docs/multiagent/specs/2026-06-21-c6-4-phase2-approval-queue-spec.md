---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.3 (구현 완료 — 메커니즘, 활성화 0)
track: C6-4 Phase 2 (비동기 승인 큐 — E3 승인창 only)
status: implemented
l2_ref: "[[2026-06-21-c6-4-phase2-approval-queue-spec-l2-deepen-r2-20260621-174337]]"
artifact_ref: 2026-06-21-c6-4-phase2-approval-queue-spec
impl: "done — c6-queue.js(decideQueue E3-only·실행창·enqueue rate-limit·lock, 8 픽스처) + 훅 배선(deny→allow consult, default-off) + c6-policy.queue + decision-policy c6-queue-approve DENY(자가승인 차단). L2 2R 수렴(6 settled+3 에스컬 전부 기술해소). ★ out-of-band 실행기 없음·실행 0. 라이브 무변경 입증(git-merge still deny·hard_deny 무접촉). 합성 enqueue→approve→allow·kill-switch 검증. 회귀 44/44·drift 0. ★ 활성화=O1(0, 대표 게이트)."
---

> **v0.2 변경(L2 2R 수렴, 6 settled + 3 에스컬 전부 기술해소 — 설계가 더 단순·안전해짐)**:
> - (B `582a8eab`) E2 opt-out 창이 24/7 헤드리스에서 대표 취침 중 만료→T3 자동실행 = 보안구멍 → **큐는 E3-only**(E2 auto-elapse 폐기. T3 r3_residual은 정책상 E3. "무응답=진행" 비가역에 절대 적용 안 함).
> - (B `b8160cde`) 승인 CLI가 T1→에이전트 자가승인 가능 → **`c6-queue --approve/--veto`를 게이트 deny**(에이전트 불가, 대표 `!`/Telegram만).
> - (B `215cadd1`+`c7046546`) consume-on-allow 비원자(TOCTOU)+정당 재시도 차단 → **one-shot consume 폐기 → 승인 후 짧은 실행창**(창 내 재시도 허용, allow시 write 없음=무race, 창후 만료).
> - (`c0d0f0fc`) opKey 명령만 → cwd/repo 교차매칭 → **opKey에 cwd+branch 포함**.
> - (`707b0a96`) state 경합 → **모든 변경 lock**. (`ce0ccbc5`) "대기" 메시지→LLM 무한재시도 → **"중단·재시도금지·큐등록" 메시지**+deny-halt+relay 1분 cron 케이던스. (`a9d4c6d7`) 인자변조 dedup 우회 스팸 → **enqueue ruleId별 rate-limit/coalesce**.

# C6-4 Phase 2 — 비동기 승인 큐

> 자율 실행 표면(**mc-relay가 `claude --agent --permission-mode acceptEdits` 1분마다 spawn**)이 T3 게이트 op에 막히면 모달 없는 헤드리스라 **실패→retry churn→교착**. 본 스펙 = 그 op을 **대표 비동기 승인 대기열**에 넣고, **게이트가 그 큐를 참조**해 승인분만 deny→allow 강등 → 에이전트 재시도가 정상 실행. ★ **out-of-band 실행기 없음**(큐가 raw 명령 실행 안 함). **default-off**.
>
> - 선행: [[2026-06-16-c6-0.1-policy-taxonomy]](E2 veto/E3 승인창 §3) / [[2026-06-21-c6-3-phaseB-cutover-spec]](게이트가 side-channel 참조해 강등 — **본 스펙은 그 deny→allow 대칭**) / [[2026-06-21-c6-4-rollback-proposer-spec]](Phase 1). SSOT: 코드/spec=repo.

## 0. ★ 안전 설계 (대표 결정 "메커니즘만")
- **실행기 없음**: 큐는 명령을 실행하지 않음. 게이트가 큐 참조 → **승인된 op만 deny→allow** → 실제 실행=**에이전트 자연 재시도**(정상 컨텍스트). cutover 동형(cutover=policy-classify 참조 ask→allow / queue=큐 참조 deny→allow).
- **자동롤백 실행=비범위**(Phase 1 H: audit에 정확 SHA 없어 자동 reset 위험). 본 Phase=승인큐만.
- 통합 깊이=메커니즘만(파일기반·CLI 승인). 대시보드 UX·relay 상태통합=후속.

## 1. 목표 / 비목표
**목표**
- G1. **`decideQueue(opKey, state, now, cfg, env)`**: 큐 상태로 게이트 강등 여부 판정(pure).
- G2. **CLI**: enqueue / approve / veto / list. 대표 비동기 결정.
- G3. **훅 배선**: 활성 T3 r3_residual op → 승인분 allow(one-shot) / 미승인 auto-enqueue+deny. **default-off**.

**비목표**
- N1. 큐 실행기 아님. N2. hard_deny/DENY-class 강등 아님. N3. 자동 cutover/활성화 아님. N4. external-send(DENY-class) 비범위.

## 2. 설계

### 2.1 pure core `decideQueue(opKey, state, now, cfg, env)` → `{allow, reason}` (★ E3-only, 실행창)
1. `env.MAIA_C6_QUEUE_OFF` → `{allow:false,'killswitch'}`. `cfg.activated !== true` → `{allow:false,'not-activated'}`.
2. `state.proposals` 중 `opKey` 매칭, **E3 승인창만**:
   - `status==='approved'` && `now < decidedAt + execWindowMs`(기본 15분) → `{allow:true}`. 미승인(pending)·veto·만료(창 경과) = `{allow:false}`.
- ★ **E2 폐기**(`582a8eab`): 비가역 T3에 "무응답=진행" 절대 없음. 모두 E3(opt-in, 무응답=차단).
- ★ **one-shot consume 폐기**(`215cadd1`/`c7046546`): 승인 = `execWindowMs` 동안 *실행 허용*(transient 실패 재시도 OK). allow 시 **write 없음**(TOCTOU race 제거). 창 후 자동 만료(재제안 필요). 창 내 동일 op 재실행은 허용(idempotent T3 가정, 창 짧게).

### 2.2 CLI (`state/c6-queue.json`, 모든 변경 lock)
- `enqueue --rule <id> --key <opKey>`: pending 제안 추가(**E3 고정**, dedup by opKey). **ruleId별 rate-limit**(`a9d4c6d7`: windowMin 내 maxEnqueue 초과→coalesce, Telegram 무음). lock+tmp+rename.
- `--approve <id>` / `--veto <id>`: 대표 결정. ★ **이 명령은 게이트 deny**(§2.5 b8160cde) — 에이전트 자가승인 불가, **대표 `!`/Telegram만**.
- `--list`: pending/approved 표시. 제안 스키마: `{id, opKey, ruleId, E:'E3', enqueuedAt, status:pending|approved|vetoed, decidedAt, decidedBy}`.

### 2.3 훅 배선 `~/.ai-bootstrap/hooks/pre-risk-classify.js` (cutover와 대칭, deny측)
`permissionDecision==='deny'` 직후 try-catch 안, **삼중가드**(`result.cls==='T3'` && `ruleId ∈ cfg.activatedRules` && `classifyPolicy(op).denyReason !== 'hard_deny'`)면:
- `decideQueue`(read-only) → `allow`면 `permissionDecision='allow'` + audit `queue:'approved'`(**consume write 없음**).
- 아니면 **auto-enqueue E3**(lock+dedup+rate-limit) + Telegram + **deny 유지**, systemMessage=`이 op은 대표 승인 대기열 등록됨(T3). ★ 지금 재시도하지 말고 이 작업을 중단하라 — 승인 후 다음 재dispatch에서 진행된다.`(`ce0ccbc5`: LLM 무한루프 차단 — "대기" 아닌 "중단").
- 전체 throw → deny 유지(fail-closed). ★ DENY-class(force-push·secret·rm-rf=hard_deny)·non-T3 **무접촉**.

### 2.4 `c6-policy.json` queue 블록 (편집 자체 T2)
```json
"queue": { "activated": false, "activatedRules": [], "execWindowMin": 15,
  "rateLimit": { "maxEnqueue": 3, "windowMin": 10 },
  "_note": "C6-4 Phase 2 E3-only. 활성화=대표 게이트. 롤백: activated:false|empty|MAIA_C6_QUEUE_OFF=1. T3 r3_residual만(git-merge; hard_deny·DENY-class 불가). 승인=대표 ! 만(c6-queue approve/veto는 게이트 deny)." }
```

### 2.5 ★ 자가승인 차단 (`b8160cde` — decision-policy)
- 현 `c6-queue --approve/--veto`가 T1이면 **에이전트가 자기 막힌 op을 스스로 승인** 가능 = 치명적. **해소**: `decision-policy.json` commandRules에 `c6-queue(\.js)?\s.*(--approve|--veto)` → **DENY**(에이전트 실행 불가). 대표는 `!`(인간)로 우회. enqueue·--list는 T1 유지(에이전트 큐등록은 정상). 정책=json만.

## 3. ★ 안전 불변식 (L2 핵심)
- **I-Q1 T3-only + non-hard_deny**: DENY-class·hard_deny 영구차단(force-push·secret·rm-rf). 후보=정당워크플로 r3_residual T3(git-merge). external-send=DENY-class라 cls가드로 자동 제외.
- **I-Q2 E3-only opt-in**: 미승인·veto·창만료 = deny. **"무응답=진행" 없음**(E2 폐기 — 헤드리스 자동실행 차단).
- **I-Q3 자가승인 불가**: approve/veto = 게이트 deny → 에이전트 우회 불가, 대표만(`b8160cde`).
- **I-Q4 실행창(상시 allow 아님)**: 승인은 execWindowMin 동안만 유효(재시도 허용·창후 만료). 무기한 standing allow 없음. lock으로 enqueue/approve/veto 직렬화(TOCTOU 방어).
- **I-Q5 3중가역**: activated/activatedRules/MAIA_C6_QUEUE_OFF. **I-Q6 fail-closed**: throw·미활성·매칭없음 → deny 유지.
- **I-Q7 무한루프 차단**: deny+`중단` 메시지(재시도 금지) — 케이던스는 relay cron(1분), 인-턴 루프 아님.
- **I-Q8 관측성**: 강등건 audit `queue:'approved'` → c6-trust/digest 감시.

## 4. ★ 정직한 한계
- H-Q1: 매칭키=`tool::정규화 cmd::cwd::branch`(`c0d0f0fc`로 cwd+branch 추가, opId는 ts라 재시도 불일치). 동일 컨텍스트 동일명령은 여전히 구분 불가(대표 명령단위 승인=수용).
- H-Q2: 실행창 내 **동일 op 재실행 허용**(재시도 위해) → 완전 1회성 아님. 창 짧게(15분)+idempotent T3(git-merge) 한정으로 위해 최소화. 비-idempotent op은 활성화 부적격(대표 판단).
- H-Q3: 승인 전 task 실패-재시도 churn(relay 상태통합=후속, "메커니즘만" 수용). 대시보드 승인 UX 없음(현 CLI/Telegram). MC DB `decision_proposals` 미러=후속.
- H-Q4: external-send(DENY-class) 비범위 — T3 재분류는 별 정책결정(taxonomy §7-1).
- H-Q5: 승인은 op이 *재dispatch될 것*을 가정(현 relay 재시도 존재).

## 5. 검증 계획
- 골든픽스처(`c6-queue.test.js`): E2 veto창(만료→allow·veto→deny)·E3 승인창(approved→allow·미승인/만료→deny)·미활성→deny·one-shot consume(2회째 deny)·kill-switch·dedup enqueue.
- 훅 통합(stdin): 활성 T3+approved→allow / 미승인→deny+enqueue marker / **hard_deny(rm-rf)→deny 무변** / DENY-class→deny / 비활성 T3→deny.
- e2e: 합성 git-merge enqueue→approve→decideQueue allow(consume)→재consult deny.
- default-off 라이브 무변경(실 T3 op 여전히 deny, 감사). maia-deploy drift 0. 전체 C6 회귀.

## 6. 매니페스트/SSOT
- `c6-queue.js`·`c6-queue.test.js` → manifest shared.boot. queue state=local. 코드=repo, 활성화=c6-policy(배포추적).
