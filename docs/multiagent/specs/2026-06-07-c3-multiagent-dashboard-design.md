# C3 설계 — 멀티AI 에이전트 대시보드 (mission-control 기반) [v2 — L2 검증 반영]

> 작성: 2026-06-07 / author: claude / **v2: Codex(기술 5)+Gemini(UX 5) L2 검증 반영**
> cycle: 멀티AI 시스템 C cycle 세 번째 서브프로젝트 (C1 Hermes+Telegram ✅ / R6 상시구동 ✅ / C2 위키 보고 ✅ 후)
> 진입점: 위키 `[[SESSION-HANDOFF-c1-r6-c2-20260607]]` + 조사 `[[c3-dashboard-opensource-research-20260607]]`
> L2 검증: 위키 `reviews/c3-spec-tech-review-codex-20260607.md`(조건부승인 5) + `reviews/c3-spec-ux-review-gemini-20260607.md`(조건부승인 5)
> 관련 메모리: `feedback_no_inference_verify_data`, `feedback_windows_hook_command_format`, `reference_hermes_skill_execute_code_gate`, `reference_wsl_daemon_autostart`, `feedback_l2_subagent_call_standard`

---

## 0. L2 검증 반영 요약 (v1 → v2)

양쪽 **조건부 승인** — 아키텍처(WSL Next.js + Cloudflare Tunnel + SQLite + 별도 subdomain)는 성립, 운영·보안 디테일 보강 후 진행.

| 출처 | 지적 | v2 반영 |
|---|---|---|
| Codex#1 | 독립성을 DNS 단위로 명확화 | P3에 **zone-level rule(WAF/Access/Redirect/Transform/wildcard Worker route) `*.bestconsulting.vip` 간섭 확인** 추가 |
| Codex#2 | P5 통과기준 느슨 | **실제 CLI 프로세스 실행 실증**(Claude/Codex/Gemini) + 실패 시 Hermes executor fallback (Claude Code bridge는 read-only scan 성격도 있음) |
| Codex#3 | 상시구동 production build | `install --frozen-lockfile`+`build`+`better-sqlite3` 네이티브 빌드 runbook + 기본 포트 **0.0.0.0:3005** 충돌검사 |
| Codex#4 | SQLite 운영 리스크 | 단일 인스턴스 강제(중복 lock) + `MISSION_CONTROL_DATA_DIR` 절대경로 고정 |
| Codex#5 | 공개 노출 보안 | 보안 체크리스트 신규(기본비번 변경 / `MC_ALLOWED_HOSTS` / Cloudflare Access / endpoint 공개범위 / token 권한) |
| Codex+ | 한글화 머지 안정성 | en/ko **key parity 검사 스크립트** + 머지 후 typecheck/test/i18n diff + ko.json 별도 커밋 |
| Gemini#1 | 31패널 정보 과부하 | 핵심뷰/시스템상세 분리 or 즐겨찾기 고정 (P4·차기) |
| Gemini#2 | 용어 표준 | Task=작업 / Dispatch=배정·실행 / Recurring=반복 (자연어 결과 UI 표기) |
| Gemini#3·4 | 비대칭 UX 호평 | C1 Telegram=모바일 HUD / C3=데스크톱 관제소 (모바일 1차 제외 유지) |
| Gemini#5 | 개선 | Artifact 미리보기 / Telegram 알림 액션버튼(중단·재시도) → carry |

---

## 1. 목적과 범위

멀티 AI 에이전트 시스템(Claude/Codex/Gemini)의 **프로젝트·작업·일정·시스템 관리**를 한 웹 화면에서 한국어로 한다. **mission-control(builderz-labs, MIT)을 베이스로 fork**하여 `agents.bestconsulting.vip` 2차 도메인에서 접속. 기존 bestconsulting 서비스와 **완전 독립**(WSL 로컬 + 별도 SQLite + Cloudflare Tunnel — 코드/배포/DB 상호 참조·간섭 0).

