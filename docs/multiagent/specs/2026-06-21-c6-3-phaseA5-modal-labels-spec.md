---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.3 (구현 완료)
track: C6-3 Phase A.5 (모달 응답 로깅 — Phase B 선결)
status: implemented
l2_ref: "[[2026-06-21-c6-3-phasea5-modal-labels-spec-l2-deepen-r2-20260621-152255]]"
artifact_ref: 2026-06-21-c6-3-phaseA5-modal-labels-spec
impl: "done — c6-label.js(+7 골든픽스처) + c6-trust.js 라벨조인(+1 테스트). 종단 251 라벨(rejected 1·executed 250·🚨🚨 0, 7일분 트랜스크립트 15파일). 멱등 재실행 0신규·unresolved 재시도 확인. 단일 롤링 리포트(대표 결정). maia-deploy drift 0. 전체 C6 회귀 16/16. ★ Phase B(실제 cutover)=대표 게이트, 미착수."
---

> **v0.2 변경(L2 2R 수렴)**: 6 settled 반영 — (B1 `ac0a11e8`/`b6b1aaa6`) ruleId-단위 집계 폐기 → **op별 self-contained 라벨**(human + C6 동시 산출). (B2 `87b9014a`) 비거부 실행을 "approved"로 집계 금지 → **rejected만 확정 라벨**, 비거부=`executed`(상한). (I1 `c001e64e`) unresolved 보류 → **resolved-only dedup**(lastTs 컷오프 폐기). (I2 `7b0dbc5e`) `policy_version` 필드 추가. (I3 `873149fc`) **시크릿 레드action + 로컬 보존**(위키=집계만). 1건(`0b2f1628` 리포트 파일 증식)=대표 에스컬레이션 → §2.5.

# C6-3 Phase A.5 — 모달 응답 로깅 (인간 라벨 수집)

> Phase A(`c6-trust.js`)는 **C5정책 vs C6모델**만 대조한다(spec C6-3 Phase A §3 H1). 감사로그는 인간이 모달에서 **실제 승인/거부한 결과를 미기록** → 진짜 신뢰계측("C6 vs 인간")이 불가능. 본 스펙은 그 **인간 라벨을 사후 트랜스크립트에서 복원**해 수집하고, c6-trust가 그것을 조인해 **"C6 vs 인간" 합치도**(Phase B 게이트의 근거)를 산출하게 한다.
>
> - 선행: [[2026-06-21-c6-3-phaseA-trust-metrics-spec]] §0·§3 H1 / [[2026-06-21-c6-1-result-digest-spec]](멱등·불변 리포트 패턴) / C6-0.2 분류기(`policy-classify`) / C5 게이트(`risk-classify`).
> - SSOT: 코드/spec=repo, 지식=위키. `[기획결정]` = 본 MVP 확정.
> - ★ 라이브 enforcement·모달·settings 훅 **0 변경**(완전 섀도우, Phase A N1과 동일).

## 0. 문제 / 왜 트랜스크립트인가 (설계 근거)

진짜 신뢰계측엔 op별 **인간의 실제 모달 응답(승인/거부)** 라벨이 필요하다. 가능한 소스를 검토:

| 소스 | 인간 응답 관측? | 판정 |
|---|---|---|
| 감사로그 `risk-*.jsonl` | ❌ 정책결정(allow/ask/deny)만, 상관 ID 없음(`opIdOf`가 ts 포함 → 후속 조인 불가) | 불가 |
| PreToolUse 훅 | ❌ 모달 **이전** 실행 | 불가 |
| PostToolUse 훅 | △ **승인 시에만** 발동(거부 미관측) + 현재 미등록 | 편향(승인만) |
| **세션 트랜스크립트** `~/.claude/projects/<slug>/*.jsonl` | ✅ **승인·거부 양쪽** 영속 기록 | **채택** |

