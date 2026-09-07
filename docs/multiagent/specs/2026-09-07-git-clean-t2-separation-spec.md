# spec — `git clean` 등급 분리 (DENY → 전용 T2)

- 날짜: 2026-09-07
- 상태: **v0.2 — 초안 설계 폐기, 대안 C 로 전환. 대표 판정 대기**
- 근거 결정: [2026-09-07 게이트 규칙 전수 감사 spec](./2026-09-07-gate-rule-audit-spec.md) **§8 대안 (나)**
- 적용기: `~/p1c/candidates/gate-clean-t2/`
- L2: round 1~3 (claude ∥ gemini, `evidenceEligible=true`) — **blocker 2건 확증**, 아래 §3·§5 에 반영

> ⚠️ **v0.1 설계는 폐기됐다.** "clean 대안을 통째로 T2 로 옮긴다"는 초안은 **새 안전구멍을 만든다** — L2 blocker `c335fb41` 가 지적했고 실측으로 확증됐다. §3 참조. v0.2 는 옵션 접두 형태를 DENY 에 남기는 **대안 C**다.

---

## 1. 왜 바꾸는가

전수 감사(2026-09-07)가 `git-destructive`(DENY)의 `\b` 결함을 닫으면서 `clean -fd` 계열이 **처음으로 실제 차단**되기 시작했다. 감사 당시 §8 은 **(가) 그대로 DENY** 를 채택했다 — 빈도가 낮고(4/47,510) 되돌릴 수 없는 삭제라서다. 채택 시 명시한 전환 조건이 "마찰이 실제로 거슬리면"이었고, 대표님이 **(나) 전환**을 지시했다(2026-09-07).

마찰의 실체는 좁다. 코퍼스 40,580 고유 명령 중 실제 `clean` 실행은 **6건**이고 전부 BC 빌드 산출물 정리다 — `cd <repo> && git clean -fd workers/*/dist-check` 형태. **6건 전부 평문 형태**이고 옵션 접두를 쓴 것은 하나도 없다. 이 사실이 §3 의 설계를 정한다.

---

## 2. ⚠️ 등급만 바뀌는 게 아니다 — 스캔 계층이 바뀐다

`risk-classify.js:819`:

```js
new RegExp(r.re, 'i').test(r.class === 'T2' ? headCmd : scanCmd)
```

- **DENY·T3** → `scanCmd` = 원문에 가까운 텍스트
- **T2** → `headCmd` = `maskExecPayload` + 세그먼트 **헤드만**(`headTokens`, verb 뒤 4토큰 상한)

즉 `clean` 을 T2 로 내리는 것은 등급 조정이 아니라 **탐지 계층 이동**이다. 이것이 v0.1 이 실패한 이유다.

---

## 3. 🚩 v0.1 이 만들던 구멍 (L2 blocker `c335fb41` — 실측 확증)

`headTokens`(`risk-classify.js:471`)는 경로형 토큰을 `_` 로 치환한다. 그런데 게이트 규칙들의 옵션 접두 관용구는

```
(?:-[a-zA-Z]\s+\S+\s+|-{1,2}\S+\s+)*
```

이고, 이 패턴은 **`_` 를 소비하지 못한다**. `--git-dir=/tmp/r/.git` 이 `_` 가 되는 순간 접두 그룹이 끊기고 규칙 전체가 발화하지 않는다.

**실측** (v0.1 패치본):

| 명령 | 현재 | v0.1 적용 시 |
|---|---|---|
| `git clean -fd` | DENY | T2 |
| `git -C /tmp/r clean -fd` | DENY | T2 |
| **`git --git-dir=X clean -fd`** | DENY | **T1 ⛔ 자율 실행** |
| **`git --git-dir=A --work-tree=B clean -fd`** | DENY | **T1 ⛔** |
| **`git -c a=b -c c=d clean -fd`** | DENY | **T1 ⛔** |

v0.1 의 "실행 경로 이탈 0건"은 **틀렸다.** 노출면 probe 16형태에 `-C <경로>`(짧은 옵션 + 분리 값 → `-` 로 시작해 접두 그룹이 소비함)는 있었지만 **경로형 롱옵션 형태가 없었다.** gemini 가 먼저 제기했고 claude 가 대질에서 corroborate 했다.

### 이것은 T2 계층 전체의 기존 결함이다

