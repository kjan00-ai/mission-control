# wrangler 조회형 하위명령 완화 spec — remote-run 잔여 모달 해부 + 1안

- **발단**: 대표 지시 *"B의 remote-run 2,523건 해부 진행하자"* → 해부 후 **대표 결정 = 1안(안전 구간만)**
- **선행**: [[2026-09-01-subshell-head-precision-spec]](서브셸 우회 차단, 적용 완료) 이후의 잔여 모달
- **측정**: BC/SF Windows 감사로그. 코퍼스는 라이브라 측정마다 증가하므로 각 표에 시점 크기를 병기한다([[resolution-rate-metrics-must-be-reproducible]])

---

## 1. 해부 — remote-run 2,525건은 왜 남았나

> 코퍼스가 라이브라 측정 시점마다 총계가 다르다 — 대표 보고 시점 2,523건, 해부 시점 **2,525건**. 아래 표는 해부 시점 기준이며, 세부 나열은 **상위 항목만** 적어 소계와 정확히 일치하지 않는다(A의 1,460 = wrangler 1,444 + cli 8 + opennextjs-cloudflare 6 + `2>` 1 + bulk-suppressions 1).

| 원인 | 건수 | |
|---|---|---|
| **A. 화이트리스트 밖** | 1,460 (57.8%) | **wrangler 1,444** · cli 8 · opennextjs-cloudflare 6 · 기타 2 |
| B1. cwd 없음(조건 C 판정 불가) | 446 (17.7%) | vitest 265 · tsc 142 · eslint 37 |
| B2. 로컬 미설치(현시점) | 364 (14.4%) | 죽은 OneDrive 경로 235 / **살아있는 경로 129** |
| E. 실행 아님(언급·미파싱) | 246 (9.7%) | 명령치환 안·`for` 루프 안 등 |
| C. 버전 지정·원격 강제 플래그 | 9 (0.3%) | **정당한 게이트** |

**B2의 살아있는 129건**은 `cd`로 **하위** 디렉토리에 들어가 실행하는 형태다(`evt.cwd`는 `StarFollow`, 실제 실행은 `StarFollow/web`). 게이트는 cwd에서 **위로만** 5단계 올라가므로 하위의 `node_modules`를 못 본다. npx spec이 "명령 속 `cd`를 신뢰하면 임의 경로로 로컬 설치를 가장할 수 있다"며 `evt.cwd`만 신뢰하기로 한 결정의 대가이며, **의도된 안전 방향 실패**다.

### wrangler 1,440건의 성격

| | 건수 | 처리 |
|---|---|---|
| `d1 execute --remote` (SELECT류 ~1,090 / 쓰기 49) | ~1,114 | **유지** |
| 조회형 하위명령(`whoami`·`deployments list`·`secret list`·`d1 list`·`r2 bucket list` …) | 202 | **완화** |
| `d1 execute` (`--remote` 없음 = 로컬 DB) | 108 | **유지** (L2 지적 반영 — §3) |
| 배포(`deploy`/`publish`/`pages deploy`) | 126 | **유지** |
| `tail` | 42 | **유지**(블로킹) |
| `secret put`·`migrations apply`·`delete` | 13 | **유지** |

> `--command`의 첫 동사 분포(1,231건): SELECT 1,088 · PRAGMA 81 · INSERT 24 · UPDATE 10 · DELETE 8 · CREATE/DROP 6 · BEGIN 1. PRAGMA는 `table_info`(79)·`foreign_keys`·`foreign_key_check`로 **전부 읽기**다(초기 집계에서 PRAGMA를 쓰기로 분류한 것은 오류였고 정정했다).

---

## 2. 왜 원격 SELECT(~1,090건)를 풀지 않는가

가장 큰 덩어리지만 **안전하게 풀 수 없다**. `--command`에 **다중 문장이 실제로 쓰인다**(실측 8건, 그중 `--remote` 3건):

```
[--remote] INSERT INTO baseline_library …;  DELETE FROM baseline_library …
[--remote] BEGIN; INSERT INTO support_programs …; SELECT changes(); ROLLBACK;
```

