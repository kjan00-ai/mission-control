# 검증 깊이 축 (Verification Depth Axis) + 오케스트레이션 복원력 — dev-case 2026-06-16 확장 스펙

> dev-case [[2026-06-16-case-l2-review-overhead-and-subagent-error]] (S-1~S-4)를 구체 메커니즘으로 확장한 설계. C6의 §2.1(사전 검증 게이트 입도) 미해소 난제에 실측 근거를 주고, MAIA에 **권한·가역성 게이트와 분리된 "검증 깊이" 차원**을 도입한다.
>
> - 날짜: 2026-06-16 / 작성: claude / 버전: **v0.2 (L2 반영 — codex BLOCK ∥ gemini REVISE, BLOCKER 3건 전건 반영)** / 리뷰 [[2026-06-16-verification-depth-axis-l2-aggregation]]
> - 선행: [[2026-06-13-c6-verification-over-approval-spec]] (§1.0 가역성·§2.1 입도) / [[2026-06-11-maia-autonomy-overhaul-design]] (Decision Gate T0~T3)
> - **★ 편입(2026-06-16)**: 본 스펙은 C6 v0.2의 정식 컴포넌트(§1.2 검증 깊이 차원 + §2.5 복원력)로 편입됨. C6 스펙은 요약+링크, 본 문서가 상세 SSOT.
> - 출처: dev-case 2026-06-16 (BC zone-token cycle 실측) — 수신처 = MAIA 오케스트레이션 개발 파트
> - 범위: `~/.ai-bootstrap`(l2-loop 디스패치·audit·verify-batch) + 글로벌 CLAUDE.md 규약 + C6 로드맵(§6)
> - SSOT: 코드/spec=이 repo, 지식/결정=위키 + 위키링크

### v0.2 변경 요약 (L2 반영)
1. **[BLOCKER·codex] V축과 실행 게이트 분리** — V는 "얼마나 리뷰하나"일 뿐 "실행 가능 여부"가 아니다. 매트릭스에서 DENY 제거, T3/R3는 `V3 + 비-V 게이트(지연큐/veto/DENY)`로 분리 표기(§2.4).
2. **[BLOCKER·codex] S-1 재시도 대상 제한** — `readOnly·sideEffectClass=none·idempotencyKey` 검증 태스크만 자동재시도. 부작용 subagent는 재시도 금지·"실행불명" 격상(§3).
3. **[BLOCKER·gemini + 중요·codex] 자동 하한 게이트** — W 자기선언 하향 도덕적 해이를 사후 audit이 못 막음 → 오케스트레이터단 하드코딩 승격룰을 자기선언 *위*에 둠(§2.5).
4. **[중요·both] "직교" 표현 완화** — R/T/V는 독립 직교가 아니라 상관 있는 분리 차원. 우선순위 명시(§1·§6).
5. **[중요·codex] 구조화 호출계약** — 빈출력=유실 false-positive 차단(§3.1).
6. **[중요·codex] 검증 배치 manifest** + **[제안·gemini] 메모리 폴백**(§4).
7. **[중요·gemini] S-4 툴 래퍼 힌트 자동주입**(§5).
8. **[제안·codex] V를 단일 ordinal floor + escalator**로(범위값 max 모호 제거, §2.3).

---

## 0. 문제 정의 (dev-case 요약)

BC에서 **기계적 치환 작업**(consultant 7파일 brand hex→Tailwind 토큰, ~56곳)에 **풀 오케스트레이션**(brainstorm→L2 3R→spec→plan L2→subagent 2-stage)을 일률 적용 → 결과는 정상(회귀 0)이나 체감 시간 과다·대표 2회 개입. 동반해 하네스 internal error로 subagent 결과 다회 유실.

| 구분 | 원인 | 성격 |
|---|---|---|
| A | subagent/L2 결과가 하네스 internal error로 유실(다회) | **인프라 결함**(MAIA 외부) |
| B | 검증이 과하게 잘게 직렬 + background 개별 통지대기 | 정책 부재 |
| C | 작업 난이도 무관 풀 파이프라인 일률 적용 | 정책 부재 |
| D | grep 이스케이프(`\:`) 오판 → 불필요 재실행 | 자가검증 효율 |

★ **핵심**: B·C가 시간을 끈 주범, A가 불확실성을 얹음. **L2 자체는 가치 입증**(직전 cycle에서 git pathspec `:(glob)` 차단무력화 결함을 L2가 포착) — 폐지가 아니라 **강도 조절**이 본 스펙의 목적.

---

