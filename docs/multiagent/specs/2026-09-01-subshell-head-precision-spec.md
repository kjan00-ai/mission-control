# 서브셸 헤드 정밀화 spec — B안 잔여 우회 차단 + 실측 해소율 정정

- **발단**: 대표 지시 *"실측 검증 진행해줘"* → 선행 4패치의 주장치를 BC/SF 감사로그 전수 replay로 재현
- **결과**: 누적 해소율 주장 **39.6%가 재현되지 않음(실측 34.16%)** + **B안이 만든 게이트 우회 2건 발견**
- **설계 기준**: BC/SF Windows 감사로그(2026-06-12~09-01). 메모리 [[maia-design-baseline-is-bc-sf-not-mc]]

> ⚠️ **코퍼스는 라이브 로그라 측정할 때마다 늘어난다** — 감사로그는 지금도 기록 중이므로 본 문서의 표마다 건수가 다르다(§1 재현 49,777 → §4 최종 검증 49,852). 각 표에 **그 측정 시점의 코퍼스 크기를 함께 적었고**, 비율은 같은 표 안에서만 비교해야 한다. 표 사이의 소수점 차이(34.16% vs 34.14%)는 분모 증가에서 온다.
- **선행**: [[2026-08-31-t2-gate-precision-spec]](A안) · [[2026-08-31-npx-local-tool-precision-spec]](npx) · [[2026-09-01-git-arg-message-precision-spec]] · [[2026-09-01-head-scan-precision-spec]](B안)

---

## 1. 실측 재현 — 주장치와 실측의 차이

패치 4단계(`232342b^` → `98b1427`)의 게이트를 각각 꺼내 **같은 코퍼스에 순차 적용**했다. 최종단계는 라이브 게이트와 byte-identical을 확인했고, WSL·Windows 양쪽에서 돌려 교차검증했다.

| 단계 | spec 주장 | 실측 | 판정 |
|---|---|---|---|
| A안 + npx | 254 + 2,627 = 2,881 | **2,450** | 431건 과대 |
| git-arg | 20 | **19** | ✅ |
| B안 헤드스캔 | 546 | **540** | ✅ |
| **누적 ask 해소** | **3,448 / 8,703 = 39.6%** | **3,006 / 8,800 = 34.16%** | **5.4%p 과대** |

**갭의 원인은 npx 단계에 있다.** 조건 C(`node_modules/.bin/<pkg>` 실존 검사)가 **판정 시점의 파일시스템에 의존**하기 때문이다. cwd 매핑 방식만 바꿔도 결과가 크게 흔들린다:

