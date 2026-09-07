# spec — `git clean` 등급 분리 (DENY → 전용 T2)

- 날짜: 2026-09-07
- 상태: 검증 완료 · **대표 `!` 적용 대기**
- 근거 결정: [2026-09-07 게이트 규칙 전수 감사 spec](./2026-09-07-gate-rule-audit-spec.md) **§8 대안 (나)**
- 적용기: `~/p1c/candidates/gate-clean-t2/apply.js`

---

## 1. 왜 지금 바꾸는가

전수 감사(2026-09-07)가 `git-destructive`(DENY)의 `\b` 결함을 닫으면서 `clean -fd` 계열이 **처음으로 실제 차단**되기 시작했다. 감사 당시 §8은 세 안을 놓고 **(가) 그대로 DENY**를 채택했다 — 빈도가 낮고(4/47,510) 되돌릴 수 없는 삭제라서다.

채택 시점에 명시한 전환 조건이 "마찰이 실제로 거슬리면"이었고, 대표님이 **(나) 전환**을 지시했다(2026-09-07). 이 문서는 그 전환의 설계·검증이다.

**등급 일관성 재검토**: §8은 "`clean -f`가 이미 DENY이므로 등급 일관성 관점에선 (가)가 맞다"고 적었다. 그 논리는 여전히 유효하나, 그것은 *`clean` 내부의* 일관성이다. 바깥을 보면 `clean`의 실사용은 전부 빌드 산출물 정리였고(6/40,438), 같은 성격의 되돌릴 수 없는 작업인 `rm`·`mv`는 이미 T2(`move-rename`)다. **DENY 층은 "대표님도 `!` 없이는 못 하는 것"이 아니라 "어떤 근거로도 자동 실행돼선 안 되는 것"을 담는 층**이고, 승인 한 번으로 정당화되는 정기 유지보수 작업은 T2가 제자리다.

---

## 2. 설계 — 새 정규식을 쓰지 않는다

`git-destructive.re` 는 top-level `|` 로 이어진 **9개 대안**이다. 그중 `clean` 대안 **하나만** 떼어 신설 `commandRules` 규칙에 그대로 넣는다.

```
[변경 전] denylist/git-destructive (DENY)
          reset --hard | clean -f… | checkout -- | checkout -f | checkout . |
          restore -W | restore <path> | restore --staged . | rebase
                       └─────┬─────┘
[변경 후]                    │  그대로 이동 (byte-동일)
          denylist/git-destructive (DENY) — 8개 대안
          commandRules/git-clean (T2)     ← 떼어낸 대안 1개
```

정규식을 **다시 쓰지 않는 것이 설계의 핵심**이다. 손으로 옮겨 적으면 백슬래시 하나가 깨져도 `risk-classify` 의 `JSON.parse` 가 실패해 **fail-open(T1 allow)** 으로 떨어지고 DENY 층 전체가 조용히 무력화된다(gate-audit L2 blocker `2811aa0c`). 그래서 `split.js` 가 라이브 정책에서 대안을 기계적으로 분리하고, **분리한 대안을 `|` 로 다시 이으면 원문과 byte-동일한지** 왕복 검증한 뒤에야 진행한다. SSOT 는 여전히 하나다.

> 문자클래스 `[^\n;&|]` 안의 `|` 와 그룹 `(?:a|b)` 안의 `|` 는 경계가 아니다 — 분리기는 이스케이프·문자클래스·괄호 깊이를 인식한다. 순진한 `split('|')` 은 규칙을 파괴한다.

---

## 3. ⚠️ 등급만 바뀌는 게 아니다 — 스캔 계층도 바뀐다

`risk-classify.js:819`:

```js
new RegExp(r.re, 'i').test(r.class === 'T2' ? headCmd : scanCmd)
```

- **DENY·T3** → `scanCmd`(`dangerScanText`) = 원문에 가까운 텍스트
- **T2** → `headCmd`(`headScanText`) = `maskExecPayload` + 세그먼트 **헤드**만

즉 `clean` 을 T2 로 내리면 **페이로드 마스킹과 헤드 축약이 이 규칙에 처음 적용된다.** 이것은 부작용이자 동시에 의도된 이득이다 — 다만 **자동으로 따라오는 변화이므로 명시 고지 대상**이다. (계층이 다르면 패치가 안 듣는다는 사실은 2026-09-07 세션에서 이미 실증됐다.)

**노출면 실측** (`layer-probe.js`, 실행 경로 16형태):

| 형태 | 현재 | 패치 후 |
|---|---|---|
| 단독 / 결합플래그(`-fdxq`) / 분리플래그(`-d -f`) / `--force` | DENY | **T2** |
| 체인 뒷단 · 세미콜론 뒷단 · `git -C` 경로점프 · env 접두 | DENY | **T2** |
| `bash -c` · `sh -c` · `eval` · `xargs` | DENY | **T2** |
| heredoc→`bash` 파이프 · 명령치환 · 서브셸 · `node -e` 내부 | DENY | **T2** |