## 1. 재설계 원칙 — 분리된 정책 차원 (직교 아님)

> MAIA는 지금까지 작업을 **실행/위험 하나의 축**으로만 분류했다. 그러나 "어떻게 실행/게이트하나"와 "얼마나 검증할까"는 **별개의 정책 차원**이다.

> ★ **모델 갱신(C6 v0.3, 2026-06-16)**: 구 R(가역성)·T(권한/위험)는 **단일 실행 축 E**로 통합됐다([[2026-06-16-rt-execution-axis-merge-design]]). 본 스펙의 "T축" 참조는 모두 **E축(실행 게이트)**·**riskFlags(위험 입력)**로 읽는다. 아래 §2.4 표의 T0~T3는 legacy 표기(→ E0~E3)다.

- **실행 축 (E)**: 어떻게 실행/게이트하나 → **실행 허용·통제**(자율/사전가드/지연·veto/차단). C6 §1.1 E축이 담당. 입력 = 가역성 R + riskFlags.
- **검증 깊이 차원 (V, 본 스펙)**: 작업이 얼마나 *어렵나*(의미판단·통합·설계) → **리뷰 절차 강도**(가드만~풀 L2).

★ **상관 있는 분리 차원**(직교 아님): 위험할수록 실행도 검증도 깊어지는 양의 상관. **우선순위**:
> **E(§1.1)가 실행을 게이트한다(can/how it runs) → W/V가 리뷰 깊이를 정한다(how much review).** riskFlags는 E·V 공통 입력. V는 *리뷰 깊이일 뿐 실행 허가가 아니다.*

두 차원이 별개라는 증거(실측): **위험하지만 단순한 작업**(secret 1줄 수정 = 위험·E1+, 난이도 W0)과 **안전하지만 복잡한 작업**(새 알고리즘 = 안전·E0, 난이도 W3)이 둘 다 존재. 실행 게이트 하나로는 절차 강도를 결정할 수 없다 → dev-case의 일률 풀 파이프라인이 그 증상.

---

## 2. 검증 깊이 차원 정의 (S-2 확장)

### 2.1 작업 클래스 (Work Class, W)

| 클래스 | 정의 | 예 |
|---|---|---|
| **W0 기계적** | 1:1 매핑·문구 치환·결정성 변환. 의미판단 거의 0 | className 토큰 치환, import 경로 일괄변경, 순수 rename |
| **W1 국소 로직** | 단일 모듈/함수 내 로직 변경. 영향 국소 | 버그픽스 1곳, 가드 추가, 경계조건 |
| **W2 다파일 통합** | 여러 모듈 교차·계약 변경·마이그레이션 | API 시그니처 변경, DB migration, 스키마 변경 |
| **W3 설계 결정** | 아키텍처·정책·비가역 선택 | 새 서브시스템, 게이트 정책, 외부계약 설계 |

### 2.2 검증 깊이 사다리 (Verification Depth, V) — 단일 ordinal

| 깊이 | 검증 방식 | 상대비용 |
|---|---|---|
| **V0 가드만** | 자동 가드(타입체크/테스트)만. 인간·AI 리뷰 0 | ~0 |
| **V1 인라인 자가검증** | 호출자가 직접 diff·grep·테스트 확인. subagent 0 | 저 |
| **V2 단일 서브에이전트 리뷰** | code-reviewer 등 1회 | 중 |
| **V3 풀 L2** | Codex∥Gemini 독립 적대검증 + 심화 사다리 | 고 (분 단위) |

★ **V는 리뷰 깊이만 정한다. 실행 허용은 R/T 게이트가 별도로 결정**(§1 우선순위). V3라도 R3 작업이면 실행은 지연큐/veto/DENY로 따로 막힌다.

### 2.3 매핑 — floor + escalator (범위 아님)

각 작업은 **단일 V floor**를 받고, escalator가 있으면 **+1**(cap V3):

| 작업 클래스 | V floor |
|---|---|
| W0 기계적 | **V0** |
| W1 국소 로직 | **V1** |
| W2 다파일 통합 | **V2** |
| W3 설계 결정 | **V3** |

