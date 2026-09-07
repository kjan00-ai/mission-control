# 게이트 규칙 전수 감사 spec — `git-destructive` 미탐 복구 + `git-merge` 정밀화

- **문서유형**: spec (적용 완료) · **v0.3**
- **작성일**: 2026-09-07
- **발단**: 대표 승인 — 결정 1(`clean -fd` 갭) · 결정 2(옵션 접두 우회) · 결정 5(건별 → **전수 감사 1회**)를 하나로 묶어 진행.
- **선행**: [[2026-09-06-merge-base-precision-spec]](본 spec에 **흡수** — 별도 적용 불필요) · [[2026-09-01-exec-payload-mask-spec]](**이미 라이브** — 단 DENY 층 미적용이라 본 spec과 상호작용 없음, §7)
- **상태**: **적용 완료(2026-09-07 대표 `!`)** — 라이브 실증 31/31 · `risk-classify` 237/237 · C6 fixture 53/53 · drift 0
- **대상(A2 자기보호 T3, 대표 `!`)**: `~/.ai-bootstrap/decision-policy.json` 의 `git-destructive.re` · `git-merge.re`
- **적용기**: `~/p1c/candidates/gate-rule-audit/apply.js` (하네스 동봉)
- **L2**: 2026-09-07 claude ∥ gemini 2R — **blocker 2 + important 3 전건 반영(설계 축 전환)**, 미합의 3건은 §10.

---

## 1. 감사 범위 — 추측이 아니라 열거로 확정

정책 52개 규칙을 전수 열거해 결함 후보를 기계적으로 추출했다(`enumerate.js`).

| 결함 유형 | 판정 기준 | 해당 규칙 |
|---|---|---|
| ① 옵션 접두 우회 | `도구\s+하위명령`인데 옵션 스킵 없음 | **`git-destructive`, `git-merge`** (2/7) |
| ② 하위명령 접두어 충돌 | 리터럴 단어 + `\b` | `merge`(3형제) · `commit`(2형제) |
| ③ 결합플래그 갭 | `-[a-z]*X` 뒤에 `\b` | **`git-destructive`** (1/52) |

**세 유형이 같은 두 규칙에 몰려 있었다.** `force-push`·`delete-ref`·`tag-push`·`git-push`·`git-commit`은 이미 올바른 관용구를 쓴다 — **정답이 같은 파일 안에 있었고 두 규칙만 낡은 형태로 남아 있었다.**

---

## 2. 실측 — `git-destructive`(DENY)는 거의 작동하지 않고 있었다

**단일 원인은 그룹 말미의 `\b` 하나다.**

```
git\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|restore\s+--staged\s+\.|rebase)\b
                                                                                      ↑
```

`\b`는 직전 문자가 단어문자일 때만 성립한다. 대안이 공백(`checkout --␣`)이나 마침표(`restore --staged .`)로 끝나면 **그 대안 자체가 영구히 발화하지 않는다.** `clean -[a-z]*f`도 `f`가 플래그 마지막 글자여야 한다 — 그런데 디렉토리까지 지우려면 `-fd`를 쓴다.

| 형태 | 현재 | |
|---|---|---|
| `git clean -f` / `-df` | DENY ✅ | |
| **`git clean -fd` / `-fdx` / `--force`** | **T1** ⛔ | 추적외 파일·디렉토리 삭제 |
| **`git checkout -- .`** | **T1** ⛔ | 로컬 변경 전량 폐기 |
| **`git restore --staged .`** | **T1** ⛔ | **규칙에 명시 열거돼 있는데도** |
| **`git -C <경로> reset --hard`** | **T1** ⛔ | 옵션 접두 우회 |

### 실사용 (감사 47,510건 전수)

`clean` 결합/롱플래그 6건(자율 4) · `restore --staged` 10건(자율 3) · `checkout -- .` 3건(자율 0).
**이론이 아니다 — 7건이 실제로 자율 실행됐다.**

---

## 3. ⚠️ v0.1 설계 폐기 — 감사 축이 틀렸다 (L2 반영)

v0.1은 **"정규식 형태"를 축으로** 잡았다. 그 결과 형태 결함은 고쳤지만 **파괴적 명령 공간에는 19개 구멍이 남았다.** L2가 지적하고 전부 실측 확인했다:

| L2 | 남은 구멍 | 예 |
|---|---|---|
| `f0085cf1` (blocker) | 옵션 스킵을 **하위명령 앞에만** 둠 → 하위명령↔플래그 **사이** 옵션이 우회 | `git clean -d -f` · `git reset -q --hard` |
| `8bdccbaf` | `restore` 대안에만 결합플래그 관용구 미적용 | `git restore -W .` · `-SW .` |
| `97052ed9` | `gh pr merge`에 옵션 스킵 없음 / 읽기전용 플러밍 과잉차단 | `gh -R o/r pr merge` · `merge-tree` |
| `e58ced28` | **축 자체의 한계** — 동등하게 파괴적인데 열거되지 않음 | `git checkout .` · `HEAD -- .` · `-f <branch>` |

**v0.2는 축을 "파괴적 명령 공간"으로 바꾼다.** 하위명령과 위험 토큰 사이를 **세그먼트 스패너**(`[^\n;&|]*?` = 구분자를 넘지 않는 같은 명령 안)로 잇는다.

---

## 4. 설계 (v0.2)

**옵션 스킵**은 `force-push`의 관용구를 확장해 **인자를 따로 받는 옵션**(`-C <경로>`·`-R <repo>`)까지 흡수한다:
`(?:-[a-zA-Z]\s+\S+\s+|-{1,2}\S+\s+)*`

### `git-destructive` — 9개 대안

| 대안 | 잡는 것 |
|---|---|
| `reset\b<seg>\s--hard\b` | `reset --hard` (사이 옵션 무관) |
| `clean\b<seg>\s(?:-[a-zA-Z]*f[a-zA-Z]*\b\|--force\b)` | `-f`·`-fd`·`-xfd`·`-d -f`·`--force` |
| `checkout\b<seg>\s--\s` | 경로형 `checkout -- …` |
| `checkout\b<seg>\s(?:-…f…\b\|--force\b)` | `checkout -f <branch>` |
| `checkout\s+\.(?:\s\|$)` | `checkout .` |
| `restore\b<seg>\s(?:-[a-zA-Z]*W[a-zA-Z]*\b\|--worktree\b\|--source\b)` | 워킹트리 명시 형태(`-W`·`-SW` 포함) |
| `restore\s+(?!-)\S` | 플래그 없는 `restore <경로>` (기본이 워킹트리 폐기) |
| `restore\b<seg>\s(?:--staged\|-…S…)\s+\.(?:\s\|$)` | 일괄 언스테이지(원 규칙 의도) |
| `rebase\b` | 이력 재작성 |

**의도적 비게이트**: `restore --staged <경로>`(부분 언스테이지 — 내용이 워킹트리에 남아 가역), `checkout <branch>`·`-b`(브랜치 전환), `reset`·`--soft`(가역).

### `git-merge`

```
git\s+<opt>merge(?!-(?:base|tree|index)\b)\b | gh\s+<opt>pr\s+merge
```

읽기전용 플러밍 `merge-base`·`merge-tree`·`merge-index`를 해제하고, **`merge-file`은 유지**한다(제자리 덮어씀). `gh`에도 옵션 스킵을 적용해 `gh -R o/r pr merge`를 닫는다.

---

## 5. 검증

정책은 손복사하지 않고 실제 파일을 프로그램적으로 복사→**두 필드만** 치환한 arm으로 비교했다(SSOT 하나).

**(a) 케이스 60건 → PASS** (`v2-verify.js`)
기존 DENY 유지 5 · 1차 신규 포착 9 · **L2 지적 19** · 회피(공백/탭/`-c core.pager=cat`) 3 · merge 플러밍 4 · 안전형태 20.

> `SAFE_KEEP`에 과잉 차단 감시용 안전 형태를 20건 넣었다: `clean -n`·`--dry-run`, `restore --staged <경로>`·`-S <경로>`, `checkout -b`·`checkout main`·`checkout feat/my-branch`, `reset HEAD~1`·`--soft`·`reset HEAD <경로>`, `add -A`, `stash`, `log --grep rebase`, `commit -m "…merge conflict"`. **전건 등급 불변.**

