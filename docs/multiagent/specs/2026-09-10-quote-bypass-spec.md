# spec — 따옴표 우회 차단 (엔진 스캔 텍스트)

- 날짜: 2026-09-10
- 상태: **v0.2 — 라이브 적용 완료**(2026-09-13, 대표 `!`). v0.1 은 2026-09-12 적용분이며 L2 합의 4건이 열려 있었다 → §8
- 하네스: `~/p1c/candidates/quote-bypass/` (v0.1 `apply.js` · **v0.2 `apply2.js --check|--apply|--rollback`** · `measure.js`·`measure2.js` · `three-way.js` · `compose-check.js`)
- 발견 경로: [clean 게이트 반전 spec](./2026-09-07-clean-requireforce-bypass-spec.md) 의 L2 4차 blocker `2e1fc2e6` → 실측으로 범위가 전 규칙으로 확대

---

## 1. 구멍 — 한 글자로 게이트 전체가 열린다

하위명령(또는 명령 자체)을 따옴표로 감싸면 **모든 명령 규칙이 불발한다.** DENY 층도 예외가 아니다.

| 명령 | 라이브 등급 |
|---|---|
| `git clean -fd` | T2 |
| `git "clean" -fd` | **T1 (자율 실행)** |
| `git reset --hard` | DENY |
| `git "reset" --hard` | **T1** |
| `git checkout -- .` | DENY |
| `git "checkout" -- .` | **T1** |
| `git rebase -i HEAD~3` | DENY |
| `git "rebase" -i HEAD~3` | **T1** |
| `rm -rf /tmp/x` | DENY |
| `"rm" -rf /tmp/x` | **T1** |

홑따옴표 · 토큰 내부 따옴표(`cl""ean`) · 백슬래시(`\clean`) · 명령 자체(`"git" clean -fd`) 전부 같다.

**격리 repo 실동작 확증** — `git "clean" -fd` 는 게이트 T1 을 통과하고 작업물을 전부 삭제한다. 셸이 따옴표를 벗겨 git 에게 `clean` 으로 넘기기 때문이다.

### 노출은 잠복형이다

코퍼스 41,339 고유 명령에서 따옴표로 감싼 **명령/하위명령** 실사용은 사실상 0 이다(따옴표-머리 39건은 전부 `cd "경로"` 형태). `clean.requireForce` 와 같은 패턴이다 — **빈도 0 은 위험 0 이 아니라 아직 안 밟았다는 뜻**이고, 그때는 발견 몇 분 만에 밟혔다.

---

## 2. 원인 — 규칙 52개가 아니라 스캔 텍스트 한 곳

분류기는 두 갈래 스캔 텍스트를 만든다(`dangerScanText`=DENY·T3 / `headScanText`=T2). **둘 다 따옴표를 원문 그대로 둔다.** 원문 보존은 서브셸 우회를 잡으려는 의도적 설계였는데, 정작 **토큰을 쪼개는 따옴표**가 사각으로 남았다.

T2 쪽은 한 겹 더 있다. `headOfSegment` 는 헤드를 만들기 전에 인용문을 통째로 `_` 로 **치환**한다:

```js
const stripped = lead.replace(/\$\([^()]*\)/g, ' _ ').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ' _ ')
```

`git "clean" -fd` → `git _ -fd`. 내용이 사라지므로 **사후 보정으로는 복구되지 않는다** — 벗기려면 원문 단계에서 벗겨야 한다. (이 치환 자체는 없애면 안 된다. `node "/tmp/x.js"` 가 헤드 `node` 로 줄어 interactive 규칙에 걸리는 오탐 58건을 막는 장치다.)

---

## 3. 설계 — 벗긴 형태를 **추가로** 검사한다

```
[변경 전]  규칙 ← 원문 스캔텍스트
[변경 후]  규칙 ← 원문 스캔텍스트  OR  따옴표를 벗긴 스캔텍스트
```

원문 검사를 **그대로 두고 주체를 늘리기만** 한다. 그래서 이 패치로 등급이 **낮아지는 명령은 원리적으로 없다** — 완화 회귀가 설계상 불가능하다(주장이 아니라 OR 의 성질이다).

### 벗기는 범위를 좁힌다 — 공백 없는 토큰을 감싼 따옴표만

