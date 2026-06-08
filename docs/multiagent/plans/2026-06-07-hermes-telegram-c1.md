# Hermes + Telegram 연동 (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **이 plan은 코드 작성이 아니라 시스템 설치/설정 절차다.** TDD failing-test 대신 각 task가 "명령 실행 → 검증 게이트 → 실패 시 중단"으로 구성된다. **subagent에 위임하지 말고 컨트롤러(메인 세션)가 직접 실행**하는 것을 권장 — WSL2/secret/사용자 TTY 입력이 얽혀 subagent 격리가 오히려 위험하다.

**Goal:** WSL2 Ubuntu에 Hermes Agent를 설치하고 OpenRouter LLM + Telegram 봇 게이트웨이를 연동해, 대표가 Telegram으로 Hermes와 1회 왕복 대화하는 것까지 검증한다.

**Architecture:** Telegram(모바일/PC) ↔ Telegram Bot API ↔ WSL2 Ubuntu 내 Hermes Agent(gateway+LLM). Hermes는 NousResearch 오픈소스 CLI(자체호스팅, 텔레메트리 없음). 위키 데이터 연동은 C2 범위 — C1은 OneDrive 경로 접근 가능 여부만 1회 확인.

**Tech Stack:** WSL2 Ubuntu 24.04 LTS / Hermes Agent CLI (install.sh, Python 3.11+Node.js 자동 의존) / OpenRouter (LLM, context ≥64k 모델) / Telegram Bot API (long polling).

---

## 실측 선행 사실 (이 plan의 전제 — 2026-06-07 확인)

- WSL2 `Ubuntu` (24.04.4 LTS, kernel 6.6 WSL2, **systemd 사용**) 설치됨, 기동 정상.
- WSL2 의존성: curl/git/tar/python3 **있음**. node/unzip/ripgrep/ffmpeg/gcc **없음** → Hermes install.sh가 자동 설치한다고 공식 문서 명시.
- **R4 충족**: WSL2에서 `/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS` 접근 OK (C2 전제 통과).
- 설치: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` (공식, NousResearch).
- OpenRouter 비대화형 설정: `hermes config set OPENROUTER_API_KEY sk-or-...` (R2 해소 — TTY 직접입력 가능).
- 사용자 준비물 **둘 다 보유**: OpenRouter API 키 + Telegram 봇 토큰.

## 사용자 입력 지점 (실행 중 반드시 멈추고 요청)

| 지점 | 무엇 | 왜 사람만 |
|---|---|---|
| Task 2 | sudo 비밀번호 (install.sh가 apt 의존성 설치 시) | 시스템 변경 권한 |
| Task 4 | OpenRouter API 키 (`sk-or-...`) | secret — WSL TTY 직접입력 |
| Task 5 | Telegram 봇 토큰 + 대표 Chat ID | secret — WSL TTY 직접입력 |
| Task 6 | Telegram 앱에서 "안녕" 전송 + 응답 확인 | 모바일은 사용자만 봄 |

## secret 취급 규칙 (CLAUDE.md §15-7.5 + spec R5)

- 키/토큰을 **Claude가 stdout/commit/로그에 echo 절대 금지**. 변수명만 표기, 값은 `<REDACTED>`.
- 주입은 **사용자 WSL TTY 직접입력** 또는 권한 600 config 파일. 커맨드라인 인자 전달 금지(`ps`/history 노출).
- 명령 안내 시 `set -x` 금지, history 비활성(`HISTFILE` 또는 명령 앞 공백).
- 노출 시 즉시 토큰 rotation.

---

## Task 1: WSL2 Ubuntu 기동 + 환경 baseline 확인

**Files:** 없음 (시스템 상태 확인만)

- [ ] **Step 1: WSL2 Ubuntu 기동 + OS 확인**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'echo BOOT_OK; cat /etc/os-release | grep -E "^(NAME|VERSION)="; uname -r; ps -p 1 -o comm='
```
Expected: `BOOT_OK` + `NAME="Ubuntu"` `VERSION="24.04...` + kernel `...microsoft-standard-WSL2` + `systemd`

