# C3 멀티AI 에이전트 대시보드 (mission-control + Hermes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) 또는 subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** mission-control(MIT)을 WSL에 fork 설치 + 한국어화 + Cloudflare Tunnel로 agents.bestconsulting.vip 노출, Hermes를 실행엔진으로 연동해 "지시→실행→모니터링"이 되는 멀티AI 대시보드를 bestconsulting과 완전 독립으로 구축한다.

**Architecture:** mission-control(Next.js+SQLite, 관리/한글UI/일정/권한) + Hermes(acp/kanban/swarm, 실제 실행엔진) — 둘 다 같은 WSL2에 공존. Cloudflare Tunnel이 2차 도메인을 로컬 포트로 라우팅. bestconsulting(Cloudflare Pages+D1)과 코드/배포/DB 완전 분리.

**Tech Stack:** mission-control(Next.js16, better-sqlite3, pnpm), cloudflared, Hermes v0.16, WSL2 Ubuntu.

> ## [v2] L2 검증 반영 (Codex 기술 15 + Gemini UX 4 — 둘 다 조건부 승인)
> 위키 `reviews/c3-plan-tech-review-codex-20260607.md` + `c3-plan-ux-review-gemini-20260607.md`
> | 출처 | 반영 |
> |---|---|
> | Codex#7·8·9 | **Task5에 MC webhook 실측 + Hermes 명령 `--help` 실측 선행** + E2E 기준 강화(daemon pickup→실제 프로세스 로그→상태 반영). 단방향이면 범위 명시/역방향 항목화 |
> | Codex#10 | **Task6 보안 강화** — Cloudflare Access 필수(대표 결정→기본 적용) + webhook HMAC + **Hermes wrapper allowlist + shell escaping**(payload를 shell 직접 주입 금지) |
> | Codex#11·12·13 | **Task8** linger 확인(sudo 가능) + 작업스케줄러 존재 검증 + 재부팅 다중 검증(is-active/ss:3005) + SQLite 중복 프로세스 기계적 확인 |
> | Codex#1·3·4·5·6·15 | `~/bin` 생성(Task0) / 로컬 검증 후 프로세스 종료(Task1) / cloudflared `--config` 명시(Task2·8) / DNS 검증 `curl -I`+HTML(Task2) + dig(Task3) / 독립성 grep 범위 확대(app/lib/server/package.json) / i18n 구조 실측(Task4) |
> | Gemini#1 | 통합 셋업 체크리스트(Task9) |
> | Gemini#2·3·4 | Telegram 액션버튼 2차 최우선(carry) / 알림에도 용어표준 / Hermes 연결 인디케이터 + Hello World E2E 가이드(carry) |

> ⚠️ **이 plan의 특수성**: 산출물이 WSL 외부 시스템(fork+cloudflared+연동)이고 검증이 실측(접속·dispatch·재부팅). TDD 단위테스트 대신 **Phase별 실측 검증(V1~V9, spec §6)**. 각 Task 끝 검증이 test 역할.
> ⚠️ **메모리 준수**: `feedback_no_inference_verify_data`(실측), `feedback_windows_hook_command_format`(WSL/Win 경로·MSYS_NO_PATHCONV), `reference_wsl_daemon_autostart`(R6 패턴), `reference_hermes_skill_execute_code_gate`, `feedback_commit_includes_push`.
> ⚠️ **독립성 mandate**: C3 코드는 best-consulting-hp repo **밖**(WSL `~/`). bestconsulting Pages/D1/Worker 무접촉. secret 출력 금지(§15-7.5).
> ⚠️ **WSL 명령**: `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c '...'` + 경로 quote.

**기준 사실 (실측 2026-06-07):**
- WSL 네이티브 Node **미설치** (`/mnt/c/.../node` = Windows 바이너리, Permission denied) → **P0에서 WSL Node+pnpm 설치 선행 필수**
- 빌드툴 python3/make/g++ ✅ (better-sqlite3 가능)
- cloudflared **미설치** → P2에서 설치
- 포트 3000/3005/9119 비어있음 (9119는 Hermes gateway)
- mission-control 실행 모델(코드 실측): spawn=OpenClaw 위임 / claude-tasks=읽기전용 / pty=tmux attach → **단독 dispatch 불가 → Hermes 실행엔진 연동 필수**
- Hermes 보유: acp/kanban(boards/create/assign/swarm/daemon)/cron/send

