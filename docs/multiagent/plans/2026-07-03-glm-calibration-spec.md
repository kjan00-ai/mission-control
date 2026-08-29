# GLM PoC 캘리브레이션 정답셋·채점 스펙 (착수 전 고정)

- **문서유형**: spec (locked v1.0.0)
- **작성일**: 2026-07-03
- **상위계획**: [[2026-07-02-glm52-poc-plan]] §1.5·§3·§5·§6-5 / 결정문서 [[2026-07-02-glm-remaining-decisions]] D-2(`2b825150`)
- **하네스 위치**: `~/.glm-poc/calibration/`(격리, repo 밖) — fixtures·answer-key·score.mjs·README
- **상태**: 구현+자기검증+**동기 L2(codex∥gemini) 반영 완료** — settled 6건 반영. **대표 판정 3건 = ✅ 전부 활성 확정(옵션A, 2026-07-03)** → answer-key v1.1.0·lock v3·재-L2 완료(§7.3). 승격 게이트(§5-2) 개방됨.
- **★ §6-5 캘리브레이션 실행 완료 (2026-07-05)**: 4벤더(codex∥gemini∥claude∥GLM-5.2) 클린 fixtures 리뷰 → 채점. **전 벤더 개별 PASS + 패널 union PASS**(critical 3/3·전체 10/10·오탐 8.1%). = concordance 상시지표 승격 게이트 충족(승격 자체는 대표 확정 별도). GLM 단독도 PASS(codex/gemini 동급). 공통 미탐 B07(cancelled 앵커 철자=보강 후보). 결과 원장 [[2026-07-05-glm-calibration-execution-results]], raw `~/.glm-poc/calibration/runs/2026-07-05/`.

> ⚠️ 이 스펙은 상위계획 §6-4/5의 "정답셋·분모·채점 스크립트를 **착수 전 고정**"(D-2 `2b825150` 대표 판정)을 이행한다.
> 캘리브레이션의 목적은 GLM 채점이 아니라 **"우리 L2 패널(Codex∥Gemini∥Claude)이 GLM 오류를 실제로 거르는지"** 를 seeded-bug로 보증하는 것(§1.5 2층 평가 모델).

## 1. 왜 필요한가 (순환논리 차단)
상시 운영지표 = L2-verified concordance("GLM 산출물이 L2를 BLOCKER 없이 통과한 비율"). 그러나 **L2가 놓친 버그는 concordance가 못 잡는다.** 정답을 미리 심은 seeded-bug로 L2 패널의 **발견률을 숫자로** 재어, concordance 지표를 상시지표로 승격해도 되는지 결정한다. 실패 시 → L2 패널 보정(Claude 비중↑) 후 재측정(§5 판정규칙).

## 2. 표본 구성 (총 N=10, D-2 고정 = critical≥3·logic≥4·style≥3)
합성 fixture 3파일(MC 관용구: Next.js route·better-sqlite3·auth). **의도적 버그를 심은 코드라 repo src 편입 금지**(§0 G2: 합성/공개 데이터만).

| id | 카테고리 | 파일 | 결함 |
|---|---|---|---|
| B01 | **critical/auth** | agents-route.ts | DELETE 핸들러 인증검사 누락 → 미인증 파괴적 삭제 |
| B02 | **critical/payment** | token-cost.ts | computeCost `parseInt` 소수 절삭 → 청구 누락(undercharge) |
| B03 | **critical/security** | agents-route.ts | status 문자열 보간 → SQL injection |
| B04 | logic/pagination | agents-route.ts | OFFSET `page*limit` off-by-one (should be `(page-1)*limit`) |
| B05 | logic/capacity | task-queue.ts | canAccept `<=` → maxCapacity+1 초과 허용 |
| B06 | logic/race | task-queue.ts | writeTask 미await → stale read |
| B07 | logic/filter | task-queue.ts | pendingTasks가 'cancelled' 미제외 → 무한 재처리 |
| B08 | style | agents-route.ts | 미사용 import(dead import) |
| B09 | style | token-cost.ts | 매직넘버 5000 하드코딩 |
| B10 | style | task-queue.ts | 'queued' 리터럴 중복(shared const 부재) |