- [ ] **Step 2: 의존성·네트워크 baseline 확인**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'which curl git tar python3; echo "--net--"; curl -fsS -I https://hermes-agent.nousresearch.com/install.sh | head -1; echo DONE'
```
Expected: curl/git/tar/python3 경로 출력 + `HTTP/...200` (또는 2xx/3xx) + `DONE`
조건 분기: install.sh URL이 200이 아니면 **중단하고 보고** (네트워크/프록시/방화벽 — spec R1). 다른 단계 진행 금지.

- [ ] **Step 3: OneDrive 위키 경로 접근 재확인 (C2 전제)**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'ls "/mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS" >/dev/null 2>&1 && echo WIKI_OK || echo WIKI_FAIL'
```
Expected: `WIKI_OK`
조건 분기: `WIKI_FAIL`이면 OneDrive 클라우드전용 파일 이슈 — **C1은 계속 진행**(C1 범위 아님), 단 C2 carry로 기록.

---

## Task 2: Hermes Agent 설치 (install.sh)

**Files:** WSL2 내부 (Hermes repo + venv + 글로벌 `hermes` 명령). Windows 파일시스템 변경 없음.

> ⚠️ install.sh가 apt로 node/ripgrep/ffmpeg 등 설치 시 **sudo 비밀번호**를 요구할 수 있다. 이때 멈추고 사용자에게 WSL 터미널에서 직접 실행을 요청하거나 비번 입력을 받는다. Claude headless에서 sudo 비번 echo 금지.

- [ ] **Step 1: 설치 스크립트 사전 검토 (실행 전 1회 본다)**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh && wc -l /tmp/hermes-install.sh && grep -nE "sudo|apt|curl .*\| *bash|rm -rf" /tmp/hermes-install.sh | head -30'
```
Expected: 줄 수 출력 + sudo/apt 사용 라인 목록. (공급망 안전 — 무엇을 하는지 확인.)
조건 분기: 스크립트가 `rm -rf /` 류 위험 패턴이나 예상 밖 외부 전송을 하면 **중단하고 보고**.

- [ ] **Step 2: 설치 실행 (사용자 입력 지점 — sudo)**

먼저 사용자에게 안내: "Hermes 설치를 시작합니다. apt 의존성 설치 중 sudo 비밀번호를 물으면 WSL 터미널에 직접 입력해주세요." 그 후:
```bash
wsl.exe -d Ubuntu -- bash -lc 'bash /tmp/hermes-install.sh 2>&1 | tee /tmp/hermes-install.log; echo "EXIT=${PIPESTATUS[0]}"'
```
Expected: 설치 진행 로그 + `EXIT=0`
조건 분기:
- `EXIT≠0` → `/tmp/hermes-install.log` tail 50줄 확인 → 누락 의존성이면 해당 패키지 `sudo apt-get install -y <pkg>` 후 재시도. 2회 실패 시 **중단하고 보고**.
- sudo 비번 대기로 멈추면 → 사용자에게 WSL 터미널 직접 실행 요청.

- [ ] **Step 3: 설치 검증 게이트**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'command -v hermes && hermes --version 2>&1 | head -3; echo CHK=$?'
```
Expected: `hermes` 경로 + 버전 출력. (`--version` 미지원이면 `hermes --help` head로 대체 — 명령 존재 확인이 핵심.)
조건 분기: `hermes` 명령 없음 → PATH 미반영 가능. `source ~/.bashrc` 또는 새 `bash -lc`로 재확인. 그래도 없으면 **중단하고 보고**.

---

## Task 3: Hermes 초기 설정 (모델 context 요건 확인)

**Files:** WSL2 내 Hermes config (예: `~/.config/hermes/` 또는 `~/.hermes/` — 설치 후 실제 경로 확인).