**실행 경로 이탈 0건.** 엔진이 보수적으로 설계된 덕이다 — `headOfSegment` 는 셸·`eval`·`xargs`·명령치환을 만나면 **원문을 그대로 넘기고**, `maskExecPayload` 는 논리 줄에 top-level `|` 가 하나라도 있으면 그 줄의 마스킹을 통째로 포기한다.

**부수 이득**: 문서 heredoc(`cat > doc.md <<'EOF' … EOF`) 안의 `clean -fd` **텍스트**는 DENY → T1 로 풀린다. gate-audit 핸드오프의 잔여 carry "heredoc 오탐 3건(대표 판정 (가)로 수용)" 중 이 계열이 해소된다. 감사 당시 "payload 마스킹으로는 해소 불가 — 층이 다르다"고 적었던 바로 그 문제가, **층을 옮기니** 풀린다.

---

## 4. 검증 — 완화는 "강화 0"으로 증명되지 않는다

이 패치는 **완화**다. 강화 방향만 보면 완화 쪽 안전구멍을 놓친다. 기준은 **유지(retention)**: 지금 막히던 것이 패치 뒤에도 게이트에 남는가. T0/T1 로 떨어지면 등급 조정이 아니라 구멍이다.

**고정 코퍼스 전수 대조** (`corpus-diff.js` — WSL + Windows 감사 로그 전부, 합성 케이스 없음):

```
코퍼스: 고유 명령 40,438 건 (총 실행 47,904 건)
[1] 강화(등급 상승)            0 ✅
[2] 완화 6건 · 게이트 이탈(T0/T1) 0 ✅
[3] 범위 밖 완화(clean 이외)    0 ✅
[4] 의도한 변화 DENY → T2/git-clean : 6건
판정: ✅ PASS
```

6건은 전부 BC 빌드 산출물 정리(`workers/*/dist-check`·`dist-final`·`dist`)다. 감사 당시 보고한 4건보다 2건 많은데, 이번엔 양 환경 로그를 합쳐 코퍼스가 넓어졌기 때문이다.

**스모크 28건**(`apply.js`, 쓰기 전 게이트) — clean 13(GATE 11·FREE 2) + 나머지 파괴적 대안 불변 확인 11 + 조회 2 + **룰 귀속 2**. 룰 귀속은 등급이 아니라 *어느 층이 잡았는지*를 본다: `clean -fd` → `git-clean`, `reset --hard` → `git-destructive`.

**영구 회귀 가드**: `gate-destructive.test.js` 74 → **76건**. 기존 74건은 GATE 축(DENY/T3/T2)이라 등급이 낮아져도 그대로 통과한다 — 바꿔 말해 **74건만으로는 이 변화를 감지하지 못한다.** 그래서 룰 귀속 2건을 추가해 "clean 은 전용 T2 규칙이, 나머지는 DENY 층이 잡는다"를 고정한다.

> **정책과 시험은 한 트랜잭션이다.** 시험을 먼저 고치면 정책 적용 전까지 74/74 가 깨져 세션 시작 점검(핸드오프 지정)이 오작동하고, 정책만 고치면 신규 등급을 고정하는 가드가 없다. `apply.js` 가 둘을 함께 쓰고 함께 롤백한다.

---

## 5. 적용 — 대표 `!` 필요

`decision-policy.json` 은 `gate-self-policy` T3(에이전트 자가편집 차단)다. 실측:

```
T3 | gate-self-policy      | .ai-bootstrap/decision-policy.json
T1 | default-write         | .ai-bootstrap/gate-destructive.test.js
```

```bash
node ~/p1c/candidates/gate-clean-t2/apply.js --check     # 확인만 (변경 없음)
node ~/p1c/candidates/gate-clean-t2/apply.js --apply     # 적용
node ~/.ai-bootstrap/gate-destructive.test.js            # 76/76 기대
node ~/.ai-bootstrap/maia-deploy.js                      # Windows 동기 (canonical=WSL)
```

롤백은 `apply.js --rollback` (정책·시험 동시 복원, 백업 `*.bak-clean-t2`).

---

## 6. 잔여 위험

