# spec — `git clean` 게이트 반전 (열거 → 면제)

- 날짜: 2026-09-07
- 상태: **v0.2 — L2 blocker 3건으로 v0.1 폐기, 설계 반전. 검증 완료 · 대표 판정 대기**
- 배경: [git clean 등급 분리 spec](./2026-09-07-git-clean-t2-separation-spec.md) §7 — **실사고 발생분**
- 하네스: `~/p1c/candidates/clean-requireforce/`
- L2: round 1~3 (claude ∥ gemini, `evidenceEligible=true`) — **blocker 3 + important 5 확증**

> ⚠️ **v0.1 은 폐기됐다.** "우회 형태를 열거해 막는다"는 접근이 L2 에서 세 방향으로 뚫렸고, 그중 하나는 **위협모델 자체가 틀렸음**을 보였다. v0.2 는 열거를 버리고 **안전한 형태만 면제**한다.

---

## 1. 실사고

```
git -c clean.requireForce=false clean -d      →  T1 (자율 실행)
```

격리 repo 실동작 확증:

```
before: junk.txt junkdir
$ git -c clean.requireForce=false clean -d -q      → 게이트 T1 통과
after :                                             ← 둘 다 삭제
```

발견 보고 **직후 이 우회가 실제로 실행되어** 작업 산출물(당시 미추적이던 spec 문서)을 삭제했다. 그때 "코퍼스 실사용 0건 → 별건 이연"으로 분류했는데 그 분류가 틀렸다. 빈도 0 은 위험 0 이 아니라 아직 안 밟았다는 뜻이고, 몇 분 만에 밟혔다.

---

## 2. 🚩 v0.1 이 틀린 이유 (L2 blocker 3건)

v0.1 은 우회 **형태를 열거**했다 — `-c clean.requireForce=…` 와 `git config … clean.requireForce`. 셋 다 뚫렸다(패치본 실측):

| L2 id | 우회 | v0.1 |
|---|---|---|
| `c13e1f3d` | `git -c "clean.requireForce=false" clean -d` — **따옴표 한 쌍** | T1 ⛔ |
| `5a11e396` | `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=… git clean -d` — **git 정식 env 주입** | T1 ⛔ |
| `46abd809` | `git clean -id` — **`-i` 는 requireForce 를 건드리지도 않는다** | T1 ⛔ |

총 8형태가 뚫린 채였다.

### 세 번째가 결정적이다 — 위협모델이 틀렸다

`git clean -i`(대화형)는 `-f` 없이도, `clean.requireForce` 를 건드리지도 않고 삭제한다. 즉 v0.1 의 "두 갈래(인라인/영속)" 프레이밍 자체가 잘못됐다.

**그 증거는 내가 v0.1 spec 에 직접 인용한 git 에러문에 이미 있었다**:

```
clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean
```

git 이 실행을 허용하는 조건을 스스로 말하고 있다 — **`-i` 또는 `-n` 또는 `-f`**. 인용해 놓고 `-i` 를 못 봤다.

---

## 3. 설계 v0.2 — 열거를 버리고 뒤집는다

git 이 허용하는 세 조건 중 **안전한 것은 `-n`(드라이런) 하나뿐**이다. 그러면 규칙은 이렇게 된다:

> **`git clean` 은 드라이런이 아니면 전부 게이트한다.**

```
[변경 전] git … clean … (-f | --force)          ← 실행 조건 하나만 열거
[변경 후] git … clean  (?! … -n | --dry-run … ) ← 안전 조건만 면제
```

등급 분리는 [대안 C](./2026-09-07-git-clean-t2-separation-spec.md) 를 그대로 유지한다:

| 형태 | 등급 |
|---|---|
| 평문 `git clean …` | **T2** (`git-clean`) |
| 옵션 접두 `git -c … clean …` · `git --git-dir=… clean …` | **DENY** (`git-destructive`) |
| 드라이런 `-n`·`-nd`·`-xn`·`--dry-run` 및 축약 | 자유 |

