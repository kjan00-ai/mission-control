# 래퍼 실행 payload 마스킹 — T2 스캔에서 heredoc·`-c` 본문 분리 (spec v0.2)

- 날짜: 2026-09-01
- 대상 파일: `~/.ai-bootstrap/risk-classify.js`(T3 owner-only) · `~/.ai-bootstrap/decision-policy.json`(T2)
- 코퍼스 스냅샷: **2026-09-01T03:43:49Z** — `~/p1c/candidates/exec-payload-mask/measure/corpus/`(risk-*.jsonl 77파일 50,136레코드), 고정 데이터셋 `baseline-14d.json`(14일 ask 1,696건)
- 선행: `2026-09-01-subshell-head-precision-spec.md`(B안 헤드 정밀화) — 본 spec은 그 위에 얹는다

---

## §1 배경 — 무엇이 남았고, 이건 그중 무엇인가

ASK(T2 모달) 층의 안전 기여는 0.030%(20,283건 중 인간거부 6건, Edit/Write는 0)로 실측 확정돼 있다. 잔여 모달 감소가 곧 대표님 시간 절약이다.

고정 코퍼스 재분류 결과 **잔여 754건**의 구성:

| 구분 | 건수 | 비중 | 해법 |
|---|---|---|---|
| 커밋 호출 규약 위반 | 421 | 55.9% | 코드 0 (규약 효과로 33→4~7건/일 감소 중) |
| **래퍼 본문전용 오탐** | **134**(상한 추정) | 17.8% | **본 spec** — 실구현 완화는 **92건 · 12.2%**(§4-R) |
| 진짜 실행(가역) | 93 | 12.3% | 별건(Bash 축 안전판) |
| remote-run 원격쓰기 | 106 | 14.1% | 비가역 → 게이트 유지가 정답 |

### 1.1 대상 134건의 정체

BC/SF 세션이 `python - <<'PY' … PY` / `python -c "…"` / `cat <<'EOF' … EOF` 로 **파일을 쓸 때**, 그 **본문 텍스트**가 T2 룰에 걸린다.

| 실측 예 | 오탐 룰 | 트리거한 것 |
|---|---|---|
| `python - <<'PY' … io.open('CLAUDE.md','w') … PY` | `migration` | 본문 안 `migrations/` 문자열 |
| `mut() { python - "$1" "$2" <<'PY' … PY` | `move-rename` | 파이썬 변수명 `rm` |
| `cat > .github/workflows/x.yml <<'EOF' … pip install … EOF` | `pkg-install` | YAML 내용 |

**실행되는 명령이 아니라 데이터가 게이트를 트리거한다.**

분해: heredoc 본문 **96건(71.6%)** + `-c`/`-e` payload **38건(28.4%)**, 겹침 **0**.
heredoc 리더 분포: `python` 78 · `cat` 25 · 기타 1(측정 스크립트 아티팩트).

### 1.2 왜 지금까지 "수정 불가"였나 — 그 전제가 무너진 지점

직전 세션 판정: *"본문을 스캔에서 빼면 `python - <<'PY' … os.system("rm -rf /")` 우회가 열린다."*

맞는 지적이지만 **전제가 틀렸다.** 분류기의 스캔 텍스트는 이미 두 갈래다:

- `headScanText(cmd)` (risk-classify.js:534) — **T2 커맨드 룰 전용**
- `dangerScanText(cmd)` (risk-classify.js:543) — **denylist·T3 전용, 원문 보존**

이 분리는 B안(서브셸 헤드 정밀화)이 세웠고, 그 주석이 명시한다: *"⚠️ dangerScanText(denylist·T3)에는 적용하지 않는다 — 서브셸에서 원문을 유지해야 차단력이 불변."*

⇒ **T2 쪽에서만 본문을 비우면 `rm -rf /` 우회는 열리지 않는다.** 본 spec은 새 분리를 발명하지 않고 기존 분리를 한 층 더 쓴다.

---

## §2 설계

### 2.0 원칙