⇒ "첫 동사가 SELECT면 완화"는 `SELECT 1; DROP TABLE users`로 뚫린다. 안전하게 하려면 문자열 리터럴 밖 `;`로 문장을 쪼개 **전 문장이 읽기인지** 검사해야 하고, 이는 게이트에 SQL 파서를 넣는 일이다 — 주석(`--`, `/* */`)·이스케이프·CTE 엣지가 많고 **파서 결함 = 프로덕션 DB 노출**이다.

**대표 결정: 1안(안전 구간만).** 효과는 4분의 1이지만, "효과가 크니 넣자"로 스코프를 넓혔다가 우회를 만든 [[2026-09-01-subshell-head-precision-spec]]의 전철을 밟지 않는다.

---

## 3. 설계

`wrangler`는 **한 패키지 안에서 조회와 변경이 갈리므로** `npxLocalTools` 화이트리스트(패키지 단위)로는 표현할 수 없다. 하위명령 단위로 판정하는 별도 목록을 둔다.

**허용 목록(policy `wranglerReadSubcommands`, 19종)** — 전부 상태를 바꾸지 않는다:

```
whoami · --version · -v
deployments list · versions list · secret list
d1 list · d1 info · d1 migrations list
kv namespace list · kv key list · kv key get
r2 bucket list · r2 object get
queues list · containers list · hyperdrive list
pages project list · pages deployment list
```