### 이 반전이 한 번에 닫는 것

열거가 필요 없다 — **아래가 전부 "드라이런이 아닌 `git clean`"** 이기 때문이다:

- `-f` 계열 · `-i`/`--interactive` · 따옴표 변형 · env 정식 주입 · 설정 해제
- **영속 설정(`git config clean.requireForce false`) 뒤의 `git clean -d`**

마지막이 중요하다. v0.1 은 이 경로를 *"명령 텍스트에 흔적이 없어 원리적으로 탐지 불가"* 라고 단정했는데 — **틀렸다.** 설정을 보려 했기 때문에 그렇게 보였을 뿐, **clean 호출 자체를 보면 잡힌다.**

그래서 v0.2 는 v0.1 의 config 차단(B 갈래)을 **버린다.** 안전 이득이 없어졌고, DENY 층은 heredoc 을 마스킹하지 않아 *문서에 그 문자열을 쓰는 것까지 하드블록*하는 마찰만 남기 때문이다.

### 드라이런 면제는 축약까지 받는다

git 은 모호하지 않은 롱옵션 접두를 허용한다. 코퍼스에 실제로 `git clean --dry-ru` 가 있었다 — 진짜 드라이런인데 게이트되면 마찰이다. `git clean` 의 롱옵션 중 `--d` 로 시작하는 것은 `--dry-run` 뿐이라 접두 열거가 안전하다:

```
--d(?:r(?:y(?:-r(?:u(?:n)?)?)?)?)?\b      → --d · --dr · --dry · --dry-r · --dry-ru · --dry-run
```

`\b` 가 `--dir` 류를 걸러내고, 짧은 `-d`(디렉토리)는 대시 두 개를 요구해 구분된다. 짧은 플래그는 결합형 관용구 `-[a-zA-Z]*n[a-zA-Z]*\b` 로 `-nd`·`-xn` 을 받는다(git 은 `-n` 이 있으면 `-f` 가 함께 있어도 드라이런이다).

---

## 4. 검증

### A. 스모크 29건 PASS ✅

v0.1 이 뚫렸던 8형태 전부 게이트 — `-i` 대화형·`-i` 파이프(`printf 'c\n' | git clean -id`)·`--interactive`·따옴표(겹/홑)·env 정식 주입·영속 설정 후 clean·실사고 형태. 기존 형태(평문·경로인자·결합플래그·체인·`bash -c`·경로형 롱옵션 접두) 등급 유지. 드라이런 7형태(축약 포함) 자유. 무관 명령(`reset --hard`·`commit`·`status`·`config --get`) 불변.

### B. 고정 코퍼스 전수 — 40,816 고유 명령

```
강화 · 미탐 해소(실제 실행)   2   ← 둘 다 이 세션의 실사고 프로브 자신
강화 · 오탐 재발(텍스트 언급)  0 ✅
완화                         0 ✅
```

`git clean --dry-ru` 는 축약 면제를 넣기 전 1건 잡혔다가 면제 후 자유로 돌아왔다.

### C. 기존 시험군 ✅

`risk-classify` 237 · `gate-destructive` 81 · `policy-classify` 53 — 전부 통과.

### D. 영구 회귀 가드 — 81 → 91건

GATE/FREE 8 + **룰 귀속 2**. 룰 귀속을 넣는 이유는 GATE 축(DENY/T3/T2 아무거나)이 이 설계의 계약인 *"평문=T2 / 접두형=DENY"* 를 구분하지 못하기 때문이다(L2 `6683b216`). 정책과 **한 트랜잭션**으로 쓴다.

---

## 5. L2 처리 내역

