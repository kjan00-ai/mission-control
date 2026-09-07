# spec — `clean.requireForce` 우회 차단

- 날짜: 2026-09-07
- 상태: 검증 완료 · **대표 판정 대기**
- 배경: [git clean 등급 분리 spec](./2026-09-07-git-clean-t2-separation-spec.md) §7 — **실사고 발생분**
- 하네스: `~/p1c/candidates/clean-requireforce/`

---

## 1. 무엇이 뚫려 있었나

```
git -c clean.requireForce=false clean -d      →  T1 (자율 실행)
```

git 은 자체 안전장치를 갖고 있다 — `clean.requireForce` 가 기본 `true` 라서 `-f` 없는 `git clean` 을 거부한다. 이 형태는 **그 안전장치를 꺼서** `-f` 없이 파괴적이 된다. 게이트 규칙은 `-f`/`--force` 의 **존재**를 요구하므로 발화하지 않는다.

격리 repo 실동작 확증:

```
before: junk.txt junkdir
$ git -c clean.requireForce=false clean -d -q      → 게이트 T1 통과
after :                                             ← 둘 다 삭제
--- 대조군 ---
$ git clean -d
fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean
```

**git 자체가 거부하는 명령을 설정 한 줄로 열고, 게이트도 통과한다.**

### 🚩 실사고

발견 보고 직후 이 우회가 **실제로 실행되어** 작업 산출물(당시 미추적이던 spec 문서)과 빈 디렉토리를 삭제했다. 추적 파일 손실은 0 이었고 spec 은 재작성·커밋했다.

발견 시점에 "코퍼스 실사용 0건 → 별건 이연"으로 분류했는데 **그 분류가 틀렸다.** 빈도 0 은 위험 0 이 아니라 아직 안 밟았다는 뜻이고, 몇 분 만에 밟혔다. 파괴적 명령의 위험은 빈도가 아니라 **가역성**이 정한다 — 미추적 파일 삭제는 git 으로 되돌릴 수 없다.

---

## 2. 우회 표면은 두 갈래다

| 갈래 | 형태 | 탐지 가능성 |
|---|---|---|
| **A 인라인** | `git -c clean.requireForce=… clean …` | 명령 텍스트에 드러남 |
| **B 영속** | `git config clean.requireForce false` → 이후 `git clean -d` | **설정하는 순간만** 드러남 |

B 가 중요하다. 한 번 영속 설정되면 그 뒤의 `git clean -d` 는 명령 텍스트에 아무 흔적이 없어 **원리적으로 탐지 불가**다. 그러니 탐지 가능한 유일한 지점 — 설정하는 순간 — 에서 막아야 한다.

**실사용 빈도**: 코퍼스 40,768 고유 명령 중 A 형태 4건, B 형태 0건. 그런데 **A 4건은 전부 이 세션의 내 프로브와 그것을 기록한 커밋 메시지**다. 즉 이전 실사용은 **0**. 잠복이다 — 그러나 §1 대로 이연 근거로 쓰지 않는다.

---

## 3. 설계

`git-destructive`(DENY) 에 대안 2개를 추가한다(9 → 11).

```
A  git\s+[^\n;&|]*?(?:-c\s+|--config-env=)clean\.requireForce=[^\n;&|]*?\sclean\b
B  git\s+(?:-[a-zA-Z]\s+\S+\s+|-{1,2}\S+\s+)*config\b[^\n;&|]*?clean\.requireForce\s+\S
```

### 값을 열거하지 않는다

`=false|0|no|off` 를 열거하고 싶어지지만 **하지 않는다.** 값 열거는 대소문자(`FALSE`)·동의어·env 간접(`--config-env=키=환경변수`)으로 우회된다. **키의 존재만으로** 게이트한다. `=true` 로 명시하는 경우까지 걸리지만 그건 마찰일 뿐 구멍이 아니고, 실사용 빈도도 0 이다.

### B 는 쓰기만 잡는다

키 뒤에 토큰이 오면(`\s+\S`) 쓰기다. 읽기는 키 뒤가 비어 매치되지 않는다:

| 명령 | 판정 | 이유 |
|---|---|---|
| `git config clean.requireForce false` | DENY | 키 뒤에 값 |
| `git config --get clean.requireForce` | 자유 | 키가 마지막 |
| `git config clean.requireForce` | 자유 | 키가 마지막 |
| `git config --unset clean.requireForce` | 자유 | **해제는 기본값 `true` 복원 = 안전** |

### 접두 관용구는 복제한다

B 의 접두는 `git-destructive` 가 쓰는 것을 그대로 가져왔다. `(?:-{1,2}\S+\s+)*` 만 쓰면 `git -C <경로> config …` 처럼 **값이 분리된 짧은 옵션**을 넘지 못한다(실측 miss → 수정).

### 왜 T2 가 아니라 DENY 인가

B 를 T2(모달)로 두면, 모달 한 번으로 **탐지 불가능한 상태가 영구히 만들어진다.** 실측 모달 거부율은 0.030% 다 — 사실상 통과한다. 이건 "이 삭제가 위험한가"의 문제가 아니라 **탐지기 자체를 끄는 행위**라 A2 게이트 자기보호와 같은 성격이고, DENY 가 맞다. 정말 필요하면 대표님이 `!` 로 실행한다.

---

## 4. 검증

### A. 우회 폐쇄 — 9형태 전부 `T1 → DENY` ✅