### 베이스 선정 근거 (조사 종합 — `[[c3-dashboard-opensource-research-20260607]]`)
- 대표 1순위 = **한글화 UI** → mission-control이 i18n 프레임워크 완비(`messages/en.json` + `src/i18n/` + `language-switcher`) → `ko.json` 번역만으로 한글화.
- 부가 강점: 권한 3-tier(Viewer/Operator/Admin)+SSO / 시스템관리 31패널 / 반복 스케줄(자연어+템플릿) / MIT(자유 수정) / ⭐5,202.
- 약점(차기 보완): 모바일 반응형 ❌ / 1회예약 ❌ / Cloudflare 아님(Next.js).

### ★ 역할 분담 — mission-control(관리 UI) + Hermes(실행 엔진) (P5 코드 확인 발 확정, 2026-06-07)

**P5 선제 코드 확인 결과** (위키 `[[c3-dashboard-opensource-research-20260607]]` + 본 cycle): mission-control은 CLI를 **직접 spawn 실행하지 않음**:
- `spawn/route.ts` → OpenClaw 게이트웨이로 HTTP/RPC 위임 (우리엔 OpenClaw 없음)
- `claude-tasks/route.ts` → `~/.claude/tasks` **읽기 전용 스캔**(모니터링)
- `pty/attach` → **이미 떠 있는 tmux 세션에 attach**(사람이 먼저 CLI 실행)
- Gemini CLI → 미지원(claude-code/codex-cli/hermes만)

→ "보드에서 task 만들면 자동 실행"은 mission-control 단독 불가. **역할 분담 확정**:
- **mission-control** = 관리·모니터링·한글 UI·일정·권한 **보드**
- **Hermes** = 실제 작업 **실행 엔진**(acp/kanban/swarm — 우리 보유)
- **연동** = 둘을 이어 "지시 → 실행" 완성 (대표 결재 2026-06-07)

### 범위 (1차)
- ✅ mission-control fork 설치 + WSL 구동 + Cloudflare Tunnel 2차 도메인 노출
- ✅ 한국어화(`ko.json` + locale 등록)
- ✅ 에이전트 등록 + 작업 보드 + 반복 스케줄 + 권한(기본) 검증 (관리·모니터링)
- ✅ **Hermes 실행엔진 연동 1차** — mission-control 작업 지시 → Hermes(kanban/swarm) 실제 실행 → 진행상황 mission-control 반영 (최소 1 에이전트 E2E)
- ✅ Hermes cron → Telegram 업데이트 알림
- ✅ 상시구동(R6 패턴)
- ⏸ 차기: 모바일 반응형 / 1회 예약 / OpenClaw 게이트웨이 옵션 / Hermes 연동 깊이(전체 에이전트·양방향 동기화)

---

## 2. 아키텍처 & 독립성

```
[대표 브라우저/모바일]
   │ https://agents.bestconsulting.vip
   ▼
[Cloudflare Tunnel] ── cloudflared (WSL 실행)
   │  DNS: agents CNAME → tunnel (bestconsulting.vip Pages 라우트와 별개)
   ▼
[WSL2 Ubuntu — 사용자 bestconsulting]
   ├─ mission-control (Next.js, pnpm start, 포트 분리 — Hermes :9119 회피)  ← 관리/모니터링 UI
   │    └─ SQLite (로컬 ~/mission-control/data.db)
   │    │ 작업 지시 (연동)
   │    ▼
   ├─ Hermes (acp/kanban/swarm)  ← 실제 작업 실행 엔진 (우리 보유)
   │    └─ Claude/Codex 실행 → 진행상황 → mission-control 반영
   ├─ Hermes gateway (C1, :9119 / Telegram)  ← 공존
   └─ Hermes cron (P6 업데이트 알림 / 차기 연동)
```

### 독립성 보장 (대표 mandate — 핵심)