## 3. 채점 규칙
- **채점 단위**: 버그 1건 = 1점, **부분발견 불인정**. 매칭 = 파일 일치 + 앵커 키워드 ≥`minAnchors`(정답셋별 `answer-key.json`에 지정). line은 window 보너스만(AI의 line 보고 불안정성 대비).
- **커버리지 모델(L2 `ea02a2e6` 반영)**: 어떤 finding이든 한 버그에 앵커 매칭하면 그 버그 "발견"(중복 지목 허용, 오탐 오집계 방지). 미매칭 finding = 오탐(FP).
- **PASS(현행 = D-2 대표확정)**: critical 발견 **100%(3/3)** AND 전체 발견율 **≥80%(≥8/10)**. (상위계획 GO-4 "critical 미탐=즉시실격"과 정합)
- **오탐률** = 미매칭 지목 / **벤더가 제출한 findings 총수(len)** (분모 명확화 = L2 `b737f7bd` 대표 에스컬레이션 반영안). **PASS 조건 포함(대표 승인 2026-07-03, `fpRateMax=0.5`).**
- **패널 집계 = union(L2 `ea02a2e6`)**: 벤더별 findings 합집합의 커버리지로 PASS 판정(실배포 "패널 중 누구든 잡으면 잡힌 것" 반영) + **벤더별 진단 병기**(약한 벤더 가시화). `score.mjs --union <a> <b> <c>`.
- ✅ **대표 승인 활성 (2026-07-03, 옵션A — answer-key v1.1.0)**:
  - `2c71f1a1`: 오탐률을 PASS에 포함(대량추측 gaming 차단). `thresholds.fpRateMax = 0.5`(정밀도 ≥50%).
  - `bb25a0bb`: logic 카테고리 최소 발견률(critical·style만 맞히고 logic 2건 놓치는 8/10 회피 차단). `thresholds.categoryFloors = {"logic":0.75}`.
  - **둘 다 `score.mjs`에 구현 완료. 활성화=answer-key threshold 값 설정 + lock v3 재생성 + §4 해시표 갱신 + 재-L2 완료.**

## 4. 재현성 lock (L2 blocker `2e97acc1`·`30b474f7` 반영)
- **정답셋 SSOT = `~/.glm-poc/calibration/answer-key.json`**: 앵커 목록·`minAnchors`·`window`·`thresholds`의 **정본**. 본 스펙은 그 계약을 서술하며, 실제 값은 answer-key가 규정(구현자 임의 변경 차단).
- **해시락(sha256, 2026-07-03 lock v3 — 대표 승인 강화 3건 활성 반영, answer-key v1.1.0)** — 아래 값이 바뀌면 = 하네스 변경 → **version bump + 본 스펙 갱신 + 재-L2 의무**. **실행 전 자동 검증 게이트**(`score.mjs`가 `lock.json` 대비 fixtures·answer-key 재해시 대조, 불일치 시 exit 3 중단 — L2 `e6f10382` 반영):
  | 파일 | sha256 |
  |---|---|
  | `fixtures/agents-route.ts` | `62872103ee262503e39e10493f4000d39fe13d24772a2eaf65464affcc97e97b` |
  | `fixtures/token-cost.ts` | `7e2d8956574ca9072aca82f96d6fcead198efc61dd0bc084b3bc0a35e50a3f21` |
  | `fixtures/task-queue.ts` | `0064f543b16bec9fccd556254f59485142844216ad93f2cd776395827865b61c` |
  | `answer-key.json` | `c17b90f2185e74d76645b95152e7208dbdc25b5f74a7cb251a054fba3d51377c` |
  | `score.mjs` | `47136980a8a771d939d73666e7a37abe1911abb82e515bb03e9112d65a805e0b` |
  | `lock.json` (런타임 게이트 매니페스트) | `5beedf2e15bc80269611150f28dab7b2d9fcd7a4a6397b30682cd8e39370c107` |
  > ⚠️ answer-key/fixture 편집 시 `lock.json` 재생성 + 본 표 갱신 + 재-L2. `thresholds.fpRateMax`/`categoryFloors` 활성화(대표 승인)도 answer-key 해시 변경 → bump.
