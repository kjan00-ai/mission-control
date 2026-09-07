# spec — T2 계층 옵션 접두 우회 수정 (엔진 + 규칙)

- 날짜: 2026-09-07
- 상태: **v0.2 — L2 blocker 반영해 ② 설계 교체. 검증 완료 · 대표 판정 대기**
- 배경: [git clean 등급 분리 spec](./2026-09-07-git-clean-t2-separation-spec.md) §3 에서 발견된 T2 계층 결함 (그 spec §10-① 정공법)
- 하네스: `~/p1c/candidates/head-scan-fix/`
- L2: round 1~3 (claude ∥ gemini, `evidenceEligible=true`) — **blocker 1 + important 4 확증**, 전건 반영

---

## 1. 무엇이 뚫려 있었나

T2 규칙은 `headCmd`(헤드 축약)로 판정된다(`risk-classify.js:819`). DENY·T3 는 원문(`scanCmd`)을 보므로 면역이고 — **T2 계층만 감염돼 있었다.**

| 명령 | 헤드 텍스트 (규칙이 보는 것) | 결과 |
|---|---|---|
| `git --git-dir=/tmp/r/.git commit -m x` | `git _ commit -m x` | **T1** ⛔ |
| `git -c a=b -c c=d commit -m x` | `git -c a=b -c c=d ` | **T1** ⛔ |
| `npm --prefix /tmp --loglevel warn install lodash` | `npm --prefix _ --loglevel warn ` | **T1** ⛔ |

### 기전 셋 — 원인이 다르다

**① 경로형 옵션의 형태 소실 (엔진)** — `headTokens`(`:471`)가 경로형 토큰을 `_` 로 치환한다. `--git-dir=/tmp/r/.git` 이 `_` 가 되면 **옵션이라는 형태가 사라져** 규칙의 접두 관용구가 그 자리를 소비하지 못한다. `-C /tmp/r` 은 `-C` 가 대시로 남아 살아남았고, 그래서 이 결함이 오래 안 보였다.

**② 상한이 서브커맨드를 자른다 (엔진)** — `kept.length >= 4` 는 **옵션도 인자로 센다.** `-c a=b -c c=d` 가 네 슬롯을 먹으면 `commit` 이 헤드에 없다.

**③ 규칙에 접두 관용구가 없다 (정책)** — `pkg-install`·`bulk-edit` 은 **원문에서조차** miss 다. 전 규칙 조사 결과 이 2개뿐이다.

---

## 2. 🚩 v0.1 의 ② 설계는 폐기됐다 (L2 blocker `7ceb83f4`·`d46bc00b`)

v0.1 은 ②를 이렇게 고쳤다: **"대시로 시작하지 않는 토큰만 실인자로 센다."**

**틀렸다.** 옵션의 **분리된 값**(`a=b`·`/tmp`·`warn`)도 대시로 시작하지 않는다 → 값 4개만 앞세우면 서브커맨드가 다시 잘린다. 총 길이 상한 16 도 같은 문제를 임계값만 올려 재생산한다.

실측 (v0.1 = V12):

| 형태 | v0.1 |
|---|---|
| `git -c a=b -c c=d commit -m x` (검증에 있던 형태) | T2 ✅ |
| **`git -c a=b -c c=d -c e=f -c g=h commit -m x`** | **T1** ⛔ |
| **값 없는 롱플래그 16개 + `commit`** | **T1** ⛔ |
| **`npm --a v1 --b v2 --c v3 --d v4 install`** | **T1** ⛔ |

내 검증은 `-c` 쌍을 **2개까지만** 넣어서 이걸 놓쳤다. claude 가 먼저 제기하고 gemini 가 corroborate 했다.

### 상한을 없애면 되는가 — 아니다 (실측)

상한 자체를 폐지해 봤다(V3). **오탐 37건 재발**: migration 16 · remote-run 10 · pkg-install 4 · infra 2 · move-rename 2 · interactive 2 · process-kill 1. **상한은 실제로 일하고 있다** — 원래 설계 의도가 실측으로 입증됐다.