---

## File Structure

| 위치 | 책임 | repo 밖? |
|---|---|---|
| WSL `~/mission-control/` (fork clone) | 대시보드 본체 (Next.js+SQLite) | ✅ repo 밖 |
| WSL `~/mission-control/messages/ko.json` | 한국어 번역 | ✅ |
| WSL `~/.cloudflared/` (config + cert) | Tunnel 설정 | ✅ |
| WSL `~/mission-control/.env` | MC 설정(MC_ALLOWED_HOSTS 등, secret) | ✅ |
| WSL systemd `~/.config/systemd/user/mission-control.service` | 상시구동 | ✅ |
| WSL `~/bin/mc-upstream-check.sh` | 업데이트 알림 cron 스크립트 | ✅ |
| repo `docs/superpowers/plans|specs/` | spec/plan 문서만 | repo 안 (문서만) |
| 위키 `dev-tasks/c3-dashboard-20260607.md` | 구축 기록 | 위키 |

**repo 코드 변경 0** (C3 코드는 전부 WSL). repo엔 spec/plan 문서만.

---

## Task 0: WSL 네이티브 Node + pnpm 설치 (P0 — 선행 필수)

**Files:** WSL 시스템 (repo 밖)

- [ ] **Step 1: WSL 네이티브 Node 부재 재확인**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'which -a node; node --version 2>&1 | head -1'
```
Expected: Windows 경로 node만 보이거나 "Permission denied" — WSL 네이티브 node 없음 확인.

- [ ] **Step 2: nvm로 WSL 네이티브 Node 22 설치 (Windows node와 분리)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 22 && nvm alias default 22 && node --version'
```
Expected: `v22.x.x` (WSL 네이티브). ⚠️ `bash -lc`로 nvm 로드.

- [ ] **Step 3: corepack으로 pnpm 활성화**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && corepack enable && corepack prepare pnpm@latest --activate && pnpm --version'
```
Expected: pnpm 버전 출력 (WSL 네이티브 node 기반).

- [ ] **Step 4: PATH 우선순위 확인 (WSL node가 Windows node보다 먼저)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'which node; node --version'
```
Expected: `~/.nvm/.../node` 경로 + v22. Windows node 아님.

**검증 통과**: WSL 네이티브 node v22 + pnpm 동작. 실패 시 멈추고 보고(이후 전부 막힘).

---

## Task 1: mission-control fork clone + 빌드 + 로컬 구동 (P1)

**Files:** WSL `~/mission-control/`

- [ ] **Step 1: GitHub에서 fork (대표 계정)**

대표 GitHub(kjan00-ai)에서 `builderz-labs/mission-control` → Fork. (웹 or `gh repo fork builderz-labs/mission-control --clone=false`)
→ fork URL: `https://github.com/kjan00-ai/mission-control` (예시, 실제 계정 반영)

- [ ] **Step 2: WSL에 clone + upstream 등록**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'cd ~ && git clone https://github.com/kjan00-ai/mission-control.git && cd mission-control && git remote add upstream https://github.com/builderz-labs/mission-control.git && git remote -v'
```
Expected: origin(fork) + upstream(원본) 둘 다 등록.

- [ ] **Step 3: 의존성 설치 (frozen lockfile)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd ~/mission-control && pnpm install --frozen-lockfile 2>&1 | tail -15'
```
Expected: 설치 완료. ⚠️ better-sqlite3 네이티브 빌드 — 실패 시 `pnpm rebuild better-sqlite3`.

- [ ] **Step 4: better-sqlite3 네이티브 빌드 확인**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd ~/mission-control && node -e "require(\"better-sqlite3\"); console.log(\"sqlite OK\")" 2>&1'
```
Expected: `sqlite OK`. 실패 시 `pnpm rebuild better-sqlite3` 후 재확인.

- [ ] **Step 5: production build**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd ~/mission-control && pnpm build 2>&1 | tail -20'
```
Expected: 빌드 성공. 실패 시 로그 보고 후 멈춤.

- [ ] **Step 6: 로컬 구동 + 접속 (DATA_DIR 절대경로 고정)**