```js
function dequoteCmd(s) {
  if (!s || !/['"\\]/.test(s)) return null
  const out = String(s)
    .replace(/\\(?=[A-Za-z])/g, '')
    .replace(/"([^"\s\\]*)"|'([^'\s]*)'/g, (m, a, b) => (a !== undefined ? a : b))
  return out === s ? null : out
}
```

| 입력 | 결과 | 이유 |
|---|---|---|
| `git "clean" -fd` | `git clean -fd` | 토큰을 쪼개는 따옴표 → 벗긴다 |
| `cl""ean` | `clean` | 토큰 내부 따옴표 |
| `echo "hello world"` | 그대로 | **공백 포함 = 진짜 인자** |
| `ls -la "/tmp/some dir"` | 그대로 | 공백 경로 |
| `node -e "console.log(1)"` | payload 유지 | 래퍼 payload 규율 불변 |

벗긴 원문을 **같은 스캔 경로**(`dangerScanText`·`headScanText`)에 한 번 더 태운다. 마스킹·blankArgs·데이터싱크 규율이 그대로 적용되므로 기존 오탐 방어가 유지된다.

`$`·백틱(치환)은 건드리지 않는다 — 치환은 이미 다른 보수 규칙의 소관이고, 정적으로 펼칠 수 없다(§5).

---

## 4. 검증

### A. 스모크 20건 PASS ✅

우회 14형태(따옴표 3종 × clean/reset/checkout/rebase/rm, 명령 자체 따옴표, 접두 결합, 체인 뒤) 전부 게이트. 오탐 감시 6건(조회·공백 인자·공백 경로·따옴표 패턴·payload) 전부 등급 불변.

### B. 고정 코퍼스 전수 — 41,412 고유 명령

```
등급 상승   0 ✅   ← 기존 이력에 오탐 0. 순수 예방 패치다
등급 하락   0 ✅   ← 설계상 불가능한 방향이 실측으로도 0
```

실사용 이력에 **영향이 전혀 없다.** 닫는 것은 아직 밟지 않은 형태뿐이다.

> ⛔ **이 측정은 틀렸다**(2026-09-13 정정). 기준선을 *패치 이전 엔진*이 아니라 다른 것으로 잡아 상승을 못 봤다. `three-way.js` 로 **패치 직전 백업(`risk-classify.js.bak-quote-bypass`)을 실제 기준선으로 놓고** 다시 재면 **v0.1 은 224건을 T1→T2 로 올린다**(하락은 실제로 0). 원인·후속은 §9. 교훈: 완화든 강화든 **기준선은 "패치 직전 그 파일"이어야 한다** — 재현 가능한 백업을 기준선으로 고정하지 않으면 "영향 0" 은 측정이 아니라 희망이다.

### C. 기존 시험군 ✅

`risk-classify` 237 · `gate-destructive` 81 · `policy-classify` 53 — 전부 통과.

### D. 영구 회귀 가드 — 81 → 87건

따옴표 6형태(겹·홑·내부·백슬래시·명령 자체 + 공백 인자 오탐 감시)를 고정한다. 가드 패치본을 **샌드박스에서 실행해** 검증한 뒤 쓴다.

### E. 결합 검증 — `clean` 반전 패치와 함께 ✅

두 패치가 동시에 대기 중이고 **같은 시험 파일**을 편집한다. `compose-check.js` 로 확인: 네 앵커가 서로 겹치지 않고 각 1회 존재하며, 결합 상태에서 `git "clean" -n`(따옴표+드라이런)까지 T2 로 잡힌다. 적용 순서 의존성 없음.

---

## 5. 잔여 위험 — 이 패치가 닫지 **않는** 것

텍스트 게이트는 **간접화**를 원리적으로 못 닫는다. 실측(패치본 기준):

| 형태 | 패치 후 | 판단 |
|---|---|---|
| `S=clean; git $S -fd` | T1 ⛔ | 변수 간접 |
| `git $(printf clean) -fd` | T1 ⛔ | 명령치환 |
| `X=ean; git cl$X -fd` | T1 ⛔ | 부분 변수 |
| `git config alias.z "clean -fdx" && git z` | T1 ⛔ | alias 은닉(기지, 별건) |
| `echo <base64> \| base64 -d \| bash` | T1 ⛔ | 인코딩 |
| `eval "git clean -fd"` | T2 ✅ | eval 은 원문 유지 규율로 잡힌다 |
| `bash -c 'git clean -fd'` | T2 ✅ | 셸 래퍼는 원문 유지 |

