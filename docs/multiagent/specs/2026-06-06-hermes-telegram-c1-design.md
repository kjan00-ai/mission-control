# Hermes 설치 + Telegram 연동 설계 (C cycle / C1)

> 작성일: 2026-06-06
> 작성: Claude Code (brainstorming)
> 상태: draft → 사용자 검토 대기
> 범위: 전체 구상(A 위키 + B 부트스트랩 + C 모니터링) 중 **C cycle, 첫 서브프로젝트 C1**
> 선행: A cycle(위키) + B cycle(부트스트랩) 완료
> 후속: C2(작업 데이터→Hermes 연동) / C3(대시보드, 필요시)

---

## 0. 배경 — C cycle 분해와 C1의 위치

사용자 요구: "프로젝트별·AI별·에이전트별 진행 모니터링 대시보드 + 대표는 Hermes agent로 확인·지시 + 모바일은 Telegram 연동".

**핵심 발견 (실측):** Hermes Agent(`hermes-agent.org`)는 **CLI 자체호스팅 오픈소스(MIT, 무료)** 제품이고, **Telegram 게이트웨이 + 스케줄링 + 대표 인터페이스를 통째로 제공**한다. 즉 C는 "대시보드를 처음부터 만들기"가 아니라 "Hermes 설치 + 우리 작업데이터 연동"이 핵심.

**C cycle 분해 (사용자 결재):**
| 서브 | 내용 | 상태 |
|---|---|---|
| **C1** | Hermes WSL2 설치 + OpenRouter LLM + Telegram 봇 연동 + 기본동작 | **본 spec** |
| C2 | 위키 log/handoffs + 프로젝트별 진행 → Hermes가 읽는 연동 레이어 | 다음 |
| C3 | 대시보드 (Hermes 보고로 부족 시) | 다음, 선택 |

**환경 실측:** WSL2 + Ubuntu(v2) 설치됨(Stopped) / curl 가용 / Hermes는 Linux·macOS·WSL2 지원 → 설치 가능.

---

## 1. 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  Telegram (모바일/PC) ← 대표가 메시지로 확인·지시          │
└────────────────────────┬────────────────────────────────┘
                         │ Telegram Bot API (봇 토큰)
┌────────────────────────▼────────────────────────────────┐
│  WSL2 Ubuntu                                             │
│  └── Hermes Agent (CLI, curl 설치)                       │
│      ├── gateway: Telegram 연결                          │
│      ├── LLM: OpenRouter (키)                            │
│      └── memory + skills + scheduling (제품 기본)        │
└──────────────────────────────────────────────────────────┘
                         │ (C2 범위) 읽기