> **래퍼의 실행 payload 는 DENY 층에는 코드, T2 층에는 데이터다.**
> **단 payload 가 셸을 다시 부르면 그 구간은 T2 층에도 코드다 — 마스킹하지 않는다.**

**⚠️ v0.1 의 (e)안은 폐기됐다.** 처음에는 "payload 안에서 `irreversible: true` 룰 정규식에 매치되는 부분문자열만 원문 보존"으로 설계했다. **회귀 테스트와 L2(blocker `c1b5946b`)가 독립적으로 같은 결함을 잡았다** — 정책의 룰 정규식은 *실행 형태*가 아니라 **맨 부분문자열**이다(`migration` re=`migrat`, `privilege` re=`\bsudo\b`, `infra` re=`\b(docker|kubectl|systemctl|…)\b`). 그래서 보존 규칙이 **목표 오탐을 그대로 되살렸다**(본문 안 `migrations/` 문자열·`sudo` 단어가 다시 T2). §2.1(e) 가 근거로 든 "`migrations?\s+apply` 같은 실행 형태"는 **정책에 존재하지 않는 정규식**이었다.

대체 설계 — **셸 재호출 감지**: payload 안에 `os.system` · `subprocess.` · `child_process` · `execSync` · `popen` · `%x(` 류가 하나라도 있으면 **그 구간 전체를 마스킹하지 않는다**. 셸을 다시 부르는 순간 payload 안 문자열은 실행되는 명령이기 때문이다.

이 목록이 **retention 의 유일한 안전장치**다. 실측 근거(기준선 판정):

| 형태 | 기준선 | 마스킹 시 |
|---|---|---|
| `node -e "…execSync('pkill -9 1234')"` | **T2**(process-kill) | T1 로 하락 → 감지기가 막는다 |
| `python -c "…os.system('npx wrangler deploy')"` | **T2**(remote-run) | T1 로 하락 → 감지기가 막는다 |
| heredoc 본문의 `os.system("npx wrangler deploy")` | **T1** | T1 (변화 없음) |

세 번째 줄이 중요하다. heredoc 본문의 deploy 는 **기준선에서도 게이트가 아니다**(`headOfSegment` 가 인용문을 `_` 로 치환하므로). 그걸 이 패치에서 새로 잡으려 드는 것은 **범위 초과**다 — 목표는 retention 이지 강화가 아니다. v0.1 은 이 구분을 못 해 "있지도 않은 안전을 지킨다"고 적었다.

### 2.1 파싱 규격 (정확 명세)

신규 순수 함수 `maskExecPayload(cmd, policy)`. **길이 보존 치환**(대상 구간을 같은 길이의 공백으로) — 기존 offset·`sep` 재조립 로직이 그대로 동작한다.

#### (a) 상태 기계 — 인용 인식

`splitTopLevel`(risk-classify.js:67)과 **동일한** 인용/이스케이프/치환 상태 기계로 순회한다. 마스킹 후보는 **작은따옴표·큰따옴표·백틱 밖(unquoted)** 에서 만난 토큰만이다. `echo "a << b"` 의 `<<` 는 후보가 아니다.

`$( )` · `${ }` · 백틱 **안쪽**에서 만난 `<<` 는 **마스킹하지 않는다**(보수). 기존 `headOfSegment`(risk-classify.js:516)가 명령치환이 있으면 원문을 넘기는 것과 같은 판단이다.

#### (b) heredoc 구간

- **연산자**: `<<` 또는 `<<-`. 앞에 fd 숫자(`0<<`) 허용. **`<<<`(here-string)은 제외** — 부정형 선읽기 `(?!<)` 로 배제한다.
- **구분자 워드**: `TAG` / `'TAG'` / `"TAG"` / `\TAG`. 인용 여부는 확장 유무만 바꾸므로 **마스킹 판정에는 무관**하다(태그 문자열만 취한다).
- **본문 시작**: 연산자가 놓인 **논리 줄이 끝난 다음 줄**부터다. 연산자 직후가 아니다 — `python - <<'PY' && echo hi` 의 `&& echo hi` 는 본문이 아니라 명령의 일부다.
- **본문 끝**: `구분자만 있는 줄`. 앞뒤 공백 없음. `<<-` 이면 **선행 탭만**(스페이스 아님) 제거 후 비교한다(POSIX).
- **한 줄에 heredoc 2개 이상**(`cmd <<A <<B`): 본문이 **선언 순서대로** 이어진다.
- **미종결**(구분자 줄 없음): 파싱 신뢰 불가 → **마스킹 포기, 원문 유지**(fail-safe).