**그래서 이 패치의 위협모델을 정직하게 적는다**: 막는 대상은 *적힌 그대로 실행되는 형태*다 — 에이전트가 무심코 쓰거나 편의로 따옴표를 두르는 경우. 작정한 우회를 막는 장치가 아니며, 그건 텍스트 게이트가 아니라 다른 층(실행 계측·사후 롤백)의 몫이다.

다만 닫는 값어치는 분명하다: 따옴표 형태는 **사전 준비가 필요 없고**(변수 설정도, alias 정의도, 인코딩도 없이) 그 자리에서 바로 실행되며, 실제로 DENY 층까지 관통한다.

---

## 6. 적용

```bash
node ~/p1c/candidates/quote-bypass/apply.js --check     # 스모크 + 시험군 + 가드 미리보기
node ~/p1c/candidates/quote-bypass/apply.js --apply     # 엔진+시험, 이어서 Windows 동기
node ~/.ai-bootstrap/gate-destructive.test.js           # 87/87 기대
```

롤백 `apply.js --rollback` — 적용 당시 해시와 대조해 **다른 트랙의 편집이 있으면 거부**한다(`--force` 로만 강행).

원자성의 실제 범위는 `clean` spec §7 과 같다: **엔진+시험 두 파일만** 원자적이고 Windows 동기는 다음 단계다. 실패 시 비정상 종료 + `maia-deploy.js --check` 로 드리프트 확인 후 수동 동기.

⚠️ `risk-classify.js` 는 **T3(게이트 SSOT)** 라 에이전트가 직접 편집할 수 없다. 적용은 `apply.js` 가 대신 쓰는데 그 실행 자체는 T1 이다 — 지금 이 변경을 통제하는 것은 게이트가 아니라 **대표 판정**이다(기지 항목, `clean` spec §8 과 동일).

---

## 7. 후속

- **간접화 일반**(변수·치환·인코딩) — 텍스트 게이트로는 못 닫는다. 실행 계측(PostToolUse commit SHA 포착)과 사후 롤백 쪽 트랙으로 귀속
- **alias 은닉** — alias *정의*를 보는 별개 규칙(기지, `clean` spec §8)
- **다른 규칙군의 같은 사각** — 이번 수정은 전 규칙에 일괄 적용된다. 다만 `test: 'path'` 규칙은 대상이 아니다(경로는 셸 인용 문제가 다름)

---

## 8. v0.2 — L2 합의 4건 반영 (2026-09-13 라이브)

v0.1 을 적용한 뒤 돌린 L2(`evidenceEligible: true`)가 round 2 에서 **4건을 합의(corroborated)** 로 올렸고, **전부 라이브에서 재현됐다.** 즉 v0.1 은 "적용 완료"였지만 구멍이 열린 채였다.