- **findings.json 스키마** (벤더 제출 입력): `[{file: string, line?: number, category?: string, severity?: string, title?: string, description?: string}, ...]` 또는 `{findings|bugs|issues: [...]}`. 매칭은 `file` + `title|description|category`(소문자 결합) 앵커로 판정. ⚠️ **`category`는 앵커 매칭 텍스트의 선택 입력일 뿐** — `categoryFloors`(logic 하한)는 **정답셋(answer-key) 버그의 category**로 산정하므로 finding의 `category` 누락/오기와 무관(L2 `eb2b6c9e` 명확화).
- 자기검증(2026-07-03): 완전탐지→PASS/exit0, critical(B03) 미탐→FAIL/exit1, 패널 union(A logic∥B style)→union PASS·벤더별 FAIL 확인. 스크립트 결정론적(모델·난수 미사용).

## 5. 사용 흐름 (상위계획 §6)
1. **리뷰어 격리(L2 `650d9b7e`·`3d58ce17` 반영)**: fixture 파일은 **정답 주석(seeded 위치·ID)을 포함하지 않는 클린 코드**(정답은 `answer-key.json`에만 존재 — 초기본의 `// seeded:` 노출 결함 제거). 벤더에겐 **`fixtures/`만** 별도 임시 디렉토리로 복사해 제공, `answer-key.json`·`score.mjs`·`lock.json`은 리뷰 컨텍스트 포함 금지. 채점은 리뷰 종료 후 별도 수행.
2. (§6-5) 캘리브레이션: 각 L2 벤더(Codex∥Gemini∥Claude)에게 fixture 리뷰시켜 findings.json 수집 → `score.mjs --union`로 채점.
   - ⚠️ **concordance 상시지표 승격 게이트(L2 `a2e35fab`·`c02f6e29` 반영)**: 승격은 **§7 대표 판정 3건이 종결된 뒤에만**. 잠정(default-off) 기준으로 승격 금지 — 대표가 `fpRateMax`/`categoryFloors`를 확정(활성 or D-2 유지 명시)한 PASS 기준으로 union 통과해야 승격.
   - ✅ **승격 확정 = 대표 확정 (2026-08-29)**: 두 선결(대표 판정 3건 종결 2026-07-03 + §6-5 캘리 union PASS 2026-07-05: critical 3/3·10/10·logic 4/4·오탐 8.1%) 모두 충족 → **L2-verified concordance 상시 운영지표 승격**. 결정문 [[2026-08-29-concordance-standing-metric-promotion]]. ⚠️ 실제 수치 산정은 GLM 생성스트림 발생 시점부터(현 스트림 0). 후속 §6-3 티어패널 배선 선결 #2 해소.
3. **패널 미통과 시 보정(L2 `9c2e9739` 반영 — "Claude 비중↑" 모호성 해소)**: 재측정 루프는 아래를 순서대로, **최대 2회**까지:
   - (a) 미탐이 특정 벤더 편중 → 해당 카테고리에 **강한 벤더 가중**(예 보안 미탐 시 Claude/Codex 우선) 또는 패널에 벤더 추가.
   - (b) 미탐이 앵커 표현 문제로 판명(수동판별) → answer-key 앵커 보강(= version bump + 재-L2).
   - (c) **재사용 오염 방지(L2 `bc52241e` 반영 — 부담 완화)**: L2 CLI 벤더는 **스테이트리스**(호출마다 새 프로세스, 라운드 간 기억 없음)라 재사용 오염 위험이 낮음 → **셔플은 필수 아님**. 메모리 보유 에이전트를 검증자로 쓸 때만 fixture 동형 변형(그 경우 version bump+재-L2). 2회 내 미수렴 → **대표 에스컬레이션**.
4. **미매칭 지목(수동판별) 부하 관리(L2 `46542315`·`e2161f92` 반영)**: `score.mjs`는 제출 findings **하드 상한 300건**(초과 시 exit 4 — 대량제출 gaming/OOM 차단). 수동판별 대상은 그 이내 미매칭 findings. 판별 결과 "미시딩 실버그"면 answer-key 신규 등재(version bump), "오탐"이면 FP 집계.

## 6. 리스크
- **fixture 현실성 vs 재현성**: 합성이라 실전 분포와 다를 수 있음 → 표본은 "L2 감도 측정"용이지 GLM 실력 랭킹 아님. 실전 감도는 상시 concordance로 보완.
- **앵커 매칭 관대성**: 키워드 기반이라 표현 다양성 흡수하나 과대매칭 위험 → `minAnchors`로 조임 + 미매칭은 수동 판별로 회수.

