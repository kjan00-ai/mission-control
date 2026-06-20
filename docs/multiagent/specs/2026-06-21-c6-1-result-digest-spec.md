---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.2 (L2 round1+2 반영 — blocker 3·important 6 전건 수정)
track: C6-1 (결과 다이제스트 MVP)
status: L2-converged
l2_ref: "[[2026-06-21-c6-1-result-digest-spec-l2-deepen-r2-20260621-060218]]"
---

# C6-1 — 결과 다이제스트 MVP (Verification over Approval)

> C6 §2.3 구현. 모달 결재 스트림을 **비동기 배치 검토 뷰**로 대체하는 첫 단계: MAIA가 결정·실행한 것 + L2 판정 + 롤백 정보를 묶어 제시하고, 대표는 **스텝이 아니라 결과를** 본다. C6-0.2 분류기(`policy-classify.js`)가 산출하는 E×V 레코드를 소비.
>
> - 선행: [[2026-06-13-c6-verification-over-approval-spec]] §2.3 / C6-0.1 정책 / **C6-0.2 분류기(완료, `policy-classify.js`+`c6-policy.json`+골든픽스처)**.
> - ★ L2 경고(both): **"그냥 요약"이면 고무도장을 사후로 옮긴 것**. 다이제스트가 실효를 가지려면 (E,V)·escalatedBy·Why·롤백을 구조화하고 **샘플링+고위험집중+이상알림**(전수검토 금지)이어야 한다.
> - SSOT: 코드/spec=이 repo, 지식=위키. `[기획결정]` = 본 MVP에서 확정.

## 0. 목표 / 비목표
**목표**
- G1. **수동 호출 + 일배치**로 결과 다이제스트 1건 산출(위키 리포트) + 고위험 요약 1줄 Telegram. (★ L2 `c6310e58`: 세션종료 훅 연동은 **후속**으로 명시 이연 — MVP 완료기준에서 제외.)
- G2. 각 항목에 **(E,V)·escalatedBy·denyReason·L2 Why·영향·롤백가능·requiredControls·R**을 §2.3 순서로.
- G3. **샘플링·고위험집중 + circuit breaker**: 전수 아님. 격상/고E/L2 BLOCKER 우선, 일상 T0/T1은 카운트+샘플. 고위험도 **상한(cap)+반복op 중복제거**(L2 `a7a2e027`).

**비목표**
- N1. **모달 제거 아님**(=C6-3). 다이제스트는 모달과 **병행**(advisory). C5 게이트는 그대로.
- N2. **원클릭 전체 롤백 파이프라인 아님**(=C6-4). MVP는 **롤백 커맨드 힌트**만 제시.
- N3. 대시보드 뷰 이연. MVP 채널 = **위키 리포트 + Telegram 요약**(`[기획결정]` 확정).

## 1. 데이터 소스 (확인됨)
| 소스 | 제공 | 위치 |
|---|---|---|
| 위험 감사로그 | 실제 결정/실행(tool·path·cmd·cls·decision·ts) | `~/.ai-bootstrap/audit/risk-*.jsonl` |
| C6 분류기 | E·V·escalatedBy·reversibility·denyReason·requiredControls (감사 entry를 enrich) | `policy-classify.js` (parallel) |
| L2 판정 | verdict·근거(Why)·BLOCKER/에스컬레이션 | 위키 `reviews/*-l2-aggregation-*.md` + durable bus(MC DB `l2_reviews`) |

★ **핵심 한계(정직)**: 감사로그는 **C5 모델(cls/decision)**. E·V는 다이제스트가 `policy-classify`로 **사후 재구성**(C6 라이브 게이트가 아직 없으므로). 즉 다이제스트의 등급은 "C6가 매겼을 등급"(advisory). C6-3 cutover 후엔 게이트가 직접 기록.

## 2. 설계

### 2.1 파이프라인 (`c6-digest.js` — 소스 read-only / 출력은 멱등 부작용)
★ **자기모순 교정(L2 `7c14620c`)**: "stateless/read-only"는 틀린 표기. 정확히는 **입력 소스(감사로그·L2·정책)에 read-only**이고, **출력(위키 다이제스트·워터마크·선택적 Telegram)은 명시적·멱등 부작용**이다.
```
입력: --since <ts|기본 워터마크> --project <name|all>
① 감사로그 스캔(since~now) → op 레코드 목록(각 op에 안정적 opId 부여 = sha1(ts|tool|path|cmd))
② 각 op enrich: policy-classify({tool,path,command:cmd}) → {E,V,escalatedBy,reversibility,denyReason,requiredControls}
   + 정책버전 스탬프(§2.6 H1)
③ L2 조인: op.path → slugOf(path)(§2.3 공유 함수) → 그 슬러그의 L2 aggregation 중 op.ts 이전 최신 + 산출물 hash 일치분 링크
④ 롤백힌트 파생(§2.4)
⑤ 선별(§2.2)+cap+dedup → 정렬(고위험 우선)
⑥ 멱등 기록(§2.6): 락 획득 → 이미 다이제스트된 opId 제외 → 신규 불변 다이제스트 파일 작성(tmp+rename) → 워터마크 원자 갱신 → (고위험≥1) Telegram → 락 해제
```

