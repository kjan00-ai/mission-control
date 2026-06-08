# C4 — 에이전트 3층위 정합 (Agent Three-Layer Alignment) 설계

> 멀티AI 시스템 C cycle 4번째 서브프로젝트. 베이스: C3 대시보드(mission-control fork + Hermes/codex/gemini 연동). 위키 확정 설계: `BestConsulting_OS/wiki/projects/best-consulting-hp/dev-tasks/c3-dashboard-20260607.md §C4 후속 설계`(대표 결재). 본 spec은 그 결재 설계를 실측 결과로 구체화한 것.
>
> - 날짜: 2026-06-07
> - 작성: claude
> - 버전: **v2** (L2 검증 반영 — Codex 기술 조건부6 + Gemini UX 조건3 전부 반영. §5.4 rate limit 신규)
> - 선행 cycle: C1(Hermes+Telegram) / R6(상시구동) / C2(위키 보고) / C3(대시보드)
> - SSOT: 멀티AI 지식은 위키 원본, 코드/spec은 repo 원본 + 위키링크

---

## 1. 문제 정의

대표 핵심 지적: **"agents 웹에서 확인/지시되는 작업자 = 실제 실행되는 작업자가 동일해야 한다."**

현재 3개 층위가 전부 어긋나 있다:

| 층위 | 현재 상태 | 문제 |
|---|---|---|
| **[1] 화면 표시** | mission-control builtin 데모(dogfood/yuanbao) | 우리 시스템과 무관한 이름 |
| **[2] 실제 실행(assignee 라우팅)** | `codex`/`gemini`/`default`(Hermes) 3분기 | 프로젝트 서브에이전트와 무관 |
| **[3] 프로젝트 실제 서브에이전트** | `best-consulting-hp/.claude/agents` 12개 | 화면·실행에 안 드러남 |

→ 대시보드에서 "frontend-engineer에게 시킨다"가 불가능하고, 화면 카드는 실제 작업자를 반영하지 않는다.

## 2. 목표

세 층위를 **단일 진실**로 통일한다.

- **단일 진실 = [3] 프로젝트별 `.claude/agents`** (전역 `~/.claude/agents`가 아님 — mission-control 프로젝트 = 그 repo의 `.claude/agents`)
- 정합 체인: **[3] 정의 → [1] 화면 카드 동일 이름 → [2] task assignee 동일 이름 → 실행도 그 서브에이전트**
- 실행 주체 = **Claude(claude CLI)가 해당 서브에이전트로 `--agent` 실행**

## 3. 실측으로 검증된 전제 (2026-06-07, 전부 PASS)

C4 최대 리스크였던 "claude CLI headless 서브에이전트 실행 가능성"을 WSL 실환경에서 검증 완료:

- ✅ **claude CLI 2.1.168 설치 + Claude account OAuth 인증 완료** (`~/.claude/.credentials.json` 생성, `~/bin/claude` 심링크)
- ✅ **`--agent <name>` 공식 지원** — 세션 전체를 그 서브에이전트로 실행(위임 경로 안 탐, 직접 지정). 플래그 실재 확인.
- ✅ **`.claude/agents/` cwd walk-up 자동발견** — 별도 등록/플래그 불필요. BC repo cwd에서 `claude --agent frontend-engineer -p "..."` 실행 시 서브에이전트가 자기 정체성·역할 정확 인식:
  - 실측 결과: `"I'm the frontend-engineer agent, responsible for implementing Next.js 14 App Router pages, React components, and UI flows for the BEST-consulting project."`
- ✅ **`--permission-mode acceptEdits` + `--output-format json`** — cron 무인 실행 + 기계 파싱 가능. `permission_denials: []`.
- ✅ **fork 수정 지점 확정**: `src/lib/local-agent-sync.ts` L101~103 이 `homedir()` 기준 전역 경로(`~/.agents`/`~/.codex/agents`/`~/.claude/agents`)만 스캔 → 프로젝트별 미스캔 확인. `agents` 테이블에 `display_name` 컬럼 없음(users 테이블엔 있음).

