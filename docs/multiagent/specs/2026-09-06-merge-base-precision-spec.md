# `git-merge` 규칙 정밀화 spec — `merge-base` 오탐 해제 + 옵션 접두 우회 차단

- **문서유형**: spec (설계·실측·L2 2R 완료, 대표 `!` 적용 대기) · **v0.2**
- **작성일**: 2026-09-06
- **발단**: 대표 지시 *"사례 기록해"*. PR #1 머지 직후 로컬 `main` fast-forward 안전성을 확인하려 `git merge-base --is-ancestor main origin/main`(**읽기전용**)을 호출했으나 `[MAIA T3] merge (git-merge)`로 차단.
- **설계 기준**: BC/SF Windows 감사로그 (메모리 [[maia-design-baseline-is-bc-sf-not-mc]])
- **선행 계열**: [[2026-08-31-t2-gate-precision-spec]] · [[2026-09-01-git-arg-message-precision-spec]] · [[2026-09-01-exec-payload-mask-spec]]
- **대상(A2 자기보호 T3, 대표 `!`)**: `~/.ai-bootstrap/decision-policy.json` 의 `git-merge.re` **한 필드**
- **L2**: 2026-09-06 claude ∥ gemini, 2라운드. **settled 3건 전부 본 v0.2에 반영**, 에스컬레이션 1건은 §8.

---

## 1. 문제 — 두 방향의 부정확

`git-merge` 규칙은 **단어 경계 하나로만** 머지를 식별한다.

```
"id": "git-merge", "class": "T3", "re": "git\\s+merge\\b|gh\\s+pr\\s+merge"
```

여기서 **두 종류의 오류가 동시에** 발생한다.

### (A) 과잉 차단 — 읽기전용 `merge-base`

`\b`는 단어 경계이므로 `merge` 다음의 `-`가 경계로 인정된다 → **`git merge-base`가 그대로 매치**된다. `merge-base`는 두 커밋의 공통 조상을 **출력만** 하는 plumbing 조회로, 워킹트리·인덱스·ref 어느 것도 바꾸지 않는다.

피해가 특히 고약한 지점: 막히는 것이 fast-forward 안전성 확인(`--is-ancestor`), 분기 시점 조회(`git log $(git merge-base …)`), 충돌 사전 점검 같은 **머지 전 안전 점검**이다. 게이트가 정확히 "안전을 확인하려는 행위"를 벌한다.

### (B) 과소 차단 — 옵션 접두 우회 (L2 `b3c8f7a2`, 실측 확인)

**같은 규칙이 진짜 머지를 놓친다.** 정규식이 `git`과 `merge`를 붙여서만 보기 때문에, 사이에 전역 옵션이 끼면 매치가 깨진다.

| 명령 | 현행 등급 |
|---|---|
| `git merge origin/main` | T3 ✅ |
| **`git -C /path/to/repo merge origin/main`** | **T1 (자율 실행) ⛔** |
| **`git -c user.name=x merge origin/main`** | **T1 ⛔** |
| **`git --no-pager merge origin/main`** | **T1 ⛔** |
| `git --git-dir=.git merge origin/main` | T3 ✅ |

**`git-merge`는 git 계열 규칙 중 유일하게 옵션 스킵 패턴이 없다.** 같은 파일의 `git-push`·`git-commit`은 `git\s+(?:-c\s+\S+\s+|-{1,2}\S+\s+)*<sub>\b` 형태를 이미 쓰고 있어 위 6형태 전부를 잡는다(실측 12/12 정상). 즉 이 우회는 **`git-merge`만의 누락**이다.

> ⚠️ 특히 위험한 조합: MC의 WSL git 함정 규약이 `git -C <경로>` 사용을 권장한다(프로젝트 CLAUDE.md). **규약이 권장하는 형태가 곧 게이트 우회 형태**였다.

---

## 2. 실측 — 기준선

감사로그에서 `git-merge` 규칙이 실제로 트립한 **전체 83건**(WSL/MC 5 + Windows/BC·SF 78). 측정 시점 2026-09-06 02:40 KST.

| 구분 | 건수 | 비중 |
|---|---|---|
| `merge-base` 포함 (읽기전용 오탐) | **53** | 63.9% |
| 그 외 (진짜 머지 + payload 텍스트 오탐) | 30 | 36.1% |

> **표본 해석 주의 2건**
> 1. **"진짜 머지가 적다"를 게이트 성공으로 읽으면 안 된다.** 진짜 머지는 대표님이 `!`로 실행하므로 훅을 경유하지 않아 로그에 없다. 이 표본은 "에이전트가 시도해서 걸린 것"만 담는다.
> 2. **코퍼스는 살아 있다.** 본 spec 작성 중 L2 리뷰어(claude)가 자체 검증 프로브를 돌려 WSL 3→5건으로 늘었다. 81→83의 차이는 이 메타작업이다.