```js
function wranglerReadOnly(segText, policy) {
  const list = (policy && policy.wranglerReadSubcommands) || []
  if (!list.length) return false
  const m = /\bwrangler(?:\.cmd)?\s+([\s\S]*)$/.exec(String(segText))
  if (!m) return false
  const a = m[1].replace(/\s+/g, ' ').trim()
  if (/(?:^|\s)--remote(?:\s|=|$)/.test(a)) return false   // 원격 대상은 조회여도 게이트
  if (/\$\(|`|\$\{/.test(a)) return false                  // 명령치환은 그 안이 실행된다
  for (const s of list) { if (a === s || a.indexOf(s + ' ') === 0) return true }
  return false
}
```

`npxAllLocal`의 화이트리스트 검사 앞에 분기를 넣고, **npx를 거치지 않은 wrangler 세그먼트**도 같은 기준으로 본다:

```js
if (pkg === undefined) {                      // npx 실행 위치가 아닌 세그먼트
  if (bareWranglerSeg(text) && !wranglerReadOnly(text, policy)) return false
  continue
}
…
if (pkg === 'wrangler') {
  if (!wranglerReadOnly(text, policy)) return false
  continue                                    // 조건 C 면제
}
```

- **`--remote`가 있으면 무조건 게이트** — 조회형 하위명령이어도 예외 없다(`d1 list --remote`도 게이트)
- **`d1 execute`는 로컬이어도 제외** — 초안은 `--remote`가 없으면 허용했으나, **SQL 내용 검사가 없어 `--local --command "DROP TABLE users"`가 통과**한다(L2 `777fc672`, 실측 재현). 실측으로도 로컬 `d1 execute` 125건 중 **32건이 쓰기**(`DROP TABLE`·`INSERT`·`--file`)다. 원격 SELECT를 "SQL 파서를 넣지 않는다"는 이유로 거부해 놓고 로컬 쓰기를 허용하면 **내부 모순**이므로, 같은 기준으로 제외한다
- **명령치환·백틱·`${}`가 있으면 게이트** — prefix 매칭만으로는 `wrangler whoami $(wrangler deploy)`가 통과한다(L2 `fe84c1bf`, 실측 재현)
- **npx 없는 wrangler 실행도 검사** — 없으면 `npx wrangler whoami; wrangler deploy`처럼 완화 세그먼트 뒤에 변경을 붙여 **명령 전체가 자율 통과**한다(실측 재현). `;`·`&&`·`|`·서브셸·prefix 러너 형태를 모두 회귀에 넣었다
- **`tail` 제외** — 상태는 불변이나 블로킹이라 교착 위험. A안이 `tail -f`를 되돌린 것과 같은 이유
- **버전 지정·원격 강제 플래그는 기존 경로가 차단** — `npx wrangler@4 …`는 `npxPkgName`이 null을 반환하고, `npx --yes wrangler …`는 `npxTargetOf`가 null을 반환해 둘 다 이 분기 전에 걸러진다

### ⚠️ 조건 C(로컬 실존) 면제 — 근거

wrangler는 **worker 하위 디렉토리**에 설치되는데 게이트는 cwd에서 위로만 올라간다. 조건 C를 적용하면 **310건 중 17건**만 풀려(실측) 조치의 실효가 사라진다. 면제해도:

- 패키지 이름이 **`wrangler`로 고정**된다 — 임의 패키지가 아니다
- **원격 강제 플래그(`-y`/`--yes`/`-p`/`--package`)와 버전 지정(`@`)은 계속 차단**된다
- 실행 가능한 하위명령이 **조회형 19종 + 로컬 `d1 execute`로 제한**된다

즉 `remote-run` 규칙의 본래 취지(레지스트리에서 임의 코드를 받아 실행)는 여전히 막힌다. 남는 잔여 위험은 wrangler 패키지 자체의 공급망 오염인데, 이는 로컬 설치본에도 동일하게 성립하며 대표 승인 모달로 판별 가능한 종류가 아니다.

---

## 4. 검증

### 회귀 (드라이런 전건 통과)

| | 결과 |
|---|---|
| 기존 골든 픽스처 | 237 / 237 |
| A안·npx·git-args·B안·서브셸 회귀 | 전건 통과 |
| **본 패치 회귀(신규)** | **게이트 35 · 완화 16** ✅ |

게이트군은 배포·`secret put`·`migrations apply`·`delete`·`kv/r2 put`, **`--remote`가 붙은 조회 및 다중 문장**(`SELECT 1; DROP TABLE users`), **로컬 `d1 execute` 4종**(조회·쓰기·`--file`·플래그 없음), `tail`·`dev`·`login`·`init`, 원격 강제 플래그·버전 지정, **서브셸 안 배포**, 조회 뒤 설치 체인, 그리고 **L2가 찾은 우회 7종**(`;`/`&&`/`|`/prefix 러너/서브셸 뒤 bare 배포, 명령치환·백틱 속 배포)을 포함한다.

### 전수 replay (코퍼스 49,925건 — 라이브 vs 패치본)

| | |
|---|---|
| **강화** | **0건** |
| 완화 | **144건** (전부 `remote-run`) |
| ask 총계 | 5,815 → **5,671** |
| 누적 해소율(S0 대비) | 34.09% → **35.72%** (+1.63%p) |

L2 반영 전 초안은 251건(36.94%)이었으나 로컬 `d1 execute` 108건을 제외해 **144건으로 줄었다**. 효과를 절반 가까이 포기하고 안전을 택한 것이며, 원격 SELECT를 거부한 것과 같은 기준이다.

### 안전 감사 — 완화 251건 전수 스캔

`--remote` · `deploy`/`publish` · `secret put/delete` · `migrations apply` · `delete` · `kv/r2 put` · `tail` · `dev` 패턴 **0건**. 완화된 것은 조회형과 로컬 `d1 execute`뿐이다.

### 알려진 미해소

`npx wrangler d1 migrations list` — `remote-run`은 풀리지만 **`migration` 규칙**이 명령 텍스트의 "migrations"를 잡아 T2로 남는다. **실측 1건**이라 본 패치 범위 밖으로 두며, `migration` 규칙 정밀화 시 함께 처리한다.

조회형 202건 대비 실제 완화 144건인 것도 같은 이유다 — 일부가 `migration` 등 다른 규칙에 중복으로 걸린다(게이트는 보수적 max).

---

## 5. 적용

```bash
node ~/p1c/candidates/wrangler-read/apply.js --dry   # 드라이런(원본 미변경)
node ~/p1c/candidates/wrangler-read/apply.js         # 적용 — 대표 `!` 전용
node ~/.ai-bootstrap/maia-deploy.js                  # Windows 동기
```

롤백: `node ~/p1c/candidates/wrangler-read/rollback.js` (+ 재배포). gate·policy **두 파일**을 백업/복원한다.

apply는 앵커 유일성(3곳) → 백업 → 치환 → 구문검사 → **정책 JSON 스키마 검사**(`wranglerReadSubcommands` 존재 + `npxLocalTools`에 wrangler가 섞이지 않았는지) → 골든픽스처 → 회귀 6종 순으로 진행하며 어느 단계든 실패하면 **gate·policy 모두 자동 롤백**한다.

---

## 6. 남은 트랙

| | 건수 | |
|---|---|---|
| 원격 SELECT | ~1,090 | SQL 파서 필요 — 별건, 본 spec §2 |
| 로컬 `d1 execute` | 108 | 위와 동일한 SQL 파서 문제(쓰기 32건 실측) |
| B1 cwd 없음 | 446 | **훅 입력 문제** — 게이트 로직이 아니라 `evt.cwd` 전달을 고쳐야 한다 |
| B2 `cd` 하위 이동 | 129 | 안전 설계상 의도적. 완화하려면 cwd 신뢰 모델 재검토 필요 |
| E 실행 아님 | 246 | 명령치환·루프 안 — 파싱 개선 여지 |

**B1(446건)이 다음으로 값지다** — 게이트를 건드리지 않고 훅이 cwd를 항상 넘기게 하면 조건 C가 정상 작동한다.

---

## 7. L2 반영

codex ∥ gemini 3라운드(T3 패널). R1 6쟁점 → R2 합의 4 · 심화 1 → R3 에스컬레이션 1.

### 합의 반영 (4건)

| id | severity | 제기 | 반영 |
|---|---|---|---|
| `777fc672` | important | `d1 execute`가 `--remote`만 없으면 SQL 검사 없이 완화 — '조회형' spec인데 로컬 쓰기·삭제까지 허용 | **실측 재현**(`--local --command "DROP TABLE users"` → T1) → **완화 대상에서 제외**. 실측 로컬 125건 중 쓰기 32건. 완화 251 → 144건 |
| `fe84c1bf` | important | 하위명령 prefix 매칭이 뒤 인자를 제한하지 않아 같은 세그먼트의 추가 동작이 통과 | **실측 재현**(`whoami $(wrangler deploy)` → T1, `whoami; wrangler deploy` → T1) → **명령치환·백틱 차단** + **npx 없는 wrangler 세그먼트 검사**(`bareWranglerSeg`) 추가, 회귀 7종 편입 |
| `d8b59ef9` | important | 측정 표의 건수가 내부 불일치(2,523 vs 2,525 / 1,460 vs 세부합) | **정정** — 라이브 코퍼스라 시점마다 총계가 다름을 명시하고, 세부 나열이 상위 항목만임을 밝힘(§1) |
| `c49cc6bc` | important | 정책에 들어갈 조회형 19종이 spec에 나열되지 않아 대조 검증 불가 | **19종 전체를 §3에 나열** |

`777fc672`·`fe84c1bf`는 **둘 다 실측으로 재현된 실제 결함**이었다. L2가 없었으면 로컬 DB 쓰기와 체인 우회를 열어둔 채 배포될 뻔했다.

### 대표 에스컬레이션 (1건) — 판정

**`332f0ec4`** (codex 제기 **blocker** / gemini refute) — *조건 C 면제가 `npx wrangler …`의 레지스트리 원격 실행을 다시 허용해 remote-run 차단 목적과 충돌한다*

→ **refuted 유지, 설계 그대로 간다.** gemini 반박대로 원격 강제 플래그(`-y`/`--yes`/`-p`/`--package`)와 버전 지정(`@`)이 계속 차단되고, 실행 가능한 하위명령이 조회형 19종으로 제한되므로 "레지스트리에서 **임의 코드**를 받아 실행"하는 본래 차단 목적은 유지된다. 남는 것은 wrangler 패키지 자체의 공급망 오염 위험인데, 이는 로컬 설치본에도 동일하게 성립하고 대표 승인 모달로 판별할 수 있는 종류가 아니다. 조건 C를 고수하면 310건 중 17건만 풀려 조치가 무의미해진다(실측).

다만 codex 지적의 실질 — "완화 대상이 늘면 노출 면적이 커진다" — 은 `fe84c1bf` 수정(bare wrangler 검사)으로 상당 부분 흡수됐다.

리뷰 원본: [[2026-09-01-wrangler-read-subcommand-spec-l2-aggregation-20260901-101331]] · [[2026-09-01-wrangler-read-subcommand-spec-l2-deepen-r2-20260901-101331]] · [[2026-09-01-wrangler-read-subcommand-spec-l2-deepen-r3-20260901-101331]]
