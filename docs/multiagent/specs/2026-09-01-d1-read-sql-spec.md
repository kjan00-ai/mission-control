# d1 execute 읽기 SQL 완화 spec (B1) + wrangler 조회형 보강 (B5)

- **발단**: 대표 지시 *"권고 순서대로 진행"*(B5→B4→B1) → **조사가 순서를 뒤집었다**. B4·B5는 실익이 26건뿐이고 B4는 안전한 수정이 어려워, B5를 B1과 한 패치로 묶었다
- **선행**: [[2026-09-01-wrangler-read-subcommand-spec]](조회형 19종, 적용 완료)
- **측정**: BC/SF Windows 감사로그. 라이브 코퍼스라 표마다 시점 크기가 다르다([[resolution-rate-metrics-must-be-reproducible]])

---

## 1. 조사가 권고를 정정했다

권고 순서를 **"오탐이 많을 것"이라는 검증 안 된 추정**으로 잡았고, 실측하니 둘 다 틀렸다.

| 트랙 | 추정 | 실측 |
|---|---|---|
| A1 cwd 누락 446건 | 훅이 `evt.cwd`를 안 넘김 → 고치면 해소 | **이미 2026-06-21에 해결됨** — 446건은 전부 그 이전 로그 |
| B4 `move-rename` 78건 | 93%가 실행 위치 아닌 오탐 | **90.5%가 진짜 `mv`/`rm` 실행** — 실익 7~8건 |
| B5 wrangler 누락 | — | ~18건 |

A1의 오판은 **전체 기간 통계를 현재 문제로 착각**한 것이고, B4의 오판은 **분류 스크립트가 `mv`만 보고 `rm`을 빠뜨린 것**이다. 규칙은 `\bmv\s|\brm\s(?!-rf)`인데 `mv|rename`만 셌다.

### 기간별로 봐야 현재 마찰이 보인다

모달 비율 자체는 기간과 무관하게 11% 내외로 안정적이나 **구성이 다르다**. `infra`·`hook`·`interactive`는 최근 14일엔 0건(과거 이력)이고, 상위 4개가 97.5%를 차지한다.

| 최근 14일(10,590건 · ask 1,213) | 건수 | 비중 |
|---|---|---|
| `remote-run` | 579 | 47.7% |
| `git-commit` | 416 | 34.3% |
| `migration` | 104 | 8.6% |
| `move-rename` | 84 | 6.9% |

그리고 `remote-run` 581건 중 **538건(92.6%)이 `wrangler d1 execute --remote`** 였다.

### B4를 보류하는 이유

오탐 6건의 정체는 **heredoc 본문 안 파이썬 변수명**(`for i,rm in enumerate(...)`)이다. splitTopLevel이 heredoc을 인식하지 않아 본문 각 줄이 독립 세그먼트가 되고, 그 줄의 `kept` 토큰에 `rm `이 남는다. 고치려면 heredoc 본문을 스캔에서 빼야 하는데, **`python - <<'PY' … os.system("rm -rf /")` 같은 실행 우회가 열린다**. 6건 대비 위험이 크다.

---

## 2. B1 — d1 execute 읽기 SQL

### 왜 이제 풀 수 있나

선행 spec은 원격 SELECT를 "다중 문장 우회(`SELECT 1; DROP TABLE x`)가 실측 확인돼 SQL 파서 없이는 안전히 풀 수 없다"며 보류했다. 최근 14일 실측이 그 판단의 근거를 바꿨다:

| `d1 execute --remote` 539건 | 건수 | |
|---|---|---|
| 단일 읽기(SELECT) | **515** | 95.6% |
| 단일 쓰기 | 20 | 3.7% |
| **다중문장** | **2** | **0.4%** |
| `--file`·추출 실패 | 2 | |

**SQL 파서를 만들 필요가 없다.** 다중문장을 *판별*하는 대신 **다중문장이면 무조건 게이트**로 하면 파싱 부담이 사라진다.

### 설계 — 세 겹의 보수 조건

