# spec — T2 계층 옵션 접두 우회 수정 (엔진 + 규칙)

- 날짜: 2026-09-07
- 상태: 검증 완료 · **대표 판정 대기**
- 배경: [git clean 등급 분리 spec](./2026-09-07-git-clean-t2-separation-spec.md) §3 에서 발견된 T2 계층 결함. 그 spec 의 후속 §10-①(정공법)
- 하네스: `~/p1c/candidates/head-scan-fix/`

---

## 1. 무엇이 뚫려 있었나

T2 규칙은 `headCmd`(헤드 축약 텍스트)로 판정된다(`risk-classify.js:819`). 그 축약이 **옵션 접두가 붙은 명령에서 규칙을 통째로 불발**시킨다. DENY·T3 는 원문(`scanCmd`)을 보므로 영향이 없다 — **T2 계층만 감염돼 있었다.**

실측:

| 명령 | 헤드 텍스트 (규칙이 보는 것) | 결과 |
|---|---|---|
| `git --git-dir=/tmp/r/.git commit -m x` | `git _ commit -m x` | **T1** ⛔ |
| `git -c a=b -c c=d commit -m x` | `git -c a=b -c c=d ` | **T1** ⛔ |
| `npm --prefix /tmp --loglevel warn install lodash` | `npm --prefix _ --loglevel warn ` | **T1** ⛔ |

### 기전은 셋이다 — 원인이 서로 다르다

**① 경로형 옵션의 형태 소실 (엔진)**
`headTokens`(`:471`)가 경로형 토큰을 `_` 로 치환한다. `--git-dir=/tmp/r/.git` 이 `_` 가 되는 순간 **옵션이라는 형태가 사라져**, 규칙의 접두 관용구 `(?:-[a-zA-Z]\s+\S+\s+|-{1,2}\S+\s+)*` 가 그 자리를 소비하지 못한다. `-C /tmp/r` 은 `-C` 가 대시로 남아 살아남았다 — 그래서 이 결함이 오래 안 보였다.

**② 4토큰 상한이 서브커맨드를 자른다 (엔진)**
`kept.length >= 4` 는 **옵션도 인자로 센다.** `-c a=b -c c=d` 가 네 슬롯을 다 먹으면 `commit`·`clean` 자체가 헤드에 없다. 규칙이 볼 수조차 없다.

**③ 규칙에 접두 관용구가 없다 (정책)**
git 계열 규칙은 접두 관용구를 갖췄지만 `pkg-install`·`bulk-edit` 은 없다. 이 둘은 **원문에서조차** miss 다 — 엔진과 무관한 별개 결함이다.

```
pkg-install  (npm|pnpm|yarn)\s+(install|add|i)\b|…      ← 접두 자리 없음
bulk-edit    \b(sed|perl)\s+-i\b|find\s[^\n]*-(delete|exec)  ← 접두 없음 + 결합형(-ni)·롱폼(--in-place) 누락
```

전 규칙 조사 결과 접두 우회가 가능한 것은 이 **2개**다(나머지는 관용구가 있거나 형태상 무관).

---

## 2. 실사용 빈도 — 잠복이다, 그러나 이연하지 않는다

경로형 롱옵션 접두 + 게이트 대상 서브커맨드 형태: 코퍼스 **0/40,644**.

> 같은 날 `clean.requireForce` 우회도 실사용 0 이었고 **보고 몇 분 만에 실행되어 파일을 삭제했다.** 빈도 0 은 위험 0 이 아니라 아직 안 밟았다는 뜻이다. 파괴적 명령의 위험은 빈도가 아니라 가역성이 정한다.

다만 ②·③ 은 잠복이 아니었다 — 실사용에서 실제로 새고 있었다(§4 참조).

---

## 3. 설계

### 엔진 (`risk-classify.js`)

```js
// 전
const kept = []
for (const t of toks.slice(1)) { kept.push(HEAD_PATHISH(t) ? '_' : t); if (kept.length >= 4) break }

// 후
const kept = []
let n = 0
for (const t of toks.slice(1)) {
  kept.push(blankHeadTok(t))        // ① 옵션은 형태 보존, 값만 비움
  if (!/^-/.test(t)) n++            // ② 상한은 실인자만 센다
  if (n >= 4 || kept.length >= 16) break
}
```

