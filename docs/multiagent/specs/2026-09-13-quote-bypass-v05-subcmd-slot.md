# 따옴표 우회 v0.5 — 첫 인자 자리를 "서브커맨드일 때만" 벗긴다

- 날짜: 2026-09-13
- 대상: `~/.ai-bootstrap/risk-classify.js` (게이트 SSOT · T3)
- 선행: [[2026-09-10-quote-bypass-spec]] v0.1→v0.4 · 핸드오프 carry "오탐 잔여 40건"
- 상태: **L2 1차 반영 완료 · 대표 `!` 적용 대기**

---

## 1. 문제 — 잔여 오탐 42건의 실제 구성

v0.4 적용 후 남은 오탐을 기준선(`risk-classify.js.bak-quote-bypass` = v0.1 적용 직전 백업) 대비 전수로 덤프했다(`measure5.js`, 코퍼스 42,004 고유 명령).

| 규칙 | 건수 | 성격 |
|---|---|---|
| `migration` (T1→T2) | 19 | **인용 경로 속 단어** + 히어독 본문 |
| `git-commit:branch-gate` (T1→T2) | 4 | **정탐** — `git -c user.name=…` 은 env 우회라 T2 가 정책이다 |
| `git-destructive`·`rm-rf`·`external-send` (→DENY) | 6 | **언급 텍스트**(09-07 판정: 수용). 이 트랙의 커밋 메시지·하네스 소스가 잡힌 것 |
| `git-push`·`force-push`·`git-clean` (→T3/T2) | 5 | **정탐** — `P="git pu""sh"` 형태의 게이트 프로브 조립. 설계 목적 그대로 |
| `remote-run`·`pkg-install`·`interactive`·`infra` | 8 | 히어독 본문 + 인용 경로 |

즉 42건 중 **"줄일 가치가 있는 오탐"은 약 27건**이고, 나머지 15건은 정탐이거나 이미 수용된 판정이다.

## 2. 진단 — 뿌리는 `pos <= 1` 한 줄

v0.4 의 `dequoteHead` 는 T2 헤드 레인에서 **명령 위치(pos 0)와 첫 인자(pos 1)** 를 벗긴다.

```js
res += (isAssign || (!multiWord && !isValue && (pos <= 1 || isFlag))) ? cand : buf
```

첫 인자를 벗기는 유일한 이유는 **서브커맨드**다 — `git "clean"` · `gh "pr"`. 그런데 그 자리에 인용된 **경로**가 오면 경로 속 단어가 그대로 규칙에 먹힌다. `dequoteHead` 단독 관찰(`probe5.js`) — 이것은 **중간 출력**이지 분류 결과가 아니다:

```
IN  : ls "D:/…/web/lib/db/migrations/" | head -20
OUT : ls D:/…/web/lib/db/migrations/ | head -20      ← 첫 인자가 벗겨져 경로 속 단어가 헤드에 노출된다
IN  : find . -name "migrations"
OUT : (불변)                                          ← v0.4 의 expectValue 규율이 이미 지킨다
```

⚠️ **중간 출력에서 등급을 추론하면 틀린다.** 위 축약 명령을 실제로 분류하면 v0.4 에서도 `T1/default-cmd` 다 —
노출만으로 규칙이 걸리는 것이 아니기 때문이다. 등급이 실제로 바뀌는 것은 **코퍼스 원문 6건**이며(`relaxed5.js`),
그 전수가 `T2→T1` 로 내려간다. 아래 §7 가드는 그 원문을 쓴다.

`-name "migrations"`(플래그 값)는 v0.4 가 이미 막았다. **남은 구멍은 첫 인자 자리 하나뿐이다.**

## 3. 설계 — 서브커맨드는 경로가 아니다

첫 인자 자리는 **경로형이 아닐 때만** 벗긴다. 판정기는 새로 만들지 않고, 엔진이 이미 쓰는
`HEAD_PATHISH`(`blankHeadTok` 의 판정기, 같은 모듈 스코프)를 **그대로 호출**한다.

```js
const isSubcmdSlot = pos === 1 && !HEAD_PATHISH(cand)
res += (isAssign || (!multiWord && !isValue && (pos === 0 || isSubcmdSlot || isFlag))) ? cand : buf
```

- **DENY·T3 레인(전역 `dequoteCmd`)은 한 글자도 건드리지 않는다** — 차단력 불변이 주장이 아니라 코드 구조다
- 새 정규식 0 — "검증된 규칙 패턴 복제, 새 정규식 발명 금지"

## 4. 실측 (코퍼스 42,004 고유 명령 · WSL + Windows 감사로그)

| 지표 | live(v0.4) | **v0.5 A** | v0.5 B(기각) |
|---|---|---|---|
| 오탐(pre 기준선 대비 상승) | 42 | **37** | 34 |
| 완화(pre 대비 하락) | 0 | **0** | 0 |
| 완화(live 대비) | — | **6 (전량 T2→T1)** | 9 |
| 그중 T3·DENY 완화 | — | **0** | 0 |
| 강화(live 대비 상승) | — | **0** | 0 |
| 시험군 | — | **414/414** (237·124·53) | — |