```js
function d1ReadOnlySql(args) {
  const m = /--command(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*')/.exec(args)
  if (!m) return false                          // ① --file 등 SQL 미상 → 게이트
  const sql = m[1].slice(1, -1)
  if (/--|\/\*/.test(sql)) return false         // ② 주석 → 게이트
  if (d1BareSemicolon(sql)) return false        // ③ 다중문장 → 게이트
  const t = sql.replace(/^[\s(]+/, '')
  const bare = t.replace(/'(?:[^']|'')*'/g, "''")
  if (D1_DML_STMT.test(bare) || D1_DANGER_FN.test(bare)) return false   // ④ DML 구문·위험 함수
  if (/^SELECT\b/i.test(t) || /^WITH\b/i.test(t)) return true
  const p = /^PRAGMA\s+(\w+)\s*(?:\([^)]*\))?\s*(=)?/i.exec(t)
  if (p && !p[2] && D1_READ_PRAGMA.test(p[1])) return true
  return false
}
```

**③ 다중문장 판별** — SQLite의 인용 규칙을 모두 인지한다:

```js
// '…'(이스케이프는 '' 반복) · "…"(식별자) · `…`(MySQL 호환) · […](MSSQL 호환)
function d1BareSemicolon(sql) {
  let q = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (q) {
      if (q === "'" && c === "'") { if (sql[i+1] === "'") { i++; continue } q = ''; continue }
      if (q === '"' && c === '"') { if (sql[i+1] === '"') { i++; continue } q = ''; continue }
      if (q === '`' && c === '`') { q = ''; continue }
      if (q === ']' && c === ']') { q = ''; continue }
      continue
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '[') { q = ']'; continue }
    if (c === ';' && sql.slice(i+1).trim()) return true
  }
  return false
}
```

미인식 형태가 남더라도 결과는 **다중문장 오판 = 게이트**(안전 방향)이고, 반대로 인용이 미종결이면 그 SQL은 애초에 실행되지 않는다.

**④ DML은 키워드 단독이 아니라 구문 형태로 판정한다** — 그러지 않으면 `COUNT(attach_url) attach`의 ATTACH, 함수 `replace(...)`의 REPLACE가 오탐돼 실측 5건이 통째로 막힌다:

```js
const D1_DML_STMT = /\b(?:INSERT\s+INTO|REPLACE\s+INTO|UPDATE\s+[\w."`\[\]]+\s+SET|DELETE\s+FROM|
  DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|CREATE\s+(?:TEMP\s+|TEMPORARY\s+|VIRTUAL\s+|UNIQUE\s+)*(?:TABLE|INDEX|VIEW|TRIGGER)|
  ALTER\s+TABLE|TRUNCATE\s+TABLE|ATTACH\s+DATABASE|DETACH\s+DATABASE|VACUUM\b|REINDEX\b|PRAGMA\s+\w+\s*=)/i
