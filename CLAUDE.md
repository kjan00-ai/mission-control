# Mission Control

Open-source dashboard for AI agent orchestration. Manage agent fleets, track tasks, monitor costs, and orchestrate workflows.

**Stack**: Next.js 16, React 19, TypeScript 5, SQLite (better-sqlite3), Tailwind CSS 3, Zustand, pnpm

## Prerequisites

- Node.js >= 22 (LTS recommended; 24.x also supported)
- pnpm (`corepack enable` to auto-install)

## Setup

```bash
pnpm install
pnpm build
```

Secrets (AUTH_SECRET, API_KEY) auto-generate on first run if not set.
Visit `http://localhost:3000/setup` to create an admin account, or set `AUTH_USER`/`AUTH_PASS` in `.env` for headless/CI seeding.

## Run

```bash
pnpm dev              # development (localhost:3000)
pnpm start            # production
node .next/standalone/server.js   # standalone mode (after build)
```

## Docker

```bash
docker compose up                 # zero-config
bash install.sh --docker          # full guided setup
```

Production hardening: `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d`

## Tests

```bash
pnpm test             # unit tests (vitest)
pnpm test:e2e         # end-to-end (playwright)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm test:all         # lint + typecheck + test + build + e2e
```

## Key Directories

```
src/app/          Next.js pages + API routes (App Router)
src/components/   UI panels and shared components
src/lib/          Core logic, database, utilities
.data/            SQLite database + runtime state (gitignored)
scripts/          Install, deploy, diagnostics scripts
docs/             Documentation and guides
```

Path alias: `@/*` maps to `./src/*`

## Data Directory

Set `MISSION_CONTROL_DATA_DIR` env var to change the data location (defaults to `.data/`).
Database path: defaults to `<MISSION_CONTROL_DATA_DIR>/mission-control.db`.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)
- **No AI attribution**: Never add `Co-Authored-By` or similar trailers to commits
- **Package manager**: pnpm only (no npm/yarn)
- **Icons**: No icon libraries -- use raw text/emoji in components
- **Standalone output**: `next.config.js` sets `output: 'standalone'`

## Agent Control Interfaces

Mission Control provides three interfaces for autonomous agents:

### MCP Server (recommended for agents)
```bash
# Add to any Claude Code agent:
claude mcp add mission-control -- node /path/to/mission-control/scripts/mc-mcp-server.cjs

# Environment config:
MC_URL=http://127.0.0.1:3000 MC_API_KEY=<key>
```
35 tools: agents, tasks, sessions, memory, soul, comments, tokens, skills, cron, status.
See `docs/cli-agent-control.md` for full tool list.

### CLI
```bash
pnpm mc agents list --json
pnpm mc tasks queue --agent Aegis --max-capacity 2 --json
pnpm mc events watch --types agent,task
```

### REST API
OpenAPI spec: `openapi.json`. Interactive docs at `/docs` when running.

## Common Pitfalls

- **Standalone mode**: Use `node .next/standalone/server.js`, not `pnpm start` (which requires full `node_modules`)
- **better-sqlite3**: Native addon -- needs rebuild when switching Node versions (`pnpm rebuild better-sqlite3`)
- **AUTH_PASS with `#`**: Quote it (`AUTH_PASS="my#pass"`) or use `AUTH_PASS_B64` (base64-encoded)
- **Gateway optional**: Set `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` for standalone deployments without gateway connectivity

---

## 🤖 멀티AI 시스템 운영 (이 repo = 멀티AI 시스템 SSOT, 2026-06-09 BC에서 이관)

> ⚠️ **BC(BEST-consulting)와 별개 프로젝트.** 이 mission-control fork = '멀티AI 시스템 + agent웹'의 코드+문서 SSOT. BC repo(`Projects/Ai-Insight/best-consulting-hp`)와 코드·문서·메모리·git 절대 혼입 금지. BC 작업 시 이 컨텍스트 로드 안 함(역도 동일). 경계 결정문: 위키 `projects/mission-control/decisions/2026-06-09-multiagent-bc-boundary-separation.md`.
>
> ※ 전역 멀티AI 부트스트랩(Obsidian 위키 연동·신규 프로젝트 자동 적용)은 글로벌 `~/.claude/CLAUDE.md`에 있어 **이 프로젝트에도 자동 적용**된다 — 본 섹션은 그 위에 얹는 MC 고유 운영 세부.