### 0.1 트랜스크립트 사실 (이 버전에서 직접 검증)
- assistant 엔트리(`type:assistant`): `message.content[]`에 `{type:'tool_use', id:<tool_use_id>, name, input}`. 엔트리 레벨에 `cwd`, `gitBranch`, `sessionId`, `timestamp` 동반.
- user 엔트리(`type:user`): `message.content[]`에 `{type:'tool_result', tool_use_id, is_error, content}`. 거부 시 엔트리에 `toolUseResult: "User rejected tool use"`, `is_error:true`, content가 `"The user doesn't want to proceed with this tool use..."`로 시작.
- 조인 키 = **`tool_use_id`**(globally-unique, ts충돌 없음 → `opIdOf`보다 견고).
- ★ assistant 엔트리가 `gitBranch`+`cwd`를 보유 → **재분류를 라이브 게이트와 동일 입력**(`classify({tool,path,command,branch},{cwd})`)으로 수행 가능 = **풀 충실도**(특히 최대 T2 카테고리 `git-commit:branch-gate`가 branch 의존).

## 1. 목표 / 비목표

**목표**
- G1. **`c6-label.js`**: 트랜스크립트 스캔 → tool_use↔tool_result 조인 → 재분류 → **C5게이트가 ask(T2)였던 op**의 인간 outcome(approved/rejected) 라벨 스트림 산출(`audit/modal-labels-*.jsonl`) + 위키 리포트(멱등·불변).
- G2. **`c6-trust.js` 확장**: 라벨을 조인해 **C6 vs 인간** 대조(§3.2) — 특히 `인간 rejected × C6 allow`(🚨🚨 안전 critical) 노출. 카테고리별 합치 컬럼 + 신규 리포트 섹션.
- G3. **정직한 보류**: 라벨 없는 ruleId·라벨 부족 카테고리는 **"미라벨 — 판정 보류"**. ★ **cutover-ready는 여전히 미산출**(Phase B 대표 게이트).

**비목표**
- N1. 라이브 게이트/모달/훅 변경 아님(섀도우 only, read-only 트랜스크립트).
- N2. 거부 **사유**(분류기 갭 vs 정당) 분류 아님 — v1은 outcome 라벨만(H2′).
- N3. 자동 cutover/flip 아님(Phase B=대표 게이트).
- N4. 비-T2(게이트 자동 allow/deny) op의 인간 라벨화 아님 — 인간 모달이 없었으므로(별도 카운트만).

## 2. 설계 — `c6-label.js`

```
입력: --project <name> [--tdir <transcript dir>]
① 트랜스크립트 디렉토리 스캔(프로젝트 slug)
② 파일별: pass1 assistant tool_use → map[tuid] = {tool,input,ts,cwd,branch}
          pass2 user tool_result → outcome(tuid) = rejected | executed | unresolved
③ 각 tuid: classify(input)→{cls,decision,ruleId}  ∥  classifyPolicy(input)→{effectiveDecision(C6),V}
④ decision==='ask'(T2) & outcome≠unresolved 만 유지 → 레코드에 human+C6 동시 기록
⑤ append modal-labels-{day}.jsonl(레드action) + 위키 리포트(집계만)
```

### 2.1 라벨 레코드 스키마 (`audit/modal-labels-YYYYMMDD.jsonl`, 로컬 only)
```json
{ "tuid":"toolu_…", "ts":<assistant ts ms>, "tool":"Bash", "path":"", "cmd":"git commit … (레드action)",
  "branch":"feat/…", "cls":"T2", "ruleId":"git-commit:branch-gate",
  "humanLabel":"rejected", "c6":"allow", "V":"V0",
  "policy_version":"c6-policy@…", "sessionId":"…", "source":"transcript" }
```
- `tuid` = dedup 키(멱등). `humanLabel ∈ {rejected, executed}`(§2.2). `c6`/`V` = **동일 input의 `classifyPolicy` 산출**(B1 해소: 라벨 레코드가 op별로 human+C6를 **자기완결**로 보유 → 별도 조인 불필요, rejected×C6-allow 셀이 op 단위로 직접 산출).
- `policy_version` = 재분류 시점 정책 스탬프(I2 해소, H1′와 정합).
- 비-T2는 스킵하되 run 메타에 `{skipped_nonT2, skipped_auto_deny}` 집계.