### 2.2 선별 정책 (샘플링·고위험집중 + circuit breaker)
- **우선 포함**: `effectiveDecision∈{deny,delay_*}` · `E∈{E2,E3,DENY}` · L2 verdict=BLOCKER/에스컬레이션 · riskFlags 비어있지 않음.
- **카운트+샘플**: 일상 `E0/E1 + allow`는 **집계 수치 + 최근 N(예 5)건 샘플**만.
- ★ **Circuit breaker (L2 `a7a2e027`)**: 반복 동일 op(같은 tool+cmd 정규화)는 **중복제거 → 1건 + 횟수**. 고위험 표시 **상한 MAX_ITEMS(예 50)**, 초과분은 `+N건 더(감사로그 참조)`로 접음. Telegram은 항상 **요약 1줄**(스팸 방지).
- **이상징후 알림 (측정가능, L2 `61042bb9`)**: MVP는 **고정 임계** — 윈도우 내 `deny+BLOCKER 건수 ≥ ANOMALY_N(예 5)` 또는 단일 ruleId deny `≥ RULE_N(예 3)`이면 상단 경고+Telegram. (통계적 baseline=후속 튜닝.)

### 2.3 항목 포맷 (§2.3 순서 — R중심 아닌 E/V중심)
```
### [E2·V2] <op 한줄요약>   ⟵ 헤더에 (E,V) 최상단
- escalatedBy: E=<원인> / V=<원인>      (왜 격상됐나)
- denyReason: <없음|rule>
- L2(Why): <verdict + aggregation 링크 | 해당없음>   (조인 규칙 ↓)
- 영향: <tool·path·cmd 요약>
- 롤백: <가역등급 R + 커맨드 힌트>        (§2.4)
- requiredControls: [...]  / (E2면) vetoDeadline: <…>
```

★ **L2 조인 식별자(L2 blocker `1772d4c9`·important `b0927975`)**: fuzzy 매칭 금지. op.path를 **l2-loop/post-task-l2와 동일한 `slugOf(path)`(dir-hash+basename) 공유 함수**로 변환해 슬러그 일치로 조인. 후보 aggregation 중 **op.ts 이전 최신 + 산출물 content-hash 일치**분만 채택(버전 불일치 시 "L2 버전 불일치" 명시, 오조인 금지). 산출물(spec/plan/design) 편집 op만 대상 — 일반 코드편집은 L2 비대상(H4).

### 2.4 롤백 힌트 파생 (MVP = 카테고리 힌트, 정밀 롤백은 C6-4)
| 가역성/op | 롤백 힌트 |
|---|---|
| R0 (빌드산출물·재생성) | "재생성, 조치불요" |
| R1 (src 편집·commit) | `git revert <sha>` / 미push면 `git reset` (감사에 sha 없으면 "해당 커밋 revert") |
| R2 (PR·발신·준가역) | "PR close / 발신 취소 / 재배포" |
| R3 (비가역·외부) | "⚠️ 수동 — 자동롤백 불가, 영향 점검 필요" |

### 2.5 채널·주기 (`[기획결정]` 확정)
- **위키 리포트**: `wiki/projects/{project}/digests/C6-DIGEST-{YYYYMMDD-HHMMSS}.md`. ★ **불변·append-only(L2 `03a9de4a`)**: 재실행은 기존 파일을 **재작성하지 않고** 신규 run 파일을 만든다(운영자가 남긴 체크박스·코멘트 보존). opId 중복제거로 같은 op는 한 번만 등장 → 누적 중복 0. 일자 인덱스 `digests/_index.md`에 run 링크 추가.
- **Telegram 요약 1줄**: 고위험 ≥1건일 때만 — `📋 C6 다이제스트: 검토필요 N건(deny D·BLOCKER B) → 위키링크`. hermes 경유(WSL) / Windows는 [[l2-avail-wsl-independence]] 직통 재사용.
- **주기**: 수동(`node c6-digest.js`) + 일배치(스케줄). 세션종료 훅 연동은 **후속**(비블록 주의).

### 2.6 멱등성·동시성·버전 (L2 `31a0d144`·`9baf2bba` 반영)
- **opId 중복제거**: 각 op = `sha1(ts|tool|path|cmd)`. 워터마크 + 이미 처리된 opId 집합으로, 재실행/스케줄중복/크래시재시도에도 **같은 op 재보고 0**.
- **동시성·원자성**: post-task-l2와 동형 **hard-link 락** 임계영역 + 출력 **tmp+rename**. 워터마크는 다이제스트 파일 작성 **성공 후에만** 전진(부분실패 시 다음 run이 안전 재처리).
- **정책 버전 고정(advisory 명확화)**: 다이제스트 frontmatter에 `policy_version`(policy-classify+c6-policy의 hash/버전) 스탬프. 등급은 **"그 버전 기준 사후 재구성"** 임을 명시 → 과거 다이제스트는 정책 변경에도 불변(재분류 금지).

## 3. 검증 계획
- 골든 픽스처: 합성 감사 entry(각 E/V/deny/BLOCKER 케이스) → 다이제스트 항목 정확성·선별·정렬·롤백힌트 단위테스트.
- L2 조인: 실제 위키 aggregation 슬러그 매칭 1건.
- read-only·stateless 확인(워터마크 외 부작용 0). maia-deploy drift 0.

## 4. 정직한 한계
- H1. **등급은 advisory**(C5 감사 재구성). C6-3 후 게이트직접기록으로 대체.
- H2. **롤백은 힌트**(실행 아님). 원클릭/전체롤백=C6-4.
- H3. 선별 임계(deny율 이상징후 등)는 **초기 보수값**, 운영 데이터로 튜닝.
- H4. L2 조인은 **산출물 편집 op 한정**(코드 일반 편집은 L2 대상 아님 — diff-artifact 모델 이연).

## 5. 매니페스트/SSOT
- `c6-digest.js`·`c6-digest.test.js` → manifest shared.boot. 워터마크 `state/c6-digest.json` → local.
- 다이제스트 산출물=위키(지식 SSOT). 코드=repo.