| id | 등급 | 지적 | 처리 |
|---|---|---|---|
| `c13e1f3d` | blocker | 따옴표 한 쌍으로 A·B 둘 다 우회 | **설계 반전** — 형태를 안 보므로 무관해짐 |
| `5a11e396` | blocker | `GIT_CONFIG_*` env 정식 주입 미차단 | **설계 반전** |
| `46abd809` | blocker | `-i` 가 requireForce 없이 삭제 — 위협모델 오류 | **설계 반전** (근본 원인) |
| `d5153540` | important | `--unset` 을 "기본값 true 복원=안전"으로 단정한 것은 틀림 — 상위 스코프 상속값을 복원하므로 global 에 false 가 있으면 우회 복원 | **지적이 옳다.** v0.2 는 config 차단을 버려 이 판단 자체가 사라졌다 |
| `7b45612a` | important | "탐지 가능한 유일한 지점" 과장 — 파일 직접 쓰기는 못 막음 | **주장 철회.** v0.2 는 clean 호출을 보므로 설정 경로와 무관 |
| `18e81aa8` | important | 롤백이 공유 SSOT 를 낡은 스냅샷으로 덮어써 다른 트랙 편집 소실 | 적용 시 해시를 기록하고, 롤백 전 대조해 **불일치면 거부**(`--force` 로만 강행) |
| `c09e92ee` | important | 적용은 수동 동기 안내, 롤백만 자동 → 분기 창 | **적용도 자동 동기** |
| `6683b216` | important(refuted) | 가드가 GATE 축뿐이라 DENY↔T2 다운그레이드를 못 잡음 | gemini 는 "본문 밖 구현이라 판정 불가"로 refute 했으나 **지적 내용은 옳다** — 룰 귀속 2건 추가 |
| `9fe0e0d0` | important(refuted) | 이미 설정된 legacy false 상태 미대응 | v0.2 에서 **해소** — clean 호출을 보므로 선행 설정과 무관 |
| `d662c21d` | important(refuted) | apply.js 가 T1 이라 게이트 자기적용 공백 | 기지 항목, 별건 후속(§7) |

---

## 6. 잔여 위험

| 위험 | 판단 |
|---|---|
| `git clean -d`(git 자신이 거부하는 형태)도 게이트 | 마찰 방향. 코퍼스 실사용 0 |
| 드라이런 면제가 과하면 미탐 | 면제는 `-n` 계열과 `--d…` 접두뿐. `-f`·`-i` 는 면제 대상이 아니고, `-n` 이 섞이면 git 자체가 드라이런으로 동작하므로 **면제가 곧 사실** |
| 문서 heredoc | 평문 형태는 T2(마스킹 적용)라 자유. **접두형만** DENY 라 하드블록 — `git checkout --` 과 동일 계열로 기수용 |
| 게이트 밖 삭제 경로 | `rm -rf`·`find -delete` 등은 별도 규칙 소관. 이 spec 은 `git clean` 만 |

---

## 7. 적용

```bash
node ~/p1c/candidates/clean-requireforce/apply.js --check    # 스모크 29 + 시험군 + 가드 미리보기
node ~/p1c/candidates/clean-requireforce/apply.js --apply    # 정책+시험 한 트랜잭션 + Windows 동기 자동
node ~/.ai-bootstrap/gate-destructive.test.js                # 91/91 기대
```

롤백 `apply.js --rollback` — 적용 당시 해시와 대조해 **다른 트랙의 편집이 있으면 거부**하고, 통과 시 정책·시험 복원 후 Windows 동기까지 수행한다.

⚠️ 이 명령들은 게이트상 **T1 이라 막히지 않는다.** 대표 판정 없이 실행하지 않는 것은 정책 의도를 존중하는 선택이지 기술적 강제가 아니다.

---

## 8. 후속

- **정책 자가적용 강제력 공백** — `node apply.js --apply` 가 T1
- **같은 계열 설정 키** — `core.hooksPath` 등 "안전장치를 끄는 설정"의 일반화 검토
- **다른 규칙의 열거식 설계 점검** — 이번 교훈(열거 → 면제)이 적용될 규칙이 더 있는지
- **L2 상대경로 오배달** — 회피는 `MAIA_L2_PROJECT=mission-control`