| 계층 | bestconsulting (기존) | C3 대시보드 (신규) |
|---|---|---|
| 코드 | repo `best-consulting-hp` | **repo 밖** (WSL `~/mission-control/`, 별도 fork) |
| 배포 | Cloudflare Pages + Workers | **WSL 로컬 프로세스** (Pages/Workers 미사용) |
| DB | Cloudflare D1 | **로컬 SQLite** (D1 미사용) |
| 도메인 | bestconsulting.vip (Pages 라우트) | agents.bestconsulting.vip (**Tunnel 라우트** — 별개) |
| 비밀 | bestconsulting secrets | **별도** mission-control .env |

**상호 참조 0 보장**:
- C3 코드는 best-consulting-hp repo **밖** → bestconsulting 개발 시 grep/import로도 안 닿음.
- 같은 Cloudflare 계정이나 **DNS 서브도메인 라우트만 공유** — Pages 프로젝트/D1/Worker 무접촉.
- Tunnel은 `agents` 서브도메인만 라우팅 → 루트 트래픽과 격리.

### 핵심 결정
1. **WSL 단일 호스트** — C1 Hermes와 mission-control 공존(포트 분리). 상시구동은 R6 패턴 재사용.
2. **MIT fork** — clone해서 우리 것으로(한글화·보완 자유). 업스트림은 선택 머지.
3. **C3 → bestconsulting 무접촉** (위키 연동도 요구에서 제외됨).

---

## 3. 업스트림 업데이트 정책

mission-control은 GitHub 오픈소스(MIT)이나 **소스 clone 방식**(npm 패키지 아님) → 자동 업데이트 없음(의도적 — 한글화 보존). fork로 통제 + 알림만 자동화.

```
upstream (builderz-labs/mission-control) ──┐ 새 릴리스
   │                                        │ (우리가 원할 때만 merge)
   ▼                                        ▼
[Hermes cron 1일1회 확인]              our fork (ko.json + 수정)
   │ fork보다 최신이면                       │ git fetch upstream && merge (충돌 검토)
   ▼                                        ▼
[hermes send → Telegram]              WSL 재빌드·재시작 (수동)
"⬆️ mission-control 새 버전 vX.Y"
```

- **자동 업데이트 ❌** — 수동 `git pull`만 (안정 우선, 한글화 보존).
- **자동 알림 ✅** — Hermes cron이 upstream 최신 릴리스/태그 주기 확인 → fork보다 최신이면 `hermes send` Telegram. LLM 불필요(`--no-agent` 스크립트). C1 자산 재사용.
- **실행** — 알림 → 대표 판단 → fetch/merge → 한글화 충돌 검토 → 테스트 → 재시작. 항상 사람 통제.

---

## 4. 한글화 방식

mission-control i18n 완비 → "번역 파일 추가"가 핵심, 코드 수정 최소.

```
messages/en.json (원본 영어 전체 문자열)
        │ 복제 + 번역
        ▼
messages/ko.json (신규 한국어)  ← 우리가 만드는 것
        +
src/i18n/config.ts (locales 배열에 'ko' 추가)
src/components/ui/language-switcher.tsx (한국어 옵션 등록)
```

**단계**:
1. `messages/en.json` 규모 확인(문자열 수 = 작업량 실측).
2. `ko.json` 생성 — 영어 키 구조 그대로, 값만 번역. **AI 도메인 용어 표준화**(task=작업, agent=에이전트, dispatch=배정/지시, schedule=일정, recurring=반복 등).
3. `i18n/config.ts`에 `ko` 등록 + 기본 locale = 한국어.
4. language-switcher "한국어" 표시.

**주의**:
- 업스트림 머지로 en.json 새 키 추가 시 ko.json도 갱신 — 누락 키는 영어 fallback(next-intl 기본)이라 안 깨짐. 머지 시 새 키만 번역.
- 번역 범위: i18n 완비라 **전체 한 번에** 권장.

---

## 5. 단계별 구축 (Phase)