`blankHeadTok` — `--git-dir=/p/.git` → `--git-dir=_` / `/p/.git` → `_`. 경로 내용은 지우되 옵션 형태는 남긴다.

②는 **선행 옵션을 파싱하지 않는다.** 처음엔 옵션 토큰과 그 값을 건너뛰는 루프로 짰는데, 롱옵션의 분리된 값(`--prefix /tmp`)에서 판단이 갈려 `npm --prefix /tmp --silent --no-audit --no-fund install` 이 다시 샜다. "실인자만 센다"로 바꾸니 파싱 없이 해결된다 — 원래 의도(실인자 4개)는 그대로 두고 **무엇을 인자로 셀지만** 바로잡는다. 총 길이 상한 16 토큰으로 헤드가 무한정 길어지는 것은 막는다.

### 규칙 (`decision-policy.json`)

접두 관용구를 넣는다. 기존 두 관용구로는 부족해 **새 관용구**를 쓴다 — 둘 다 롱옵션의 분리된 값을 넘지 못하기 때문이다(실측 miss):

```
git-commit        (?:-c\s+\S+\s+|-{1,2}\S+\s+)*         → `-c <값>` 만
gate-destructive  (?:-[a-zA-Z]\s+\S+\s+|-{1,2}\S+\s+)*  → 한 글자 옵션만
신규              (?:-{1,2}\S+(?:\s+[^-\s]\S*)?\s+)*     → 롱옵션 + 분리된 값
```

`bulk-edit` 은 추가로 in-place 결합형(`-ni`·`-Ei`·`-i.bak`)과 롱폼(`--in-place`)을 잡는다. 결합 플래그 관용구 `-[a-zA-Z]*i[a-zA-Z]*\b` 는 `gate-destructive` 의 f 형과 동형(검증된 패턴 복제).

### ⚠️ 함께 고치는 것 — `find` 절 정밀화

엔진을 고치면 `bulk-edit` 의 `find\s[^\n]*-(delete|exec)` 절이 규칙대로 발화하는데, **실사용에서 새로 걸리는 6건이 전부 `find … -exec stat` 류 읽기전용**이었다. 안전 이득 0 에 모달만 6건 — 실측 모달 거부율 0.030% 를 생각하면 순수 마찰이다. 그래서 읽기전용 `-exec` 대상을 화이트리스트로 면제한다:

```
find\s[^\n]*-delete\b|find\s[^\n]*-exec(?!\s+(?:stat|ls|cat|head|tail|file|wc|echo|grep|…)\b)
```

**화이트리스트(blocklist 아님)** 라 열거되지 않은 모든 `-exec` 대상(`sh`·`bash`·`rm`·`mv`·`chmod`…)은 그대로 게이트된다. find 절의 폭은 이 패치가 넓힌 것이 아니라 원래 그랬고, 헤드 절단이 가려주던 것이 드러났을 뿐이다.

---

## 4. 검증

### A. 구멍 폐쇄 — 19형태 전부 게이트 ✅

엔진① 4형태(`--git-dir`·`--work-tree`·`--exec-path` 조합) · 엔진② 3형태(`-c` 다중, 훅 우회 `core.hooksPath=/dev/null` 포함) · 혼합 1 · 규칙 npm 4 · sed/perl 3 · find 파괴형 4(`-delete`·`-exec rm`·`-exec sh`·`-exec chmod`).

### B. 오탐 불재발 — 23형태 전부 자유 유지 ✅

`risk-classify.js` 주석이 근거로 든 실측 사례를 전부 포함한다 — **여기가 진짜 관문**이다(헤드를 길게 만드는 패치라서):

| 케이스 | 주석의 근거 |
|---|---|
| `node "/tmp/x.js"` | 인용 제거 시 인자없는 REPL 오인 — **실측 강화 58건** |
| `ls "D:\…\migrations\"` | Windows 경로 끝 백슬래시 파싱 붕괴 — **실측 강화 15건** |
| `codex exec --add-dir "$(pwd)" "…migration…"` | 치환 섞인 프롬프트 — **실측 강화 1건** |
| `python3 -m http.server` | `http.server` 를 경로로 오인 |

추가로 `npm run install-deps`·`pnpm run add-agent`(스크립트명에 install/add), `sed -n`·`perl -ne`(비 in-place), 읽기전용 `find -exec` 3형태.

### C. 고정 코퍼스 전수 — 40,644 고유 명령