> ⚠️ 비용 주의: BC의 거대한 CLAUDE.md + 12개 agents 전체 로드로 단일 `--agent` 호출 시 cache_creation 128K 토큰 발생(API 환산 ~$0.80). 단, Claude account OAuth는 **구독 한도 내**라 추가 청구 아님. → rate limit 제어는 §5.4에서 C4 필수로 다룸(carry 아님).

> ⚠️ CLI 버전 의존 (Codex 조건부 #1): 본 실측은 **claude CLI 2.1.168 기준**이며 장기 API 보장 아님. 연동 스크립트는 실행 전 `claude --version` 체크 + `--agent`/`--print` 플래그 존재 가정 실패 시 즉시 `failed`+Telegram. CLI 업그레이드는 검증 후 적용(자동 업그레이드 금지).

## 4. 범위

이번 C4 cycle 범위 (대표 결재): **② 연동 스크립트 + ③ mission-control fork 수정 + ⑤ 3층위 정합 E2E**

- ① claude CLI 설치+인증 → ✅ **완료**(brainstorm 단계에서 선행 실측)
- ④ B 부트스트랩 자동 연동 → **별도 cycle (carry)**

## 5. 설계

### 5.1 컴포넌트 ① — 연동 스크립트 재작성 (`c3_mc_to_hermes.js`)

WSL `~/mission-control/c3_mc_to_hermes.js` (현 v4). MC SQLite tasks 폴링 → assignee 분기 → 실행.

**현재 분기**: `codex` → codex exec / `gemini` → gemini -p / `default`(+기타) → Hermes kanban

**추가 분기 (C4)**:
```
assignee ∈ CLAUDE_AGENTS (프로젝트 .claude/agents 이름 12종)
  → cwd = resolveRepoPath(github_repo)   // 기존 로직 재사용 (자동 clone/pull)
  → git -C <cwd> pull (최신화, Gemini 必 #2)   // KNOWN_LOCAL은 skip, 실패해도 진행, 로그
  → claude --agent <assignee> -p <title>
       --permission-mode acceptEdits
       --output-format json
       (timeout 300s)
```

**분기 진입 가드 (Codex 조건부 #3 반영)** — claude-agent 분기는 아래를 **모두** 충족해야 진입:
1. task에 `project`/`github_repo`가 **확정**돼 있어야 함 (project 미지정 task는 claude-agent 분기 금지 → default/skip)
2. cwd = resolveRepoPath(github_repo) 확정 + `<cwd>/.claude/agents/<assignee>.md` **실제 존재 확인**
3. assignee가 예약어 `codex`/`gemini`/`default`와 **겹치지 않을 것** (겹치면 기존 CLI/Hermes 분기 우선 — 이름 충돌 가드)
- ⚠️ **assignee 미존재 = fallback 금지 (Codex 조건부 #3, 핵심)**: project가 지정됐는데 `.claude/agents/<assignee>.md`가 없으면(오타 `frontend-enginer` 등) **default Hermes로 흘리지 않고 `failed`**(reason: agent_not_found) + Telegram. 정합 실패를 숨기지 않음.

**원자적 task claim (Codex 조건부 #4, 핵심)** — 중복 pickup 방지:
- 폴링이 `todo → running` 으로 **원자적 UPDATE**(`UPDATE tasks SET status='running' WHERE id=? AND status='todo'` → `changes()=1`일 때만 이 인스턴스가 소유). cron 중첩·재시작·status 지연에 안전. last-id 커서는 보조.

**실행 가시성 (Gemini 必 #1)** — claude/codex/gemini 공통 적용:
- `timeout 300`로 hang 차단 + **child process tree kill 보장**(`timeout --kill-after` / 프로세스 그룹 kill — 좀비 방지)
- 종료 후 **판정 우선순위 (Codex 조건부 #4)**: exit code 0 + JSON valid → `done` / exit 0 이나 JSON malformed → `failed`(reason: bad_output) / exit nonzero → `failed`(부분 JSON 있어도 실패 우선) / timeout(124) → `failed`(reason: timeout)
- 결과를 MC `tasks.status` UPDATE (역방향)
- 실패 시 Telegram 알림 (`hermes send` 또는 직접 Bot API, home channel 6206674018) — 요약 + 로그 경로
- **OAuth 만료/반복 실패 backoff (Codex 조건부 #4)**: 동일 task·동일 reason 반복 실패 시 backoff·suppress(같은 실패를 cron마다 재과금 방지). OAuth 만료는 별도 reason(auth_expired) + 재로그인 안내 1회.
- 로그 파일: `~/.c3-relay-logs/{task_id}-{assignee}-{ts}.log` (기존 패턴 유지)

**acceptEdits 파일 변경 정책 (Codex 조건부 #4)**:
- claude `--agent`가 `acceptEdits`로 실 파일을 변경할 수 있음. 실행 후 `git -C <cwd> diff --stat`을 로그에 기록(변경 가시화). **자동 commit/push는 하지 않음**(대표 검토 후 수동 — BC master 직접 관행과 분리). KNOWN_LOCAL(OneDrive 원본)은 이 PC가 직접 작업하는 곳이라 변경이 작업트리에 남는 것이 정상.

> **assignee 이름 = 영어 정의 이름**(frontend-engineer). display_name(한글)은 화면 표시 전용이며 실행 키로 안 씀.

**CLAUDE_AGENTS 출처**: 하드코딩 배열이 아니라, 실행 시점에 해당 프로젝트 `<cwd>/.claude/agents/*.md` 파일명(확장자 제거)을 읽어 동적 결정 → 프로젝트마다 다른 에이전트 셋 지원 + 스크립트 코드 수정 0(신규 프로젝트 자동).

> ⚠️ **cwd 정합 mandate**: claude 실행 cwd, scanProjectAgents 스캔 경로, assignee 검증(.claude/agents 존재 확인)이 **반드시 동일 경로**여야 3층위 정합이 성립한다. BC는 `resolveRepoPath`의 `KNOWN_LOCAL` 매핑상 OneDrive 원본(`/mnt/c/Users/user/OneDrive/.../best-consulting-hp`)을 쓰고, 그 외 프로젝트는 `~/c3-repos/{repo}` 사본을 쓴다. fork의 scanProjectAgents도 동일 resolve 규칙을 공유해야 함(화면에 표시된 에이전트 = 실행 경로의 에이전트). ⚠️ BC는 OneDrive 원본이라 git pull이 OneDrive 동기화와 충돌할 수 있음 — KNOWN_LOCAL 경로는 pull skip(원본은 이 PC가 직접 작업하는 곳).

### 5.2 컴포넌트 ② — mission-control fork 수정 (접근 A, 커밋 분리)

위키 결재 = A 정공법. Claude 검증 권고 = ko.json처럼 **논리 단위로 커밋 분리**해 업스트림 머지 충돌 최소화.

**공유 resolveRepoPath (Codex 조건부 #5, mandate)**: cwd 결정 규칙(KNOWN_LOCAL + `~/c3-repos/{repo}`)을 연동 스크립트와 fork가 **단일 진실로 공유**해야 함. 구현: WSL `~/.c3-repo-map.json`(KNOWN_LOCAL 매핑 + REPOBASE) 설정 파일 1개 → 연동 스크립트·scanProjectAgents 양쪽이 읽음. "공유해야 한다"는 권고가 아니라 동일 설정 파일 강제. → 화면 스캔 경로 = 실행 경로 보장.

**2-a. 프로젝트별 `.claude/agents` 스캔** (`src/lib/local-agent-sync.ts`)
- 현 전역 스캔(L101~103)은 **유지**(비파괴)
- **신규 분리 함수** `scanProjectAgents()`: MC `projects` 테이블에서 `github_repo` 있는 프로젝트 → 공유 resolveRepoPath로 경로 산출 → `<path>/.claude/agents/*.md` 스캔 → frontmatter(name/description/tools) 파싱 → `agents` 테이블 upsert
- **upsert key = `(source, name)` (Codex 조건부 #2, 핵심)**: source=`claude-project:{repo}` + name. `name` 단독 키면 여러 프로젝트의 동명 agent(예: 두 repo의 code-reviewer)가 충돌 → 반드시 (source, name) 복합 또는 project_id 병기. UNIQUE INDEX `(source, name)`.
- **ON CONFLICT DO UPDATE (Codex 조건부 #2)**: row replace 방식 금지(전체 row 날아감). `INSERT ... ON CONFLICT(source,name) DO UPDATE SET description=excluded.description, tools=excluded.tools, updated_at=...` — **display_name·status 등 사용자 데이터는 SET 절에서 제외**(보존).
- **삭제된 .md 비활성 정책 (Codex 조건부 #2)**: 디스크에서 사라진 agent는 DELETE 안 하고 `status='inactive'`(또는 last_seen 기준 stale 표시) — task 이력 보존 + 화면에서 흐리게.
- git pull 최신화는 연동 스크립트(5.1)가 담당 — sync는 디스크 현재값 읽기

**2-b. `display_name` 컬럼 마이그레이션** (별도 파일)
- `ALTER TABLE agents ADD COLUMN display_name TEXT` (SQLite, NULL 허용 → 기본 비파괴)
- **idempotency (Codex 조건부 #2)**: SQLite ALTER ADD COLUMN은 재실행 시 에러 → 마이그레이션이 `PRAGMA table_info(agents)`로 컬럼 존재 확인 후 조건부 실행(또는 try/catch). MC 마이그레이션 러너 관례 따름.
- 표시 우선순위: `display_name ?? name`

**2-c. PATCH `/api/agents/[id]`** (display_name 수정)
- super_admin(대표) 권한
- **sync 보존**: §2-a ON CONFLICT SET 절에서 display_name 제외로 보장(2-a와 일관)

**2-d. UI** (agents 화면) — Gemini UX 조건 전부 반영
- **역할/직무 기반 그룹핑·필터 (Gemini #B, 핵심)**: 1차 분류축 = 역할(개발/디자인/검토/문서/QA 등), 모델(Claude/Codex/Gemini)은 카드 하단 작은 배지. "AI 공급자"가 아니라 "어떤 직무"로 고르게. (데이터는 §2-a source/project로 저장하되 UI 표시축만 역할 — 양립)
  - 역할 매핑: `.claude/agents` frontmatter는 별도 role 필드가 없으므로 name 접미사(`-engineer`/`-reviewer`/`-designer`/`-migrator` 등) 또는 description 키워드로 분류. 미분류는 "기타".
- **카드 한 줄 설명 (Gemini #D)**: `.claude/agents` frontmatter `description`을 카드에 노출(이미 존재 — 저비용). task 생성 시 키워드 매칭 추천 태그는 carry.
- **한글 display_name 중심 (Gemini #A·#3)**: display_name(한글) 압도적 강조, name(영어 실행 키)은 옅은 회색/툴팁으로 최소 노출(시각 노이즈 축소)
- display_name 인라인 편집(PATCH 호출)

### 5.4 컴포넌트 — rate limit / 비용 제어 (Codex FAIL #6 해소, C4 필수)

단일 `--agent` 호출이 cache_creation 128K(API 환산 ~$0.80) 발생. cron 반복·재시도·중복·병렬에서 구독 rate limit에 걸릴 현실적 위험 → carry 아닌 C4 안에 포함.

- **per-run concurrency limit**: 동시 실행 claude 프로세스 1개(또는 N) 제한. lock 파일(`~/.c3-relay.lock`) — 실행 중이면 다음 cron은 skip.
- **per-hour/day 실행 상한**: claude-agent 실행 카운터(`~/.c3-relay-quota.json`, 일자별) — 상한 초과 시 task를 `deferred`(status) + 다음 주기로 미룸 + Telegram 1회 통지.
- **동일 실패 backoff**: §5.1 backoff와 연계 — 같은 task 연속 실패 시 재시도 간격 증가.
- **task당 최대 재시도**: N회(기본 2) 초과 시 `failed` 확정(무한 재과금 차단).
- **rate limit 감지**: claude JSON `api_error_status` 또는 exit 패턴이 rate limit이면 `blocked/deferred` 처리(failed 아님 — 일시적).
- **비용 측정 로그**: claude JSON `total_cost_usd`·`usage`를 로그/카운터에 기록(추세 가시화). 구독 한도라 청구는 아니나 사용량 추적.

### 5.3 컴포넌트 ⑤ — 3층위 정합 E2E

검증 시나리오:
1. 대시보드 agents 화면에 BC `.claude/agents` 12개가 **Claude 그룹**으로 표시됨([3]→[1] 정합)
2. 대시보드에서 task 생성, assignee=`frontend-engineer`, project=best-consulting-hp([1]→[2] 정합)
3. 연동 스크립트 cron 발동 → BC repo cwd에서 `claude --agent frontend-engineer` 실제 실행([2]→실행 정합)
4. 실행 결과가 MC `tasks.status`=done + 로그에 frontend-engineer 정체성 확인
5. **화면에서 본 작업자 = 지시한 작업자 = 실제 실행 작업자가 동일** → 3층위 정합 입증

## 6. 데이터 흐름

```
[대시보드 UI]  agents 화면 (Claude/Codex/Gemini 그룹, display_name 표시)
     │  ← scanProjectAgents (projects.github_repo → .claude/agents 스캔, source=claude-project:*)
     │
[대표]  task 생성: assignee=frontend-engineer, project=BC
     │
[MC SQLite]  tasks row (status=todo)
     │  ← c3_mc_to_hermes.js 폴링 (mc-relay cron, every 1m)
     │
[연동 스크립트]  assignee 분기:
     │    claude-agent → git pull → claude --agent <name> -p (timeout, acceptEdits, json)
     │    codex/gemini → 기존 경로 (+ 가시성 통일)
     │    default → Hermes
     │
[실행]  claude CLI (해당 서브에이전트로 BC repo cwd 실행)
     │
[역방향]  exit/JSON 파싱 → MC tasks.status UPDATE(done/failed) + 실패 시 Telegram + 로그
     │
[대시보드 UI]  task 상태 갱신 표시
```

## 7. 에러 처리

| 상황 | 처리 |
|---|---|
| claude 실행 hang | timeout 300s → kill → status=failed + Telegram |
| git pull 실패 | 경고 로그 후 기존 디스크 상태로 진행(중단 안 함). KNOWN_LOCAL(BC OneDrive 원본)은 애초에 pull skip |
| repo 없음(github_repo 빈 값) | 중립 cwd(`~/.c3-workspace`)에서 실행 or skip(정책: skip + 로그) |
| assignee 이름이 .claude/agents에 없음 | default(Hermes)로 fallback (기존 동작) |
| claude OAuth 만료 | 실행 실패 → status=failed + Telegram(재로그인 안내) |
| sync가 display_name 덮어쓸 위험 | upsert에서 display_name 컬럼 제외(2-c) |
| 동시 실행(중복 pickup) | 기존 단일 인스턴스 + last-id 커서 유지 |

## 8. 테스트

- **단위/실측**: scanProjectAgents가 BC 12개 정확 파싱 / PATCH display_name 후 sync 재실행 시 보존(ON CONFLICT SET 제외) 확인 / 연동 스크립트 assignee 분기 dry-run / upsert (source,name) 복합키 동명 agent 충돌 없음 / ALTER ADD COLUMN 재실행 idempotent
- **E2E**: §5.3 5단계 전부 PASS
- **회귀**: 기존 codex/gemini/Hermes 분기 정상 동작 유지(C3 E2E 회귀 0)
- **가시성**: 의도적 실패(잘못된 agent명/timeout) 주입 → status=failed + Telegram 수신 확인
- **정합 실패 차단 (Codex #3)**: 오타 assignee(`frontend-enginer`) + project 지정 → default fallback 안 되고 `failed`(agent_not_found) 확인
- **원자적 claim (Codex #4)**: cron 중첩 시뮬레이션(동시 2 폴링) → 동일 task 1회만 running claim
- **rate limit 제어 (Codex #6)**: 일 상한 초과 → deferred + Telegram 1회 / 동시 실행 lock skip / 재시도 N회 초과 failed

## 9. 범위 밖 (carry)

- ④ B 부트스트랩 자동 연동(신규 프로젝트 첫 진입 시 .claude/agents 자동 등록)
- task 생성 시 키워드 매칭 추천 에이전트 태그(Gemini #D 보조 — UI 기본 노출은 §5.2-d 반영, 추천 자동화만 carry)
- 실재부팅 후 자동기동 검증(R6 메커니즘 동일, 미실측)
- claude `--agent` 변경분 자동 commit/PR/rollback 정책(현재 git diff 로그만, 수동 검토)
- mission-control 역방향 양방향 보드 동기화 심화(현재 task.status 단방향 UPDATE까지)
- mission-control systemd 재시작 빈도 진단(C3 운영 carry)

## 10. L2 검증 반영 (C4 spec 검증 — 2026-06-07)

위키 reviews: `c4-spec-tech-review-codex-20260607.md` (Codex 조건부승인: 치명1+조건부5) / `c4-spec-ux-review-gemini-20260607.md` (Gemini 조건부승인: 조건3). 충돌 없음(Codex=기술 / Gemini=UX, 영역 분리) — 전부 반영.

**Codex (기술)**:
- #1 CLI 버전 의존 → §3 `claude --version` 체크 **반영**
- #2 fork upsert key/보존/idempotency/삭제정책 → §5.2-a·2-b **반영** ((source,name)+ON CONFLICT+조건부 ALTER+inactive)
- #3 assignee 미존재 fallback 금지 + 이름충돌 가드 + project 선확정 → §5.1 분기 진입 가드 **반영**
- #4 원자적 claim + 판정 우선순위 + tree kill + backoff + git diff → §5.1 **반영**
- #5 공유 resolveRepoPath 단일 설정 → §5.2 `~/.c3-repo-map.json` **반영**
- #6 (FAIL) rate limit/비용 제어 → §5.4 신규 섹션 C4 필수로 **반영**(carry 탈출)

**Gemini (UX)**:
- #A·#3 한글 display_name 중심, 영어 ID 최소 → §5.2-d **반영**
- #B 역할/직무 기반 그룹핑·필터 → §5.2-d 1차 분류축 역할 **반영**
- #C 실패 Telegram+상태반영 → §5.1 가시성 (PASS, 유지)
- #D 카드 한 줄 설명 → §5.2-d description 노출 **반영** (추천 태그는 carry)

**선행 cycle 검증 (위키 §C3+C4)**:
- (Claude 最우선) claude CLI headless 서브에이전트 실행 → §3 실측 PASS로 **리스크 해소**
- (Claude) fork 수정 커밋 분리 → §5.2 논리 단위 분리 **반영**

## 11. 관련 문서

- 위키 `dev-tasks/c3-dashboard-20260607.md §C4 후속 설계` (대표 결재 원본)
- 위키 `handoffs/SESSION-HANDOFF-c1-r6-c2-20260607.md` (C cycle 진입점)
- repo `docs/superpowers/specs/2026-06-07-c3-multiagent-dashboard-design.md` (C3 베이스)
- 메모리: `reference_wsl_daemon_autostart` / `feedback_l2_subagent_call_standard` / `feedback_no_modal_for_directed_work` / `project_multiagent_c_cycle`