#### (c) `-c` / `-e` payload 구간

- 기존 `WRAPPER_EXECFLAG`(risk-classify.js:453, `/^-(?:l?c|e|-eval|-check)$|^-[a-z]*c$/`)에 매치되는 토큰 **직후의 인용 문자열 1개**.
- 인용 파싱은 기존 `blankQuotes`(risk-classify.js:141) 규칙을 재사용한다 — `\"` 이스케이프 인식 포함. 미종결 인용 → **마스킹 포기**.

#### (d) 마스킹 허용 리더 — **allowlist(fail-closed)**

리더는 세그먼트 선두 토큰의 basename이며, `stripLeadWrappers`(risk-classify.js:489)로 서브셸·그룹·env 대입을 벗긴 뒤 판정한다.

| 구간 | 허용 리더 | 근거 |
|---|---|---|
| heredoc | `cat` `tee` `python` `python3` `node` `deno` `bun` `perl` `ruby` `php` | 실측 103/104 커버(python 78·cat 25) |
| `-c`/`-e` | `python` `python3` `node` `deno` `bun` `perl` `ruby` `php` | 셸 제외 |

**목록에 없으면 마스킹하지 않는다.** 특히 아래는 **절대 마스킹 대상이 아니다**:

- **셸**(`bash` `sh` `zsh` `ksh` `dash`) · `eval` · `xargs` — 본문이 곧 셸 명령이다. 기존 `IS_SHELL` 분기(risk-classify.js:519)의 판단을 그대로 계승한다.
- **원격 실행기**(`ssh` `docker` `kubectl` `wsl` `psexec` 등) — 본문이 원격에서 실행된다(비가역).
- **DB 클라이언트**(`sqlite3` `mysql` `psql` `wrangler`) — 본문이 DML일 수 있다.

allowlist 는 정책 데이터(`decision-policy.json`)에 둔다. 새 벤더 추가가 코드 수정이 아니게 하기 위함이며, B안이 npx 화이트리스트를 정책 데이터로 둔 선례와 같다.

#### (e) 셸 재호출 감지 — 그 구간은 마스킹하지 않는다

마스킹 후보 구간 안에 아래 중 **하나라도** 있으면 그 구간은 원문 유지한다(부분 보존이 아니라 **구간 전체 포기**).

```
os.system · os.popen · os.exec* · os.spawn* · pty.spawn · subprocess. · commands.getoutput
child_process · execSync · execFileSync · spawnSync · execFile( · spawn(
shell_exec · passthru · proc_open · popen · Kernel.system · Open3. · %x( · qx{
```

정책 데이터 `execPayloadMask.shellExecApis` 에 둔다. **목록이 비면 마스킹 자체를 하지 않는다**(안전장치 부재 = no-op, fail-closed).

#### (f) 파이프 가드 — L2 blocker `64baf6ee`

**논리 줄에 top-level `|` 가 하나라도 있으면 그 줄의 마스킹을 전부 포기한다**(파이프 대상 불문, 보수).

근거: `cat <<'EOF' … EOF | bash` 는 heredoc 소유 세그먼트의 리더가 allowlist 의 `cat` 이지만 **본문이 파이프로 셸에 먹여진다**. 기존에는 본문 각 줄이 독립 세그먼트로 T2 판정을 받고 있었고, denylist 의 `pipe-to-shell` 은 `curl|wget|fetch` 로 시작하는 형태만 잡아 이 형태는 **DENY 로도 걸리지 않는다**. (a)~(e) 만으로는 통째로 새는 경로였다.

### 2.2 배선

`headScanText`(risk-classify.js:534) **한 곳만** 바꾼다:

```
splitTopLevel(cmd)  →  splitTopLevel(maskExecPayload(cmd, policy))
```

`dangerScanText`(risk-classify.js:543)는 **한 글자도 건드리지 않는다.** 이것이 차단력 불변의 구조적 근거다(주장이 아니라 코드 구조).

기존 fail-safe 도 유지: `headScanText` 의 `catch` 는 `dangerScanText(cmd)` 로 폴백하므로, `maskExecPayload` 가 던지면 **원문 스캔**으로 떨어진다(보수).

---

## §3 안전 논증

| 위협 | 방어 |
|---|---|
| heredoc 안 `rm -rf /` · secret 유출 · 외부발신 | `dangerScanText` 미변경 → denylist 가 원문을 그대로 본다. §4 ② 로 실측 증명 |
| payload 가 셸 재호출(`os.system`·`execSync`…) | §2.1(e) 구간 전체 마스킹 포기 → 기준선 등급 유지 |
| **`cat <<'EOF' … EOF \| bash`** (L2 `64baf6ee`) | §2.1(f) 파이프 가드 → 줄 전체 마스킹 포기 |
| `bash <<'EOF' … EOF` 로 셸 명령 우회 | allowlist 에 셸 없음 → 마스킹 안 함 |
| `ssh host <<'EOF' … EOF` 원격 실행 | allowlist 에 없음 → 마스킹 안 함 |
| 종료 태그 위조(`PY` 를 본문에 넣어 조기 종료) | 조기 종료 시 남은 줄이 **원문으로 스캔**된다 = 보수 방향 |
| 미종결 heredoc/인용으로 파서 교란 | 마스킹 포기(원문 유지) |
| 파서 자체 예외 | `headScanText` catch → `dangerScanText` 폴백 |
| A2 자기보호(게이트 SSOT 편집) | `gate-write-bash` 는 denylist → `dangerScanText` 경로. 불변 |

---

## §4 검증

**Step 0 (완료)** 코퍼스 고정 — 스냅샷 2026-09-01T03:43:49Z, `baseline-14d.json`. 감사로그는 라이브라 측정마다 총계가 늘므로 **모든 수치에 시점을 병기**한다. **BC/SF replay 는 Windows 원본 cwd 가 라이브 조건**이다.

① **골든 픽스처** `risk-classify.test.js` 237건 — 전건 유지(0 회귀).

② **신규 회귀 약 45종**
- heredoc 15종: 인용/비인용/백슬래시 태그 · `<<-` 탭 들여쓰기 · `<<<` 오탐 방지 · 본문 안에 태그와 같은 문자열 · 미종결 · 한 줄 2개 · `cat <<TAG` 파일쓰기 · `<<TAG && echo` (본문 시작점)
- payload 10종: `-c`/`-e`/`-lc`/`--eval` · 홑·쌍따옴표 · `\"` 이스케이프 · 미종결 인용
- **능동 probe 13종(핵심)**: 합성 MUST_GATE 목록은 **쓰지 않는다.** 실제 게이트 거동을 재현하지 못해 "있지도 않은 안전을 지킨다"는 착각을 만든다 — v0.1 이 그 함정에 빠졌다(heredoc 본문의 deploy 를 MUST_GATE 로 적었으나 기준선이 이미 T1). 대신 **기준선 등급과 대조**한다: 각 probe 를 기준선/패치본 두 버전으로 돌려 `등급(패치) ≥ 등급(기준선)` 을 요구한다. 대상: 셸 재호출 payload · 셸/ssh/sqlite3 리더 · 파이프 형태 · 구조 변형(서브셸 · `timeout` 접두 · heredoc 뒤 실명령).

③ **DENY 불변 증명** — denylist 38종을 heredoc/payload 안에 넣은 변형으로 전건 DENY 유지 확인.

④ **양방향 전수 replay (라이브 vs 패치)** — 고정 코퍼스 1,696건. **"강화 0"만 보지 않는다**:
- 완화 목표 약 134건, 전건을 커맨드 단위로 육안 확인(본문전용 오탐이 맞는지)
- **retention: 기존 T2/T3/DENY 대상이 유지되는가** — 완화 134건 외에 등급이 내려간 건이 1건이라도 있으면 **즉시 중단**
- 강화 0