┌────────────────────────▼────────────────────────────────┐
│  위키 (BestConsulting_OS) — Windows 파일시스템           │
│  WSL2에서 /mnt/c/Users/user/OneDrive/.../BestConsulting_OS│
└──────────────────────────────────────────────────────────┘
```

**C1 범위 한정:** Hermes 설치 + OpenRouter 연결 + Telegram 봇 연동 + "안녕" 수준 왕복 확인. **위키 데이터 연동은 C2.** 단 WSL2에서 OneDrive 경로(`/mnt/c/...`) 접근 가능 여부는 C1에서 1회 미리 확인(C2 전제).

### 결정 근거
- Hermes가 게이트웨이·스케줄링·메모리를 제공 → 자체 구현 대비 압도적 절감. 사용자가 Hermes 명시.
- 자체호스팅·텔레메트리 없음 → 작업 데이터 외부 유출 없음(사용자 환경 안).

---

## 2. 실행 분담 (사용자 결재 — Claude 최대 자동 + 사용자는 키·토큰만)

| 단계 | 주체 | 비고 |
|---|---|---|
| WSL2 Ubuntu 기동 | Claude | `wsl.exe -d Ubuntu` |
| Hermes `curl` 설치 | Claude | 공식 설치 스크립트 (sudo 필요 시 사용자 1회 비번) |
| OpenRouter 키 발급 | **사용자** | 계정·결제 — 사람만 가능 |
| Telegram 봇 발급(@BotFather) → 봇 토큰 | **사용자** | 모바일/앱 — 사람만 가능 |
| `hermes setup` (OpenRouter 키 입력) | Claude | 사용자가 준 키로 |
| `hermes gateway setup` (Telegram 토큰 입력) | Claude | 사용자가 준 토큰으로 |
| 동작 검증 (Telegram 메시지 → Hermes 응답) | Claude 트리거 + **사용자 확인** | 모바일 응답은 사용자만 봄 |

**★ spec/plan에 "사용자 입력 필요 지점" 명시** — 그 지점에서 멈추고 키/토큰 요청. 없이 진행 불가.

---

## 3. 안전 · 검증

- **WSL2 설치 = 시스템 변경**: 각 주요 단계 로그 + 실패 시 중단. sudo는 사용자 1회 비번.
- **secret 취급**: 봇 토큰·OpenRouter 키 = secret → CLAUDE.md §15-7.5 secret echo 금지 적용. **화면·커밋·로그에 평문 금지**, Hermes 설정파일(WSL2 내부)에만. Claude는 사용자가 준 값을 받아 설정 명령에 넣되 stdout에 echo 안 함.
- **자체호스팅**: Hermes 텔레메트리 없음 — 데이터 외부 전송 없음.
- **검증 항목**:
  1. `hermes --version`(또는 설치 확인) PASS
  2. `hermes gateway` 상태 = Telegram 연결됨
  3. **Chat ID 화이트리스트(Gemini R7)**: 대표 Chat ID만 허용 설정 + 인증완료 메시지 확인
  4. Telegram 봇에 "안녕" → Hermes 응답 1회 왕복 (사용자 확인)
  5. WSL2에서 `ls /mnt/c/Users/user/OneDrive/Documents/BestConsulting_OS` 접근 확인 (C2 전제)
  6. secret 비노출 확인: shell history·로그에 키/토큰 평문 없음 (Codex R5)

---

## 4. 본 cycle(C1) 산출물

1. WSL2 Ubuntu에 Hermes Agent 설치
2. OpenRouter LLM 연결 (`hermes setup`)
3. Telegram 봇 게이트웨이 연동 (`hermes gateway setup`)
4. 기본 동작 검증 (Telegram 왕복 + WSL2 OneDrive 경로 접근)
5. 설치·설정 절차 + 사용자 입력 지점 문서화 (위키 reviews 또는 handoffs)

### 범위 밖 (C2/C3)
- 위키 log/handoffs를 Hermes가 읽어 "프로젝트별·AI별 진행" 보고 (C2)
- 시각적 대시보드 (C3, 선택)
- Hermes 스케줄링으로 정기 보고 자동화 (C2/C3)

---

## 5. 열린 질문 / 리스크

### R1 — WSL2 Hermes 설치 실제 동작 (Critical, plan 최우선 검증) ★ Codex 보강
- Hermes 공식 설치 스크립트가 현재 WSL2 Ubuntu(v2, Stopped)에서 실제 도는지. sudo 요구 시점.
- **의존성 사전 점검 목록(Codex)**: ca-certificates, git, unzip/tar, build-essential, node/python/rust/go 런타임, systemd 사용 여부, PATH 반영, Ubuntu 버전, Windows/WSL 프록시·방화벽.
- **Telegram polling vs webhook 확인(Codex)**: long polling이면 inbound 포트 불요(C1 범위 유지). webhook이면 public HTTPS endpoint 필요 → C1 범위 커짐 → polling 우선 확인.
- plan 1단계에 "WSL2 기동 + 의존성 점검 + 설치 스크립트 + 실패 시 진단" mandate.

### R2 — Hermes ↔ OpenRouter 연결 형식
- `hermes setup`이 OpenRouter 키를 어떤 형식으로 받는지(대화형 prompt vs config 파일). 실제 설치 시 확인.

### R3 — Telegram 봇 게이트웨이 설정
- `hermes gateway setup`의 Telegram 연동 절차(봇 토큰 + chat_id 등). 대화형일 가능성 → Claude가 헤드리스로 넣기 어려우면 사용자 입력 지점으로.

### R4 — WSL2 ↔ Windows OneDrive 경로 (C2 전제)
- WSL2에서 `/mnt/c/Users/user/OneDrive/...` 접근 성능·동기화. OneDrive 클라우드 전용 파일 이슈 가능. C1에서 1회 확인.

### R5 — secret 비대화형·비노출 주입 (Critical) ★ Codex 보강
- `hermes setup`/`gateway setup`이 프롬프트 기반이면 Claude headless 주입 시 **커맨드라인 인자·shell history·로그·프로세스 목록 노출** 위험.
- **비노출 절차(Codex)**: ① config/env 파일 방식 지원 확인 → 권한 600 파일로 주입 ② 미지원 시 **사용자가 WSL TTY에서 직접 입력**(Claude는 명령만 안내) ③ `read -s` 패턴. 커맨드라인 인자 전달 절대 금지.
- **운영 절차**: set -x 금지 / history 저장 방지(`HISTFILE` 비활성 또는 ` ` 접두) / Hermes config 권한 확인 / 노출 시 토큰 rotation.
- plan에 "secret은 사용자 TTY 직접입력 또는 600 config" 명시 — Claude가 stdout에 echo하는 경로 차단.

### R6 — WSL2 상시 구동 (별도 승인) ★ Codex 보강
- Hermes Telegram 게이트웨이 상시 동작 = WSL2 + Hermes 데몬 상주 필요. C1은 **수동 기동만**.
- Windows 재부팅 후 자동 재기동(Task Scheduler/Startup/service)은 **별도 사용자 승인 필요** — 무단 scheduler 등록 금지(안전 게이트). C2/C3에서 승인 후 설계.

### R7 — 대표 UX (Gemini 보강 — C1 산출물에 추가)
- **Chat ID 화이트리스트(보안)**: 봇이 아무나 못 쓰게 대표 Chat ID만 허용. 봇이 대표 계정 식별 → 화이트리스트 잠금 → 인증완료 메시지. C1 검증 항목.
- **첫 진입 고정 메뉴(백지 공포 해소)**: "안녕" 외 뭘 할지 모름 → 고정 키보드/인라인 버튼([최근 작업 요약][작업 지시][시스템 상태]) 기본 제공. C1 또는 C2.
- **온보딩 메시지**: 연결 완료 시 "WIKI 현황 모니터링 준비됨, 요약 볼까요?" 안내.

### R8 — 알림 피로도 (C2 carry — Gemini)
- 작업마다 알림 vs 일일 요약(Daily Digest) 수신 설정. C1 범위 밖, C2 데이터 연동 시 설계.