- [ ] **Step 1: config 위치·현재 설정 확인**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'hermes config list 2>&1 | head -40; echo "---paths---"; ls -la ~/.config/hermes 2>/dev/null; ls -la ~/.hermes 2>/dev/null'
```
Expected: 현재 config 키 목록 + config 디렉토리 경로. (`config list` 명령명이 다르면 `hermes config --help`로 정확한 서브명령 확인 후 사용.)
조건 분기: config 명령 형식이 문서와 다르면 `hermes --help` / `hermes config --help`로 실제 인터페이스 확인 후 이후 task의 명령을 맞춘다 (spec R2/R3 — 실제 인터페이스 우선).

- [ ] **Step 2: OpenRouter 모델 context 요건 메모**

확인만 (실행 아님): Hermes는 context ≥ 64,000 토큰 모델 필요. OpenRouter 모델 선택 시 64k 미만(일부 소형 모델)은 startup에서 거부됨. Task 4에서 모델 지정 시 이 요건 충족 모델 사용 (예: 큰 context의 범용 모델). 사용자에게 모델 선호 물을 때 이 제약 안내.

---

## Task 4: OpenRouter LLM 연결 (사용자 입력 지점 — secret)

**Files:** WSL2 Hermes config (`OPENROUTER_API_KEY` 등).

> ⚠️ secret 주입. Claude는 키 값을 **받아 stdout에 echo하지 않는다**. 가능하면 사용자가 WSL TTY에서 직접 `hermes config set` 실행. Claude가 대신 넣어야 하면 history 비활성 + 커맨드라인 노출 차단.

- [ ] **Step 1: 사용자에게 OpenRouter 키 요청 + 입력 방식 결정**

사용자에게 안내(택1):
- (A 권장) 사용자가 WSL 터미널에서 직접:
  ```bash
  read -rs OR_KEY && hermes config set OPENROUTER_API_KEY "$OR_KEY" && unset OR_KEY
  ```
  (`read -rs` = 화면 비표시. 입력 후 키는 config에만.)
- (B) Claude가 넣어야 하면: 사용자가 키를 채팅에 주되, Claude는 그 값을 **재출력 금지**하고 아래를 history 비활성로 실행. (A를 우선 권장 — 채팅 노출 회피.)

- [ ] **Step 2: 모델 지정 (context ≥64k)**

Run (모델명은 사용자 선택 — 예시는 자리표시 아님, 실제 OpenRouter 모델 ID로 사용자와 확정):
```bash
wsl.exe -d Ubuntu -- bash -lc 'hermes config set LLM_PROVIDER openrouter; hermes config set OPENROUTER_MODEL "<사용자가 고른 64k+ 모델 ID>"; echo SET_OK'
```
Expected: `SET_OK`. (config 키 이름은 Task 3 Step 1에서 확인한 실제 키명 사용 — `OPENROUTER_MODEL`이 다르면 실제명으로.)

- [ ] **Step 3: LLM 연결 검증 (secret 비노출)**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'hermes config get OPENROUTER_API_KEY 2>&1 | sed -E "s/(sk-or-.{4}).*/\1…<REDACTED>/"; echo "---test---"; hermes chat "ping" 2>&1 | head -5; echo "EXIT=$?"'
```
Expected: 키가 `sk-or-XXXX…<REDACTED>`로 마스킹되어 설정됨 확인 + `hermes chat "ping"`이 LLM 응답 1줄 반환 + `EXIT=0`.
조건 분기:
- `hermes chat` 명령명이 다르면 `hermes --help`로 1회성 프롬프트 서브명령 확인.
- 모델 context 거부 에러("64,000 tokens")면 → 더 큰 context 모델로 Step 2 재실행.
- 인증 에러면 → 키 재확인(사용자), 노출됐으면 rotation.

---

## Task 5: Telegram 봇 게이트웨이 연동 (사용자 입력 지점 — secret)

**Files:** WSL2 Hermes gateway config (Telegram 봇 토큰 + 화이트리스트 Chat ID).

> ⚠️ 봇 토큰 = secret, 동일 비노출 규칙. R7(Chat ID 화이트리스트) C1 필수.