Run (background로 띄우고 curl):
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd ~/mission-control && MISSION_CONTROL_DATA_DIR=$HOME/mission-control/.data PORT=3005 nohup pnpm start > /tmp/mc.log 2>&1 & sleep 12 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3005'
```
Expected: `200`. 실패 시 `cat /tmp/mc.log` 진단.

**검증 (V1)**: localhost:3005 대시보드 200 + 패널 로드.

---

## Task 2: Cloudflare Tunnel로 2차 도메인 노출 (P2)

**Files:** WSL `~/.cloudflared/`

- [ ] **Step 1: cloudflared 설치 (WSL)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/bin/cloudflared 2>/dev/null && chmod +x ~/bin/cloudflared && ~/bin/cloudflared --version'
```
Expected: cloudflared 버전. (`~/bin`이 PATH에 없으면 절대경로 사용)

- [ ] **Step 2: Cloudflare 로그인 (대표 인증 1회)**

⚠️ 대표 브라우저 인증 필요. 대표가 직접:
```bash
~/bin/cloudflared tunnel login
```
(브라우저 열림 → bestconsulting.vip zone 선택 → cert.pem 저장)
Expected: `~/.cloudflared/cert.pem` 생성.

- [ ] **Step 3: 명명된 Tunnel 생성**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc '~/bin/cloudflared tunnel create c3-dashboard 2>&1'
```
Expected: Tunnel UUID + `~/.cloudflared/<UUID>.json` credential 생성.

- [ ] **Step 4: config.yml 작성 (agents 서브도메인 → localhost:3005)**

WSL `~/.cloudflared/config.yml`:
```yaml
tunnel: <UUID>
credentials-file: /home/bestconsulting/.cloudflared/<UUID>.json
ingress:
  - hostname: agents.bestconsulting.vip
    service: http://localhost:3005
  - service: http_status:404
```

- [ ] **Step 5: DNS 라우트 (agents CNAME → tunnel)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc '~/bin/cloudflared tunnel route dns c3-dashboard agents.bestconsulting.vip 2>&1'
```
Expected: `agents.bestconsulting.vip` CNAME → `<UUID>.cfargotunnel.com` 등록.

- [ ] **Step 6: Tunnel 실행 + 외부 접속 확인**

Run (background):
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc '~/bin/cloudflared tunnel run c3-dashboard > /tmp/tunnel.log 2>&1 & sleep 10 && curl -s -o /dev/null -w "%{http_code}" https://agents.bestconsulting.vip'
```
Expected: `200`. 실패 시 `/tmp/tunnel.log` 진단.

**검증 (V2)**: https://agents.bestconsulting.vip 외부 접속 + TLS + 대시보드.

---

## Task 3: 독립성 검증 (P3 — 강화, Codex#1)

**Files:** 없음 (검증)

- [ ] **Step 1: agents 서브도메인에 기존 레코드 없었음 확인**

Step 2-5(Task2)에서 신규 생성된 것 외에 기존 A/CNAME/Pages custom domain/Worker route 충돌 없었는지 — route dns가 성공했으면 충돌 없음(에러 안 남). 재확인:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'nslookup agents.bestconsulting.vip 2>&1 | tail -5'
```
Expected: cfargotunnel.com CNAME 해석 (Pages IP 아님).

- [ ] **Step 2: zone-level rule 간섭 확인 (대표 — Cloudflare 대시보드)**

⚠️ 대표가 Cloudflare 대시보드에서 확인:
- WAF / Access / Redirect Rules / Transform Rules / Page Rules 중 `*.bestconsulting.vip` 또는 와일드카드 매칭이 agents에 걸리는 것 없는지
- wildcard DNS(`*`) / wildcard Worker route 없는지
Expected: agents에 의도치 않은 rule 미적용. 있으면 agents 예외 처리.

- [ ] **Step 3: bestconsulting.vip 본체 무영향 확인**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" https://bestconsulting.vip
```
Expected: `200` (기존 서비스 정상 — C3가 영향 0).

- [ ] **Step 4: C3가 D1/Pages 무접촉 확인**

mission-control은 로컬 SQLite만 사용 — wrangler/D1 호출 코드 없음 확인:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && grep -rl "best-consulting-db\|D1Database\|wrangler" src/ 2>/dev/null | head || echo "D1 참조 없음"'
```
Expected: "D1 참조 없음" (bestconsulting DB 무접촉).

