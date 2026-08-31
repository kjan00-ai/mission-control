# T2 게이트 정밀화 spec — 모달 오탐 근본 제거 (A안, 1단계)

- **문서유형**: spec **v0.3 — 구현·검증 완료, 대표 `!` 적용 대기**
- **작성일**: 2026-08-31
- **발단**: 대표 지시 — *"실제로 no를 선택한 경우가 손에 꼽을 정도로 적은데, 모달 자체가 의미가 있냐"* / 선행 *"지속적인 모달로 개발 중 계속 모니터링해야 하는 문제 = MAIA 근본목적 위배"*
- **대표 결정(2026-08-31)**: **A안 먼저 적용**, 나머지 사안은 핸드오프 기재
- **상위 원칙**: [[maia-founding-purpose-save-owner-time]] · [[t2-modal-formal-replace-with-evidence-verify-fallback]]
- **변경 대상**: `~/.ai-bootstrap/risk-classify.js` **1개 파일**(T3 gate-self-classifier, 대표 `!` 전용). `decision-policy.json` **미변경**.
- **L2**: codex ∥ gemini 3R — blocker 1건 **실측 확인 후 반영**, escalate 1건 **설계로 해소**

---

## 1. 문제 (실측 확정)

### 1.1 모달은 안전 필터로 기능하지 않는다
트랜스크립트 1,016파일 / 36일(2026-07-27~08-31) 전수 스캔:

| 도구 | 호출 | 인간 거부(no) | 거부율 |
|---|---:|---:|---:|
| 전체 | 20,283 | 6 | **0.030%** |
| Bash | 14,206 | 5 | 0.035% |
| Edit/Write | 3,305 | **0** | 0.000% |

거부 6건 전수 확인: **4건은 워크플로우 거부**(위험이 아니라 방향 오류로 중단), 안전 목적 거부는 **많아야 2건**.

### 1.2 반면 마찰은 상시적이다
audit `risk-*.jsonl`: 모달 밀집 구간 **연속 간격 중앙값 228초** → 구현 세션 중 **약 4분마다 1회** 대표 개입.

### 1.3 근본원인은 규칙이 아니라 **스캔 단위**
현행은 명령 전체 텍스트를 한 덩어리로 정규식 매칭 → grep 패턴·파일명·스크립트 리터럴까지 스캔 대상. **단어를 언급만 해도** T2/DENY가 된다.

실측 오탐(전부 상태 미변경): `grep -nE "ALTER TABLE" src/lib/migrations.ts`(**파일명**) · `node -e "…['migration']…"`(**스크립트 문자열**) · `systemctl --user is-active` · `crontab -l | grep c6`(**읽기 서브커맨드 미구분**) · `ps -o pid,cmd -p 75019` · `tail -5 …/c6-concordance.js`(**`2>/dev/null`의 `>`가 뒤 경로와 결합해 `gate-write-bash` DENY 오탐**).

---

## 2. 설계 — 기존 구조에 얹는 최소 변경

`risk-classify.js`에는 이미 **세그먼트 분해기(`splitTopLevel`)**, **인용 blanking(`blankQuotes`)**, **데이터 싱크 개념(`DATA_SINKS`)** 이 완비돼 있다. 부족한 것은 단 하나 — **`grep`·`ps`·`ls` 같은 조회 도구가 싱크 목록에 없다는 것**이다. 따라서 새 스캐너를 만들지 않고 기존 파이프라인에 3가지를 더한다.

1. **`READ_LEADERS`** — 인자를 **실행하지 않는** 조회 리더 목록(grep/rg/ls/head/tail/wc/ps/stat/jq/diff/git 읽기 서브커맨드 등).
2. **`blankArgs()`** — 그 리더의 세그먼트는 인용문뿐 아니라 **인자 전체를 길이 보존 blanking**. 인자가 실행되지 않으므로 실행 위험이 생기지 않는다.
3. **`readSubExempt()`** — `systemctl status`·`crontab -l`·`docker ps` 등 **읽기 서브커맨드**면 세그먼트 전체를 면제. 값을 받는 플래그는 arity를 인지해 값 토큰을 건너뛴다(`kubectl -n ns get`).