실사고 형태 · 값 변형(`=0`) · 대소문자(`requireforce=FALSE`) · 옵션 혼합 · env 간접(`--config-env`) · 체인 뒷단 · 영속 설정 · 전역 설정 · 경로점프+로컬 설정.

### B. 오탐 불발생 ✅

**코퍼스에서 이 키에 매칭된 4건 중 2건이 내 커밋 메시지였다** — 규칙이 텍스트 언급에 발화하면 안 된다. DENY 층의 `dangerScanText` 는 커밋 메시지를 비우므로 통과한다(엔진 통합으로 확인):

| 케이스 | 결과 |
|---|---|
| 커밋 메시지가 키·우회명령을 인용 (코퍼스 실재) | T2 → T2 ✅ (git-commit 이 잡을 뿐, 신규 규칙 아님) |
| AI 프롬프트가 키 언급 | T1 → T1 ✅ |
| `git config --get` / 키만 / `--unset` / `--list` | 전부 불변 ✅ |
| 무관한 config 쓰기(`user.email`) | 불변 ✅ |

### ⚠️ 수용된 절충 — 문서 heredoc 은 하드블록된다

```
cat > doc.md <<'EOF'
git -c clean.requireForce=false clean -d 는 DENY 입니다
EOF
                                        →  T1 → DENY
```

DENY 층은 `dangerScanText` 를 쓰고 **그건 heredoc 페이로드를 마스킹하지 않는다**(마스킹은 T2 층의 `headScanText` 전용). 그래서 이 문자열을 문서에 쓰는 것도 막힌다.

이건 텍스트 스캔 DENY 의 구조적 한계이며, `git checkout --` 에 대해 **대표 판정 (가)로 이미 수용된 계열**이다. 회피는 heredoc 대신 파일 쓰기 도구를 쓰는 것 — 이 spec 자체가 그렇게 작성됐다.

### C. 기존 등급 불변 ✅

`git clean -fd`(T2) · `git --git-dir=X clean -fd`(DENY) · `git -c a=b clean -fd`(DENY) · `git clean -n`(T1) · `git reset --hard`(DENY) 전부 그대로.

### D. 고정 코퍼스 전수 — 40,768 고유 명령

```
강화 · 미탐 해소(실제 실행)   1   ← 실사고를 낸 그 명령 자체 (T2 → DENY)
강화 · 오탐 재발(텍스트 언급)  0 ✅
완화                         0 ✅
```

### E. 기존 시험군 ✅

`risk-classify` 237 · `gate-destructive` 81 · `policy-classify` 53 — 전부 통과.

### F. 영구 회귀 가드 — 81 → 90건

정책과 **한 트랜잭션**으로 쓴다: 시험을 먼저 넣으면 적용 전까지 81/81 이 깨져 세션 시작 점검이 오작동하고, 정책만 고치면 다음 편집이 조용히 되돌려도 아무도 모른다. 추가 9건 = 우회 7 + 읽기·`--unset` 자유 2.

---

## 5. 잔여 위험

| 위험 | 판단 |
|---|---|
| **이미 설정된 config** | `~/.gitconfig` 나 repo `.git/config` 에 **이전에** 설정돼 있으면 이후 `git clean -d` 는 명령 텍스트에 흔적이 없어 **원리적으로 탐지 불가**. 게이트가 아닌 다른 층(설정 감시)의 문제다. 이 패치는 앞으로 설정되는 것만 막는다 |
| 문서 heredoc 하드블록 | §4 수용 절충. 파일 쓰기 도구로 회피 |
| `=true` 명시도 게이트 | 의도적(값 열거 회피). 마찰 방향이라 구멍 아님 |
| 같은 계열의 다른 설정 키 | `core.hooksPath=/dev/null`(훅 우회) 등이 같은 구조다. 코퍼스 6건은 전부 시험 프로브. **이 패치 범위 밖 — 별건** |

> **선행 상태 점검 권고**: 적용과 별개로, 현재 `clean.requireForce` 가 어디엔가 이미 꺼져 있는지 한 번 확인하는 것이 좋다 — `git config --show-origin --get-all clean.requireForce` (읽기라 자유).

---

## 6. 적용

```bash
node ~/p1c/candidates/clean-requireforce/apply.js --check    # 스모크 19 + 시험군 + 가드 미리보기
node ~/p1c/candidates/clean-requireforce/apply.js --apply    # 정책 + 시험 한 트랜잭션
node ~/.ai-bootstrap/gate-destructive.test.js                # 90/90 기대
node ~/.ai-bootstrap/maia-deploy.js                          # Windows 동기
```

롤백 `apply.js --rollback` — 정책·시험 동시 복원 후 **Windows 동기까지 수행**하고, 실패하면 분기 상태임을 명시하며 비정상 종료한다.

⚠️ 이 명령들은 게이트상 **T1 이라 막히지 않는다.** 대표 판정 없이 실행하지 않는 것은 정책 의도를 존중하는 선택이지 기술적 강제가 아니다(별건 후속).

---

## 7. 후속

- **정책 자가적용 강제력 공백** — `node apply.js --apply` 가 T1
- **같은 계열 설정 키** — `core.hooksPath` 등 "안전장치를 끄는 설정"의 일반화 검토
- **L2 상대경로 오배달** — 회피는 `MAIA_L2_PROJECT=mission-control`
