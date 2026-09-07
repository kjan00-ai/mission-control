# 백엔드 레지스트리 spec — GLM 고정 → N-모델 선택

- **문서유형**: spec (구현·시험 완료, L2 2R 반영) · **v0.2**
- **작성일**: 2026-09-07
- **발단**: 대표 질의 *"GLM 대신 다른 AI모델을 사용할 경우 다시 구현해야 하나? 모델 선택기능을 넣을 수는 없나?"*
- **선행**: [[2026-07-06-glm-05-governance-gate-spec]] · [[2026-08-29-glm-phase2-egress-proxy-spec]] · [[2026-08-29-glm-b2-operational-routing-spec]]
- **적용 범위**: MAIA 공유 인프라 = **전 프로젝트 동시 발효** ([[maia-always-global-immutable-law]])
- **L2**: 2026-09-07 claude ∥ gemini 2R — blocker 2 + important 6 **전건 반영**, 미합의 3건은 §9.

---

## 1. 현황 실측 — 무엇이 이미 일반적이고 무엇이 고정인가

| 층 | 파일 | 총 줄 | 벤더 토큰 | 하드코딩된 벤더 **값** |
|---|---|---|---|---|
| 게이트 | `glm-gate.js` | 214 | 3% | 0 (정책은 `glm-policy.json`) |
| egress 프록시 | `glm-egress-proxy.js` | 166 | 9% | 3줄 |
| 런처 | `glm-launch.sh` | 87 | 47%(대부분 주석) | 5줄 |

**메커니즘은 이미 벤더 중립이다.** 프록시는 `x-api-key`와 `Authorization: Bearer`를 **둘 다** 주입하고, `gate()`는 이미 `opts.policyPath`를 받는다.

> ⚠️ **v0.1 주장 정정 (L2 `464145c1`)** — v0.1은 *"env override 전부 가능 · 오늘도 코드 0줄로 동작"* 이라고 썼다. **틀렸다.**
> 1. `GLM_BASE_URL`/`GLM_MODEL`은 **ENVFILE에서만** 읽혔다(`set -a; . "$ENVFILE"`가 부모 env를 덮음). 부모 env 우선순위는 **이번 변경으로 처음 생겼다.**
> 2. 키 변수명이 `GLM_API_KEY`로 고정이라, 다른 벤더 env 파일은 런처 사전검사(`grep -qE GLM_API_KEY`)에서 exit 2 했다.
>
> 즉 "설정만으로 된다"는 **이번 작업 이후에 참**이 된 명제다.

---

## 2. 해결 대상 2가지

### (A) 거버넌스가 벤더에 고정
`glm-policy.json`은 z.ai 약관 기준(BC 보험/금융 하드 denylist, DPA §4b 무저장 근거)이다. 런처는 게이트를 **정책 지정 없이** 호출했으므로, 어떤 백엔드로 띄우든 **항상 z.ai 정책**이 적용된다. 다른 벤더를 끼우면 **에러 없이 잘못된 근거로** allow/deny가 난다.

### (B) 프로토콜 경계 미검사
claude-code는 Anthropic 형식으로만 말한다. OpenAI 호환만 제공하는 모델을 끼우면 런처는 성공하고 **첫 요청에서** 깨진다.

---

## 3. 설계 — 레지스트리 1개 + 진입점 1개 (기존 3층 무개편)

### 3.1 `backends.json` (신규, shared) — 비밀 아닌 것만
실키는 종전대로 격리 env 파일에만 둔다. **출시 시점 등재는 `glm` 하나뿐이다.** `_meta.editRule`에 신규 등재 = 약관 R3 조사 + 전용 정책 파일 + 대표 승인을 못박는다.

### 3.2 `backend-resolve.js` (신규) — 순수 리졸버 + fail-closed 검증
`resolve(name)` → 파라미터 또는 **throw**. 검증:

1. 등재 + `enabled: true`
2. `protocol === 'anthropic'` — 아니면 **명시 거부**(변환층 미구현 안내). → (B) 해소
3. `policy` 지정 + shared 경계 내 + **실존** → (A) 해소: 정책 없는 백엔드는 뜨지 않는다
4. **정책 내용 하한 검사** (L2 `bae08639`): `mode === 'fail-closed'` + `contentScan.enabled !== false`
5. `envFile` 실존 / `baseUrl` https / `model` 지정
6. 출력 필드 **제어문자 차단** — 런처가 `eval` 없이 `KEY=VALUE`로 파싱하므로 개행 주입을 원천 차단

경계 검사는 **`realpath` 정규화 후** 비교한다(L2 `3f999c4e`) — 심링크로 shared 밖 정책을 가리키는 우회를 막는다([[cp-through-symlink-gate-bypass]] 계열).

### 3.3 `backend-launch.sh` (신규) — 유일 진입점
```
backend-launch.sh --backend <name> [claude 인자...]
backend-launch.sh --list-backends
```
리졸버 호출 → env 세팅 → 기존 `glm-launch.sh` **그대로 exec**. 프록시 coproc·핸드셰이크·게이트·트랩 정리는 **한 줄도 재작성하지 않는다.** 리졸버 출력은 **키 화이트리스트 파싱**(eval 금지) + 셸측 재확인(계약 drift 방어).

### 3.4 `backend-gate.js` (신규) — 왜 별도 파일인가

당초 계획은 `glm-gate.js` CLI에 `--policy` 플래그를 더하는 것이었다. **구현 중 차단됐다** — `glm-gate.js`는 `gate-self-glm` 규칙으로 **T3(대표 `!` 전용)** 이다(§8 정정 참조).

그래서 이미 export된 `gate(input, {policyPath})`·`writeAudit()`을 호출하는 **얇은 래퍼**를 만들었다. 판정 로직·감사 형식은 복제하지 않는다(SSOT 하나). 이 파일이 하는 일은 인자 파싱과 exit 코드(0/3)뿐이며, `--policy` 없이 부르면 **기본정책으로 조용히 떨어지지 않고 exit 2** 한다.

감사 레코드에 `backend`·`policyPath`를 기록한다(L2 `360986f9`) — "어느 벤더 약관 근거로 allow 됐는지" 사후 입증.

### 3.5 기존 파일 수정 — 3곳

| 파일 | 변경 |
|---|---|
| `glm-launch.sh` | ① `GLM_BASE_URL`/`GLM_MODEL` **부모 env 우선** ② 키 사전검사를 `BACKEND_API_KEY\|GLM_API_KEY`로 일반화 (L2 `906f4ff7`) ③ `${GLM_POLICY:-}` 분기로 게이트 선택 — **`set -u` 즉사 방지** (L2 `780f2413`) ④ **직접 호출 가드**(아래) |
| `glm-egress-proxy.js` | `readKey()`가 `BACKEND_API_KEY` 우선 · `GLM_API_KEY` 폴백. 파일 내 등장 순서와 무관 |
| `maia-manifest.json` | 신규 4파일 shared, 2파일 wslOnly 등재 |

**직접 호출 가드 (L2 `7a1d0d8b`, blocker)**: V6(하위호환)이 남긴 `glm-launch.sh` 직접 호출 경로는 리졸버를 거치지 않아 (A)(B)를 그대로 안고 있었다. 이제 직접 호출은 **GLM 기본 구성일 때만** 허용한다 — `GLM_POC_ENV`/`GLM_BASE_URL`/`MAIA_BACKEND` override가 감지되면 fail-closed로 중단하고 `backend-launch.sh`로 안내한다.

### 3.6 콘텐츠 스캔 — 하한이 둘로 나뉜다 (L2 `bae08639` 정정)

v0.1은 "콘텐츠 스캔 = 전 백엔드 공통 하한"이라고 뭉뚱그렸다. 실제로는 **두 층이고 강제력이 다르다**:

| 층 | 대상 | 강제력 |
|---|---|---|
| **egress 프록시 스캔** | 나가는 모든 요청 payload(재귀 문자열 전량) | **정책과 무관하게 무조건** — 진짜 하한 |
| 런치시점 디렉토리 스캔 | cwd∪addDirs의 git-tracked 파일 | 정책 파일 소관(`contentScan`) |

후자가 정책으로 꺼질 수 있었으므로, 리졸버가 `contentScan.enabled === false`·`mode !== 'fail-closed'` 정책을 **거부**한다.

### 3.7 MC relay 라우팅
`useGlm` boolean → `pickBackend(who, config)` selector. 우선순위 `config.backend` > `modelPrefix` > `namePrefix`, 미매치 = `null` = 기본 claude.

**실패모드 명시 (L2 `af5c451e`)**: 레지스트리 부재·파싱 실패·모듈 부재는 전부 **`null`(fail-open to Claude)**. 근거 — 백엔드는 opt-in 최적화이고 relay는 24/7 cron이다. fail-closed면 레지스트리 파일 하나로 전체 task 처리가 정지한다. 대신 **비용이 드는 방향이 아니라 기본 경로(구독 Claude)로** 떨어지므로 조용한 과금 증가는 없다.

exit 코드: `3` = 게이트 거부(`glm_gate_denied`, 기존 이력 호환) / `2` = 레지스트리 해석 실패(`backend_unresolved`, 신규).

---

## 4. 검증 결과

| # | 항목 | 결과 |
|---|---|---|
| V1 | 리졸버 fail-closed 전 분기 | `backend-resolve.test.js` **27/27** |
| V2 | 정책 경로 경계(`../`·절대·심링크·접두 유사) | 포함 |
| V3 | 기존 스위트 무회귀 | `glm-gate.test.js` **34/34** · `glm-egress-proxy.test.js` **8/8** |
| V4 | `backend-gate --policy=glm-policy.json` ≡ `glm-gate.js` CLI | 3개 cwd 전건 exit 동일 |
| V5 | relay selector 기존 거동 보존 | `glm-*`→glm, model `glm*`→glm, 그 외→null |
| V6 | 하위호환 직접 호출 | 기본 구성은 통과, override는 exit 2 |
| V7 | manifest | `maia-deploy --check` 신규 6건만 drift(배포 전 정상) |
| — | 신규 통합 | `backend-registry.test.js` **19/19** |

**합계 88 pass / 0 fail.**

---

## 5. 명시적 비-범위

- **OpenAI 호환 변환층 미구현.** 요청/응답 스키마·SSE·tool use 매핑은 별개 작업. 리졸버가 `protocol`로 명시 거부해 "조용히 깨지는" 경로를 없애는 것까지가 범위다.
- **신규 벤더 등재 없음.** 약관 조사 + 정책 파일 + 대표 승인 선행.
- **`glm-policy.json`·`glm-gate.js` 무수정** — T3.
- **E2E(실제 타 벤더 호출) 없음** — 등재 벤더가 glm뿐이라 검증 대상이 없다. 두 번째 벤더 spec에서 수행.

---

## 6. 잔여 위험

- **레지스트리가 새 신뢰 지점이다.** 등재 = 그 벤더로 코드가 나가도 좋다는 승인. `_meta.editRule` + 정책 실존 fail-closed + `backends.json` 자체가 `maia-policy` **T2**로 게이트된다.
- **`glm-launch.sh`는 gitignore 대상이다**(`.gitignore:27`, "E-1/E-2 scaffold/PoC — not versioned"). 따라서 §3.5의 변경 4건(직접 호출 가드 포함)은 **버전관리·Windows 동기 밖**이며 이 머신에만 존재한다. 런처는 이제 PoC가 아니라 relay가 의존하는 운영 경로이고 보안 가드까지 담고 있으므로 **추적 전환을 권고**한다(§9-c).
- 프록시 `readKey()`에 두 변수명이 다 있으면 `BACKEND_API_KEY`가 이긴다(등장 순서 무관, 시험 고정).