- [ ] **Step 1: gateway 인터페이스 확인**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'hermes gateway --help 2>&1 | head -40'
```
Expected: gateway 서브명령/옵션(telegram, setup, token, allowed chat 등) 목록.
조건 분기: 출력으로 Telegram 설정 방식(대화형 setup vs config set vs config 파일) 확정 후 Step 2 명령을 맞춘다. webhook 요구 시(public HTTPS) → **long polling 옵션 우선 사용**, polling 불가하면 C1 범위 초과로 보고(spec R1).

- [ ] **Step 2: 봇 토큰 주입 (사용자 TTY 직접 권장)**

사용자 WSL 터미널에서(권장):
```bash
read -rs TG_TOKEN && hermes config set TELEGRAM_BOT_TOKEN "$TG_TOKEN" && unset TG_TOKEN
```
(키명은 Step 1에서 확인한 실제명 사용. gateway setup이 대화형이면 사용자가 직접 setup 실행.)

- [ ] **Step 3: Chat ID 화이트리스트 설정 (R7 — 대표만 허용)**

사용자에게 대표 Telegram Chat ID 요청(숫자 ID. 모름 → 봇에 메시지 후 getUpdates로 확인하거나 @userinfobot 사용 안내). 그 후:
```bash
wsl.exe -d Ubuntu -- bash -lc 'hermes config set TELEGRAM_ALLOWED_CHAT_IDS "<대표 Chat ID>"; echo WL_OK'
```
Expected: `WL_OK`. (화이트리스트 키명은 Step 1 확인 실제명. 미지원이면 gateway 설정 내 allowlist 옵션 사용.)

- [ ] **Step 4: gateway 기동**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'nohup hermes gateway start >/tmp/hermes-gateway.log 2>&1 & sleep 8; tail -20 /tmp/hermes-gateway.log; echo "---running---"; pgrep -af "hermes" | head -5'
```
Expected: gateway 로그에 "Telegram connected/listening" 류 + hermes 프로세스 실행 중.
조건 분기: 로그에 토큰 인증 에러 → 봇 토큰 재확인. polling 에러 → 네트워크 확인. 기동 실패 2회 → **중단하고 보고**. (start 서브명령명은 Step 1 확인 실제명.)

---

## Task 6: 동작 검증 (Telegram 왕복 — 사용자 확인)

**Files:** 없음 (런타임 검증).

- [ ] **Step 1: 사용자 Telegram 왕복 (R7 온보딩 포함)**

사용자에게 요청: "Telegram 앱에서 봇에게 **안녕** 보내고, Hermes 응답이 오는지 확인해주세요. (대표 Chat ID만 허용되므로 다른 계정은 무시되어야 정상)"
Expected (사용자 확인): 봇이 응답 1회. 화이트리스트 외 계정은 무응답/거부.
조건 분기: 무응답 → gateway 로그(`tail -40 /tmp/hermes-gateway.log`) 확인 → polling/인증/Chat ID 불일치 진단. 다른 계정도 응답되면 → 화이트리스트 미적용, Step 5-3 재설정.

- [ ] **Step 2: secret 비노출 최종 점검 (spec R5/R6 / Codex)**

Run:
```bash
wsl.exe -d Ubuntu -- bash -lc 'echo "--- history에 토큰 평문? ---"; grep -nE "sk-or-|[0-9]{8,}:[A-Za-z0-9_-]{30,}" ~/.bash_history 2>/dev/null | head -5 || echo "history clean/none"; echo "--- config 권한 ---"; ls -la ~/.config/hermes 2>/dev/null; ls -la ~/.hermes 2>/dev/null'
```
Expected: history에 OpenRouter 키/Telegram 토큰 평문 **없음** + config 파일 권한이 사용자 전용(가능하면 600).
조건 분기: history에 평문 발견 → 해당 라인 제거(`history -d` 또는 파일 편집) + 토큰 rotation 권고. config가 너무 개방적이면 `chmod 600`.

---

## Task 7: C1 설치·설정 절차 문서화 (위키)