**Escalator(+1, 누적 cap V3)** — 하나라도 해당 시 깊이 상향:
- 변경 파일 수 임계 초과(예 >3) 또는 변경 라인 임계 초과 (**blast radius** — gemini 제안).
- 정규식 캡처그룹/AST 기반 치환(단순 리터럴 1:1 아님).
- 위험 경로(auth/scheduler/migration/hook/lockfile/secret) 또는 public API·DB·schema·config 변경.
- 삭제·rename·테스트 변경.
- 가역등급 R2/R3 포함, 또는 **분류 불확실성**(애매하면 상향).
- ★ **task-intent / 요청출처** (L2 round2 codex B3-partial): 계획서·spec·정책/아키텍처/게이트/외부계약/신규 알고리즘 키워드 또는 plan 메타가 잡히면 **diff 크기와 무관하게 W3/V3 floor 강제**. *작은 diff·큰 의미*(설계결정을 W0로 위장) 변경을 사전 차단.

→ `최종 V = min(V3, floor + (escalator 있으면 1 else 0))`. **범위값·max 모호성 제거**(codex 제안).

### 2.4 ★ 실행 축 E와의 결합 (실행 게이트는 V와 별개)

> **검증 깊이 V는 위험(riskFlags)이 하한(floor)을 끌어올린다. 그러나 실행 허용/차단은 V가 아니라 실행 축 E(C6 §1.1)가 한다.**

| 실행 등급 E(=위험·가역성 룩업 결과) | V 하한 | 실행 게이트(비-V, E가 결정) |
|---|---|---|
| E0 (자율·가역) | 작업 클래스 floor 그대로 | 자율 + 사후검증 |
| E1 (위험·가역, 사전가드) | **V2 이상으로 끌어올림** | 자율 + 사전가드(스냅샷·사전 L2) |
| E2/E3 (지연·비가역 잔여) | **V3** | **지연큐 / 인간 비동기 veto** (C6 §1.1) |
| DENY | — (V축 비대상) | **실행 차단** |

★ **L2 교정(codex BLOCKER, round1)**: V 매트릭스에 DENY/실행게이트를 섞으면 "금지/지연/veto 요구가 검증 절차로 대체되는" 오해를 낳는다. **DENY는 V 비대상(verificationDepth=not_applicable)**, 실행은 E가 결정한다. V를 아무리 높여도 E3/DENY의 실행 게이트(지연큐/veto/차단)를 대신하지 못한다. (구 T0~T3 표기는 [[2026-06-16-rt-execution-axis-merge-design]] §7 마이그레이션 참조.)

### 2.5 누가 / 언제 분류하나 — 자동 하한 게이트 우선

★ **L2 교정(gemini BLOCKER + codex 중요)**: 자기선언만으로는 하향 도덕적 해이(빨리 끝내려 W0 허위신고)를 **사후 audit이 못 막는다**(audit ≠ 사전 게이트). → **자동 하한을 먼저 강제하고, 자기선언은 그 위에서만 선택**:

1. **자동 하한 게이트(하드코딩 승격룰, 사전)**: 오케스트레이터/래퍼가 §2.3 escalator(diff 특성 + **task-intent/요청출처**)를 자동 감지해 **V 하한을 강제 승격**. 에이전트가 W0를 신고해도 escalator 충족 시 시스템이 V2↑(설계의도면 V3)로 올린다. 에이전트는 이 하한 *위로만* 선택 가능.
   - ★ **분류기 범위 제약(L2 round2 gemini)**: 휴리스틱 오버헤드 과소평가 방지 — **AST 등 고비용 분석 배제**, 파일 확장자·diff 크기·위험경로 문자열·intent 키워드/plan 메타 수준의 **단순 정규식·메타 매칭 MVP**로 범위 엄격 제한. 정교화는 신뢰 계측 후.
2. **자기선언(보완)**: 하한 위에서 상향(보수적)은 근거와 함께 자유. **하향은 사전 reason 필수 + 샘플링 V3 대상**(거짓음성 점검).
3. **입도** = "결정/산출물" 단위(C6 §2.1 정합 — 도구호출마다가 아님).

→ 자동분류기(diff 휴리스틱)는 본 게이트의 핵심 구현물. 미구현 구간은 보수적 기본(애매하면 상향).

---

## 3. 결과유실 복원력 (S-1 확장)

### 3.1 구조화 호출계약 + 감지

★ **L2 교정(codex 중요)**: "빈 출력 = 유실"은 false-positive가 크다(정상 "findings 없음"·"변경 없음"·plain-text 결과). → **호출계약을 구조화**해 빈 stdout 단독으로 유실 판정 금지:

```
{ status: "ok" | "empty_ok" | "lost" | "failed",
  findings: [...], summary: ..., idempotency_key, side_effect_class }
```
- `lost`(유실) 판정 = 빈 stdout **+** (exit code / stderr / heartbeat·sentinel 부재 / expected-output schema 불일치) 조합.
- subagent 유실 신호: `[Tool result missing due to internal error]` / 비정상 종결.
- L2 CLI: exit 124(timeout) / 유효 json 블록 0개([[l2-cli-invocation-gotchas]] last-valid-block 파서 연계).