그러니 답은 상한 폐지가 아니라 **무엇을 인자로 셀지 바로잡기**다.

---

## 3. 설계 v0.2

### 엔진 (`risk-classify.js`) — 옵션과 값을 짝지어 세지 않는다

```js
// 전
const kept = []
for (const t of toks.slice(1)) { kept.push(HEAD_PATHISH(t) ? '_' : t); if (kept.length >= 4) break }

// 후
const kept = []
let n = 0, expectValue = false
for (const t of toks.slice(1)) {
  kept.push(blankHeadTok(t))                       // ① 옵션은 형태 보존, 값만 비움
  if (/^-/.test(t)) { expectValue = !/=/.test(t) } // 옵션 — 세지 않는다. `=` 없으면 다음이 값
  else if (expectValue) { expectValue = false }    // 그 옵션의 값 — 세지 않는다
  else if (++n >= 4) break                         // 진짜 인자만 센다
}
```

`blankHeadTok`: `--git-dir=/p/.git` → `--git-dir=_` / `/p/.git` → `_`. 경로 내용은 지우되 옵션 형태는 남긴다.

**총 길이 상한은 두지 않는다.** 어떤 개수 상한이든 패딩으로 넘을 수 있고(`d46bc00b`), 상한이 막는 것은 미탐이 아니라 **오탐뿐**이라 실인자 상한(4)만으로 충분하다 — 그 판단은 §4-C 코퍼스 실측이 뒷받침한다.

### 규칙 (`decision-policy.json`)

**접두 관용구 신설.** 기존 두 관용구는 롱옵션의 **분리된 값**을 넘지 못한다(실측 miss):

```
git-commit        (?:-c\s+\S+\s+|-{1,2}\S+\s+)*         → `-c <값>` 만
gate-destructive  (?:-[a-zA-Z]\s+\S+\s+|-{1,2}\S+\s+)*  → 한 글자 옵션만
신규              (?:-{1,2}\S+(?:\s+[^-\s]\S*)?\s+)*     → 롱옵션 + 분리된 값
```

**`bulk-edit` in-place 플래그 — 결합 관용구를 복제하면 안 된다 (L2 `25db6235`).**
`gate-destructive` 의 `-[a-zA-Z]*f[a-zA-Z]*\b` 를 i 에 그대로 옮기면 **오탐한다**: 엔진이 규칙을 `/i` 로 컴파일하므로 `[a-zA-Z]` 가 대문자도 먹어 perl 의 `-Ilib`(include 경로)가 in-place 로 잡힌다. f 는 대문자 동음 플래그가 없어 문제가 없었을 뿐이고, **"검증된 패턴이니 이전된다"는 논거가 성립하지 않는다.** 그래서 명시 열거한다:

```
(?:--in-place\b|-i\b|-i\.\S*|-(?:[a-z]i|i[a-z])\b)
```

`-i\b` 는 `-Ilib` 에 매치되지 않는다(i 뒤 단어경계 없음). 잔여: `perl -Il` 같은 2글자 include 는 여전히 매치된다 — 희귀하고 마찰 방향이라 수용.

### `find` 절 정밀화 — 함께 고치는 이유

엔진을 고치면 `bulk-edit` 의 `find\s[^\n]*-(delete|exec)` 절이 규칙대로 발화하는데, 실사용에서 새로 걸리는 **6건이 전부 `find … -exec stat` 류 읽기전용**이었다. 안전 이득 0 에 모달만 6건 — 실측 모달 거부율 0.030% 를 생각하면 순수 마찰이다.

읽기전용 `-exec` 대상을 화이트리스트로 면제한다. **전체 18개를 여기 열거한다** (L2 `1833ba10`: T3 결재 대상이 `…` 로 생략되면 승인 범위를 spec 만으로 감사할 수 없다):

```
stat  ls  cat  head  tail  file  wc  echo  grep  egrep
fgrep  md5sum  sha256sum  basename  dirname  readlink  du  printf
```

```
find\s[^\n]*-delete\b|find\s[^\n]*-exec(?!\s+(?:<위 18개>)\b)
```