---

## 3. 설계 — 정규식 1개 필드, 두 수정 동시

| | 정규식 |
|---|---|
| 기준선 | `git\s+merge\b\|gh\s+pr\s+merge` |
| **제안** | `git\s+(?:-c\s+\S+\s+\|-{1,2}\S+\s+)*merge(?!-base\b)\b\|gh\s+pr\s+merge` |

- **옵션 스킵 접두** `(?:-c\s+\S+\s+|-{1,2}\S+\s+)*` — **`git-push`·`git-commit`에서 이미 검증된 패턴을 그대로 복제**한다. 새 패턴을 발명하지 않는다(SSOT 일관성).
- **부정 전방탐색** `(?!-base\b)` — `merge-base`만 해제.

로직 변경 없음. 규칙 순서·다른 규칙·denylist 전부 불변.

**의도적으로 게이트를 유지하는 것**

| 명령 | 판정 | 근거 |
|---|---|---|
| `git merge-file` | 유지(T3) | `-p/--stdout` 없으면 **파일을 제자리에서 덮어쓴다** |
| `git merge-tree --write-tree` | 유지(T3) | 객체 DB에 쓴다. 완화 범위를 넓힐 이유 없음 |
| `git merge-based-*` (가상 별칭) | 유지(T3) | `-base\b`가 `based`에서 불성립 → 보수적으로 걸림 |

---

## 4. 검증 — "유지" 기준 (메모리 [[gate-relaxation-needs-retention-check]])

완화 패치는 "강화 0"만으로 부족하다. **기준선을 먼저 실측하고 고정 코퍼스를 전수 대조**했다. 정책은 손복사하지 않고 실제 `decision-policy.json`을 프로그램적으로 복사→`git-merge.re` 단일 필드만 치환한 arm으로 비교했다(SSOT 하나). 하네스 = `~/p1c/candidates/merge-base-precision/`.

**(a) 합성 코퍼스 22건** — `MUST_GATE 8 / NEW_GATE 4 / RELEASE 3 / UNCHANGED 7` → **PASS**

```
MUST_GATE  8/8  T3 유지 (merge / --no-ff / --abort / --continue
                 / merge-file / merge-tree / gh pr merge / merge-based-alias)
NEW_GATE   4/4  T1 -> T3 (-C path / -c k=v / --no-pager / -C .)   ← 우회 차단
RELEASE    3/3  T3 -> T1 (merge-base 3형태)
UNCHANGED  7/7  등급 불변 (status / fetch / log --grep merge
                 / commit -m "…merge conflict" / push=T3 / rev-list / -C … merge-base)
```

**(b) 감사로그 `git-merge` 트립 전수 83건** (Windows 원본 `cwd` = 라이브 조건)

```
해제 43 | 유지 40 | 예상밖 변동 0
```

**(c) 전체 감사로그 고유명령 39,653건 — 새로 상향(강화)된 명령: 0건.**
옵션 스킵 접두를 넣어도 실사용 로그에서 새로 걸리는 명령은 없다. 즉 (B) 차단은 **기존 워크플로를 하나도 방해하지 않는다**.

**(d) 완화 방향 안전구멍** — 해제된 43건 중 진짜 머지 호출이 섞인 건 **0건**.

> ⚠️ **v0.1의 근거 오류 정정 (L2 `945e8db1`, 실측 확인)**
> v0.1은 이 안전성을 *"복합 명령은 세그먼트 단위로 분류되므로"*로 설명했다. **틀렸다.** T3 규칙은 세그먼트 head가 아니라 **명령 전문(`scanCmd`)에 test**되며, head 기반 분류는 T2 전용이다. 결론(구멍 0)은 그대로 성립하지만 **이유가 다르다** — 전문에 진짜 머지 토큰이 남아 있어 매치되는 것이다. 실측:
> `git merge-base --is-ancestor main origin/main && git merge origin/main` → 패치 전후 **모두 T3**.
> 근거 메커니즘을 틀리게 적어두면 후속 편집이 오판하므로 정정해 기록한다.

**(e) 미해제 10건의 정체 (L2 `a2d79465`)** — `merge-base` 포함 53건 중 43건만 해제되고 10건이 남는다. **10건 전부 같은 명령 안에 `git merge-tree`가 동거**한다(BC/SF의 충돌 사전점검 관용구 `git merge-tree $(git merge-base A B) A B`, 8건 + L2 프로브 텍스트 2건). `merge-tree`는 §3에서 의도적으로 유지 대상이므로 **설계대로 걸린 것**이다. 따라서 해소율은 **43/83 = 51.8%**이며, 63.9%(merge-base 포함 비율)와 혼동하지 않는다.