| L2 id | 등급 | 내용 | v0.1 라이브 실측 |
|---|---|---|---|
| `f4708c26` | blocker | `$'…'`·`$"…"`(ANSI-C/로케일 인용)도 셸이 똑같이 벗긴다 | `git $'reset' --hard` → **T1(allow)**. DENY 층 관통 |
| `5c4bfa05` | blocker | `branchAllow`/`trustedAllow` 의 `denyIfRe` veto 가 원문만 본다 | `git commit --"amend"` [feat/*] → **T1(allow)**. 히스토리 재작성이 자율 실행 |
| `2661b190` | important | 따옴표 제거가 인용 안에서 죽어 있던 메타문자(`;`·`&&`)를 되살려 없던 세그먼트 분할을 만든다 | `echo "a;rm"` → T2 오탐 |
| `fa4ab4a3` | important | 공백 없는 payload 는 dq 레인에서 마스킹 근거(따옴표)가 사라진다 | 〃 (같은 뿌리) |

`577c3bb3`(Windows 동기가 수용기준 밖) 도 합의였다 → v0.2 는 `apply2.js` 가 **적용 직후 `maia-deploy` 를 직접 호출**하고 실패 시 비정상 종료한다. 미합의 1건 `19b9bdb3`(T3 배포를 T1 스크립트가 한다)은 대표 에스컬레이션으로 남아 있다 — §6 의 기지 항목과 같은 사안.

### 수정 셋

1. **`$` 접두 인용도 벗긴다** — 셸 동작과 일치시킨다.
2. **인용 내용에 셸 메타문자가 있으면 벗기지 않는다.** 그 따옴표는 토큰을 쪼개는 게 아니라 메타문자를 *무력화*하는 장치다. 벗기면 셸이 하지 않는 분할을 만든다(`2661b190` 의 원인). 같은 수정이 payload 노출(`fa4ab4a3`)도 줄인다.
3. **veto 를 dq 주체에도 적용한다.** veto 는 안전장치라 **원문·제거본 둘 중 하나만 걸려도 거부**한다. 반대로 `requireRe`(허용 조건)는 원문만 본다 — 완화 방향으로는 넓히지 않는다.

```js
.replace(/\$?"([^"\s\\;&|<>()`$]*)"|\$?'([^'\s;&|<>()`$]*)'/g, ...)
```

### 검증 (적용 후 라이브)

```
스모크 19건            PASS   (ANSI-C 3 · veto 3 · v0.1 유지 5 · 오탐감시 8)
risk-classify         237/237
gate-destructive      107/107   ← 104 에서 +3 (ANSI-C 2 + 메타문자 오탐감시 1)
policy-classify        53/53
라이브 실증            11/11
maia-deploy 드리프트     0      (82 shared, 2 synced)
```

| 명령 | v0.1 | v0.2(라이브) |
|---|---|---|
| `git $'reset' --hard` | T1 | **DENY** |
| `git $'clean' -fd` / `git $"clean" -fd` | T1 | **T2** |
| `git commit --"amend" -m x` [feat/*] | T1(allow) | **T2** |
| `git commit --no-ver"ify" -m x` [feat/*] | T1(allow) | **T2** |
| `echo "a;rm"` · `echo "x&&rm"` | T2(오탐) | **T1** |
| `git "clean" -fd` · `git "reset" --hard` | T2 · DENY | 유지 |

적용 `node ~/p1c/candidates/quote-bypass/apply2.js --apply` · 롤백 `--rollback`(적용 당시 해시 대조, 다른 편집이 있으면 거부) · 백업 `.bak-quote-v2`.

---

## 9. 후속 — v0.1 이 만든 오탐 193건 (v0.3 트랙)

§4B 정정에서 드러난 건이다. `three-way.js`(기준선 = 패치 직전 백업) 실측:

```
코퍼스 41,633 고유 명령
라이브 v0.1 : 상승 224 · 하락 0
후보  v0.2 : 상승 193 · 하락 0     ← 193건 전부 v0.1 에서도 이미 상승 중
```

v0.2 는 오탐을 **31건 줄이지만**(메타문자 보존분) 나머지 193건은 남는다. 원인 규칙 집계:

| 규칙 | 건수 | 형태 |
|---|---|---|
| `migration` | **126** | `find … -name "migrations"` · `ls docs/…/specs/…` 처럼 **인자 속 단어**가 벗겨져 규칙에 걸린다 |
| `remote-run` | 30 | `cd "D:/…" && cat > "C:/…"` 등 인용 경로가 벗겨진 뒤 결합 |
| `git-clean` | 8 | 힙 문서(`python3 - <<'PY'`)가 spec 본문의 `clean` 문자열을 품는다 |
| 기타 | 29 | `git-commit:branch-gate` 5 · `move-rename` 5 · `pkg-install` 5 · `infra` 4 · `git-push` 3 · `interactive` 3 … |

**진단**: dq 레인이 **명령·하위명령 위치를 가리지 않고** 전체 텍스트를 규칙에 먹인다. 우회가 성립하는 자리는 *실행되는 토큰*(명령/하위명령/플래그)인데, 지금은 *인자 속 단어*까지 같은 대우를 받는다.

**v0.3 설계 방향**(미착수 — L2 선행 필요): dq 텍스트를 **헤드 토큰열이 실제로 달라질 때만** 규칙에 태운다. `find -name "migrations"` 는 헤드가 그대로라 dq 레인을 타지 않고, `git "clean"` 은 하위명령이 바뀌므로 탄다. ⚠️ **완화 방향 패치**라 [[gate-relaxation-needs-retention-check]] 규율 필수 — 고정 코퍼스 전수 + `gate-destructive` 107건이 **전부 유지**됨을 먼저 증명하고, 합성 MUST_GATE 는 쓰지 않는다.

> 이 193건은 **v0.2 가 새로 만든 게 아니라 v0.1 이 만든 것을 이제야 잰 것**이다. v0.2 적용 여부와 무관하게 이미 라이브에 있었다.