**검증 (V3)**: 양쪽 별개 동작 + zone rule 무간섭 + D1 무접촉.

---

## Task 4: 한국어화 (P4)

**Files:** WSL `~/mission-control/messages/ko.json`, `src/i18n/config.ts`, `src/components/ui/language-switcher.tsx`

- [ ] **Step 1: en.json 규모 확인 (작업량)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && wc -l messages/en.json && head -30 messages/en.json'
```
Expected: 줄 수 + 키 구조 파악.

- [ ] **Step 2: ko.json 생성 (en 구조 복제 + 번역)**

en.json을 복제해 값만 한국어 번역. **용어 표준**(Gemini#2): task=작업 / dispatch=배정·실행 / agent=에이전트 / schedule=일정 / recurring=반복 / session=세션 / cost=비용. 큰 파일이면 섹션별로 나눠 번역(Edit). en 키는 그대로 유지(parity).

- [ ] **Step 3: locale 등록 (config.ts + switcher)**

`src/i18n/config.ts`의 locales 배열에 `'ko'` 추가 + 기본 locale = `'ko'`. `language-switcher.tsx`에 "한국어" 옵션 등록.

- [ ] **Step 4: en/ko key parity 검사 (Codex+)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "const en=require(\"./messages/en.json\"),ko=require(\"./messages/ko.json\");const flat=(o,p=\"\")=>Object.entries(o).flatMap(([k,v])=>typeof v===\"object\"&&v?flat(v,p+k+\".\"):[p+k]);const ek=flat(en),kk=new Set(flat(ko));const miss=ek.filter(k=>!kk.has(k));console.log(miss.length?\"MISSING:\"+miss.slice(0,10).join(\",\"):\"PARITY OK (\"+ek.length+\" keys)\")"'
```
Expected: `PARITY OK (N keys)`. 누락 시 ko.json 보완.

- [ ] **Step 5: 재빌드 + 한국어 표시 확인**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd ~/mission-control && pnpm build 2>&1 | tail -5'
```
Expected: 빌드 성공. (재시작 후 대표가 https://agents.bestconsulting.vip 에서 한국어 + 전환 육안 — V4)

**검증 (V4)**: UI 한국어 + en↔ko 전환 + parity OK.

---

## Task 5: Hermes 실행엔진 연동 (P5 — 확정 범위)

**Files:** WSL — 연동 스크립트/설정 (방식은 Step 2에서 실측 후 결정)

- [ ] **Step 1: MC webhook 실측 (Codex#7 — 추정 금지)**

mission-control이 정말 outbound webhook을 task 생성 시 내보내는지 코드 실측:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && grep -RinE "webhook|hmac|retry" src app lib server package.json 2>/dev/null | head -30'
```
Expected: webhook 설정 UI/API + task 생성 이벤트 발송 + payload(title/assignee/status) + HMAC 확인. **webhook 없으면 (A)안 폐기 → (B)폴링 또는 (C)수동.**