본 패치와 무관하게 지금도 뚫려 있다 — 직접 실측:

| 명령 | 등급 | 기대 |
|---|---|---|
| `git --git-dir=X commit -m "x"` | **T1** ⛔ | T2 (`git-commit`) |
| `npm --prefix /tmp --loglevel warn install lodash` | **T1** ⛔ | T2 (`pkg-install`) |
| `git --git-dir=X merge origin/main` | T3 ✅ | T3 — **원문 스캔이라 면역** |

DENY·T3 는 `scanCmd` 를 쓰므로 영향이 없다. **T2 계층만 감염돼 있다.**

**실사용 빈도**: 경로형 롱옵션 접두 + 게이트 대상 서브커맨드 형태는 코퍼스 **0/40,580**. 잠복 구멍이다.

> ⚠️ **빈도 0 을 근거로 이연하지 않는다.** 같은 날 `clean.requireForce` 우회(§7)도 실사용 0건이었고, 보고 몇 분 만에 실제로 실행돼 파일을 삭제했다. 파괴적 명령의 위험은 빈도가 아니라 **가역성**이 정한다.

### 측정 실패 기록 (재발 방지)

코퍼스 전체에서 이 구멍의 규모를 세려고 두 번 시도했고 **두 번 다 과다계상**했다.