### 3.2 정책 (재시도 대상 제한 → 명시 폴백 → 집계)

★ **L2 교정(codex BLOCKER 2)**: v0.1은 "L2/subagent 리뷰는 read-only·멱등이라 재시도 안전"이라 단정했으나, 적용지점이 메인루프 서브에이전트(파일 수정·산출물 생성·외부 쓰기 가능)까지 포함해 **이중 실행 위험**. "결과 유실"은 *실행 실패*가 아니라 *전달 실패*일 수 있어 더 위험. →

1. **자동재시도 대상 = `readOnly=true · sideEffectClass=none · idempotencyKey 보유` 검증 태스크만**(codex/gemini L2, 순수 리뷰어). 1회, 탐색가드 강화 + timeout 120→300s.
2. **그 외 subagent(부작용 가능) = 자동 재실행 금지** → **"결과 유실/실행 여부 불명"으로 격상** + 수동·인라인 검증 폴백. 폴백 사용·검증강도 다운그레이드를 결과에 **명시**.
3. **telemetry**: `~/.ai-bootstrap/audit/orchestration-*.jsonl`에 `attempt_id·task_id·idempotency_key·side_effect_class·status` 기록. 다회 유실 = 하네스 신뢰성 추적 + 임계 시 알림.

### 3.3 적용 지점
- **L2 엔진 `l2-loop.js`**: read-only L2 디스패치 래퍼에 구조화계약·감지·1회재시도·telemetry(기존 busy 재시도 확장).
- **메인 루프 서브에이전트**: 하네스 자동재시도는 통제 밖 → **에이전트 행동규약(본 스펙·글로벌 CLAUDE.md)으로 강제**(부작용 subagent는 재시도 금지·격상).

★ **정직성**: 하네스 internal error(원인 A)는 MAIA 외부 인프라 결함이라 근치 불가. S-1은 *무방비를 줄이는 완화*다.

---

## 4. 로컬 검증 병렬-일괄화 (S-3 확장)

### 4.1 표준 패턴: 검증 배치 (Verification Batch) + 명령 manifest

- 독립 로컬 검증은 **한 묶음 병렬 → 일괄 수거 → 1회 통지**. 통지 대기 ≈ 1(배치당), not N.
- 헬퍼 `maia-verify-batch.sh <checks>` — 지정 검증 병렬 실행, 종합 결과 표 반환.

★ **L2 교정(codex 중요)**: "tsc/lint/test는 read-only — OK"는 일반화 과함. 실제 검증 명령은 cache·coverage·snapshot·test DB·temp dir·lock file·dev server port를 공유할 수 있어 build 제외만으로 자원경쟁·상태오염을 못 막는다. → **명령 단위 manifest로 병렬 가능성 선언**:

```
{ cmd, read_only_fs, writes_to:[...], ports:[...], db, cache_dir, max_mem_mb, exclusive_group }
```
- 같은 `exclusive_group`/공유 자원(포트·db·cache)을 쓰는 명령은 직렬. **미선언 명령은 직렬 기본값**.

### 4.2 메모리 폴백 (gemini 제안 + 실측 제약)

- 배치 실행 직전 `free -m` 측정 → 가용 메모리 < 임계(예 1GB)면 **병렬→직렬 자동 폴백**.
- **빌드는 배치 제외·단독 직렬**: 이 WSL 박스 RAM 4.8GB([[mc-production-build-gotchas]]), 빌드 ~2.5GB+thrashing. 배치는 경량(tsc/lint/test)만.

---

## 5. 자가검증 오판 방지 (S-4 확장)

**"출력에 기대값이 안 보인다" → 재실행/재생성 전 아래부터 의심:**
1. **grep/정규식 패턴** — 이스케이프(`\:` `\.` `[]` `{}`), 리터럴 vs 정규식(-F), 대소문자(-i).
2. **출력 잘림** — head/tail/페이지네이션·버퍼 한계.
3. **인코딩** — surrogate/유니코드([[surrogate-400-error-repair]]).
4. **타이밍** — 비동기 산출물 미작성(file watch 필요).

★ **L2 교정(gemini 중요)**: 규약 텍스트만으론 사문화(Lost-in-the-middle)된다. → **System-in-the-loop 자동주입**: grep/검색 도구 래퍼가 **빈 결과/stderr 발생 시** 반환 메시지에 "힌트: 특수문자 이스케이프(`\:` `\.`)·리터럴(-F) 확인" 리마인더를 자동 삽입. 규약 승격(비용 0)에 더해 기술적 장치 병행.