**(b) 감사로그 전수 40,108 고유명령** (Windows 원본 cwd = 라이브 조건)

```
상향(강화) 49 | 하향(완화) 53 | 예상밖 0
```

**(c) 상향 49건 정밀 분류** — 인용/heredoc 구간을 문자 단위로 추적해 매치가 **실행되는 위치인지** 판정:

| | v0.1 | **v0.2** |
|---|---|---|
| 실행되는 파괴적 명령(진짜 구멍) | 28 | **46** |
| heredoc 문서작성 본문(오탐) | 3 | **3** |

**축을 바꿔 18건을 더 잡았고 오탐은 늘지 않았다.**

> ⚠️ 처음엔 "진짜 19 / 오탐 12"로 셌다. `echo` 뒤면 무조건 payload로 세는 조잡한 휴리스틱이라 `echo "…" && git checkout -- file` 같은 **진짜 실행**을 오탐으로 분류했다. 인용 상태를 실제 추적해 정정했다.

**(d) 하향 53건 안전성** — 전부 `merge-base`/`merge-tree` 읽기전용 조회. 실행되는 머지/파괴 명령이 섞인 건 **0건**.

---

## 6. 적용 — 손편집 금지 (L2 blocker `2811aa0c`)

정규식이 1,000자에 육박하고 JSON 이스케이프가 필요하다. **백슬래시 하나만 깨지면** `risk-classify`의 `JSON.parse`가 실패하고 **fail-open(T1 allow)** 으로 떨어져 DENY를 포함한 **게이트 전체가 조용히 무력화**된 채 `maia-deploy`로 Windows까지 전파된다.

그래서 적용을 **검증 내장 스크립트**로 만들었다. 쓰기 전에 ① 대상 규칙 수 일치 ② JSON 왕복 ③ 정규식 컴파일 ④ **스모크 32건**을 모두 통과해야만 파일을 건드린다.

```
확인:  node ~/p1c/candidates/gate-rule-audit/apply.js --check     ← 변경 없음
적용:  node ~/p1c/candidates/gate-rule-audit/apply.js --apply     ← 대표 ! (T3)
동기:  node ~/.ai-bootstrap/maia-deploy.js
롤백:  node ~/p1c/candidates/gate-rule-audit/apply.js --rollback
```

`--check` 는 이미 통과 확인했다(스모크 32/32). 백업은 `decision-policy.json.bak-gate-audit` 로 자동 생성된다.

**적용 결과(2026-09-07, 대표 `!`)**: 스모크 32/32 → 적용 → **라이브 게이트 실증 31/31** · `risk-classify.test.js` **237/237** · C6 `policy-classify.test.js` **53/53** · `maia-deploy` **drift 0**(81 shared). 백업 생성 확인.

---

## 7. 잔여 위험 — 새 오탐 3건은 하드블록이 된다

heredoc으로 문서를 쓰다 본문에 `git checkout --` 텍스트가 들어간 3건은 **DENY = 항상차단**이라 모달 없이 거부된다. 기존 오탐 계열 ②([[decision-gate-scans-command-text]])다.

> ⚠️ **v0.2 권고 철회 — 사실확인 오류 (2026-09-07 정정)**
> v0.2는 *"[[2026-09-01-exec-payload-mask-spec]]이 대표 판정 대기 중이니 두 spec을 함께 적용하면 3건이 소멸한다"* 고 적었다. **두 부분 다 틀렸다.**
>
> 1. **마스킹은 이미 적용돼 라이브다.** `risk-classify.js`에 `maskExecPayload`가 있고 `decision-policy.json`에 `execPayloadMask`(허용 리더 10종)가 살아 있다. spec 본문의 "대표 `!` 대기" 문구만 읽고 미적용으로 단정했다 — **문서의 상태 서술을 적용 여부의 근거로 삼았다.**
> 2. **적용돼 있어도 이 3건에는 효과가 없다.** 마스킹은 설계상 `headScanText`(T2 층)만 비우고 `dangerScanText`(DENY·T3)는 건드리지 않는다(마스킹 spec §2.2 — 그것이 차단력 불변의 구조적 근거). 본 spec의 `git-destructive`는 **DENY 규칙**이라 원문을 본다. 실측:
>
> ```
> headScanText(T2층)     에 패턴 잔존?  false   ← 마스킹이 지움
> dangerScanText(DENY층) 에 패턴 잔존?  true    ← 원문 그대로
> 판정: DENY / git-destructive
> ```