1. "원문엔 규칙이 걸리는데 라이브가 T1" → 3,918건. 대부분 이탈이 아니라 **의도된 동작**이었다(npx 로컬도구 면제, feat/* branchAllow 자율).
2. commandRules 를 T2→T3 로 relabel 해 `scanCmd` 로 강제 → 4,584건. 여전히 과다 — `headCmd` 에는 (a) 축약 버그와 (b) 정당한 면제가 **함께** 실려 있어 이 방식으로 분리되지 않는다.

그래서 코퍼스 규모 수치는 **내지 않는다.** 확정된 것은 기전과 재현 케이스뿐이고, 방어할 수 없는 숫자보다 그 편이 정직하다.

---

## 4. 설계 v0.2 — 대안 C (옵션 접두는 DENY 유지)

목표를 다시 보면, 해소해야 할 마찰은 **평문 `git clean -fd <경로>`** 하나다(실사용 6/6). 그러면 그것만 내리면 된다.

```
git-destructive (DENY)  ← clean 대안을 접두 필수형으로 남긴다  (…)+ clean …
commandRules/git-clean (T2)  ← 떼어낸 대안 그대로              (…)* clean …
```

DENY 쪽은 접두 그룹을 `*` → **`+`** 로 한 글자만 바꾼다. 접두가 하나라도 있으면 DENY 가 먼저 잡고(denylist 는 항상 이김), 평문이면 DENY 가 발화하지 않아 T2 규칙이 받는다.

**새 정규식을 쓰지 않는다.** `split.js` 가 라이브 정책에서 대안을 기계적으로 떼어내고(분리→재결합 byte-동일 왕복 검증), 수량자 한 글자만 치환한다. 손편집 시 백슬래시 하나가 깨지면 `JSON.parse` 실패 → **fail-open(T1 allow)** 으로 DENY 층 전체가 조용히 죽는다(gate-audit L2 `2811aa0c`).

**실측**:

| 형태 | v0.2 결과 |
|---|---|
| `git clean -fd` · `git clean -fd workers/x` · `git clean --force` | **T2** (마찰 해소) |
| `git --git-dir=X clean -fd` · 롱옵션 2개 · `-c` 2개 · `git -C … clean -fd` | **DENY 유지** |
| `git clean -n` / `--dry-run` | T1 (불변) |

**한계 — 정직하게**: 이건 깔끔한 설계가 아니라 **엔진 결함에 대한 보상 통제**다. 같은 파괴력인데 접두 유무로 등급이 갈린다(§8 이 (가)를 택할 때 비정상이라고 지적한 바로 그 형태의 불일치다). 정공법은 `headTokens` 를 고쳐 T2 계층 전체를 복구하는 것이고, 그러면 이 보상 통제는 제거 대상이 된다. §9 참조.

---

## 5. 🚩 "대표 `!` 필요"는 사실이 아니었다 (L2 blocker `bb13c5a4` — 실측 확증)

v0.1 §5 는 `decision-policy.json` 이 `gate-self-policy` T3 이므로 적용에 대표님 `!` 가 필요하다고 적었다. **틀렸다.**

```
T3 | gate-self-policy | Edit/Write  →  .ai-bootstrap/decision-policy.json
T1 | default-cmd      | node ~/p1c/candidates/gate-clean-t2/apply.js --apply
T1 | default-cmd      | node ~/p1c/candidates/gate-rule-audit/apply.js --apply     ← 직전 세션도 동일
```

T3 는 **Edit/Write 도구 경로**를 막는다. 그 파일을 쓰는 **스크립트 실행은 게이트를 거치지 않는다.** 즉 에이전트는 게이트 정책을 자가적용·자가롤백할 수 있다. 직전 세션의 "대표 `!` 로 apply.js 실행 2회"는 **관례였지 기술적 강제가 아니었다.**

이는 심링크 경유 우회(`cp` 로 T3 실파일 덮어쓰기)와 같은 계열이다 — **간접 실행이 명령 텍스트 게이트를 우회한다.**

**대응**: 본 세션은 자가적용하지 않고 대표님 판정을 기다린다(정책 의도 존중). 다만 **강제력이 없다는 사실 자체를 별건으로 올린다** — A2 게이트 자기보호의 실질적 공백이다. 후보 대응: `apply.js` 류 경로를 `gate-self-policy` 에 명령 규칙으로 추가, 또는 정책 파일 쓰기를 훅에서 감시.

---

## 6. 검증

**고정 코퍼스 전수 대조** (`corpus-diff.js` — WSL + Windows 감사 로그 전부, 합성 케이스 없음). v0.1 기준 결과:

```
코퍼스: 고유 명령 40,438 건 (총 실행 47,904 건)
강화 0 · 범위 밖 완화 0 · 의도한 변화 DENY→T2 6건
```

v0.2 는 완화 범위가 **더 좁다**(평문만) — 6건은 전부 평문이라 마찰 해소는 동일하고 옵션 접두 형태의 완화가 사라진다. **v0.2 기준 재실행이 적용 전 필수 관문이다.**

**용어 정정** (L2 `111164fe`): v0.1 은 §4 에서 "게이트 이탈 0" 이라 하고 §3·§7 에서는 heredoc 텍스트의 DENY→T1 을 이득으로 들었다 — 모순이다. 실행 경로의 이탈(구멍)과 데이터 경로의 완화(의도된 이득)를 같은 단어로 불렀기 때문이다. v0.2 는 둘을 구분해 쓴다.

**회귀 가드 한계** (L2 `0f537290`): v0.1 §6 의 "T1 로는 절대 내리지 않는다 — 시험 76건이 고정"은 **과장이었다.** 76건은 GATE 축 74 + 룰귀속 2 뿐이고, §3 에서 확인된 T1 이탈 형태를 **한 건도 고정하지 않았다.** v0.2 의 시험에는 §3 표의 이탈 형태를 **GATE 로 명시 고정**한다(이 시험이 있었다면 v0.1 의 구멍을 자동으로 잡았다).

**코퍼스의 생존편향** (L2 `4f5a7384`): 40,580건은 `clean` 이 DENY 로 차단되던 체제의 로그다. 완화 후 늘어날 사용량·새 형태는 담지 못한다. 얻는 것이 6건의 마찰 감소라는 점과 함께 저울에 올려야 한다.

**미합의 1건** (L2 `51631c2c`, 대표 에스컬레이션): gemini="헤드 축약의 노출면 열거가 불완전하다" / claude="구체적 형태를 제시하지 못했으므로 완화 패치의 일반 조건일 뿐". → **gemini 가 옳았다.** 대질 시점엔 구체 형태가 없었지만 이후 실측이 `--git-dir` 계열을 찾았다. v0.2 는 그 지적을 설계에 반영했다(접두 형태를 아예 DENY 에 남김).

---

## 7. 별건 — `clean.requireForce` 우회 (실사고 발생)

```
git -c clean.requireForce=false clean -d      →  T1 (자율 실행)
```

규칙은 `-f`/`--force` 의 **존재**를 요구하는데, 이 형태는 플래그 대신 **git 자체의 안전장치를 꺼서** `-f` 없이 파괴적이 된다. 격리 repo 실동작 확증:

```
before: junk.txt junkdir
$ git -c clean.requireForce=false clean -d -q      → 게이트 T1 통과
after :                                             ← 둘 다 삭제
--- 대조군 ---
$ git clean -d
fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean
```

**🚩 실사고**: 발견 보고 직후 이 우회가 실제로 실행되어 **본 spec 문서 자신**(당시 미추적)과 빈 디렉토리를 삭제했다. 추적 파일 손실 0, 하네스는 repo 밖이라 무사. spec 은 재작성·커밋(`ed58847`)했다.

**이 사고가 뒤집은 판단**: 발견 시 "코퍼스 실사용 0건 → 별건 이연"으로 분류했다. **틀렸다.** 빈도 0 은 위험 0 이 아니라 아직 안 밟았다는 뜻이고, 몇 분 만에 밟혔다.

**한계**: `git config clean.requireForce false` 로 **영속 설정**한 뒤의 `git clean -d` 는 명령 텍스트에 흔적이 없어 텍스트 스캔으로는 원리적으로 탐지 불가다. 게이트가 아닌 다른 층(설정 감시)의 문제다.

v0.2 에서도 이 우회는 **그대로 남는다** — 층이 아니라 탐지 조건(플래그 존재 요구)의 문제라 본 패치가 만들지도, 메꾸지도 않는다. 방향이 반대(강화)라 별도 spec 으로 올린다.

---

## 8. 부수 발견 — L2 산출물 오배달

`node l2-loop.js docs/multiagent/specs/…` 처럼 **상대경로**를 넘기면 `resolveWiki` 의 프로젝트 추론이 `/([^/]+)/(?:docs|specs?|…)/` 에 걸려 **`docs/multiagent/specs/` → project=`multiagent`** 로 잡힌다. 결과적으로 리뷰가 `wiki/projects/multiagent/`(유령 폴더)로 간다. 2026-08-29 산출물도 같은 경로에 있어 **재발 중**이다.

회피: 절대경로로 호출하거나 `MAIA_L2_PROJECT=mission-control` 을 준다. 근본 수정은 별건.

---

## 9. 대표 판정 필요 — 세 갈래

| 안 | 내용 | 얻는 것 | 잃는 것 |
|---|---|---|---|
| **(A) 보류** | `clean` 을 DENY 에 그대로 | 위험 0 | 마찰 유지(빌드 정리 시 `!`) |
| **(C) 보상 통제** ★권고 | 평문만 T2, 접두 형태는 DENY | 마찰 해소(실사용 6/6) · 새 구멍 0 | 등급 불일치가 남음 |
| **(B) 정공법** | `headTokens` 를 고쳐 T2 계층 복구 → 그 위에서 평문 (나) | T2 계층 전체 복구(`git-commit`·`pkg-install` 포함) | 엔진 변경 — 범위·검증 비용 큼, 별건 |

**권고: (C) 로 마찰을 지금 해소하고, (B) 를 별건으로 올린다.** (C) 는 대표님이 요청한 결과를 안전하게 내주고, (B) 가 완료되면 (C) 의 보상 통제(`+` 수량자)를 제거해 평문 (나) 로 수렴시킨다.

### 적용 (판정 후)

```bash
node ~/p1c/candidates/gate-clean-t2/apply.js --check      # v0.2 재작성 후
node ~/p1c/candidates/gate-clean-t2/corpus-diff.js        # v0.2 기준 재실행 (필수 관문)
node ~/p1c/candidates/gate-clean-t2/apply.js --apply
node ~/.ai-bootstrap/gate-destructive.test.js             # 이탈 형태 고정분 포함
node ~/.ai-bootstrap/maia-deploy.js                       # Windows 동기
```

⚠️ §5 대로 이 명령들은 **T1 이라 게이트가 막지 않는다.** 대표님 판정 없이 실행하지 않는 것은 정책 의도를 존중하는 선택이지 기술적 강제가 아니다.

---

## 10. 후속 (별건)

1. **(B) `headTokens` 수정** — T2 계층 옵션 접두 이탈. `git-commit`·`pkg-install` 등 전 T2 규칙 영향
2. **`clean.requireForce` 우회 차단** — §7. 실사고 발생으로 우선순위 격상
3. **정책 자가적용 강제력 공백** — §5. A2 게이트 자기보호의 실질적 구멍
4. **L2 상대경로 오배달** — §8
