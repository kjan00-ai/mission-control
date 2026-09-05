# git 인자·커밋메시지 오탐 제거 spec

- **문서유형**: spec (구현 완료·검증 완료, 대표 `!` 적용 대기) · v0.1
- **작성일**: 2026-09-01
- **발단**: 대표 지시 *"커밋 메시지 오탐도 처리해줘"*. 적용 직후 감사로그에서 실사례 포착 — `git commit -m "docs(multiagent): npx 로컬 개발도구 판별 spec …"` 이 **메시지에 `npx`가 들어갔다는 이유로** `remote-run` T2 모달.
- **설계 기준**: BC/SF Windows 감사로그 (메모리 [[maia-design-baseline-is-bc-sf-not-mc]])
- **선행**: [[2026-08-31-t2-gate-precision-spec]](A안) · [[2026-08-31-npx-local-tool-precision-spec]](npx) — **둘 다 적용·배포 완료**
- **대상(T3, 대표 `!`)**: `~/.ai-bootstrap/risk-classify.js` (+ `risk-classify.test.js` 샘플 1줄)

---

## 1. 문제

두 종류의 **실행되지 않는 데이터**가 명령 텍스트로 스캔되어 T2를 유발한다.

| 형태 | 예 | 잘못 걸리는 규칙 |
|---|---|---|
| **커밋 메시지** | `git commit -m "docs: npx 로컬 도구 판별"` | `remote-run` |
| | `git commit -m "fix: migration 순서 수정"` | `migration` |
| **git add 경로** | `git add migrations/0123_feed.sql` | `migration` |
| | `git add docs/…-npx-local-tool-spec.md` | `remote-run` |

커밋 메시지는 셸이 실행하지 않는 문자열이고, `git add`의 인자는 인덱스에 등록될 경로일 뿐 실행되지 않는다.

---

## 2. 설계 — 정규식 열거 2곳 추가 (로직 변경 없음)

**① `READ_LEADERS` 에 `git add` 추가** → 기존 `blankArgs()`가 인자 전체를 길이 보존 blanking.
`git add`는 조회 명령은 아니지만 **인자를 EXECUTE 하지 않는다**는 `READ_LEADERS`의 본질 조건을 충족한다. 기존 보수 조건(리다이렉션 `<>` / 명령치환 `$()`·백틱 존재 시 blanking 취소)이 그대로 적용된다.

**② `git commit` 전용 `blankCommitMessage()` 신설** → 커밋 메시지(인용문)만 blanking하되 **인용 내용이 `-`로 시작하면 보존**.