## 7. L2 검증 이력 (codex ∥ gemini, 2026-07-03)
> 원장: reviews `2026-07-03-glm-calibration-spec-l2-aggregation-20260703-042002` (+r2/r3 deepen). round1 canonical 9(codex 6·gemini 3) → round2 settled 6 → round3 escalate 1.

**settled 6건 — 반영 완료**:
| id | 지적 | 반영 |
|---|---|---|
| `2e97acc1` (blocker) | "locked"인데 앵커·minAnchors·스키마·line규칙·해시 미고정 → 임의변경 가능 | §4 해시락 5파일 + answer-key SSOT 선언 + findings 스키마 명시 |
| `30b474f7` | minAnchors·answer-key 스키마 누락 | §4 동일 반영 |
| `ea02a2e6` | 패널 통과(벤더별/union/quorum) 미정의 | §3 union 집계 정의 + `--union` 구현 + 벤더별 진단 |
| `650d9b7e` | 정답셋·채점기 리뷰 노출 차단 절차 없음 | §5-1 리뷰어 격리(fixtures만 제공) |
| `9c2e9739` (suggest) | "Claude 비중↑" 보정 모호·재시도 한도·오염방지 부재 | §5-3 구체 보정 3단계+최대2회+fixture 셔플 |
| `46542315` (suggest) | 수동판별 부하 관리방안 부재 | §5-4 상한=제출수+재분류 규칙 |

### 7.2 재-L2 (round 2, 20260703-042943) — settled 4 반영 + escalation 3
> blocker 해소 확인차 재검증. round1 canonical 7(codex 5·gemini 2) → settled 4 → escalate 3.

**settled 4 — 반영 완료**:
| id | 지적 | 반영 |
|---|---|---|
| `a2e35fab` (blocker) | 대표 판정 대기 중 잠정기준(default-off)으로 concordance 승격 허용 | §5-2 승격 게이트 = 대표 3건 종결 후에만 |
| `67d267a4` | score.mjs가 `file` 누락 finding을 전 파일 매칭(스펙 "파일일치" 우회) | `fileMatches`: file 없으면 미매칭 |
| `e6f10382` | 해시락 문서선언뿐, 실행 전 검증게이트 없음 | `score.mjs` 런타임 `lock.json` 재해시 대조·불일치 exit3 |
| `e2161f92` | "상한=제출수"는 실질상한 아님(OOM/gaming) | findings 하드 상한 300 (exit4) |

**escalation 3 (§7.3 대표 판정)**:
- `3d58ce17` (blocker, codex제기·gemini uncertain): 리뷰어 격리 무효 — **fixture 주석이 정답 노출**. → ⚠️ **codex 정당(직접 확인)**: 초기 fixtures의 `// seeded:` 주석이 버그 ID·위치를 노출. **정답 주석 제거한 클린 fixtures로 재작성 완료**(gemini는 파일 미열람으로 uncertain했을 뿐). 반영됨.
- `c02f6e29` (blocker, gemini제기·codex반박): fpRateMax/floors 미확정=착수전고정 위반. → §5-2 승격게이트로 흡수(대표 3건 결정을 캘리브레이션 실행 전 관문화).
- `bc52241e` (important, gemini제기·codex반박): 셔플 재측정 부담. → §5-3(c) 스테이트리스 CLI는 셔플 불요로 완화.

### 7.3 대표 판정 3건 — ✅ 전부 활성 확정 (옵션A, 2026-07-03 대표 승인)
- `2c71f1a1` ✅ **활성**: 오탐률 PASS 반영(gaming 차단). `thresholds.fpRateMax = 0.5`(정밀도 ≥50%). D-2 "보고용" → PASS 조건 승격.
- `bb25a0bb` ✅ **활성**: logic 카테고리 하한. `thresholds.categoryFloors = {"logic":0.75}`(logic 4건 중 ≥3). D-2 통과선 강화.
- `b737f7bd` ✅ **확정**: 오탐률 분모 = "벤더 제출 findings 총수(len)"(§3·score.mjs 반영).
- 활성 반영: answer-key v1.1.0 · lock v3 · §4 해시표 갱신 · 재-L2 완료. 최종 PASS = critical 100% AND 전체 ≥80% AND logic ≥75% AND 오탐률 ≤50%. 라이브 자기검증(완전탐지 PASS·gaming FAIL(fpRate)·logic맹점 FAIL(floor)) 통과.