- [ ] **Step 2: Hermes 명령 문법 실측 (Codex#8)**

`hermes kanban` 실제 문법이 plan 가정과 일치하는지:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'hermes --version; hermes kanban --help 2>&1 | head; hermes kanban create --help 2>&1 | head -15; hermes kanban daemon --help 2>&1 | head -8'
```
Expected: create `--assignee/--skill` + daemon(실행 트리거) 문법 확인. **큐 등록 ≠ 실행** — daemon/worker가 실제 실행 주체임 확인.

- [ ] **Step 3: 연동 방식 확정 (Step1·2 실측 기반)**

3안 중 실측 결과로 택1:
- (A) MC webhook → 수신 스크립트 → `hermes kanban create` (Step1에서 webhook 확인 시)
- (B) MC SQLite 폴링 → `hermes kanban create` (webhook 없을 때)
- (C) 수동 트리거 (1차 최소)
→ 단방향(MC→Hermes 실행)이 1차 범위면 **명시**(goal "모니터링"은 V5 역방향 or carry). 역방향(Hermes 상태→MC) 필요 시 구현 항목으로.

- [ ] **Step 4: Hermes kanban board + 연동 스크립트**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'hermes kanban init 2>&1; hermes kanban boards create c3-tasks 2>&1 | head -3'
```
연동 스크립트 `~/bin/mc-to-hermes.sh`: payload 파싱 → `hermes kanban create`. ⚠️ **보안(Codex#10)**: payload title/assignee를 shell에 직접 넣지 말 것 — 변수 quote + allowlist된 profile만 허용 + `printf %q` escaping. (Task6과 연계)

- [ ] **Step 5: E2E — MC 지시 → Hermes daemon 실제 실행 (Codex#8 강화)**

E2E 통과 기준 (단순 "task 생성" 아님):
1. MC에서 task 생성 → 연동으로 Hermes kanban task 생성 (ID 확인)
2. **daemon/worker가 task pickup** (`hermes kanban daemon` 또는 dispatch)
3. **Claude/Codex 프로세스 실행 로그 확인** (실제 실행 증거)
4. 완료/실패 상태가 kanban 반영
5. MC에서 최소 상태 확인 가능
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'hermes kanban create --assignee default "C3 연동 테스트" 2>&1; hermes kanban list 2>&1 | head -5'
```
Expected: 위 1~5. **읽기 전용 스캔이 아닌 실 프로세스 실행** 확인. daemon이 안 돌면 dispatch 수동 트리거로 실행 증명.

**검증 (V5)**: MC 지시 → Hermes daemon pickup → 실제 프로세스 로그 → 상태 반영. 큐 등록 ≠ 실행 명확히.

---

## Task 6: 보안 (P5.5 — 신규, Codex#5)

**Files:** WSL `~/mission-control/.env`

- [ ] **Step 1: 기본 계정/비번 변경**

MC 초기 계정이 있으면 즉시 변경 (대표 — 웹 UI 또는 .env). secret 출력 금지.

- [ ] **Step 2: MC_ALLOWED_HOSTS 설정**

`~/mission-control/.env`에:
```
MC_ALLOWED_HOSTS=agents.bestconsulting.vip
```

- [ ] **Step 3: Cloudflare Access 필수 적용 (Codex#10 — 외부 공개 게이트)**

⚠️ 외부 공개 도메인이므로 Cloudflare Access **필수**(대표 결정 아닌 기본 적용). 대표가 Cloudflare Zero Trust에서:
- `agents.bestconsulting.vip`에 Access Application 생성
- 정책: 대표 이메일(ssfnc.ceo@gmail.com)만 허용 (One-time PIN or Google)
→ Access 통과 없이는 대시보드/endpoint 접근 불가. webhook endpoint는 Access 예외(서비스 토큰) or 별도 경로.

- [ ] **Step 4: endpoint 공개범위 점검 (app/lib까지)**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && ls src/app/api/ app/api 2>/dev/null | head -25; echo "---공개 endpoint(인증 없는)---"; grep -RinE "requireRole|requireAuth|public" src/app/api app/api 2>/dev/null | head -15'
```
Expected: endpoint 목록 + 인증 없는 endpoint 식별 → Access로 전체 보호 확인.

- [ ] **Step 5: webhook HMAC + Hermes wrapper allowlist/escaping (Codex#10)**

연동 스크립트(`~/bin/mc-to-hermes.sh`, Task5) 보안:
- webhook 수신 시 **HMAC 서명 검증** (MC가 HMAC 지원 시)
- profile은 **allowlist**된 값만 (`default`/`claude`/`codex` 등 화이트리스트, 그 외 거부)
- payload title/assignee를 **shell에 직접 넣지 않기** — bash 변수 quote + `printf %q` escaping
```bash
# mc-to-hermes.sh 안 예시 패턴:
# ALLOWED="default claude codex"; case " $ALLOWED " in *" $ASSIGNEE "*) ;; *) exit 1;; esac
# SAFE_TITLE=$(printf %q "$TITLE"); hermes kanban create --assignee "$ASSIGNEE" "$TITLE"
```

- [ ] **Step 6: Tunnel token/credential 권한**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'chmod 600 ~/.cloudflared/*.json ~/.cloudflared/cert.pem ~/mission-control/.env 2>&1; ls -la ~/.cloudflared/ | head'
```
Expected: credential + .env 600.

**검증 (V5.5)**: 기본비번 변경 + ALLOWED_HOSTS + **Cloudflare Access 적용**(접근 차단 확인) + endpoint 평가 + **wrapper allowlist/escaping** + credential 600.

---

## Task 7: 업데이트 알림 (P6)

**Files:** WSL `~/bin/mc-upstream-check.sh` + Hermes cron

- [ ] **Step 1: upstream 릴리스 확인 스크립트**

`~/bin/mc-upstream-check.sh`:
```bash
#!/bin/bash
cd ~/mission-control
LATEST=$(git ls-remote --tags --sort=-v:refname upstream 2>/dev/null | head -1 | sed 's@.*/@@; s/\^{}//')
CURRENT=$(git describe --tags 2>/dev/null || echo "none")
if [ "$LATEST" != "$CURRENT" ] && [ -n "$LATEST" ]; then
  hermes send --to telegram --no-agent "⬆️ mission-control 새 버전 $LATEST (현재 $CURRENT). git fetch upstream && merge 검토 필요."
fi
```
chmod +x.

- [ ] **Step 2: Hermes cron 등록 (1일 1회)**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'hermes cron create "0 9 * * *" --name mc-upstream --no-agent --script ~/bin/mc-upstream-check.sh 2>&1 | head -3'
```
Expected: cron job 등록.

- [ ] **Step 3: 강제 실행 테스트**

Run:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c 'bash ~/bin/mc-upstream-check.sh 2>&1; echo "exit=$?"'
```
Expected: (새 버전 있으면) Telegram 수신 / 없으면 조용. exit 0.

**검증 (V8)**: cron 등록 + 강제 실행 시 Telegram 수신(새 버전 시).

---

## Task 8: 상시구동 (P7 — 강화, R6 패턴)

**Files:** WSL `~/.config/systemd/user/mission-control.service` + cloudflared 서비스

- [ ] **Step 1: mission-control systemd user 서비스 작성 (단일 인스턴스)**

`~/.config/systemd/user/mission-control.service`:
```ini
[Unit]
Description=Mission Control Dashboard
After=network.target
[Service]
Type=simple
WorkingDirectory=/home/bestconsulting/mission-control
Environment=MISSION_CONTROL_DATA_DIR=/home/bestconsulting/mission-control/.data
Environment=PORT=3005
Environment=MC_ALLOWED_HOSTS=agents.bestconsulting.vip
ExecStart=/bin/bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; pnpm start'
Restart=on-failure
[Install]
WantedBy=default.target
```
⚠️ 단일 인스턴스 — 수동 `pnpm start`와 동시 실행 금지(SQLite lock).

- [ ] **Step 2: cloudflared systemd 서비스 (R6 패턴)**

`~/.config/systemd/user/cloudflared-c3.service` — `ExecStart=/home/bestconsulting/bin/cloudflared --config /home/bestconsulting/.cloudflared/config.yml tunnel run c3-dashboard` + Restart=on-failure (Codex#4 — config 명시).

- [ ] **Step 3: 수동 테스트 프로세스 종료 (SQLite lock 방지, Codex#13)**

systemd 정식 실행 전, Task1/Task2에서 수동으로 띄운 프로세스를 종료(중복 = SQLite lock):
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'pgrep -af "pnpm start|next.*3005" | grep -v systemd; pkill -f "next.*3005" 2>/dev/null; pkill -f "cloudflared tunnel run" 2>/dev/null; sleep 2; ss -ltn | grep ":3005" && echo "still up" || echo "3005 free"'
```
Expected: `3005 free` (수동 프로세스 종료).

- [ ] **Step 4: enable + linger 확인 (Codex#11 — 가정 금지)**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'systemctl --user daemon-reload && systemctl --user enable --now mission-control cloudflared-c3 && sleep 8 && systemctl --user is-active mission-control cloudflared-c3; echo "---linger---"; loginctl show-user bestconsulting -p Linger'
```
Expected: 둘 다 `active` + `Linger=yes`. linger=no면 `sudo loginctl enable-linger bestconsulting`(대표 sudo 비번 필요) 후 재확인.

- [ ] **Step 5: Windows 작업스케줄러 존재 검증 (Codex#12)**

기존 R6 `WSL-Hermes-Gateway`가 WSL을 살려두는 게 전제 → 실제 존재 확인:
```bash
MSYS_NO_PATHCONV=1 schtasks.exe /query /tn "WSL-Hermes-Gateway" /fo LIST 2>&1 | head -5
```
Expected: 작업 존재 + ONLOGON. 없으면 mission-control도 재부팅 후 안 뜸 → R6 작업 재등록 필요.

- [ ] **Step 6: 재부팅 다중 검증 (V9, Codex#12)**

재부팅 후 (대표 직접) 사람 개입 0으로:
```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- bash -lc 'systemctl --user is-active mission-control cloudflared-c3; pgrep -af "next|cloudflared" | head; ss -ltn | grep ":3005"' 
curl -s -o /dev/null -w "%{http_code}" https://agents.bestconsulting.vip
```
Expected: 서비스 active + 단일 프로세스 + 3005 listen + https 200.

**검증 (V9)**: 재부팅 후 사람 개입 0 접속 + linger=yes + 작업스케줄러 존재 + 단일 인스턴스(중복 0).

---

## Task 9: 위키 기록 + 종결

**Files:** 위키 `dev-tasks/c3-dashboard-20260607.md` + 핸드오프 + log

- [ ] **Step 1: dev-task 구축 기록** (WSL 설치 내역·연동 방식·검증 V1~V9 결과 — WSL은 git 밖이라 위키가 기록).
- [ ] **Step 2: 핸드오프 C3 섹션 갱신** (◐ → ✅ or 진행상태).
- [ ] **Step 3: log.md 한 줄.**
- [ ] **Step 4: 검증** — 3 파일 반영 확인.

---

## Self-Review

- **Spec 커버리지**: spec §2 아키텍처→Task1·2·5 / §3 업데이트→Task7 / §4 한글화→Task4 / §5 P1~P7→Task0~8 / §6 V1~V9→각 Task 검증 / §7 리스크→Task3(독립)·5(dispatch)·8(단일인스턴스). ✅ 전부 매핑. ★ P0(WSL Node) = spec에 없던 실측 발견 → Task0 신규.
- **Placeholder**: 모든 Step 실제 명령. ko.json 번역·연동 방식은 실측 후 결정 단계로 명시(과한 추측 회피). ✅
- **이름 일관성**: 포트 3005 / DATA_DIR `~/mission-control/.data` / tunnel `c3-dashboard` / board `c3-tasks` 전 Task 동일. ✅
- **검증 매핑**: V1(T1)·V2(T2)·V3(T3)·V4(T4)·V5(T5)·V5.5(T6)·V8(T7)·V9(T8). V6(반복스케줄)·V7(권한)은 T5/T8 운영 중 확인 or carry. ✅

---

## Execution 주의
- **WSL 외부 시스템** — repo commit은 spec/plan/위키만. C3 코드는 WSL(git 밖, fork는 대표 GitHub).
- **대표 인증 지점**: GitHub fork(T1) / Cloudflare login(T2) / zone rule 확인(T3) / 기본비번(T6) / 봇 알림 수신(T7).
- **secret 출력 금지**(§15-7.5) — .env/credential 값 echo 금지.
- **메모리 준수**: 실측(추측 금지), WSL/Win 경로(MSYS_NO_PATHCONV+nvm bash -lc), R6 패턴.
- **위험 Phase**: T0(Node)·T1(빌드)·T5(dispatch 실증) — 막히면 멈추고 보고.
- carry: 양방향 동기화 / 모바일 / 1회예약 / OpenClaw 옵션 / Artifact 미리보기 / **Telegram 액션버튼(Gemini 2차 최우선)** / **Hermes 연결 상태 인디케이터(Gemini)** / **Hello World E2E 온보딩 가이드(Gemini)**.

## Task 9 추가 (Gemini#1): 통합 셋업 체크리스트
dev-task 기록(Task9)에 5개 인증 지점(GitHub fork / Cloudflare login / Cloudflare Access / 기본비번 / 봇 알림) + 환경(Node/cloudflared/포트) 통합 체크리스트 포함 — 셋업 누락 방지.