**대표 판정(2026-09-07): (가) 그대로 둔다.** 빈도 3/47,510이고, 걸리면 `!`로 넘긴다. 대안 (나) `checkout -- ` 대안만 DENY→T2 강등은 진짜 `git checkout -- .`도 함께 내려가므로 채택하지 않는다. **DENY 층을 마스킹 대상에 넣는 것은 선택지가 아니다** — 마스킹 설계의 안전 근거 전체가 무너진다.

---

## 8. 마찰 고지 — `clean -fd`가 DENY가 되면

실측 4건은 정상적인 빌드 산출물 정리로 보인다(`workers/*/dist-check`). 적용 후엔 대표님 `!` 없이 불가능하다.

`clean -f`가 이미 DENY이므로 **등급 일관성 관점에선 이게 맞다**(같은 파괴력인데 플래그 하나로 등급이 갈리는 게 비정상이었다). 대안:

- **(가) 그대로 DENY** — **✅ 채택(2026-09-07 적용).** 빈도 낮고(4/47,510) 되돌릴 수 없는 삭제
- (나) `clean`만 T2(ask)로 분리 — 마찰 감소, 단 `clean -f`와 등급이 갈림
- (다) 빌드 산출물 경로 예외 — C6 오버레이 선례 있으나 화이트리스트 유지비용

마찰이 실제로 거슬리면 (나)로 전환하거나 `apply.js --rollback` 으로 전체 되돌린다.

---

## 9. 이 감사로 닫힌 것과 남은 것

**닫힘**: ① 옵션 접두 우회(2/7 → 0, `gh` 포함) · ③ 결합플래그 갭(1/52 → 0) · ② 부분(`merge-base`·`merge-tree`·`merge-index` 해제)

**남음**: ② `commit-tree`·`commit-graph`가 `git-commit`(T2)에 걸린다. **저위험 과잉 차단**이고 실사용 0건이라 제외했다 — 필요해지면 `commit(?!-)` 한 글자로 해소된다.

**전수 감사의 효용**: 건별로 갔으면 `merge-base` 하나 고치고 끝났을 것이다. 전수로 보니 같은 뿌리(`\b`)에서 **미탐 10형태·실행 7건**이 나왔고, L2가 축의 한계까지 지적해 **최종 46건**을 닫았다. `restore --staged .`는 규칙에 적혀 있으면서 한 번도 발화한 적이 없었다.

---

## 10. 🚩 대표 판정 필요 — L2 미합의 3건

1. **`694c55ae`** (claude 제기): 검증 코퍼스에 회피 케이스가 없어 "예상밖 0"은 과거 재현성만 증명한다. → **v0.2에서 회피 케이스 3건을 코퍼스에 추가**해 부분 해소. 다만 "알려진 우회형태는 반드시 DENY"라는 합격 기준을 spec에 명문화하라는 지적은 유효하다(§5(a) `GATE` 축이 그 역할).
2. **`3e91ad19`** (claude 제기): §8의 마찰 근거(4건)와 §5의 차단 규모(46건)가 모집단이 다르다(47,510 이벤트 vs 40,108 고유명령). → **두 수치 모두 병기**했다. 판단은 "clean -fd 4건" 위에서 하시면 된다(다른 42건은 원래 막혔어야 할 것).
3. **`4817b611`** (gemini 제기): payload 마스킹 spec과 동시 적용이 강제되지 않아 오탐 3건이 하드블록.
   → **✅ 대표 판정: (가) 그대로 둔다(2026-09-07).** 단 이 쟁점의 **전제 자체가 내 오류**였다 — 마스킹은 이미 라이브였고, 적용돼 있어도 DENY 층을 건드리지 않아 이 3건에 효과가 없다(§7 정정 참조). gemini의 지적(동시 적용 미강제)도 claude의 반박(고지된 트레이드오프)도 **둘 다 존재하지 않는 의존관계 위에서 논쟁**했다. 오탐 3건은 마스킹과 무관하게 남는 잔여 위험이고, 대표 판정으로 수용한다.