---

## 6. C6와의 관계 + 로드맵 배치

본 스펙 = C6 §2.1(사전 검증 게이트 입도)의 **구체화이자 누락 차원 보강**. C6 §2.1은 "E1+ 모달→사전 L2, 입도=결정/산출물 단위"까지만 정의했고 **"얼마나 깊이 검증하나"(V)는 미정의** → 본 스펙이 채운다.

**MAIA 정책 모델 = 노출 2축 (C6 v0.3):**
| 축(노출) | 질문 | 입력 | 역할 | 정의처 |
|---|---|---|---|---|
| **E 실행** | 어떻게 실행/게이트하나 | 가역성 R + riskFlags | **실행 게이트**(can/how it runs) | C6 §1.1 / [[2026-06-16-rt-execution-axis-merge-design]] |
| **V 검증깊이** | 얼마나 검증하나 | 작업난이도 W + riskFlags | **리뷰 깊이**(how much review) | **본 스펙** |

→ 적용 우선순위: **E gates execution → W/V gates review depth**(§1). riskFlags는 E·V 공통 입력(상관 있는 분리 차원). 가역성 R·위험·W는 노출 축이 아니라 분류기 레코드의 *입력*.

**로드맵**: V 매핑·자동 하한 게이트는 C6-3(E1+ 사전 L2 게이트)에 동반. S-1/S-3/S-4는 **C6 의존 없이 즉시 적용 가능한 독립 개선** → C6-0와 병행.

| 항목 | 의존 | 즉시성 | 비고 |
|---|---|---|---|
| S-4 자가검증(규약+래퍼 힌트) | 없음 | 즉시 | 비용 저 |
| S-3 검증 배치(+manifest·mem폴백) | 없음 | 단기 | RAM 주의(§4.2) |
| S-1 결과유실 복원력(+구조화계약) | l2-loop 일부 | 단기 | 하네스 한계 명시 |
| S-2 검증깊이 V(+자동 하한 게이트) | C6 프레임 | 중기(C6-3 동반) | 자동분류기 핵심 |

---

## 7. 난제 / 정직한 한계 (L2 후 갱신)

1. **자동 하한 게이트 ↔ 자동분류기 의존**: 하향 도덕적 해이 방어의 실효는 분류기 품질에 달림(§2.5). 단 분류기는 **단순 MVP로 범위 제한**(diff+intent 키워드/plan메타, AST 배제 — L2 round2 gemini)해 "분류기 자체가 별개 서브프로젝트화"되는 것을 막는다. 미구현 구간은 보수적 기본. diff만으론 작은-diff-큰-의미를 못 잡으므로 **task-intent classifier 병용**(L2 round2 codex). (gemini/codex 공통.)
2. **하네스 internal error는 외부결함**: S-1은 완화이지 근치 아님.
3. **V≠실행게이트 경계 유지**: V 상향을 R3 실행게이트의 대체로 오용하지 않도록 정책·구현에서 분리 강제(§2.4 — codex BLOCKER 1 항구 방어).
4. **신뢰 부트스트랩(C6-0 정합)**: V 매핑이 옳은지 = "W0에서 L2가 정말 불필요했나"를 사후 audit + W0에 V3 샘플링으로 거짓음성 계측.
5. **3차원 인지부하(gemini)**: 에이전트가 R/T/W를 매번 분리판단하는 비용 → 자동 하한 게이트가 분류 부담을 시스템으로 이전해 완화. R/T 통합 표기는 C6 확정 시 재검토.

---

## 8. 메타 정합성 (자기적용)

본 스펙은 **W3(정책 설계 결정)** → §2.3 매핑상 **V3(풀 L2) 필수**. 본 스펙 자체를 Codex∥Gemini L2(V3)로 검증함 — dev-case가 비판한 "강도 미스매치"를 스스로 어기지 않음. **결과: codex BLOCK ∥ gemini REVISE → BLOCKER 3건·중요 다수 v0.2 전건 반영.** 리뷰 [[2026-06-16-verification-depth-axis-l2-aggregation]].

## 관련
- [[2026-06-16-case-l2-review-overhead-and-subagent-error]] (출처 dev-case) / [[2026-06-13-c6-verification-over-approval-spec]] / [[2026-06-11-maia-autonomy-overhaul-design]] / [[l2-cli-invocation-gotchas]] / [[mc-production-build-gotchas]]