---

## 7. 롤백

신규 6파일 삭제 + 기존 3파일 revert + `maia-deploy.js` 재실행. 레지스트리가 없으면 relay는 `pickBackend`가 `null`을 반환해 전량 기본 claude로 동작한다.

---

## 8. ⚠️ v0.1 거버넌스 갭 주장 철회 (실측 정정)

v0.1 §6은 *"`glm-policy.json`이 문서상 T3를 선언하나 risk-classify는 T1로 분류한다 — 문서상 보호와 실제 게이트가 불일치"* 라고 적었다. **오측이었다.** 분류기에 `file_path` 키를 넘겼는데 실제 필드는 `path`여서 전부 `default-write`로 떨어졌다. 올바른 형태로 재측정한 결과:

| 경로 | 등급 | 규칙 |
|---|---|---|
| `glm-gate.js` · `glm-policy.json` | **T3** | `gate-self-glm` |
| `backends.json` · `maia-manifest.json` | **T2** | `maia-policy` |
| `c3_mc_to_hermes.js` | **T2** | `relay` |
| `glm-egress-proxy.js` · `glm-launch.sh` · `backend-*.js` | T1 | `default-write` |

게이트는 정상 작동 중이며, 구현 중 실제로 `glm-gate.js` 편집이 차단됐다(그래서 §3.4 래퍼 설계로 우회하지 않고 선회했다). 레지스트리(T2)와 정책(T3)이 **서로 다른 등급**이므로 §6의 이중화 주장도 이제 성립한다(L2 `3f56cf98` 해소).

**교훈**: 분류기를 프로브할 때 **입력 스키마를 코드로 확인**하고, 가능하면 실제 훅 거동으로 교차확인한다. 어제 `git-merge` 건에 이어 두 번째 계측 오류다.

---

## 9. 🚩 대표 판정 필요

**(a) L2 미합의 3건 — ✅ 전건 종결(2026-09-07)**
1. `a9592ff8`(blocker): 정책 T3 선언 vs 분류 T1 불일치 = 거버넌스 갭.
   → **종결: 전제 소멸.** 내 프로브가 분류기에 `file_path`를 넘겼는데 실제 필드는 `path`여서 T3 파일이 전부 T1로 보였다(§8). 올바른 형태로 재측정하면 `glm-gate.js`·`glm-policy.json`은 **T3(`gate-self-glm`)** 이고, 구현 중 실제로 편집이 차단됐다. 갭은 존재하지 않는다.
2. `3f999c4e`: 정책 경로 경계 검사 모호.
   → **종결: 구현에서 해소.** `realpath` 정규화 후 경계 비교(심링크 우회 차단) + 시험 4종(`../` 탈출·절대경로 탈출·접두 유사 디렉토리·정상 경로).
3. `e4b2f73d`: `pickBackend` 라우팅 상세 미정의.
   → **종결: 시험으로 고정.** 우선순위 3단(`config.backend` > `modelPrefix` > `namePrefix`) + 미매치 `null` + 미등재 명시 시 폴백 금지 + 레지스트리 로드 실패 시 `null`을 **27개 시험**으로 명세화. 등재 1건 상태에서 함수가 완전히 결정된다.

**(b) 신규 벤더 등재 여부** — 쓰실 모델이 정해지면 약관 조사부터 착수합니다. Anthropic 호환이면 레지스트리 1항목 추가로 끝, 아니면 변환층 개발 건입니다.

**(c) `glm-launch.sh` 추적 전환** — §6 참조. gitignore에서 빼고 버전관리할지 판단이 필요합니다. 파일에 비밀은 없고(키 파일 *경로*와 플레이스홀더뿐), 반대로 지금은 보안 가드가 버전관리 밖에 있습니다.
