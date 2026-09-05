# B안 — T2 판정을 실행 헤드로 정밀화 spec

- **문서유형**: spec (구현·검증 완료, 대표 `!` 적용 대기) · v0.1
- **작성일**: 2026-09-01
- **발단**: 대표 지시 *"실측 먼저 해봐"* → `migration` 815건 해부 결과 **진짜 마이그레이션 실행은 4건(0.5%)**
- **설계 기준**: BC/SF Windows 감사로그 ([[maia-design-baseline-is-bc-sf-not-mc]])
- **선행(전부 적용·배포 완료)**: [[2026-08-31-t2-gate-precision-spec]](A안) · [[2026-08-31-npx-local-tool-precision-spec]](npx) · [[2026-09-01-git-arg-message-precision-spec]](git-args)
- **대상(T3, 대표 `!`)**: `~/.ai-bootstrap/risk-classify.js`

---

## 1. 문제 — 남은 모달의 20%가 같은 원인

세 패치 적용 후에도 BC/SF에 **4,985건**이 남았고, 그 정체를 해부했다.

**`migration` 815건**
| 분류 | 건수 |
|---|---:|
| 인용문 안 언급 (`npx vitest run tests/migration-0113.test.ts`) | 368 |
| 경로 `migrations/` (`ls migrations/*.sql`) | 260 |
| 조회 명령 인자 | 65 |
| `wrangler d1 migrations **list**`(조회) | 59 |
| 문서 파일명 (`…-migration.md`) | 35 |
| 기타 | 24 |
| **실제 마이그레이션 실행** (`drizzle-kit migrate` 등) | **4** |

**`infra` 151건** 중 126건이 인용문 안 `docker` · **`eval-exec` 61건** 중 46건이 인용문 안 `eval`.

⇒ 오탐 **≈ 984건 = 남은 모달의 20%**.

**A안이 못 잡은 이유**: A안은 `grep`·`ls`·`ps` 등 **`READ_LEADERS`에 등재된 리더**의 인자만 blanking한다. 리더가 `npx`·`node`·`timeout`처럼 목록에 없으면 인자·인용문이 그대로 스캔된다.

---

## 2. 설계 — T2 규칙만 '헤드 텍스트'로 판정

**안전 계약(불변)**: `denylist`(DENY)와 **T3 규칙은 기존 `scanCmd`(전체 텍스트)를 그대로** 쓴다. 헤드 판정은 **T2 커맨드 규칙에만** 적용한다.

```
scanCmd  = dangerScanText(cmd)   // 기존 — denylist·T3 판정용 (불변)
headCmd  = headScanText(cmd)     // 신설 — T2 커맨드 규칙 판정용
…
if (new RegExp(r.re,'i').test(r.class === 'T2' ? headCmd : scanCmd)) { … }
```

**`headScanText`** — 세그먼트마다 `headOfSegment()`를 적용:
1. **A안 면제 계승** — `readSubExempt(lead)`(systemctl status·crontab -l·docker ps …)면 빈 문자열
2. **명령치환·백틱·`${}` 있으면 원문 유지** — 셸이 그 안을 실행하므로(A안 `blankArgs`와 동일한 보수 조건)
3. **래퍼면 원문 유지** — `bash|sh|zsh -c` · `node -e` · `python3 -c` · `perl|ruby -e` · `eval` · `xargs` · `script`·`watch`·`flock`·`setsid`. 인자 문자열이 곧 실행이므로 축약하면 탐지가 사라진다
4. **prefix 러너는 자기 인자만 벗기고 재귀** — `timeout 120 <cmd>` · `nohup <cmd>` · `env FOO=1 <cmd>` · `nice`·`stdbuf`·`command`·`time` (깊이 3 제한)
5. 그 외: 인용문·명령치환 제거 후 **[동사 + 비경로 토큰 4개]**. 경로형 토큰은 `_`로 **치환**(제거 아님)
6. 파싱 실패 시 `dangerScanText`로 폴백(fail-safe)

**경로 판정(`HEAD_PATHISH`)**: 경로 구분자(`/`·`~`)가 있거나 **알려진 소스/문서 확장자**로 끝날 때만. 임의의 점을 확장자로 보면 `python3 -m http.server`의 `http.server`가 경로로 오인돼 `interactive` 탐지가 사라진다 — **기존 단위 테스트가 이 회귀를 사전 포착**했다.

**부수 수정**: `npxTargetOf()`가 prefix 러너를 건너뛰도록 보강. 실측에서 `timeout 120 npx vitest run …`이 npx 판별을 타지 못해 `remote-run` T2로 남았다.

---

## 3. 검증 결과 (격리 사본 드라이런, 원본 미변경)

| 항목 | 결과 |
|---|---|
| 기존 단위 테스트 | **237 / 237** |
| A안 회귀 (선행) | **58 / 58** |
| npx 회귀 (선행) | **25 / 25** |
| git-args 회귀 (선행) | **27 / 27** |
| **B안 회귀** | **42 / 42** (게이트 31 · 통과 11) |

**안전 회귀 31건** — `pnpm install`·`sudo systemctl restart`·`crontab -e`·`pkill`·`sed -i`·`mv`·`prisma migrate deploy`·`drizzle-kit migrate`·`docker compose up`·`kubectl apply`·`pnpm dev`·`terraform fmt` / **래퍼 7종**(`bash -c`·`sh -c`·`node -e`·`bash -lc`·`python3 -c`·`xargs`·`eval`) / **prefix 러너 뒤 위험 3종**(`timeout … sudo`·`nohup pnpm dev`·`env … systemctl`) / 체인·치환 / **denylist 유지 확인**(`echo x > …/risk-classify.js`·`rm -rf`·`git push`·main 커밋) / `npx wrangler d1 migrations list`(화이트리스트 밖 = 의도적 게이트)