**Files:**
- Create: `C:\Users\user\OneDrive\Documents\BestConsulting_OS\wiki\projects\best-consulting-hp\dev-tasks\c1-hermes-telegram-install-20260607.md`

- [ ] **Step 1: 설치 절차 + 검증 결과 + 사용자 입력 지점 기록**

문서 내용(secret 값 없이, 변수명·절차만):
- 설치 명령(install.sh) + 실제 의존성 설치 내역
- config 실제 경로 + 키명(OPENROUTER_*/TELEGRAM_* 실제명)
- 검증 결과: hermes 버전 / LLM ping / Telegram 왕복 / 화이트리스트 / OneDrive 경로 / secret 비노출
- 사용자 입력 지점 4종(sudo/OpenRouter키/봇토큰+ChatID/Telegram확인)
- R6 carry: WSL2 상시 구동·재부팅 자동 재기동은 **별도 승인 필요**(C1은 수동 기동만) — Task에서 scheduler 등록 안 함
- C2 carry: 위키 데이터 연동 / R8 알림 피로도(Daily Digest) / R7 고정 메뉴 버튼

- [ ] **Step 2: 핸드오프 + CLAUDE.md OPEN 갱신 + 메모리**

- 위키 `_index.md`에 본 문서 링크 추가
- best-consulting-hp `SESSION-HANDOFF-multi-ai-system-20260607.md`의 "C cycle ◐ 설계만" → "C1 ✅ 설치 완료 (C2 carry)" 갱신
- (선택) 메모리: Hermes 설치/secret 비노출 패턴이 재사용 가치 있으면 1건

- [ ] **Step 3: 산출물 commit**

```bash
git -C "C:/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp" add docs/superpowers/plans/2026-06-07-hermes-telegram-c1.md docs/superpowers/specs/2026-06-06-hermes-telegram-c1-design.md
git -C "C:/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp" commit -m "docs(c1): Hermes+Telegram C1 설치 plan + spec"
git -C "C:/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp" push
```
(위키는 BestConsulting_OS — repo 밖이므로 commit 대상 아님, 파일 저장만.)

---

## Self-Review (spec 대비)

**1. Spec coverage:**
- §2 실행 분담 → 사용자 입력 지점 표 + Task 2/4/5/6에 명시 ✓
- §3 안전/검증 6항 → Task 2(설치) /4(LLM) /5(gateway+화이트리스트) /6(왕복+secret) /1(OneDrive) 매핑 ✓
- §4 산출물 5종 → Task 2~7 ✓
- R1(WSL2 설치+의존성+실패중단) → Task 1·2 ✓ / R2(OpenRouter 형식) → Task 3·4 ✓ / R3(Telegram 절차) → Task 5 ✓ / R4(OneDrive) → Task 1 Step3 ✓ / R5(secret 비노출) → 전역 규칙+Task 4·5·6 ✓ / R6(상시구동 별도승인) → Task 7 carry, scheduler 등록 안 함 ✓ / R7(화이트리스트+온보딩) → Task 5 Step3·6 Step1 ✓ / R8(알림피로) → Task 7 C2 carry ✓

**2. Placeholder scan:** "사용자가 고른 모델 ID"/"대표 Chat ID"/"실제 키명"은 자리표시가 아니라 **사용자 입력/런타임 확인 지점**(설치형 plan 특성). 명령 형식은 `--help`로 실제 확정하도록 분기 명시 — 추측 코드 없음. ✓

**3. Type consistency:** config 키명(OPENROUTER_API_KEY/OPENROUTER_MODEL/TELEGRAM_BOT_TOKEN/TELEGRAM_ALLOWED_CHAT_IDS)은 공식 문서 기준 표기 + 각 Task에서 "실제명과 다르면 --help로 확인 후 사용" 분기로 일관 처리. ✓

**확인된 gap:** Hermes의 정확한 서브명령/config 키명은 설치 후 `--help`로만 확정 가능 → 각 Task가 이를 분기로 흡수(추측 대신 실측). 이는 설치형 plan의 정상 구조.