### SSOT
- **코드+문서**: 이 repo (`~/mission-control`, GitHub kjan00-ai/mission-control, builderz-labs fork). spec/plan/report = `docs/multiagent/`.
- **지식·진행보고·핸드오프**: 위키 `BestConsulting_OS/wiki/projects/mission-control/` (handoffs/decisions/dev-tasks/errors/reviews/references).

### 세션 시작 시 mandate
1. **위키 최신 핸드오프 우선 참조**: 위키 `_index.md`가 가리키는 **최신 `[[핸드오프]]`를 추적**해 정독 → 차기 진입점 확인. 인덱스가 불명확하면 `wiki/projects/mission-control/handoffs/`에서 **파일명 날짜가 가장 최신인** `SESSION-HANDOFF-*.md`를 읽는다.
   - ⚠️ 고정 파일명 금지: 작업이 진행될수록 어긋난다(전역 "Obsidian Wiki 연동" + SF 규약과 일치). **항상 `_index.md` → 최신 핸드오프 경로로 추적**할 것.
2. **위키 `_index` 참조** + handoffs `to=claude & status=todo` 스캔.
3. **핵심 메모리 참조**: 위키 `references/` (reference_wsl_daemon_autostart / reference_mc_relay_idempotency / reference_hermes_skill_execute_code_gate / reference_wsl_shutdown_keepalive_restore / project_multiagent_c_cycle).

### 인프라 좌표 (고정)
- **대시보드**: `https://agents.bestconsulting.vip` (이 repo + Hermes 실행엔진 / 한국어 + Cloudflare Access / WSL 로컬 + SQLite). ⚠️ 도메인만 BC와 공유, 코드·DB 독립.
- **Telegram 봇**: `@myroyalaibot` (화이트리스트 User ID 6206674018 / OpenRouter `anthropic/claude-sonnet-4.5`).
- **실행 환경**: WSL2 Ubuntu, 사용자 `bestconsulting`. Hermes config: `~/.hermes/{config.yaml,.env,SOUL.md,skills/}`.
- **상시구동**: systemd user(linger) `hermes-gateway`/`mission-control`/`cloudflared-c3` + Windows 작업스케줄러 ONLOGON keep-alive(`sleep infinity`).
- **mc-relay**: hermes cron(every 1m, `~/.hermes/cron/`)으로 MC task 자동 처리. 연동 스크립트 `~/mission-control/c3_mc_to_hermes.js`(백업 `.c4-tXX-final`). gateway active여야 발동.

### WSL git 작업 함정 (mandate)
- `cd ~/mission-control`이 Git bash 경유 시 무력화됨(BC cwd 고정). **반드시 `powershell -NoProfile -Command "wsl.exe -d Ubuntu -u bestconsulting --cd /home/bestconsulting/mission-control -- git ..."`** (`--cd` 명시). push EXIT=0 믿지 말고 `git ls-remote`로 remote HEAD 직접 검증.
- ✅ credential 설정됨(2026-07-02 검증): WSL에서 `git -C /home/bestconsulting/mission-control push` 직접 push 성공(`e846ab2`)·`ls-remote` 검증. 과거 "credential 미설정 push 보류" carry는 **해소**. (ai-bootstrap도 동일, `66afd2d`.) ※ 세션이 이미 WSL 내부면 line 위 `powershell ... wsl.exe --cd` 래퍼 불필요 — `git -C <경로>`로 직접.

### 진행 상태 (C cycle)
- C1 Hermes+Telegram ✅ / R6 상시구동 ✅(keep-alive 영속성 carry) / C2 위키보고 ✅ / C3 대시보드 ✅ / C4 3층위 정합 ✅(T1~T14).
- 차기 carry: ④B 부트스트랩 연동(.claude/agents 자동 등록) / WSL keep-alive 영속성 검증 / gateway 자동재기동 진단(SIGTERM 후 미부활 이력).