**화이트리스트(blocklist 아님)** 라 열거되지 않은 모든 `-exec` 대상(`sh`·`bash`·`rm`·`mv`·`chmod`…)은 그대로 게이트된다 — 목록에서 빠진 조회 명령은 마찰이 남을 뿐 구멍이 되지 않는다(fail-safe). find 절의 폭은 이 패치가 넓힌 것이 아니라 원래 그랬고, 헤드 절단이 가려주던 것이 드러났을 뿐이다.

---

## 4. 검증

### A. 구멍 폐쇄 — 스모크 45건 PASS ✅

엔진①(`--git-dir`·`--work-tree`·`--exec-path`) · 엔진②(`-c` 다중, `core.hooksPath=/dev/null` 훅 우회) · **패딩 내성 5형태**(`-c` 쌍 4·6개, 값 없는 롱플래그 20개, npm 값 4·6개 — v0.1 이 뚫렸던 자리) · 규칙(npm 옵션 2·4개, pnpm `--filter`, yarn `--cwd`, `sed --in-place`, `sed -ni`, `perl -0777 -i`) · find 파괴형(`-delete`·`-exec rm`·`-exec chmod`).

### B. 오탐 불재발 ✅

`risk-classify.js` 주석이 근거로 든 실측 사례를 전부 포함한다 — **헤드를 길게 만드는 패치라 여기가 진짜 관문이다**:

| 케이스 | 근거 |
|---|---|
| `node "/tmp/x.js"` | 인용 제거 시 인자없는 REPL 오인 — **실측 강화 58건** |
| `ls "D:\…\migrations\"` | Windows 경로 끝 백슬래시 파싱 붕괴 — **실측 강화 15건** |
| `codex exec --add-dir "$(pwd)" "…migration…"` | 치환 섞인 프롬프트 — **실측 강화 1건** |
| `python3 -m http.server` | `http.server` 를 경로로 오인 |

추가: `perl -Ilib`·`perl -Ilib -Mstrict`(L2 지적분), `npm run install-deps`·`pnpm run add-agent`, `sed -n`·`perl -ne`·`sed -E`, 읽기전용 `find -exec` 3형태.

### C. 고정 코퍼스 전수 — 40,707 고유 명령

```
강화 · 미탐 해소(의도)   3   ← git-commit 1 · bulk-edit 2
강화 · 오탐 재발(부작용)  0 ✅
완화                     3   ← 전부 읽기전용 find -exec (grep·cat), 의도된 정밀화
```

**오탐 재발 0** 이 이 패치의 핵심 근거다. 미탐 해소 3건은 실제 실행이었다:

- `git -c user.email=… -c user.name=… commit -q --allow-empty` — 이 세션의 임시 repo 커밋(기전 ②로 새고 있었다)
- `perl -0777 -i -pe 's/…'` — BC 의 진짜 in-place 편집(`-0777` 접두로 새고 있었다)
- `find /tmp -maxdepth 1 -name 'l2bus-e2e.*' -type d -exec rm -r {} +` — 진짜 재귀 삭제

완화 3건은 원문을 눈으로 확인했다 — `-exec grep`, `-exec grep -l`, `-exec cat`. 전부 읽기전용.

> **이득을 부풀리지 않기 위한 기록**: 초기 집계는 미탐 해소를 8건으로 보고했다. 뜯어보니 6건이 `find -exec stat` 류 **읽기전용**이었다 — 미탐 해소가 아니라 새 마찰이다. find 절 정밀화로 걷어내고 나니 실제 안전 이득은 3건이다. **규칙이 발화한다고 다 이득은 아니다.**

### D. 기존 시험군 — 패치본으로 재실행 ✅

```
risk-classify.test.js      237 passed, 0 failed
gate-destructive.test.js    81 pass,   0 fail
policy-classify.test.js     53 pass,   0 fail
```

---

## 5. 잔여 위험