const D1_DANGER_FN = /\b(?:load_extension|writefile|readfile|edit|fts3_tokenizer)\s*\(/i
```

**읽기 허용 PRAGMA(`D1_READ_PRAGMA`)** — 전부 상태를 바꾸지 않는 조회다:

```
table_info · table_list · table_xinfo · index_list · index_info · index_xinfo
foreign_key_list · foreign_key_check · foreign_keys · database_list · collation_list
compile_options · integrity_check · quick_check · page_count · page_size · freelist_count
schema_version · user_version · journal_mode · encoding · cache_size · auto_vacuum
```

- **② 주석을 무조건 게이트** — 실측 1,250건 중 **0건**이라 손실 없이 파싱 위험(주석 안 `;`·따옴표가 파서를 어긋내는 것)을 통째로 제거한다
- **③ 문자열 리터럴 밖 세미콜론이 하나라도 있으면 게이트** — 끝의 `;` 하나(뒤에 내용 없음)는 단일 문장으로 본다
- **`SELECT` 단일 문장은 SQLite에서 데이터를 바꿀 수 없다**(D1=SQLite). 그래도 엔진 확장·특수 함수로 새지 않도록 **읽기 시작 문장 전체**에 ④를 건다(초안은 `WITH`에만 걸었고 L2 `b83b456f`가 "top-level SELECT 보장이 과장"이라 지적). 문자열 리터럴을 비우고 검사해 `WHERE note='delete me'` 같은 값도 오탐되지 않게 한다
- **PRAGMA는 읽기 목록 + 값 설정(`=`) 제외**. 함수형 `PRAGMA table_info(users)`는 **조회이므로 허용**한다 — 초안에서 함수형을 제외했다가 실측 최다(79건)를 통째로 막는 것을 발견해 고쳤다
- **로컬(`--remote` 없음)도 같은 검사를 받는다** — 선행 spec이 L2 지적(`777fc672`)으로 제외했던 로컬 `d1 execute`가 SQL 검사가 생기면서 일관되게 흡수된다. `--local --command "DROP TABLE users"`는 여전히 게이트다

### B5 — 조회형 6종 보강

`containers info`(15) · `containers images list` · `r2 object list`(3) · `r2 bucket info` · `queues info`(2) · `versions view`(2). 목록이 19종 → **25종**이 된다.

---

## 3. 검증

### 회귀 (드라이런 전건 통과)

| | |
|---|---|
| 기존 골든 픽스처 | 237 / 237 |
| A안·npx·git-args·B안·서브셸·wrangler 회귀 | 전건 통과 |
| **본 패치 회귀(신규)** | **게이트 36 · 완화 25** |

게이트군: 원격·로컬 쓰기 SQL 8종 · 다중문장 3종(전부 읽기여도) · 주석 2종 · `--file`/`command` 없음 3종 · PRAGMA 설정·목록 밖 · **CTE 안 DML 2종** · 배포/secret put/migrations apply/create 계열 · 명령치환·체인 우회 · 원격 강제 플래그.
완화군: 원격·로컬 읽기 · `--json` 동반 · `--command=` 형태 · 문자열 안 세미콜론 · 끝 세미콜론 · 읽기 PRAGMA 3종(함수형 포함) · **SQL 함수·컬럼명이 쓰기처럼 보이는 실측 3종** · B5 조회형 6종.

게이트군에는 L2 반영분도 포함된다 — **읽기로 시작해도 DML 구문·위험 함수가 섞이면 게이트**(`SELECT … (DELETE FROM u)` · `load_extension` · `writefile` · `PRAGMA journal_mode=WAL` 동반), **대괄호 식별자 + 다중문장**.

### 전수 replay (코퍼스 50,021건 — 라이브 vs 패치본)

| | |
|---|---|
| **강화** | **0건** |
| 완화 | **1,077건** (전부 `remote-run`) |
| ask 총계 | 5,695 → **4,618** |
| 누적 해소율(S0 대비) | 35.63% → **47.80%** (+12.2%p) |

L2 반영으로 DML 구문 검사를 SELECT까지 확대했으나 **완화 건수는 줄지 않았다** — 키워드 단독이 아니라 구문 형태로 판정하기 때문이다.

### 정밀 안전 감사 — 완화 1,076건 전수

완화분 중 `d1 execute`가 1,066건이고 **1,061건이 읽기로 확인**됐다. 나머지 5건은 감사 스크립트가 플래그했으나 **전부 감사 쪽 오탐**이었다:

- `ATTACH` 3건 → 컬럼명·별칭 `COUNT(attach_url) attach`
- `REPLACE` 2건 → SQLite 문자열 함수 `replace(replace(substr(...)))`

변경 계열(배포·`secret put`·`migrations apply`·`delete`·`kv/r2 put`·`create`·`tail`·`dev`) 완화는 **0건**이다. 이 세 형태는 회귀에 편입했다.

### 선행 회귀 수정 (설계 변경에 따른 정당한 갱신)

`d1 execute`의 판정 기준이 "하위명령"에서 "SQL 내용"으로 바뀌었으므로 선행 회귀 두 곳을 갱신했다. **의도는 보존**하고 케이스만 쓰기 SQL로 바꿨다:

- `npx-local.regression.js` — "wrangler는 `npxLocalTools` 화이트리스트 밖" 케이스를 `--command "SELECT 1"` → `"DROP TABLE users"`
- `wrangler-read.regression.js` — d1 관련 게이트 케이스를 본 spec 회귀로 이관, 남은 것은 쓰기·`--file`·다중문장

---

## 4. 적용

```bash
node ~/p1c/candidates/d1-read/apply.js --dry
node ~/p1c/candidates/d1-read/apply.js         # 대표 `!` 전용
node ~/.ai-bootstrap/maia-deploy.js
```

롤백: `node ~/p1c/candidates/d1-read/rollback.js` (+ 재배포). gate·policy 두 파일을 백업/복원한다.

정책 스키마 검사는 조회형 목록에 변경 계열이 섞이지 않았는지 본다 — 초안의 `/^d1 execute|deploy|…/`는 **교대 우선순위 탓에 `^`가 첫 항목에만 걸려** `deployments list`가 `deploy`에 부분 매치됐고, 각 항목을 앵커+단어경계로 고쳤다.

---

## 5. 남은 트랙

| | 최근14일 | |
|---|---|---|
| `git-commit` | 416 | 규약 조치 완료 — 발생분 감소 관찰 |
| `migration` 오탐 | 93 | 래퍼 안 언급이라 B4와 같은 어려움 |
| `move-rename` | 78 | **정당한 게이트**(실행 90.5%) — 손댈 것 없음 |
| B4 heredoc 오탐 | 6 | 실행 우회 위험으로 보류 |
| 원격 쓰기 SQL | 20 | **정당한 게이트** |

---

## 6. L2 반영

codex ∥ gemini 3라운드(T3 패널). R1 8쟁점(codex 5 · gemini 3, gemini는 verdict=pass) → R2 합의 3 · 심화 1 → R3 에스컬레이션 1.

### 합의 반영 (3건)

| id | severity | 제기 | 반영 |
|---|---|---|---|
| `455cf4e1` | **blocker** | 핵심 안전장치인 다중문장 판별 함수가 정의되지 않아 같은 보안 의미로 재현 불가 — SQLite 인용·이스케이프 규칙 미명시 | **함수 본문을 §2에 전재**하고 인용 4종(`'…'` 이스케이프 `''` · `"…"` · `` `…` `` · `[…]`)을 인지하도록 구현 보강. **미인식 시 게이트 방향**임과 미종결 인용은 실행되지 않음을 명시 |
| `1d3b1d35` | important | PRAGMA 허용 목록이 열거되지 않아 쓰기·부작용 PRAGMA가 섞이는지 검증 불가 | **23종 전체를 §2에 열거** |
| `b83b456f` | important | `WITH`만 DML을 차단하고 top-level `SELECT`는 무조건 허용해 보장이 과장 | **읽기 시작 문장 전체에 DML 구문·위험 함수 검사 적용**(`D1_DML_STMT`·`D1_DANGER_FN`). 키워드 단독이 아니라 **구문 형태**로 판정해 `attach_url`·`replace(...)` 오탐을 피했고, 실측 완화 건수는 그대로였다. 회귀 5종 추가 |

### 대표 에스컬레이션 (1건) — 판정

**`11914eda`** (codex **blocker** / gemini refute) — *원격 읽기 완화가 외부 API 비용·권한 게이트를 대체할 근거가 없다*

→ **refuted 유지.** MAIA 게이트는 **되돌릴 수 없는 변경**을 막는 장치이지 비용·권한·데이터 접근을 관리하는 도구가 아니다. Cloudflare API 토큰의 권한 범위와 과금은 플랫폼 층에서 관리되며, 본 패치는 그것을 대체한다고 주장하지 않는다. 안전 감사에서 변경 계열 완화가 0건임을 확인했다.

다만 codex 지적의 실질 — **프로덕션 데이터를 읽는 행위 자체가 정보 노출**이라는 점 — 은 유효하다. 이는 [[2026-09-01-wrangler-read-subcommand-spec]] §2에서 1안(보류)을 택할 때 이미 논의됐고, 최근 14일 실측(단일 읽기 95.6% · 다중문장 0.4%)을 근거로 **대표 결정으로 허용 범위에 넣었다**. 게이트가 아니라 대표 판단이 결정한 사안이므로 spec이 추가로 정당화할 것은 없다.

리뷰 원본: [[2026-09-01-d1-read-sql-spec-l2-aggregation-20260901-105350]] · [[2026-09-01-d1-read-sql-spec-l2-deepen-r2-20260901-105350]] · [[2026-09-01-d1-read-sql-spec-l2-deepen-r3-20260901-105350]]