> **⚠️ 초안 폐기 — L2 blocker `cc9f3ee6`(실측 확인)**
> 처음에는 `DATA_SINKS`에 `git commit`을 추가해 기존 `blankQuotes()`를 재사용하려 했다. codex가 *"따옴표로 감싼 진짜 플래그가 데이터로 오인된다"*고 제기했고(gemini는 반박), **실측 결과 codex가 옳았다**:
>
> | 명령 | 현행 | 초안 |
> |---|---|---|
> | `git commit -m "x" "--no-verify"` | T2 | **T1 ⛔** |
> | `git commit -m 'x' '--no-verify'` | T2 | **T1 ⛔** |
> | `git commit -m "x" "--amend"` | T2 | **T1 ⛔** |
> | `git commit "--no-verify" -m "x"` | T2 | **T1 ⛔** |
>
> 셸이 따옴표를 제거하므로 git에는 **진짜 플래그로 전달**된다 → feat/*에서 hook bypass·이력 재작성이 자율 허용될 뻔했다. **우회 4건 실측.**

수정된 설계:
- 인용 내용이 `-`로 시작 → **보존**(플래그일 수 있으므로) → `denyIfRe`의 `--amend`/`--no-verify` 방어 유지. **재검증 결과 우회 0건.**
- 쌍따옴표 속 `$( )`·백틱은 `skipSub`로 **보존** → `git commit -m "$(sudo cat /etc/shadow)"` 계속 포착
- `git commit` 토큰 자체는 남으므로 **`git-commit` 규칙·브랜치 판정 불변**
- `READ_LEADERS`(인자 전체 blanking)를 쓰지 않는 이유도 동일 — 플래그까지 지워지기 때문

**③ `dangerScanText` 분기 추가** — `blankArgs` 시도 **전에** `git commit` 세그먼트를 전용 처리로 보낸다.

**④ 기존 테스트 샘플 1줄 교체** — `risk-classify.test.js`의 lossless 테스트는 *"sink 리더가 없을 때"* 무손실을 검사하는데, 그 샘플이 하필 `git commit -m "x" && git push` 였다. `git commit`이 sink가 되면 **테스트의 전제가 깨진다(기능 결함 아님)** → sink가 아닌 `git tag -a v1 -m "x" && git push` 로 교체. 드라이런이 이 충돌을 사전 포착했다.

---

## 3. 검증 결과 (격리 사본 드라이런, 원본 미변경)

| 항목 | 결과 |
|---|---|
| 기존 단위 테스트 | **237 / 237** |
| A안 회귀 (선행 패치) | **58 / 58** |
| npx 회귀 (선행 패치) | **25 / 25** |
| 본 패치 회귀 | **27 / 27** (게이트 17 · 통과 8 · 브랜치 2) |

**안전 회귀(반드시 게이트 유지) — 17/17**
`git commit -m "$(sudo cat /etc/shadow)"`(쌍따옴표 속 치환) · ``git commit -m "`sudo id`"``(백틱) · `git commit -m "x" && rm -rf /tmp/x`(다른 세그먼트 DENY) · `git commit -m "msg"; sudo systemctl restart x`(체인 뒤쪽) · `git commit --amend`·`--no-verify`(평문) · **따옴표 감싼 `"--no-verify"`·`'--no-verify'`·`"--amend"`·플래그 선행·주석 뒤따름(L2 blocker 5종)** · main 브랜치 커밋 · `git add x && sudo systemctl restart y` · `git add $(sudo cat …)`(치환 → 취소) · `git add x > /etc/hosts`(리다이렉션 → 취소) · `git commit -F <(rm -rf /)`(프로세스 치환) · `git add . && pnpm install zod`

**오탐 해소 — 8/8** · **브랜치 판정 보존 — 2/2**(main=게이트 / feat/*=자율)

**부수 발견(구현 중)**: 패치 스크립트가 `String.replace`에 **문자열** replacement를 쓰면 삽입 코드의 `'$'` 리터럴이 `$'` 특수 치환 패턴으로 해석되어 코드가 깨진다. 드라이런의 구문 검사가 이를 포착했고, replacement를 **함수**로 바꿔 해결했다.

---

## 4. 기대 효과 — 작다 (정직 보고)

**전수 실측(선행 2패치 적용본 대비 순증)**: BC/SF 36,854건 중 **완화 20건 · 강화 0건**, MC 698건 중 완화 2건. 누적 모달 해소율은 **33.2% → 33.4%**(2,882 → 2,902건). 규칙이 사라지는 건은 99건이지만, 그중 84건은 **같은 명령의 `git commit` 규칙이 남아 모달이 유지**된다.

⇒ 본 패치의 효과는 **커밋 단독호출 규약**([[commit-standalone-call-for-branch-autonomy]])과 결합할 때 커진다. `git add x`(단독)는 이 패치로 오탐이 사라지고, `git commit -m "…"`(단독·feat/*)은 `branchAllow`로 자율이 되기 때문이다. 두 조치가 함께여야 84건 중 상당수가 실제로 해소된다.

변경 자체는 정규식 열거 2곳이고 안전 검증에서 누출 0이므로 **비용 대비 위험이 매우 낮다**.

---

## 5. 적용 / 롤백

```bash
node ~/p1c/candidates/git-args/apply.js --dry   # 원본 미변경 검증
node ~/p1c/candidates/git-args/apply.js         # 실제 적용  ← 대표 `!`
node ~/.ai-bootstrap/maia-deploy.js             # WSL↔Windows 동기
```
`apply.js`는 선행 패치(A안) 적용 여부를 확인하고, 앵커 4개(코드 3·테스트 1)가 정확히 1회씩 매칭될 때만 진행하며, **기존 테스트 + 선행 패치 회귀 2종 + 본 회귀**를 모두 돌려 하나라도 실패하면 자동 롤백한다.

**롤백**: `node ~/p1c/candidates/git-args/rollback.js` → `maia-deploy.js`