| 위험 | 판단 |
|---|---|
| 헤드가 길어져 못 본 오탐 | 코퍼스 40,707 전수에서 오탐 재발 0. 다만 **코퍼스는 과거다** — 새 명령 형태는 담기지 않는다. 롤백 경로를 남긴다 |
| 총 길이 상한 없음 | 의도적이다(§3). 상한은 미탐이 아니라 오탐만 막고, 어떤 상한이든 패딩으로 넘긴다. 병리적으로 긴 명령은 헤드도 길어지나 경로·인용문이 이미 비워져 있다 |
| 새 접두 관용구의 검증 이력이 짧다 | 기존 관용구로는 롱옵션 분리값을 못 넘어 불가피. 과잉 매칭은 `npm run install-deps`·`pnpm run add-agent` 로 확인 |
| `perl -Il` 2글자 include | 매치된다(마찰 방향). 희귀해 수용 |
| find 화이트리스트 열거 불완전 | **화이트리스트라 미열거는 게이트 쪽으로 떨어진다**(fail-safe) |
| ①은 실사용 0건이라 효과 미검증 | 순수 예방. `requireForce` 선례대로 빈도를 이연 근거로 쓰지 않는다 |

---

## 6. 적용

엔진(`risk-classify.js` = `gate-self-classifier` T3)·정책(`decision-policy.json` = `gate-self-policy` T3) 둘 다 대표 결재 대상이다.

```bash
node ~/p1c/candidates/head-scan-fix/apply.js --check    # 스모크 45 + 시험군 재실행
node ~/p1c/candidates/head-scan-fix/apply.js --apply
node ~/.ai-bootstrap/maia-deploy.js                     # Windows 동기
```

**롤백은 Windows 동기까지 수행한다** (L2 `880850db`): 이전 판은 WSL canonical 만 되돌려 Windows 물리복사본과 조용히 분기했다. `apply.js --rollback` 이 복원 후 `maia-deploy.js` 를 직접 호출하고, 실패하면 분기 상태임을 명시하며 비정상 종료한다.

⚠️ 이 명령들은 게이트상 **T1 이라 막히지 않는다**([git clean spec §5](./2026-09-07-git-clean-t2-separation-spec.md)). 대표 판정 없이 실행하지 않는 것은 정책 의도를 존중하는 선택이지 기술적 강제가 아니다.

---

## 7. L2 처리 내역

| id | 등급 | 지적 | 처리 |
|---|---|---|---|
| `7ceb83f4` | blocker | ②가 안 막혔다 — 옵션의 분리된 값이 실인자로 계상돼 재차 절단 | **설계 교체**(§3 옵션·값 짝짓기), 패딩 스모크 5형태 추가 |
| `d46bc00b` | important | 16토큰 상한은 임계값만 올려 같은 구멍 재생산 | **총 길이 상한 폐지**. 상한 폐지의 오탐 영향은 V3 실측으로 별도 확인(37건) 후 인자 상한만 유지 |
| `25db6235` | important | 결합 관용구가 `/i` 때문에 `perl -I` 오탐 | **명시 열거로 교체**, 오탐 케이스 3건 검증에 추가 |
| `880850db` | important | 롤백이 Windows 복사본을 안 되돌림 | `--rollback` 이 `maia-deploy` 호출, 실패 시 비정상 종료 |
| `1833ba10` | important | 화이트리스트가 `…` 로 생략돼 승인 범위 감사 불가 | **18개 전부 §3 에 열거** |
| `7ba3d735` | blocker(refuted) | apply.js 가 없어 §6 절차가 근거 없다 | gemini refute 가 옳다 — claude 는 apply.js 작성 **전** spec 을 봤다. 현재 존재하며 `--check` 통과 |

---

## 8. 후속

- **`clean.requireForce` 우회** — 이 패치로 안 막힌다(탐지 조건 문제). 실사고 발생분
- **정책 자가적용 강제력 공백** — `node apply.js --apply` 가 T1
- **`git clean` 보상 통제 제거 검토** — 이 패치가 착지하면 [git clean spec](./2026-09-07-git-clean-t2-separation-spec.md) 의 `+` 수량자를 걷어내고 평문 (나) 로 수렴 가능한지 재검증
- **L2 상대경로 오배달** — 리뷰가 `wiki/projects/multiagent/` 로 감. 회피는 `MAIA_L2_PROJECT=mission-control`