## 5. 변형 B 를 기각한 근거 — 실측된 구멍

B 는 A + "인용 안의 백슬래시도 경로 구분자"(Windows 경로 3건을 더 잡는다). 그런데 ANSI-C 인용이
백슬래시를 갖기 때문에 **서브커맨드가 경로로 오판된다**. 라이브를 대조군으로 놓고 잰 결과(`probe-ab.js`):

```
git $'\143lean' -fd    live: T2/git-clean   A: T2/git-clean   B: T1/default-cmd  ← 게이트가 풀린다
```

3건을 더 잡으려다 v0.4 가 닫은 우회를 되연다. **A 채택.**

> ⚠️ 같은 프로브의 2행(`$'\x72e…'`)은 조립 실수로 `reeset` 이 되어 **무효**다. 판정은 1행에서 확정됐다.
> (같은 계열 실수가 09-07·09-13 에 이어 세 번째다.)
>
> **대책은 "눈으로 확인"이 아니라 조립을 없애는 것이다**(L2 819fcaab 부분 수용). 이 트랙에서 실제로 한 것:
> ① 가드·측정은 **코퍼스 원문**을 그대로 쓴다(`relaxed5.js` → `relaxed5.json` → 가드). 손으로 짜맞춘 문자열이 아니다.
> ② 조립이 불가피한 게이트 프로브는 **대조군(live)을 같은 표에 찍어** 어긋남이 드러나게 한다.
> ③ ANSI-C 케이스는 `gate-destructive.test.js` 가드로 **상설화**했다 — 다음부터는 프로브가 아니라 시험이 지킨다.

## 6. 남는 것 — 수확체감 구간

해소되지 않는 약 22건의 주된 형태는 `cd "…" && python - << 'PYEOF' …` 의 **히어독 본문**이다.
엔진은 "인자가 곧 실행인 래퍼"(bash -c / node -e / python 히어독)의 payload 를 **의도적으로 원문 유지**한다
(그러지 않으면 `bash -c "systemctl restart x"` 가 헤드 축약으로 infra 탐지를 잃는다).

즉 이 22건은 버그가 아니라 **보수성의 대가**이며, 더 줄이려면 규칙 본문(`migration` 등)을 손봐야 한다 — 별건이고,
차단력에 직접 닿으므로 이 트랙에서 묶지 않는다.

**결론: 이 트랙은 v0.5 에서 수확체감에 도달한다.** 5건 해소를 위해 게이트 SSOT 를 한 줄 바꾸는 것이
값어치가 있는지는 대표 판단 사항이며, 위험 지표는 전부 0 이다.

## 7. 가드 (적용 시 함께 넣는다)

`gate-destructive.test.js` 에 3건 추가 — 규율을 양방향으로 고정한다.

| 케이스 | 기대 | 지키는 것 |
|---|---|---|
| **라이브 오탐 원문** `cat "D:/BestConsulting_OS/wiki/…/2026-06-30-claude-md-history-migration-design-…md" 2>/dev/null \| head -80` | T1 | 목표 오탐 해소 |
| `git "clean" -fd` | T2 | 서브커맨드는 여전히 벗긴다 |
| `git $'\143lean' -fd` | T2 | B 가 깨뜨린 ANSI-C 경로 |

> ★ 1행은 **축약하면 안 된다.** 처음에 `ls "…/db/migrations/" | head -20` 으로 줄여 넣었더니 v0.4 에서도 통과해
> **가드가 공허했다**(127/127). 축약본은 규칙에 걸리지 않기 때문이다. 코퍼스에서 실제로 내려간 명령 원문을 쓴다.

**비공허성 — 두 축으로 실측했다**(`nonvacuous5.js`, 라이브 거동 대조):

| 축 | 뜻 | 결과 |
|---|---|---|
| `live` (v0.4) | 규율이 없으면 | **1건 실패** — 오탐 가드가 실제로 기능한다 |
| `B` | 과도하게 완화하면 | **3건 실패** — 서브커맨드 가드들이 실제로 기능한다 |

두 축 모두에서 깨지므로 세 가드는 공허하지 않다.

## 8. 적용·롤백

- 적용기 `~/p1c/candidates/quote-bypass/apply5.js --check|--apply|--rollback` (v0.4 `apply4.js` 의 안전판 6종 계승:
  STAMP 선기록 · 적용 직전 새 백업 + 해시 가드 · 재적용 차단 · Windows 동기 실패 시 WSL 원복 · 재동기 실패 구분 · 롤백 후 `maia-deploy --check`)
- 백업: `risk-classify.js.bak-quote-v5` · `gate-destructive.test.js.bak-quote-v5`
- **적용 후 필수**: `node ~/.ai-bootstrap/gate-ssot-ledger.js --seal --reason "quote-bypass v0.5"` — 안 하면 다음날 health 가 FAIL 을 낸다(의도된 동작)
- 게이트 SSOT 는 T3 이므로 **대표 `!` 로 실행**한다