⑤ **능동 probe 최소 10종** — 코퍼스에 없는 우회를 직접 만들어 시도한다(B안이 이걸 안 해서 서브셸 우회를 놓쳤다).

⑥ **L2 동기 검증** — 본 spec 확정 전 `l2-loop` 직접 호출(codex ∥ gemini). blocker 는 **실측 재현 후** 수정. ⚠️ node **v22** 로 실행(better-sqlite3 ABI).

---

---

## §4-R 검증 실측 결과 (드라이런, 2026-09-01)

| 항목 | 결과 |
|---|---|
| 골든 픽스처 | **237 / 237** (0 회귀) |
| 선행 회귀 체인 8종 | **전건 통과** (t2-precision · npx-local · git-args · head-scan · subshell-head · wrangler-read · d1-read · branch-allow) |
| 본 패치 회귀 | **43 / 43** |
| 고정 코퍼스 1,696건 대조 | **완화 85 · 강화 1 · 불변 1,610** |
| L2 blocker 재현 하네스 | 12종 중 실제 누출 **2**(둘 다 확장 안 되는 리터럴 = 정당 완화) |
| DENY/T3 등급 이탈 | **0** |
| 능동 probe | **13 / 13** 기준선 등급 유지 |

### 완화 85건 — 예상 134건에서 하향 정정 (안전 가드를 넣을수록 내려갔다)

| 단계 | 완화 | 무엇이 줄였나 |
|---|---|---|
| 상한 추정 | 134 | `stripBodies` 정규식 근사 |
| allowlist + 셸 재호출 감지 | 92 | 리더 fail-closed · `os.system` 류 구간 보존 |
| + 파이프 가드 | 92 | (코퍼스에 해당 사례 없음 — probe 로만 확인) |
| **+ 확장 가드 · API 보강** | **85** | 인용 없는 태그·쌍따옴표 payload 의 `$( )`·백틱 보존 |

잔여 754 대비 **11.3%**. 줄어든 49건은 전부 **의도된 보수화**다.

⚠️ 중간에 백틱을 전 리더에 적용했을 때 완화가 **30건까지 무너졌다**. BC/SF 가 파이썬 heredoc 으로 `.md` 를 쓰는데 본문에 백틱이 가득하기 때문이다. 백틱은 **perl/ruby/php 리더일 때만** 셸 실행이므로(`backtickExecLeaders`) 그렇게 좁혀 85 로 회복했다. 보수화도 근거 없이 넓히면 패치가 무의미해진다.

### 강화 1건 — 기존 미탐 해소로 실증됨

`cd "D:\…\best-consulting-hp" && python - <<'PY' … PY` 뒤에 오는 **진짜** `git add … && git commit -q -m "…"` 이 T1(default-cmd) → T2(git-commit:branch-gate) 로 올라갔다.

원인 실증 — 세그먼트 분해를 직접 관찰했다:

| | 세그먼트 수 | `git commit` 이 든 세그먼트 |
|---|---|---|
| 기준선 | **22** | #21, 길이 **617자** — 파이썬 삼중따옴표(`'''`)가 `splitTopLevel` 의 인용 상태를 열어둔 채 뒤의 진짜 명령을 통째로 삼켰다 |
| 마스킹 후 | **49** | #47, 길이 385자 — `git commit` 이 자기 세그먼트를 가진다 |

⇒ **마스킹이 헤드 스캔을 더 충실하게 만든 결과**이고, 기존 게이트 구멍(본문 홀수 인용으로 뒤 명령이 사라짐)을 닫는다. 새 오탐이 아니다.