```
강화 · 미탐 해소(의도)   2   ← git-commit 1 · sed/perl in-place 1
강화 · 오탐 재발(부작용)  0 ✅
완화                     3   ← 전부 읽기전용 find -exec (grep·cat), 의도된 정밀화
```

**오탐 재발 0** 이 이 패치의 핵심 근거다.

미탐 해소 2건은 실제 실행이었다:
- `git -c user.email=… -c user.name=… commit -q --allow-empty` — 이 세션의 임시 repo 커밋(기전 ②로 커밋 게이트를 빠져나가고 있었다)
- `perl -0777 -i -pe 's/…'` — BC 의 진짜 in-place 편집(`-0777` 접두로 새고 있었다)

완화 3건은 원문을 눈으로 확인했다 — `-exec grep`, `-exec grep -l`, `-exec cat`. 전부 읽기전용.

> **이득을 부풀리지 않기 위한 주의**: 초기 집계는 미탐 해소를 8건으로 보고했다. 뜯어보니 6건이 `find -exec stat` 류 **읽기전용**이었다 — 미탐 해소가 아니라 새 마찰이다. find 절 정밀화로 그 6건을 걷어내고 나니 실제 안전 이득은 **2건**이다. 규칙이 발화한다고 다 이득은 아니다.

### D. 기존 시험군 — 패치본으로 재실행 ✅

```
risk-classify.test.js      237 passed, 0 failed
gate-classify(destructive)  81 pass,   0 fail
policy-classify.test.js     53 pass,   0 fail
```

---

## 5. 잔여 위험

| 위험 | 판단 |
|---|---|
| 헤드가 길어져 못 본 오탐이 생길 수 있다 | 코퍼스 40,644 전수에서 오탐 재발 0. 다만 **코퍼스는 과거다** — 새 명령 형태는 담기지 않는다. 롤백 경로를 남긴다 |
| 새 관용구가 검증 이력이 짧다 | 기존 관용구로는 롱옵션 분리값을 못 넘어 불가피했다. 과잉 매칭은 `npm run install-deps`·`pnpm run add-agent` 등으로 확인 |
| find 화이트리스트 열거가 불완전 | **화이트리스트라 미열거는 게이트 쪽으로 떨어진다**(fail-safe). 조회 명령이 빠지면 마찰이 남을 뿐 구멍이 되지 않는다 |
| ①은 실사용 0건이라 효과 미검증 | 순수 예방. `requireForce` 선례대로 빈도를 이연 근거로 쓰지 않는다 |
| 총 길이 상한 16토큰 | 임의값이다. 실측 근거 없음 — 무한정 길어지는 것만 막는 안전판 |

---

## 6. 적용

엔진(`risk-classify.js` = `gate-self-classifier` T3)과 정책(`decision-policy.json` = `gate-self-policy` T3) 둘 다 대표 결재 대상이다.

```bash
node ~/p1c/candidates/head-scan-fix/apply.js --check
node ~/p1c/candidates/head-scan-fix/apply.js --apply
node ~/.ai-bootstrap/risk-classify.test.js        # 237 기대
node ~/.ai-bootstrap/gate-destructive.test.js     # 81 기대
node ~/.ai-bootstrap/policy-classify.test.js      # 53 기대
node ~/.ai-bootstrap/maia-deploy.js               # Windows 동기
```

⚠️ 이 명령들은 게이트상 **T1 이라 막히지 않는다**([git clean spec §5](./2026-09-07-git-clean-t2-separation-spec.md#5)). 대표 판정 없이 실행하지 않는 것은 정책 의도를 존중하는 선택이지 기술적 강제가 아니다.

롤백: `apply.js --rollback` — 엔진·정책 동시 복원.

---

## 7. 후속

- **`clean.requireForce` 우회** — 이 패치로 안 막힌다(탐지 조건 문제). 실사고 발생분
- **정책 자가적용 강제력 공백** — `node apply.js --apply` 가 T1
- **`git clean` 보상 통제 제거** — 이 패치가 착지하면 [git clean spec](./2026-09-07-git-clean-t2-separation-spec.md) 의 `+` 수량자를 걷어내고 평문 (나) 로 수렴시킬 수 있는지 재검증
- **L2 상대경로 오배달** — 리뷰가 `wiki/projects/multiagent/` 로 감