| cwd 처리 | 해소 | 해소율 |
|---|---|---|
| 매핑 없음(Windows 경로를 WSL에서 검사) | 784 | 8.91% |
| 드라이브 매핑(`D:\`→`/mnt/d`) | 3,006 | **34.16%** |
| + 죽은 OneDrive 경로 보정 | 3,219 | 36.58% |
| Windows 원본 경로(= 라이브 조건) | 3,006 | **34.16%** |

⇒ **당시 측정이 틀렸다기보다 재현 불가능한 지표를 성과로 적었다.** 감사로그의 과거 cwd 중 상당수가 이미 존재하지 않는 경로(데스크탑 이전 전 OneDrive 계열)라, 시간이 지날수록 조건 C 통과율이 떨어진다. 재현 가능한 상한은 36.58%, **현재 조건 기준 실측은 34.16%**다.

**정정**: 선행 spec들의 해소율은 "측정 시점 스냅샷"으로 읽어야 하며, 누적 지표는 **34.16%**로 정정한다. 이후 해소율을 성과로 적을 때는 **측정 시점·cwd 처리 방식을 함께 명시**한다.

한편 **강화 0건**은 전 단계에서 재현됐다(선행 spec 주장 성립).

---

## 2. 문제 — B안이 연 우회 경로

전수 replay에서 **실행형 `npx wrangler` 1,519건 중 2건이 ask→allow로 완화**된 것이 잡혔다. 단계 추적 결과 **S0=S1=S2=ask → S3=allow**, B안 소행으로 확정된다.

```
( CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" timeout 25 npx wrangler tail app --format json > /tmp/t.json ) &
```

### 근본원인

`splitTopLevel`이 `(`를 depth로 처리해 **서브셸 전체가 한 세그먼트**로 남는다. 그 상태에서 `headOfSegment`가 선두 env 할당만 벗기므로(`^(?:\w+=\S+\s+)*`) `headTokens`가 **`(`를 실행 verb로 잡고**, 이어 `kept.length >= 4` 상한에 걸려 안쪽 진짜 명령이 잘려나간다.

| 명령 | 산출 헤드 | 소실 |
|---|---|---|
| `( V=1 timeout 60 pnpm install ) &` | `( V=1 timeout 60 pnpm` | `install` → `pkg-install` |
| `( V="$X" timeout 60 npx wrangler deploy ) &` | `( V= _ timeout 60` | `npx wrangler` → `remote-run` |
| `( V=1 timeout 60 prisma migrate deploy ) &` | `( V=1 timeout 60 prisma` | `migrate deploy` → `migration` |

인용 env 값(`V="$X"`)이 있으면 `_` 토큰으로 치환되며 한 칸 더 밀려, 인용 여부에 따라 결과가 갈렸다.

### 영향 범위 (능동 probe)

| | S0 baseline | S3 라이브 |
|---|---|---|
| `( V="$X" timeout 60 npx wrangler deploy ) &` | ask | **allow** |
| `( V=1 timeout 60 pnpm install ) &` | ask | **allow** |
| `( V=1 timeout 60 prisma migrate deploy ) &` | ask | **allow** |
| `( A="x y" B="p q" timeout 60 pnpm install ) &` | ask | **allow** |
| `( V=1 timeout 60 rm -rf … ) &` / `git push` / `curl \| sh` | deny | deny ✅ |
| `( … sudo … ) &` / `docker compose up -d` / `kubectl apply` / `crontab -e` | ask | ask ✅ |

마지막 행은 **상태를 바꾸는** infra 명령이다. 같은 `docker`라도 **조회형(`docker ps`)은 성격이 다르며**, 본 패치 후 완화된다(§4) — `readSubExempt`의 읽기 서브커맨드 면제가 서브셸 안에서도 작동하게 되기 때문이다. 규칙 이름(`infra`)이 같다고 같은 위험이 아니다.

**DENY층과 infra는 무사**하다 — `dangerScanText`(denylist·T3 전용)는 서브셸에서 원문을 그대로 유지하기 때문이다. 뚫린 것은 **T2 커맨드 규칙**뿐이지만, 거기에 **프로덕션 배포(`wrangler deploy`)와 DB 마이그레이션(`prisma migrate deploy`)** 이 포함된다.

실측 발생은 2건(`wrangler tail` — 읽기라 실피해 없음)이나, 같은 관용구가 BC/SF에서 실제로 쓰인다는 점이 확인됐다.

### 왜 선행 검증이 놓쳤나

B안 spec의 성공기준이 **"강화 0"** 이었다. 완화 방향의 안전 손실은 이 지표로 잡히지 않는다. 앞으로 게이트 완화 패치는 **"기존 게이트 대상이 유지되는가"를 별도 기준으로** 검증한다.

---

## 3. 설계

`headOfSegment`와 `npxTargetOf`가 **동일한 lead 계산**을 쓰고 둘 다 같은 이유로 실패하므로, 공통 헬퍼로 뽑는다.

```js
const LEAD_ENV_ASSIGN = /^(?:\w+=(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S*)\s+)*/
function stripLeadWrappers(s) {
  let lead = String(s).replace(/^\s*/, '')
  for (let prev = null; prev !== lead;) {
    prev = lead
    lead = lead.replace(/^\(\s*/, '').replace(/^\{\s+/, '').replace(LEAD_ENV_ASSIGN, '')
  }
  return lead
}
```

- **그룹·할당을 번갈아 벗긴다** — env 할당은 그룹 안팎 어디에도 올 수 있고 중첩 서브셸도 있다
- **env 값은 인용 안의 공백까지 통째로 벗긴다** — 기존 코드의 `\S+`를 그대로 계승했더니 값 중간에서 끊겨 lead 제거가 실패했다. L2가 blocker로 제기했고 **실측으로 누출이 재현됐다**: `( A="x y" B="p q" timeout 60 pnpm install ) &` → T1. 단일 인용 env는 우연히 `kept` 4토큰 안에 명령이 남아 살아남지만, **다중이면 밀려나 뚫린다**
- **`$(`는 영향 없음** — `^\(`가 `$(`에 매치되지 않으므로 명령치환은 기존대로 원문 유지
- **`{`는 공백을 요구** — brace expansion(`{a,b}`)과 구분
- **`dangerScanText`는 손대지 않는다** — 서브셸에서 원문을 유지해야 DENY 차단력이 불변. 의도적 비대칭이다

`npxTargetOf`가 고쳐지면 부수적으로 `( npx tsc --noEmit )` 같은 **서브셸 안 로컬 도구 완화가 살아난다**(기존에는 불발).

---

## 4. 검증

### 회귀 (드라이런 전건 통과)

| | 결과 |
|---|---|
| 기존 골든 픽스처 | **237 / 237** |
| A안 회귀 | 게이트 38 · 통과 20 ✅ |
| npx 회귀 | 자율 7 · 게이트 18 ✅ |
| git-args 회귀 | 게이트 17 · 통과 8 · 브랜치 2 ✅ |
| B안 회귀 | 게이트 33 · 통과 18 ✅ |
| **본 패치 회귀(신규)** | **게이트 25 · 통과 10** ✅ |

신규 회귀는 실측 우회 원형, 인용/비인용 env, **다중 공백 인용 env**(L2 blocker 케이스), 중첩 서브셸 `( ( … ) )`, 공백 없는 `(pnpm install)`, 중괄호 그룹 `{ … ; }`, 백그라운드 없는 서브셸, 체인 뒤 서브셸을 모두 포함하고, denylist 3종이 서브셸 안에서도 유지되는지 확인한다.

### 전수 replay (코퍼스 49,852건 — 라이브 vs 패치본)

| | 건수 |
|---|---|
| 강화(게이트 회복) | **2** — 실측 우회 2건 정확히 그것뿐 |
| 완화 | **3** — `(PATH=… docker ps …)` 조회 · `( npx tsc --noEmit )` · `GIT_DIR="$(…)" npx lint-staged` |
| ask 총계 | 5,802 → **5,801** (순감 1) |
| 누적 해소율 | 34.13% → **34.14%** |

⇒ **안전은 회복되고 마찰은 늘지 않는다.** 완화 3건은 근본원인 수정의 정당한 부수효과로, 전부 조회 또는 로컬 개발도구다. 세 번째 건은 인용 env 값 처리가 고쳐지며 `npx lint-staged`의 로컬 판별이 살아난 것이다.

### 재현 하네스 보존

측정 스크립트를 `~/p1c/candidates/subshell-head/measure/`에 함께 보존한다 — `extract.js`(단계별 게이트 추출) · `stage.js`(단계 분해) · `verify.js`(라이브 vs 패치 전수) · `wr.js`(특정 명령군 추적) · `synth2.js`(능동 probe) · `impact.js`(구조 패턴 영향). **다음 게이트 패치는 같은 하네스로 재측정**하면 되므로, 주장치가 재현 불가능해지는 문제가 반복되지 않는다.

---

## 5. 적용

```bash
node ~/p1c/candidates/subshell-head/apply.js --dry   # 드라이런(원본 미변경)
node ~/p1c/candidates/subshell-head/apply.js         # 적용 — 대표 `!` 전용
node ~/.ai-bootstrap/maia-deploy.js                  # Windows 동기
```

롤백: `node ~/p1c/candidates/subshell-head/rollback.js` (+ 재배포)

apply는 앵커 유일성 검증 → 백업 → 치환 → 구문검사 → 골든픽스처 → 회귀 5종 순으로 진행하며, **어느 단계든 실패하면 자동 롤백**한다. 회귀 파일이 없으면 건너뛰지 않고 중단한다(L2 `4735afe8` 계승).

게이트 SSOT는 A2 자기보호(owner-only T3)라 에이전트가 직접 적용할 수 없다 — candidate만 준비하고 적용은 대표 `!`로 한다.

---

## 6. L2 반영

codex ∥ gemini 3라운드. R1 8쟁점 → R2 합의 5 · 심화 2 → R3 에스컬레이션 2(둘 다 refuted).

### 합의 반영 (5건)

| id | severity | 제기 | 반영 |
|---|---|---|---|
| `93ec5b81` | **blocker** | `stripLeadWrappers`의 `\S+`가 공백 포함 인용 env 값을 끊어 오작동 | **실측으로 누출 재현**(`( A="x y" B="p q" … pnpm install ) &` → T1) → `LEAD_ENV_ASSIGN` 인용 인지 정규식으로 수정 + 회귀 5건 편입(§3·§4) |
| `888e6c23` | important | 같은 지적(quoted env + 공백) | 위와 동일 건 — 함께 해소 |
| `e00e5a73` | important | 코퍼스 수·해소율이 문서 내에서 불일치 | 원인 명시(**라이브 로그라 측정마다 증가**) + 표마다 측정 시점 코퍼스 병기(머리말·§4) |
| `7cd16f51` | important | `docker`는 ask 유지라더니 완화 결과와 충돌 | **정정** — 상태변경(`docker compose up -d`)과 조회(`docker ps`)를 구분해 기술(§2) |
| `f411a3bc` | important | 완화 패치 검증 기준에 '기존 게이트 유지' 확인이 없던 것은 절차 결함 | §2에 기준 추가 + §4에 **재현 하네스 보존**으로 실질 조치 |

### 대표 에스컬레이션 (2건) — 판정

**`cfa76553`** (codex 제기 / gemini refute) — *공백 없는 서브셸 `(pnpm install)` 처리가 설계와 맞지 않는다*
→ **결함 아님.** 실측 확인: 회귀 테스트에 해당 케이스가 있고 통과한다(`^\(\s*`의 `\s*`가 0회 매치를 허용). codex 우려의 실질은 "닫는 `)`가 헤드에 남는다"인데, 잔존 `)`는 어떤 규칙 패턴과도 매치하지 않아 판정에 영향이 없다. 다만 지적 자체는 파서 위생 관점에서 유효하므로 **후속 과제**로 남긴다(현 패치 범위 밖 — 닫는 토큰 정리는 별도 회귀가 필요).

**`aa90093d`** (gemini 제기 / codex refute) — *재현 불가능 지표의 재발 방지 조치가 없다*
→ **부분 타당, 실질 조치로 해소.** codex 말대로 §1에 표기 기준은 이미 있으나, 문서 규약만으로는 약하다는 gemini 지적이 맞다. **측정 하네스를 candidate와 함께 보존**(§4)해 다음 패치가 같은 방법으로 재측정하도록 했다. 절차적 승인 게이트 신설은 과하다고 판단해 채택하지 않는다.

리뷰 원본: [[2026-09-01-subshell-head-precision-spec-l2-aggregation-20260901-093200]] · [[2026-09-01-subshell-head-precision-spec-l2-deepen-r2-20260901-093200]] · [[2026-09-01-subshell-head-precision-spec-l2-deepen-r3-20260901-093200]]