회귀는 이 구분을 자동화한다: 마스킹은 스캔 텍스트를 줄이기만 하므로 패치본에서 룰이 매치했다면 그 텍스트는 **마스킹 구간 밖의 진짜 명령**이다. 다만 blanking 이 만들 수 있는 오탐이 하나 있다 — 인자가 사라져 `interactive`("인자 없는 REPL")에 새로 걸리는 것(`headOfSegment` 주석의 기존 함정, 실측 강화 58건 이력). **그것만 금지**하고 나머지 강화는 근거와 함께 허용한다.

### L2 결과 (codex 대신 claude ∥ gemini 패널 · 3R)

| 지적 | 처리 |
|---|---|
| `c1b5946b` **blocker** — §2.1(e) irreversible 보존이 목표 오탐을 되살린다(룰 정규식이 실행 형태가 아니라 맨 부분문자열) | **반영** — (e)안 폐기, 셸 재호출 감지로 대체. 회귀 테스트가 독립적으로 같은 결함을 먼저 잡았다(상호 확증) |
| `64baf6ee` **blocker** — `cat <<'EOF' \| bash` 가 allowlist 를 통과해 본문 T2 룰이 통째로 사라진다 | **반영** — §2.1(f) 파이프 가드 신설 + 회귀 4종 |
| `167f4774` **important (refuted)** — '논리 줄' 정의가 백슬래시 연속 등에서 모호 | **✅ 대표 판정: 결함 아님(2026-09-02).** 실측 근거는 §4-E ① |

### L2 2차 (v0.2 spec 대상 · claude ∥ gemini · 3R)

전용 재현 하네스 `~/p1c/candidates/exec-payload-mask/measure/repro-l2-r2.js` 로 **수정 전 12종 중 10종 누출을 실측 확인**한 뒤 고쳤다.

| 지적 | 실측 | 처리 |
|---|---|---|
| `bd516908` **blocker** — 인용 없는 heredoc 태그(`<<EOF`)와 쌍따옴표 `-c` payload 안의 `$( )`·백틱은 셸이 확장(=실행)하는데 §2.1(b)가 "인용 여부 무관"이라 단정해 실행 코드를 데이터로 blanking | `cat <<EOF > f\n$(npx wrangler deploy)\nEOF` **T2 → T1 누출 확인** | **반영** — §2.1(b) 정정, 확장 가드(`expandsToExec`) 신설. 재현 하네스 3/3 유지로 전환 |
| `6d8e5f71` **blocker** — `shellExecApis` 가 perl `system(`/`exec(`/백틱, `from subprocess import run`, `__import__('os').system` 을 누락 | `perl -e 'system("sudo systemctl restart x")'` 등 **5건 누출 확인** | **반영** — 언어별 이름 대신 **호출 형태**(`\bsystem\s*\(`·`\bexec\s*\(`·`\beval\s*\(`)까지 확장, `subprocess`(점 없이)·`__import__`·`importlib` 추가. 5/5 유지로 전환 |
| `d446706b` **important (refuted)** — 수용 기준이 결과를 본 뒤 사후 변경됐다(§4④ '강화 0' → §7 'interactive 강화만 금지') | (b)형 강화 코퍼스 **0건** · probe 5종 **0건** | **✅ 대표 판정: 현 기준 유지 + 경위 명시(2026-09-02).** 실측 근거는 §4-E ②. 지적 자체는 타당하다 — 원리를 먼저 따지지 않고 "강화 0"이라 적은 뒤 결과를 보고 정정했다 |

---

## §4-E 에스컬레이션 실측 (2026-09-02)

두 건 다 **판정 전에 실측으로 근거를 만들었다.** 하네스 `~/p1c/candidates/exec-payload-mask/measure/esc-167f4774.js`.

### ① `167f4774` — 실제 안전 손실 0건

gemini 가 지목한 모호 구문(백슬래시 줄이음 · 한 줄 여러 명령 · CRLF · env 접두 · 경로형 리더)에 **실제로 실행되는 payload** 를 넣어 14종을 시험했다.