| Phase | 내용 | 검증 |
|---|---|---|
| P1 설치·구동 | WSL fork clone + `pnpm install --frozen-lockfile` + `pnpm build` + **better-sqlite3 네이티브 빌드**(python3/make/g++, 필요시 `pnpm rebuild better-sqlite3`) + 로컬 구동. **기본 포트 0.0.0.0:3005 / Hermes :9119 / 3000 충돌검사**(★Codex#3) | localhost:PORT 대시보드 로드 |
| P2 2차 도메인 | cloudflared 설치 + agents.bestconsulting.vip public hostname(`agents` 단일 CNAME → `<UUID>.cfargotunnel.com`) + Tunnel→localhost:PORT | 외부 https 접속 |
| **P3 독립성 검증(강화)** | (a) agents에 기존 A/CNAME/Pages custom domain/Worker route **없음** 확인 (b) **같은 zone의 WAF/Access/Redirect/Transform/wildcard DNS·Worker route가 `*.bestconsulting.vip`에 간섭하는지 확인**(★Codex#1) (c) bestconsulting Pages/D1/Worker 무영향 (d) C3는 로컬 SQLite만 | 양쪽 별개 동작 + zone rule 무간섭 |
| P4 한글화 | ko.json + locale 등록(config 'ko' + switcher) + 한국어 기본 + 용어 표준(작업/배정·실행/반복, ★Gemini#2) + **en/ko key parity 스크립트**(★Codex+) | UI 한국어 + 전환 + parity 통과 |
| **P5 실행엔진 연동(확정)** | ★P5 코드 확인으로 mission-control 단독 dispatch 불가 확정 → **Hermes 실행엔진 연동이 공식 범위**. mission-control 작업 지시 → Hermes(kanban/swarm)가 Claude/Codex 실제 실행 → 진행상황을 mission-control에 반영. 연동 방식(webhook/api/공유DB) 결정 + 최소 1 에이전트 E2E | mission-control 지시 → **Hermes 실제 실행** → 진행 반영 (E2E 1건) |
| **P5.5 보안(신규)** | (★Codex#5) 기본 계정/비번 즉시 변경 + `MC_ALLOWED_HOSTS=agents.bestconsulting.vip` + Cloudflare Access 적용 여부 결정 + `/api-docs`·webhook·agent registration endpoint 공개범위 검토 + Tunnel token/세션쿠키 권한 | 보안 체크리스트 통과 |
| P6 업데이트 알림 | Hermes cron(upstream 릴리스 → `hermes send` Telegram, `--no-agent`) | 알림 1회 수신 |
| **P7 상시구동(강화)** | mission-control WSL 자동기동(R6 패턴, systemd+linger). **production build 기준**(`pnpm build` 후 start) + **단일 인스턴스 강제**(중복 프로세스 SQLite lock 방지) + `MISSION_CONTROL_DATA_DIR` 절대경로 고정(★Codex#3·#4) | 재부팅 후 자동 + 단일 인스턴스 |

**원칙**:
- 각 Phase 끝 실측 검증(추측 금지).
- P1~P3(설치·노출·독립)이 최대 위험 — 막히면 멈추고 보고.
- secret(.env) 별도 관리·출력 금지(§15-7.5).
- WSL 명령: `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -u bestconsulting -- sh -c '...'` + 경로 quote.
- 설치 요건(Node22+/pnpm/Docker)은 P1 진입 전 WSL 확인.
- Cloudflare Tunnel은 계정 권한 → 대표 인증 1회 발생 가능.

---

## 6. 검증 (V1~V9)

| 검증 | 방법 | 통과 기준 |
|---|---|---|
| V1 구동 | WSL localhost:PORT | 대시보드 200 + 패널 로드 |
| V2 외부 접속 | https://agents.bestconsulting.vip | TLS + 대시보드 |
| **V3 독립성(강화)** | bestconsulting.vip 정상 재확인 + C3 D1/Pages 무접촉 + **zone rule(WAF/Access/Redirect/Transform/wildcard) `*.bestconsulting.vip` 무간섭**(★Codex#1) | 상호 영향 0 |
| V4 한글화 | UI 한국어 + en↔ko 전환 + **en/ko key parity**(★Codex+) | 한국어, fallback 깨짐 0, parity OK |
| **V5 작업관리(강화)** | **실제 CLI 프로세스 실행 실증**(Claude/Codex — 큐 등록 ≠ 실행 구분, ★Codex#2). 실패 시 Hermes executor 연동 | dispatch → **프로세스 실행** → 전이 실측 |
| **V5.5 보안(신규)** | 기본비번 변경 + `MC_ALLOWED_HOSTS` + endpoint 공개범위 + token 권한(★Codex#5) | 보안 체크리스트 통과 |
| V6 반복스케줄 | "every morning" 1건 → 자식 task | 스케줄 동작 |
| V7 권한 | role(Viewer/Operator/Admin) 1개 확인 | 권한별 접근 차이 |
| V8 업데이트 알림 | Hermes cron 강제 실행 | Telegram 수신 |
| **V9 상시구동(강화)** | 재부팅 후 자동 + **단일 인스턴스**(중복 SQLite lock 0) + DATA_DIR 절대경로(★Codex#4) | 사람 개입 0 + 단일 인스턴스 |

---

## 7. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| mission-control이 Claude/Codex/Gemini CLI를 실제 dispatch 실행하나 (프레임워크 어댑터 중심 가능 — "Claude Code 세션 감지"는 확인됐으나 CLI 직접 실행은 P5 실증 필요) | P5에서 실제 에이전트 1개 dispatch 검증. 안 되면 "관리·모니터링 우선 + 실행은 Hermes 연동"으로 범위 조정 |
| Cloudflare Tunnel ↔ 기존 Pages 라우트 충돌 | agents 서브도메인만 Tunnel, 루트는 Pages — DNS 분리 확인 |
| WSL 로컬 안정성(재부팅) | R6 패턴(systemd+linger) 재사용. mission-control은 LLM 잔액 무관 |
| 한글화가 업스트림 머지로 깨짐 | fork + ko.json 분리(원본 최소 수정) |
| 독립성 위반(실수 참조) | C3 코드 repo 밖 배치(물리 차단) |

---

## 8. 산출물

- **WSL(repo 밖)**: `~/mission-control/`(fork) + cloudflared 설정 + 자동기동 스크립트
- **위키**: `dev-tasks/c3-dashboard-20260607.md`(구축 기록) + 핸드오프 갱신 + log
- **repo**: 본 spec + plan (`docs/superpowers/`) — **C3 코드는 repo 밖**(독립 mandate)

---

## 9. 실측 확인 사항 (설계 근거)

- mission-control 라이선스 MIT / ⭐5,202 / Next.js16+SQLite (gh CLI 실측)
- i18n 완비: `messages/en.json`, `src/i18n/config.ts`, `language-switcher.tsx`, `theme-selector.tsx` (git tree 실측)
- 권한 3-tier(Viewer/Operator/Admin)+Google SSO / 반복 스케줄(자연어+템플릿복제) / 웹훅 (README 실측)
- 모바일 ❌ / 1회예약 ❌ (실측 — 차기 보완)
- Hermes acp/cron/kanban 보유(C1·C2·조사 실측) — 업데이트 알림 + 차기 백엔드 연동 재료
- WSL 사용자 bestconsulting + OneDrive 접근 + R6 상시구동 패턴 (C1 실측)

## 10. carry (C3 이후)
- 모바일 반응형 추가 (mission-control 데스크톱 우선)
- 1회 예약 스케줄 (반복만 지원)
- Hermes kanban/cron 백엔드 연동 깊이 (역할/swarm 통합)
- C3 코드 별도 repo 분리 여부 (현재 WSL 로컬 fork)
- ★ **31패널 정보 과부하 완화**(Gemini#1) — 핵심 대시보드/시스템 상세 분리 or 즐겨찾기 패널 고정
- ★ **Artifact 미리보기**(Gemini#5) — 에이전트 결과물(이미지/코드/문서)을 대시보드 내 확인 (위키 이동 동선 단축)
- ★ **Telegram 알림 액션 버튼**(Gemini#5) — 업데이트/작업 알림에 중단·재시도 인라인 버튼 (모바일 대응 보완)