---

## 5. 잔여 위험

- **완화 방향이므로 미탐 위험이 원리적으로 존재**한다. 해제 대상은 `git merge-base` 단일 plumbing 조회로 한정되며 이 명령에는 파괴적 옵션이 없다(`--is-ancestor`·`--fork-point`·`--octopus` 전부 출력 전용).
- `gh pr merge`는 이 패치와 무관하게 그대로 T3다. 단 **`gh` 쪽 옵션 접두(`gh -R o/r pr merge`)는 이번 범위 밖** — 후속 트랙.
- `merge-tree`를 유지한 대가로 충돌 사전점검(§4-e의 8건)은 계속 T3다. 실무 부담이 확인되면 별도 판단.

---

## 6. 적용 (대표 `!`)

`~/.ai-bootstrap/decision-policy.json` 의 `git-merge` 규칙에서 `re` 값만 교체:

- 전: `git\\s+merge\\b|gh\\s+pr\\s+merge`
- 후: `git\\s+(?:-c\\s+\\S+\\s+|-{1,2}\\S+\\s+)*merge(?!-base\\b)\\b|gh\\s+pr\\s+merge`

적용 후 `node ~/.ai-bootstrap/maia-deploy.js` 1회 (WSL canonical → Windows 동기).
**롤백**: `re`를 전 값으로 되돌리고 `maia-deploy.js` 재실행. 상태 변경 없음.

---

## 7. 사례로서의 교훈

이번 차단은 **게이트가 명령 텍스트를 스캔한다**([[decision-gate-scans-command-text]])는 구조가 낳는 오탐 계열의 세 번째 유형이다.

| 유형 | 오탐 원인 | 관할 spec |
|---|---|---|
| ① 데이터가 명령으로 읽힘 | 커밋 메시지·`git add` 경로 | [[2026-09-01-git-arg-message-precision-spec]] |
| ② 실행 안 되는 payload | heredoc 본문·프로브 문자열 | [[2026-09-01-exec-payload-mask-spec]] |
| ③ **하위명령 접두어 충돌** | `merge-base`가 `merge\b`에 매치 | **본 spec** |

그리고 이번에 얻은 더 중요한 교훈은 따로 있다: **오탐을 파고들었더니 같은 규칙에서 미탐이 나왔다.** 과잉 차단과 과소 차단은 별개 현상이 아니라 *"규칙이 대상을 정확히 지목하지 못한다"*는 **하나의 부정확에서 나온 양면**이다. 앞으로 오탐 조사 시 **같은 규칙의 반대 방향(우회)도 함께 실측**한다.

---

## 8. ✅ 종결 — L2 `ac1167b6` 해소 (2026-09-07)

> **본 spec은 [[2026-09-07-gate-rule-audit-spec]] 에 흡수됐다. 별도 적용 불필요.**
>
> gemini의 제기(*"단일 사례만 고치고 유사 위험을 후속 트랙으로 미뤄 정밀 spec이 누적된다"*)는 **결과적으로 옳았다.** 대표 판정으로 건별 대응을 접고 **전수 감사 1회**로 전환했고, 그 결과 같은 뿌리(`\b`)에서 나온 미탐 10형태·실제 자율실행 7건이 드러났다. 건별로 갔으면 `merge-base` 오탐 하나만 고치고 끝났을 것이다.
>
> 이 spec의 `merge` 설계는 감사 spec이 승계·확장했다(`merge-tree`·`merge-index` 추가 해제, `gh` 옵션 스킵 추가).

---

## 8-A. (이력) 당초 대표 판정 요청 내용

- **gemini 제기**: 본 spec은 '접두어 충돌'을 하나의 유형으로 식별해 놓고 **단일 사례만 고치고 유사 위험은 '후속 트랙'으로 미룬다**. 근본 해결 대신 정밀 spec이 누적될 수 있다.
- **claude 반박**: 좁은 범위는 회피가 아니라 실측에 근거한 의도적 설계다 — `merge-file`·`merge-tree`는 실제로 파괴적이라 접두어 일괄 해제가 오히려 위험하다. §7 유형표가 계열 위험을 추적 대상으로 등재한다.
- **미합의 상태로 대표님께 올린다.** 판단이 필요한 지점은 *"게이트 규칙 전반을 한 번에 재설계할 것인가, 실측된 건부터 정밀화할 것인가"* 이며, 이는 정책 기준 변경이라 대표 결정 사항이다.
- 판정 전까지 §6은 **미적용**으로 둔다(fail-closed). 롤백 필요 없음 — 아직 아무것도 바꾸지 않았다.