| 군 | 결과 |
|---|---|
| 셸 리더 5종(`bash`/`/bin/bash` + 모호 구문) | 전부 **T2 유지**(원문 보존) |
| 파이프-투-셸 4종(파이프가 백슬래시 다음 줄·CRLF·세미콜론 뒤·heredoc 2개) | 전부 **T2 유지** |
| 확장(`$( )`) 3종 | 2종 유지 · 1종은 `<<\EOF`(백슬래시 인용 = **확장 없음**) + 파일쓰기 → 정당 완화 |
| 셸 재호출 payload 2종 | 전부 유지 |

**⇒ 안전 손실 0. claude 반박이 실측으로 지지된다.**

⚠️ **이 검증을 두 번 잘못 짰다.** 1차엔 모호 구문에 `cat <<EOF > f`(파일쓰기)를 넣고 "안전손실 5건"이라 결론냈는데, 그 본문은 **실행되지 않는 텍스트**라 완화가 정당한 것이었다. 이 spec 이 §4④ 에서 스스로 경계한 함정("합성 케이스는 실제 거동을 재현 못 한다")을 작성자가 그대로 다시 밟았다. **모호 구문 테스트는 반드시 '실행되는 형태'로 만들어야 한다.**

### ② `d446706b` — 현 기준이 원리적으로 옳음이 실측으로 확인

- 코퍼스 강화 1건의 룰 = `git-commit:branch-gate` **하나뿐**(미탐 해소)
- blanking 유발 오탐(`interactive`) 능동 probe 5종 → **강화 0**

원리적으로 강화가 나오는 경우는 (a) 기준선이 못 보던 진짜 명령을 보게 됨 (b) blanking 이 만든 새 패턴, 둘뿐이고 (b) 의 유일한 알려진 형태가 `interactive` 다 — 이건 `headOfSegment` 주석에 **이미 적혀 있었다**(실측 강화 58건 이력).

⇒ **"(b)형 강화 0"은 원리에서 도출되는 옳은 기준**이었다. 결론은 옳고 **절차가 틀렸다** — 작성 시 원리를 따지지 않고 편하게 "강화 0"이라 적은 뒤 결과를 보고 정정했다. 대표 판정으로 현 기준을 유지하되 이 경위를 기록에 남긴다.

**부수 발견(자체)**: 정책에 심는 `shellExecApis` 목록을 손으로 옮겨 적었더니 mask.js 만 보강되고 정책은 옛 목록이라 **`6d8e5f71` 수정이 통째로 무효화**돼 있었다(누출 5건 잔존). apply.js 가 `mask.js` 의 상수를 직접 읽도록 바꿔 SSOT 를 하나로 만들었다.

---

## §5 배포 절차

1. 후보 디렉토리 `~/p1c/candidates/exec-payload-mask/` — `apply.js`(`--dry` 지원·자동 롤백) · `rollback.js` · `exec-payload-mask.regression.js` · `.bak`
2. **회귀 파일이 없으면 apply 는 건너뛰지 않고 중단**한다(L2 `4735afe8` 계승)
3. §4 ①~⑤ 전건 통과가 apply 의 선결
4. **대표님 `!` 로 apply** — `risk-classify.js`=T3 owner-only, `decision-policy.json`=T2
5. `maia-deploy.js` → WSL↔Windows **byte-identical · drift 0** 확인
6. **양 환경 라이브 실측 일치** 확인(같은 입력에 같은 판정)
7. 커밋(ai-bootstrap master = 대표 승인) → push(T3 = 대표 `!`)

## §6 롤백

`node ~/p1c/candidates/exec-payload-mask/rollback.js` → `.bak` 복원 → `maia-deploy.js` 재배포.
환경변수 즉시 무력화는 두지 않는다 — 마스킹은 정책 데이터(allowlist)가 비면 자동으로 no-op 이므로 `decision-policy.json` 의 allowlist 를 비우는 것이 최단 회피 경로다.

## §7 중단 조건

- retention 위반(기준선 등급 하락) 1건 → 즉시 중단, 설계 재검토
- 능동 probe 13종 중 1건이라도 기준선 등급 미달 → 중단
- `interactive` 룰로 인한 강화(blanking 유발 오탐) 1건이라도 발생 → 중단
- L2 blocker 가 실측 재현되고 설계로 해소 불가 → 대표님 에스컬레이션