**blanking을 취소하는 보수적 조건(3중)**
- **리다이렉션** `< >` 존재 → 파일을 쓸 수 있다
- **명령치환** `$( )` · `` ` `` · `${ }` 존재 → 셸이 실제로 실행한다
- **스트리밍** `tail -f`/`-F`/`--follow`, `-w`/`--watch` → 블로킹(교착)이므로 `interactive` 규칙이 계속 잡아야 한다

**의도적 제외(인자가 곧 실행)**: `bash|sh|zsh -c` · `node -e` · `python -c` · `perl|ruby -e` · `eval` · `xargs` · `env` · `sudo` · `find(-exec/-delete)` · `sed -i` · `awk` · `tee` · `watch`. 이들은 리더 목록에 없으므로 **종전대로 전체 텍스트 스캔**된다.

> **L2 blocker `8d9fd76e` 대응**: codex는 "래퍼가 인자 문자열을 실제 실행하므로 헤드 스캔이 T2를 무력화한다"고 제기했고, **실측 결과 7건 중 6건이 실제로 회귀**했다(`bash -c 'systemctl restart …'` → infra 미탐 등). A안은 래퍼를 애초에 싱크 목록에 넣지 않아 이 경로를 **구조적으로** 차단한다.
>
> **L2 escalate `8ae5dd76` 대응**: `branchAllow`/`trustedAllow` 평가를 **전체 `scanCmd` 기준으로 그대로 유지**(세그먼트 단위로 내리지 않음)하므로 `denyIfRe`의 체인 문자 거부가 계속 작동한다. codex가 우려한 `git commit -m … ; touch …` 경로는 성립하지 않는다 → **판정 불필요**.

---

## 3. 검증 결과 (격리 사본 드라이런, 원본 미변경)

| 항목 | 결과 |
|---|---|
| 기존 단위 테스트 | **237 passed / 0 failed** |
| 위험 명령 게이트 유지 | **38 / 38** |
| 오탐(조회·언급 통과) | **0건** |
| 전체 613 Bash 이벤트 대비 | 게이트→자율 **13건** · 자율→게이트 **0건** |
| audit ask(Bash) 38건 | **11건 해소(28.9%)** |

**게이트 38건에는 A2 자기보호 6건이 포함**된다 — `echo x > …/risk-classify.js`, `cp … decision-policy.json`, `tee … c6-policy.json`, `sed -i … risk-classify.js`, `mv … policy-classify.js`, `>> …/.claude/hooks/…` 는 **전부 DENY 유지**. 동시에 `tail -5 …/risk-classify.js`·`grep -n … decision-policy.json` 같은 **조회는 통과** — 쓰기와 읽기가 정확히 분리된다.

완화된 13건은 전수 확인 결과 **전부 조회 명령**(grep/cat/tail/`crontab -l`/`systemctl --user list-timers`)이다.

**드라이런이 잡은 실제 회귀 1건**: 초안에서 `tail -f`가 T2→T1로 풀렸다(블로킹 교착 위험). 스트리밍 취소 조건을 추가해 해소했고, 이 케이스는 회귀 테스트에 편입했다.

---

## 4. 적용 / 롤백

```bash
node ~/p1c/candidates/t2-precision/apply.js --dry   # 원본 미변경 검증 (선택)
node ~/p1c/candidates/t2-precision/apply.js         # 실제 적용  ← 대표 `!`
node ~/.ai-bootstrap/maia-deploy.js                 # WSL↔Windows 동기
```
`apply.js`는 **백업 → 앵커 정확히 1회 검증 → 패치 → 구문검사 → 기존 237 테스트 → 회귀 테스트** 순으로 진행하고 **하나라도 실패하면 자동 롤백**한다. 중복 적용도 차단한다(`READ_LEADERS` 존재 시 중단).

**롤백**: `node ~/p1c/candidates/t2-precision/rollback.js` → `maia-deploy.js`

---

## 5. 병행 조치 — 에이전트 행동 규약 (정책 변경 불필요)

잔여 27건 중 **12건이 `git add … ; git commit …` 체인**(`git-commit` 9 + `branch-gate` 3)이다. 원인은 정책이 아니라 **호출 형태**다:
1. `branchAllow.requireRe`의 `^git commit` 앵커가 `git -C <path> commit`을 배제 — **의도된 안전장치**(훅은 `evt.cwd`로 브랜치를 판정하므로 `git -C`는 검증을 무의미하게 만든다). **완화하지 않는다.**
2. `denyIfRe`가 체인 문자(`&`·`|`·`;`)를 거부.

⇒ **규약**: 커밋은 검증/staging과 **분리해 단독 호출**하고, `git -C`·`cd` 체인 대신 **cwd를 맞춘 뒤 `git commit -m "…"` 단독** 실행. 이것만으로 12건이 자율 통과한다.

**A안 + 행동규약 합계 ≈ 38건 중 23건(60%) 해소, 안전 손실 0.**

---

## 6. 후속 (핸드오프 이관)

- **B안(헤드 스캐너)** — 모든 세그먼트를 실행 헤드로만 판정. 검증 완료(안전 26/26·오탐 0·해소 47.4%)이나 신규 코드가 늘어 **A안 적용 후 잔여 마찰을 보고 판단**.
- **2단계 — 모달 폐지(T2 → 사후검증)**: 대표 승인 방향이나 **Bash 축에 안전판이 없어** 선결 필요. 실측된 결함 3건: `pre-risk-classify.js:248`(pre-image가 Edit/Write 전용, Bash 원천 제외) · `c6-rollback.js`(advisory·미실행, `migration`/복합 `mv`는 `derivable:false`) · Stop 훅 사후 L2(문서 산출물만 검증, Bash 결과 미커버).
- **격리 실행 레인(worktree)** — 2단계의 가장 강한 안전판 후보. 타당성 실측 미착수.