**오탐 해소 11건** — `npx vitest run tests/migration-0113.test.ts` · `ls migrations/*.sql` · `cat tests/migration-0006.test.ts` · **`timeout 120 npx vitest run tests/migration-0113.test.ts`** · `grep -n "CREATE TABLE" migrations/0001_initial.sql` · `head -20 docs/…-migration.md` · `git log` · `node script.js` · `pnpm build` · `echo "docker systemctl crontab migration eval"` · `npx vitest run`

**드라이런이 사전 포착한 결함 3건**: ①`http.server` 경로 오인(기존 테스트) ②명령치환 속 `sudo` 미탐(A안 회귀) ③A안의 읽기 서브커맨드 면제 무효화(A안 회귀).

**전수 측정이 사전 포착한 '강화'(=마찰 증가) 4건** — 전부 수정 후 재검증:

| 원인 | 강화 | 수정 |
|---|---:|---|
| 인용문을 **제거**해 `node "/tmp/x.js"` 가 헤드 `node` → "인자 없는 REPL" 오인 | 58 | `_` 토큰으로 **치환**(존재 보존) |
| `\"` **이스케이프 미인식**으로 인용문 파서 어긋남 | — | `"(?:[^"\\]|\\.)*"` 로 교정 |
| **Windows 경로 끝 백슬래시**(`ls "D:\…\migrations\"`)가 `\"` 로 오인 | 15 | A안 `blankArgs`를 헤드 경로에도 **계승** |
| `codex exec --add-dir "$(pwd)" "…migration…"` — 치환 때문에 원문 경로를 타면서 **DATA_SINKS 효과 소실** | 1 | `DATA_SINKS` 계승 추가(단 `blankArgs` **뒤**에 두어야 `cat file.md` 인자까지 처리) |

부수: `cat` 이 `DATA_SINKS` 에만 있고 `READ_LEADERS` 에 없어 `cat tests/migration-0006.test.ts` 인자가 남던 것 → `READ_LEADERS` 에 `cat` 추가.

> **판정 우선순위(최종)**: ①`readSubExempt` → ②`blankArgs`(READ_LEADERS) → ③`DATA_SINKS`(blankQuotes) → ④명령치환·백틱 → 원문 → ⑤셸/래퍼 → 원문 → ⑥헤드 축약

### 전수 측정 (최종본)

| 환경 | Bash 명령 | 완화 | **강화** | 모달 해소(누적) |
|---|---:|---:|---:|---:|
| **BC/SF** | 36,949 | **546** | **0** | **3,448 / 8,703 = 39.6%** |
| MC | 858 | 17 | **0** | 29 / 65 = 44.6% |

선행 3패치까지의 누적이 33.4%였으므로 **B안 순증 +6.2%p**. 잔여 모달의 규칙 분포도 `migration` 815 → **587**, `infra` 151 → 66, `eval-exec` 61 → 34 로 감소.

---

## 3-B. L2 반영 (codex ∥ gemini 3R)

| id | 지적 | 처리 |
|---|---|---|
| `754a6a92` **blocker** | spec이 롤백 절차를 명시했는데 **`rollback.js`가 실제로 없다** | **신설**. 백업 복원 → 구문검사 → 테스트 → `maia-deploy` 재실행 안내까지 |
| `4735afe8` | `apply.js`가 회귀 파일 없으면 **건너뛰어** "전부 돌린다"는 보장이 거짓 | **누락 시 중단(rollback)** 으로 변경 |
| `c798911b` | `bash scripts/migrate.sh` 처럼 **exec 플래그 없는 셸 스크립트 실행**이 헤드 `bash _`로 축약돼 탐지 누락 | **셸(bash/sh/zsh…)은 무조건 원문 유지**로 수정. node/python은 스크립트 파일명이 오탐 원천이므로 exec 플래그가 있을 때만 원문. 회귀 2종 추가 |
| `ee346c2c` | npx prefix 보강에 **`env`가 빠져** spec과 구현 불일치 (`env FOO=1 npx …` 미판별) | prefix 목록에 `env` 추가. 회귀 2종 추가 |
| `a6886c33` | `headScanText` 복잡도 → 운영자 디버깅 부담 | 각 분기에 **근거 주석**(무엇을 막는지 + 실측 사례)을 코드에 명시 |
| `006af414` | `apply.js` 성공 후 `maia-deploy` 실패 시 **환경 간 불일치** 복구 절차 부재 | `rollback.js`가 **`maia-deploy` 재실행을 필수 단계로 안내**하고 `--check` 0 drifted 확인을 명시 |

---

## 4. 적용 / 롤백

```bash
node ~/p1c/candidates/head-scan/apply.js --dry   # 원본 미변경 검증
node ~/p1c/candidates/head-scan/apply.js         # 적용  ← 대표 `!`
node ~/.ai-bootstrap/maia-deploy.js              # WSL↔Windows 동기
```
`apply.js`는 선행 패치(A안) 적용 여부를 확인하고 앵커 5개가 정확히 1회씩 매칭될 때만 진행하며, **기존 237 + 선행 회귀 3종 + B안 회귀**를 전부 돌려 하나라도 실패하면 자동 롤백한다.

**롤백**: `node ~/p1c/candidates/head-scan/rollback.js` → `maia-deploy.js`