### 2.2 outcome 판정 규칙 (★ 신뢰도 비대칭 — B2 해소)
- **rejected (확정 라벨)**: `toolUseResult === "User rejected tool use"` **또는** (tool_result.is_error && content가 거부 마커 prefix). 두 신호 OR(버전 견고성). ★ 거부는 **반드시 인간 행위** → 고신뢰. **🚨🚨 안전지표의 근거**.
- **executed (상한 — 인간승인 아님)**: tuid가 비거부 tool_result로 해소. ★ 이것을 "인간 승인"으로 집계 **금지**(B2): always-allow·settings allowlist·이전정책 자동허용이 섞임 → 인간 개입 없이 실행됐을 수 있음. 따라서 `executed` = "현 정책상 T2였을 op이 거부 없이 실행됨" = **인간 승인의 상한**(over-count). 리포트는 이를 명시. (구현 시 트랜스크립트에 모달-표시 신호가 있으면 `executed`를 `human_approved`/`auto_allowed`로 세분 — 없으면 상한 그대로.)
- **unresolved**: tool_result 미발견(세션 진행중/중단). → 라벨 미발행 + **dedup 미등록**(I1: 다음 run에서 재시도되어 뒤늦은 tool_result 포착). run 메타 `unresolved` 카운트.

### 2.3 멱등·수명주기 (I1 해소 — resolved-only)
- dedup: state `state/c6-label.json {seenTuids[]}` — **resolved(rejected|executed) tuid만 등록**. unresolved는 미등록 → 다음 run 재스캔에서 자연 재시도. ★ **lastTs 컷오프를 정확성 기제로 쓰지 않음**(파일 mtime은 perf 힌트로만; 진행중 세션의 늦은 결과 누락 방지).
- lock(hard-link) + tmp+rename. 부작용=워터마크·라벨append·리포트write 뿐.
- read-only(트랜스크립트 읽기만). 파싱 실패 라인 skip(fail-safe).

### 2.4 시크릿/보존 (I3 `873149fc` 해소)
- **레드action**: cmd 기록 전 시크릿 패턴(`(api[-_]?key|token|secret|password|bearer|authorization)\s*[:=]\s*\S+`, `AUTH_PASS=…`, 긴 base64/hex 토큰) → `***`. 라벨 레코드·리포트 공통.
- **로컬 보존**: 라벨 스트림 `audit/modal-labels-*.jsonl` = `audit/` 동거 = **manifest local**(Windows 미동기·git 미추적, risk-*.jsonl과 동일). retention = maia-audit `--prune`에 편입(14일).
- **위키 리포트 = 집계만**: 개별 cmd 평문 덤프 금지. ruleId별 집계 + 필요한 head는 레드action·truncate(≤60자). 🚨🚨 항목도 ruleId+레드action head만.

### 2.5 ★ 리포트 파일 전략 (대표 에스컬레이션 `0b2f1628` — 대표 판정: 단일 롤링)
- 쟁점: 불변 일자별 `C6-LABELS-{date}-{run}.md` 무한 생성 → 위키 파일 폭증·그래프 오염(주기 실행 시). 감사불변성은 append-only jsonl이 이미 담당하므로 리포트까지 불변 누적은 과잉.
- **결정(대표 2026-06-21)**: **단일 롤링 리포트** `labels/C6-LABELS-{project}.md` 1파일을 매 run **overwrite**(tmp+rename 원자). 감사 불변 이력=append-only `audit/modal-labels-*.jsonl`(로컬). 리포트=현재상태 뷰. 파일 폭증 0.
- (참고: c6-trust/c6-digest의 run별 불변 일자파일도 동일 쟁점 보유 — 본 task 범위 외, 후속 검토 carry.)

## 3. 설계 — `c6-trust.js` 확장 (라벨 조인)

### 3.1 조인 (B1 해소 — op별 self-contained, 퍼지조인 없음)
- `--labels <glob>`(기본 `audit/modal-labels-*.jsonl`) 로드. ★ **라벨 레코드가 이미 op별 `{humanLabel, c6, V, ruleId}`를 자기완결로 보유**(§2.1) → **감사로그와의 ts/cmd 퍼지조인 불필요**. 라벨 모집단을 그대로 **op 단위로** C6-vs-인간 셀에 집계(rejected×C6-allow가 op별 직접 산출 — ruleId 독립집계의 모순 제거).
- 기존 C5↔C6 분석(감사로그 기반)은 **별 트랙으로 무변경 유지**. 두 트랙은 같은 리포트에 병렬 섹션으로 표기(조인하지 않음 — 모집단·키가 다름을 정직 표기).