| 위험 | 판단 |
|---|---|
| T2 는 승인 모달이라 실측 거부율이 0.030% — 사실상 통과 | **수용.** 다만 DENY 대비 이득은 "대표님이 `!` 로 명령을 직접 재입력"에서 "모달 Enter"로 줄어드는 마찰이다. 그게 이 전환의 목적 그대로다 |
| 헤드 축약으로 미탐 형태가 남을 가능성 | 실행 경로 16형태 실측 이탈 0. 다만 **열거는 완전하지 않다** — 새 형태가 발견되면 `git-destructive` 로 되돌리거나(`--rollback`) 해당 형태를 규칙에 추가한다 |
| `clean` 이 DENY 를 떠나며 "절대 자동 실행 불가" 보장 상실 | 의도된 변화. 되돌릴 수 없는 삭제라는 성질은 그대로이므로 **T1 로는 절대 내리지 않는다**(시험 76건이 고정) |
| 드라이런(`-n`/`--dry-run`)이 T2 로 끌려올라가는 강화 | 발생하지 않음 — 이동한 대안은 `-f`/`--force` 를 요구한다. 코퍼스 강화 0 · 스모크 FREE 2건 |

---

## 7. ⚠️ 별건 — `clean.requireForce` 우회 (본 패치와 독립, **실사고 발생**)

### 발견

본 패치를 조사하며 반대 방향(미탐)도 확인한 결과, **현행 DENY 층에 실재하는 우회**를 찾았다.

```
git -c clean.requireForce=false clean -d      →  T1 (자율 실행)
```

`git-destructive` 의 `clean` 대안은 `-f`/`--force` 의 **존재**를 요구한다. 그런데 이 형태는 플래그를 쓰는 대신 **git 자체의 안전장치(`clean.requireForce`)를 꺼서** `-f` 없이 파괴적이 된다. 게이트가 보는 명령 텍스트에는 `-f` 가 없으므로 규칙이 발화하지 않는다.

격리 repo 실동작 확증:

```
before: junk.txt junkdir
$ git -c clean.requireForce=false clean -d -q     → (게이트 T1 통과)
after :                                            ← 둘 다 삭제됨
--- 대조군(설정 없이) ---
$ git clean -d
fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean
```

git 자체는 거부하는 명령을, 설정 한 줄로 열고 게이트도 통과한다.

### 🚩 실사고 (2026-09-07)

발견 직후 **이 우회가 실제로 실행되어 작업 산출물을 삭제했다.** 삭제 대상은 **본 spec 문서 자신**(당시 미추적)과 빈 디렉토리 `docs/multiagent/handoffs/` 였다. 추적 파일 손실은 0이었고(`git status` 깨끗), 하네스 4종은 repo 밖(`~/p1c/candidates/gate-clean-t2/`)이라 무사했다. spec 은 재작성해 복구했다.

**이 사고가 뒤집은 판단**: 발견 시점에 감사 코퍼스 실사용이 0건이라 "빈도 낮음 → 별건으로 이연"으로 분류했다. 그 분류는 **틀렸다.** 빈도 0은 위험 0이 아니라 **아직 안 밟았다는 뜻**일 뿐이고, 실제로는 보고한 지 몇 분 만에 밟혔다. 게다가 파괴적 명령의 위험은 빈도가 아니라 **가역성**이 정한다 — 미추적 파일 삭제는 git 으로 되돌릴 수 없다.

또 하나: 본 패치가 `clean` 을 **T2 로 내려도 이 우회는 그대로 남는다.** 두 문제는 층이 아니라 **탐지 조건**(플래그 존재 요구)에서 갈리기 때문이다. 본 패치의 완화가 이 구멍을 만든 것도 아니고, 메꾸지도 않는다.

### 왜 본 패치에 묶지 않는가

방향이 반대다 — 본 패치는 **완화**(DENY→T2)이고 이 수정은 **강화**(T1→게이트)다. 한 트랜잭션에 묶으면 §4 의 "강화 0" 검증 서사가 무너져 두 변화 모두 근거가 흐려진다. 별도 spec·별도 코퍼스 검증으로 올린다.

### 수정 방향 (별건 spec 에서 상술)

- 탐지 조건에 **"`-c clean.requireForce=false` 접두 + `clean`"** 을 `-f` 와 동등하게 추가
- 대소문자·값 변형(`=false`/`=0`/`=no`), `--config-env` 경유 형태 함께 열거
- **한계 명시**: `git config clean.requireForce false` 로 **영속 설정**한 뒤의 `git clean -d` 는 명령 텍스트에 흔적이 없어 텍스트 스캔으로는 원리적으로 탐지 불가. 이건 게이트가 아니라 다른 층(설정 감시)의 문제다

---

## 8. 이 변경으로 닫히는 것

- gate-audit carry **"`git clean -fd` = DENY 마찰"** — 종결(§8 (가) → (나))
- gate-audit carry **"heredoc 오탐 3건"** — `clean` 계열 해소(`checkout --` 계열은 DENY 잔존이라 그대로)
- 신규 carry: **§7 `clean.requireForce` 우회 수정** — 실사고 발생으로 우선순위 격상