### 3.2 C6 vs 인간 대조 셀 (신규 — op 단위)
| 인간(라벨) \ C6(effectiveDecision) | allow | delay_* | deny |
|---|---|---|---|
| **rejected**(확정) | 🚨🚨 **위험**(인간거부를 C6허용) | ✅ C6=인간 | ✅ C6=인간 |
| **executed**(상한) | △ 상한합치(인간승인 미확정) | 🛡️ C6보수 | 🛡️ C6보수 |

- 🚨🚨 = **C6 자율 cutover 시 인간이 막은 행위를 자동 허용** = Phase A가 원리적으로 못 본 신호. **고신뢰**(rejected 확정 기반). **Phase B 차단조건**(이 카테고리 0이어야 cutover 후보).
- △ = `executed`는 인간승인 상한(§2.2 B2) → "C6=인간 합치"의 **상한**일 뿐. 별도 표기, ready 근거로 단독 사용 금지.
- V floor 게이트 승계: `C6 allow + V0`는 "인간도 검증도 없음" → cutover 부적격(별도 ⚠️).

### 3.3 출력 (★ ready 미산출 유지)
- 카테고리(ruleId)별: `{labeled_n, rejected, executed, 🚨🚨수, executed×C6allow(△상한)}`.
- 신규 섹션 "## C6 vs 인간 (Phase B 근거)": ruleId별 🚨🚨(고신뢰) + executed 상한 합치(△) 분리 표기 + **라벨 부족(`labeled_n < 임계`)·미라벨 ruleId = "판정 보류"** 명시. ★ cutover-ready 미산출.
- 기존 C5↔C6 분석·🏷️ 목록 **무변경**(하위호환: `--labels` 부재/빈 경우 기존 동작 그대로).

## 4. ★ 정직한 한계
- **H1′**: outcome은 트랜스크립트의 실제 인간 행위지만, **재분류 cls가 라이브 게이트 cls와 동일하다는 가정**에 의존(branch/cwd 복원으로 충실도 높임). 정책 버전 드리프트 시 라벨 cls는 *재분류 시점* 스탬프 → 레코드에 `policy_version` 기록(§2.1).
- **H2′**: 거부 **사유** 미수집(분류기 FP 정당거부 vs 인간 변심). v1=outcome only.
- **H3′ (★ B2 — 신뢰도 비대칭)**: **`rejected`만 인간 행위로 확정**. `executed`는 인간 모달승인의 **상한**(always-allow·allowlist·이전정책 자동허용 포함 가능) → "인간 승인율"·"C6=인간 합치"를 `executed`로 산출하면 과대평가. 따라서 Phase B 안전판정(🚨🚨)은 `rejected`(고신뢰)만 사용, `executed` 기반 합치는 △상한으로만 보고. (트랜스크립트가 모달-표시 신호를 주면 구현 시 세분.)
- **H4′**: ready 판정은 비범위 — Phase B(대표 게이트: A.5 라벨 + 무회귀(🚨/🚨🚨=0) + 대표 명시 승인 3조건).
- **H5′ (I3)**: 라벨/리포트는 레드action 후에도 명령 head를 보일 수 있음 → 위키 동기 제외(local), 위키 리포트는 집계+레드action head만. 완전 비밀유지 아님(advisory 운영 데이터).

## 5. 검증 계획
- 골든 픽스처(`c6-label.test.js`): 합성 트랜스크립트 JSONL — (approved/rejected/unresolved) × (T2 commit/T2 bulk-edit/T3 push/non-gated allow) 조합 → 조인·outcome판정·T2필터·dedup·branch복원 정확성.
- `c6-trust.test.js` 확장: rejected×C6-allow=🚨🚨 셀, approved×C6-allow=✅, 미라벨 보류 표기, `--labels` 부재 시 하위호환.
- e2e: 실 트랜스크립트 → `modal-labels-*.jsonl` 생성 → c6-trust 리포트 "C6 vs 인간" 섹션 육안. 멱등 재실행 신규 0.
- read-only(워터마크 외 0). `maia-deploy --check` drift 0.

## 6. 매니페스트/SSOT
- `c6-label.js`·`c6-label.test.js` → manifest shared.boot. 라벨/리포트=local·위키. 코드=repo.
