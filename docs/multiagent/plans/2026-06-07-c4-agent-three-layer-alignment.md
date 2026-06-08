# C4 에이전트 3층위 정합 — 구현 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 멀티AI 대시보드에서 화면 표시 = task 지시 = 실제 실행 작업자를 동일하게 만든다 (단일 진실 = 프로젝트별 `.claude/agents`).

**Architecture:** (1) WSL 연동 스크립트(`c3_mc_to_hermes.js`)가 assignee를 `.claude/agents`의 서브에이전트명으로 받아 `claude --agent <name>` headless 실행 + 원자적 claim + 가시성 + rate limit. (2) mission-control fork가 프로젝트별 `.claude/agents`를 스캔해 agents 테이블에 표시(역할 그룹핑 + 한글 display_name). 연동 스크립트와 fork는 공유 설정(`~/.c3-repo-map.json`)으로 경로 규칙 통일.

**Tech Stack:** WSL2 Ubuntu / Node.js 22 / claude CLI 2.1.168(`--agent` headless) / mission-control(Next.js 15 + better-sqlite3) / SQLite

**버전:** v2 (plan L2 검증 반영 — Codex 치명2+조건부5 / Gemini UX 조건3. T1 선실측으로 추측 제거).

**실행 환경 주의:**
- 모든 WSL 명령은 `wsl -d Ubuntu -u bestconsulting -- bash -lc '...'` 로 실행. **bash -lc 안에서 `$VAR` 확장 금지**(Git bash 경유 시 깨짐) → 절대경로 직접 사용.
- mission-control 위치: `~/mission-control/` (WSL, git 밖). 연동 스크립트: `~/mission-control/c3_mc_to_hermes.js`.
- BC repo (KNOWN_LOCAL): `/mnt/c/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp`
- claude CLI: `~/bin/claude` (인증 완료, `~/.claude/.credentials.json`)

**★ T1 선실측 사실 (2026-06-07, plan v2 근거 — 추측 제거):**
- **MC DB**: `~/mission-control/.data/mission-control.db` (better-sqlite3). **sqlite3 CLI 미설치** → 모든 DB 조회는 `node -e` + `require('better-sqlite3')`로(cwd=`~/mission-control`).
- **연동 스크립트 DB 접근**: 이미 `const Database = require("better-sqlite3")` 사용(L5). ⚠️ **`new Database(DB, { readonly: true })`(L55) — readonly!** → claim/finishTask의 UPDATE를 위해 **쓰기 connection 별도 생성** 필요(읽기용 유지 + 쓰기용 `new Database(DB)` 추가, 또는 readonly 제거). `fs`/`execFileSync`도 **이미 선언됨(L6~7)** → plan 코드에서 재선언(`const fs=...`) 금지(중복 syntax error).
- **tasks.status**: **CHECK constraint 없음**(TEXT NOT NULL DEFAULT 'inbox'). MC 사용값 = `inbox/assigned/in_progress/review/quality_review/done`(+현 데이터 `ready`). ⚠️ **임의 status(`running`/`failed`/`deferred`) 신설 금지** — MC kanban/필터가 `'assigned'/'inbox'/'in_progress'/'review'/'done'` 등 특정값으로 분기(src/lib/adapter.ts·task-dispatch.ts)하므로 모르는 status는 화면에서 누락됨. → C4는 MC 기존값 재사용: 실행중=`in_progress` / 성공=`done` / 실패=`in_progress` 유지 + `error_message` 채움(또는 MC 실패 표현 확인) / 보류=원래 상태 유지 + metadata.
- **tasks 유용 컬럼(이미 존재)**: `retry_count`(INTEGER DEFAULT 0), `error_message`, `outcome`, `resolution`, `completed_at`, `dispatch_attempts`, `assigned_to`, `project_id`, `github_repo`, `metadata`(JSON). → finishTask가 결과/사유를 여기 기록(별도 컬럼 추가 불필요).
- **claim 대상 status**: 현 task는 `ready`/`assigned`/`inbox` 등 → claim WHERE는 **MC가 "미처리"로 보는 값 집합**(`inbox`,`assigned`,`ready`) 기준. `'todo'` 아님(MC에 todo 없음).
- **agents 테이블**: `name TEXT NOT NULL UNIQUE` (**name 단독 UNIQUE!**). `source`(default 'manual'), `hidden`, `content_hash`, `workspace_path`, `config` 존재. **display_name 없음**(T8 추가). 현 데이터 = dogfood/yuanbao 2개(source='local', = 화면 데모). 중복 0. ⚠️ name 단독 UNIQUE라 여러 프로젝트 동명 agent 충돌 → **T8에서 name UNIQUE → (source,name) 복합 UNIQUE로 마이그레이션**(Codex #4) 후 ON CONFLICT 사용.

**커밋 정책:** mission-control fork 수정은 **WSL `~/mission-control/`에서 git commit**(별도 repo, ko.json처럼 논리 단위 커밋 분리). BC repo(`docs/superpowers/`)에는 plan/spec/E2E 보고서만 커밋. 연동 스크립트(`c3_mc_to_hermes.js`)는 git 밖이므로 **본 plan + 핸드오프가 백업**.

**운영 안전 (Codex #7):** fork 빌드는 `pnpm build` 성공 확인 **후에만** `systemctl --user restart mission-control`. 빌드 실패 시 restart 금지(운영 `agents.bestconsulting.vip` 무중단). migration 적용 전 DB 파일 백업(`cp .data/mission-control.db .data/mission-control.db.bak-c4`).

**★ 공용 검증 헬퍼 (모든 Task에서 사용 — Codex #6 / Gemini #1):**
- **DB 조회/실행**: sqlite3 CLI 미설치 → 항상 `node -e` + `require('better-sqlite3')`(cwd=`~/mission-control`, readonly는 SELECT만). 본 plan의 SQL 예시는 better-sqlite3 `.prepare().get()/.all()/.run()` 기준.
- **로컬 API 인증 (대표 쿠키 추출 불필요)**: MC sync/PATCH는 admin 권한 필요. 대표가 이미 /setup으로 로그인 → `user_sessions`에 유효 토큰 존재. **검증 스크립트가 DB에서 admin 세션 토큰을 조회해 curl Cookie에 사용**(대표 수동 추출 0). 토큰 추출 node:
  ```bash
  TOKEN=$(node -e "const D=require(process.env.HOME+'/mission-control/node_modules/better-sqlite3');const db=new D(process.env.HOME+'/mission-control/.data/mission-control.db',{readonly:true});const r=db.prepare('SELECT s.token FROM user_sessions s JOIN users u ON s.user_id=u.id WHERE s.expires_at>unixepoch() ORDER BY s.expires_at DESC LIMIT 1').get();process.stdout.write(r?r.token:'');")
  ```
  ⚠️ user_sessions는 token을 평문/해시 중 무엇으로 저장하는지 T1에서 확인(auth.ts L174 INSERT + L187 validateSession 비교 방식). **해시 저장이면** 평문 토큰을 DB에서 못 얻음 → 대안: (a) MC_PROXY_AUTH_HEADER 설정해 신뢰 헤더로 호출, 또는 (b) E2E 검증 시 대표가 대시보드 로그인 상태에서 브라우저로 sync 버튼 클릭(있으면). T1에서 토큰 저장 방식 확인 후 (DB조회/프록시헤더/UI버튼) 택1.
- 쿠키 이름: `parseMcSessionCookieHeader`가 읽는 쿠키명 확인(`src/lib/session-cookie.ts`) 후 `-H "Cookie: <name>=$TOKEN"`.

---

## File Structure

| 파일 | 위치 | 책임 | Task |
|---|---|---|---|
| `~/.c3-repo-map.json` | WSL | 공유 경로 규칙(KNOWN_LOCAL + REPOBASE) — 연동 스크립트·fork 공유 SSOT | T2 |
| `c3_mc_to_hermes.js` | WSL `~/mission-control/` | assignee 분기 + claude-agent 실행 + claim + 가시성 + rate limit | T3~T7 |
| `~/.c3-relay-quota.json` | WSL | 일자별 실행 카운터(rate limit) | T7 |
| `local-agent-sync.ts` | fork `src/lib/` | scanProjectAgents() 추가 (프로젝트별 .claude/agents → agents 테이블) | T9 |
| `<migration>` | fork `migrations/` | agents.display_name 컬럼 (idempotent) | T8 |
| `api/agents/sync/route.ts` | fork `src/app/api/agents/sync/` | `?source=projects` 분기 | T10 |
| `api/agents/[id]/route.ts` | fork `src/app/api/agents/[id]/` | PATCH display_name | T11 |
| agents UI | fork `src/app/.../agents` | 역할 그룹핑 + 한글 중심 + 설명 | T12 |

---

## Task 1: 환경 실측 확정 (대부분 완료 — plan v2 헤더 "T1 선실측 사실" 참조) + 백업

**Files:** 없음 (조사 — DDL/접근방식은 plan 작성 시 실측 완료, 본 Task는 재확인 + DB/스크립트 백업)

> 헤더 "★ T1 선실측 사실" 블록이 정본. 본 Task는 실행 직전 재확인 + 백업 + MC UI status 사용처만 추가 확인.

- [ ] **Step 1: claude CLI + DB 접근 재확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc '~/bin/claude --version; ls -la ~/.claude/.credentials.json; ls -la ~/mission-control/.data/mission-control.db; grep -n "readonly\|require(\"better-sqlite3\")\|new Database" ~/mission-control/c3_mc_to_hermes.js'
```
Expected: claude 2.1.168 / creds 존재 / DB 파일 존재 / 연동 스크립트 L5 require + L55 readonly:true 확인

- [ ] **Step 2: MC UI/API의 tasks.status 사용처 확인 (Codex #5 — 임의 status 금지 근거)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc "cd ~/mission-control && grep -rn \"status IN\\|status =\\|status===\\|=== 'in_progress'\\|'done'\\|'review'\" src/lib/adapter.ts src/lib/task-dispatch.ts src/app/api/tasks 2>/dev/null | head -20"
```
Expected: MC가 in_progress/done/review/assigned/inbox 등으로 분기 확인 → C4는 이 값들만 재사용(임의 status 금지). **kanban 컬럼이 어떤 status를 보여주는지 확인해 done/in_progress 매핑 확정.**

- [ ] **Step 3: agents (source,name) 중복 재확인 (UNIQUE 마이그레이션 안전성)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});const r=db.prepare(\"SELECT source,name,COUNT(*) c FROM agents GROUP BY source,name HAVING c>1\").all();console.log(\"dup (source,name):\",r.length);"'
```
Expected: `dup (source,name): 0` (복합 UNIQUE 마이그레이션 안전 — 중복 0이면 바로 생성 가능)

- [ ] **Step 4: DB + 연동 스크립트 백업 (롤백 안전망)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cp ~/mission-control/.data/mission-control.db ~/mission-control/.data/mission-control.db.bak-c4 && cp ~/mission-control/c3_mc_to_hermes.js ~/mission-control/c3_mc_to_hermes.js.bak-c4 && ls -la ~/mission-control/.data/*.bak-c4 ~/mission-control/*.bak-c4'
```
Expected: DB 백업 + 스크립트 백업 생성

---

## Task 2: 공유 경로 설정 파일 `~/.c3-repo-map.json` (spec §5.2 resolveRepoPath SSOT)

**Files:**
- Create: `~/.c3-repo-map.json` (WSL)

- [ ] **Step 1: 설정 파일 작성**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cat > ~/.c3-repo-map.json << "JSON"
{
  "repoBase": "/home/bestconsulting/c3-repos",
  "knownLocal": {
    "kjan00-ai/Best-Consulting": "/mnt/c/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp"
  },
  "pullSkip": ["kjan00-ai/Best-Consulting"]
}
JSON
cat ~/.c3-repo-map.json'
```
Expected: JSON 출력. (knownLocal = OneDrive 원본 우선 + pullSkip = OneDrive 동기화 충돌 방지)

- [ ] **Step 2: 파싱 검증**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node -e "const m=require(\"/home/bestconsulting/.c3-repo-map.json\"); console.log(\"repoBase:\",m.repoBase,\"known:\",Object.keys(m.knownLocal).length,\"pullSkip:\",m.pullSkip.length)"'
```
Expected: `repoBase: /home/bestconsulting/c3-repos known: 1 pullSkip: 1`

---

## Task 3: 연동 스크립트 — 공유 경로 모듈 + assignee 분기 골격 (spec §5.1)

**Files:**
- Modify: `~/mission-control/c3_mc_to_hermes.js`

> 현 스크립트는 assignee를 `codex`/`gemini`/`default(Hermes)`로 분기(v4). C4는 claude-agent 분기를 추가한다. 기존 코드를 깨지 않도록 **resolveRepoPath를 공유 설정 기반으로 교체**하고 claude 분기 골격을 넣는다.

- [ ] **Step 1: resolveRepoPath를 공유 설정 기반으로 교체**

`~/mission-control/c3_mc_to_hermes.js` 상단의 기존 `KNOWN_LOCAL`/`REPOBASE` 상수 + `resolveRepoPath` 함수를 아래로 교체:

```javascript
const REPO_MAP = require("/home/bestconsulting/.c3-repo-map.json");
const REPOBASE = REPO_MAP.repoBase;
const KNOWN_LOCAL = REPO_MAP.knownLocal || {};
const PULL_SKIP = new Set(REPO_MAP.pullSkip || []);

// github_repo(owner/repo) → 로컬 작업 경로 (없으면 자동 clone). spec §5.2 공유 규칙.
function resolveRepoPath(ghRepo) {
  if (!ghRepo) return null;                       // project 미지정 → null (claude 분기 금지 신호)
  if (KNOWN_LOCAL[ghRepo]) return KNOWN_LOCAL[ghRepo];
  const dir = REPOBASE + "/" + ghRepo.replace("/", "__");
  return dir;  // clone/pull은 ensureRepo()가 담당
}
```

- [ ] **Step 2: 문법 검증**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node --check ~/mission-control/c3_mc_to_hermes.js && echo "SYNTAX OK"'
```
Expected: `SYNTAX OK`

- [ ] **Step 3: 커밋(WSL git 밖이라 백업 갱신)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cp ~/mission-control/c3_mc_to_hermes.js ~/mission-control/c3_mc_to_hermes.js.c4-t3'
```
Expected: 스냅샷 저장

---

## Task 4: 연동 스크립트 — claude-agent 분기 진입 가드 (spec §5.1 Codex #3)

**Files:**
- Modify: `~/mission-control/c3_mc_to_hermes.js`

- [ ] **Step 1: 헬퍼 함수 추가 (가드 + agent 목록)**

스크립트에 헬퍼 추가:

```javascript
const fs = require("fs");
const RESERVED = new Set(["codex", "gemini", "default"]);

// 프로젝트 cwd의 .claude/agents/*.md 파일명(확장자 제거) 목록
function listClaudeAgents(cwd) {
  if (!cwd) return [];
  const dir = cwd + "/.claude/agents";
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") && f !== "CLAUDE.md" && f !== "AGENTS.md")
      .map(f => f.replace(/\.md$/, ""));
  } catch { return []; }
}

// claude-agent 분기 진입 가드 (spec §5.1).
// 반환: null = claude 분기 아님(예약어/project 미지정) → 기존 codex/gemini/default로
//       { cwd, exists } = claude 분기 대상. exists=false면 agent_not_found(failed, fallback 금지)
function claudeAgentCwd(assignee, ghRepo) {
  if (RESERVED.has(assignee)) return null;        // 예약어는 기존 분기 우선
  const cwd = resolveRepoPath(ghRepo);
  if (!cwd) return null;                           // project 미지정 → claude 분기 금지
  const agents = listClaudeAgents(cwd);
  return { cwd, exists: agents.includes(assignee) };
}
```

> ⚠️ Codex #2: T3 resolveRepoPath의 `ghRepo.replace("/", "__")`는 첫 `/`만 치환 → `ghRepo.replaceAll("/", "__")`로 수정(owner/repo는 `/` 1개라 현재 무해하나 안전).

- [ ] **Step 2: 문법 검증**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node --check ~/mission-control/c3_mc_to_hermes.js && echo "SYNTAX OK"'
```
Expected: `SYNTAX OK`

- [ ] **Step 3: 가드 단위 검증 (BC 경로로 frontend-engineer 존재 / 오타 미존재)**

Run (BC .claude/agents 디렉토리 직접 확인 — listClaudeAgents 로직과 동일):
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node -e "
const fs=require(\"fs\");
const BC=\"/mnt/c/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp\";
const list=fs.readdirSync(BC+\"/.claude/agents\").filter(f=>f.endsWith(\".md\")&&f!==\"CLAUDE.md\"&&f!==\"AGENTS.md\").map(f=>f.replace(/[.]md$/,\"\"));
console.log(\"count:\",list.length,\"has frontend-engineer:\",list.includes(\"frontend-engineer\"),\"has typo:\",list.includes(\"frontend-enginer\"));
"'
```
Expected: `count: 12 has frontend-engineer: true has typo: false`

---

## Task 5: 연동 스크립트 — 원자적 claim (spec §5.1 Codex #4)

**Files:**
- Modify: `~/mission-control/c3_mc_to_hermes.js`

> 기존 스크립트는 `new Database(DB, { readonly: true })`(L55)로 읽기 전용. claim/finishTask는 UPDATE가 필요 → **쓰기 connection 별도 생성**. status 값은 MC 기존값 재사용(임의 status 금지, T1 실측).

- [ ] **Step 1: 쓰기 connection 추가 (readonly 해제)**

기존 L55 `const db = new Database(DB, { readonly: true });` **아래에** 쓰기용 추가(읽기용은 SELECT에 유지):
```javascript
const dbw = new Database(DB);   // 쓰기용 (claim/finishTask UPDATE). 읽기용 db는 유지.
```
> better-sqlite3는 동일 파일 다중 connection 허용(WAL/기본 journal 모두). 읽기 SELECT는 기존 `db`, 쓰기는 `dbw`.

- [ ] **Step 2: claimTask 함수 추가 (MC 미처리 status → in_progress)**

```javascript
// 원자적 claim: 미처리(inbox/assigned/ready) → in_progress. changes=1일 때만 이 인스턴스 소유 (spec §5.1)
// status는 MC 기존값만 사용(T1 실측: tasks.status CHECK 없음이나 kanban이 특정값 분기 → 임의값 금지)
const CLAIMABLE = "('inbox','assigned','ready')";
function claimTask(taskId) {
  const r = dbw.prepare(
    `UPDATE tasks SET status='in_progress', updated_at=unixepoch() WHERE id=? AND status IN ${CLAIMABLE}`
  ).run(taskId);
  return r.changes === 1;
}
```
> ⚠️ T1 Step2에서 MC kanban이 'in_progress'를 "진행 중"으로 보여주는지 확인 후 매핑 확정. updated_at은 INTEGER(unixepoch) — DDL이 `unixepoch()` 기본값이므로 `datetime('now')` 아닌 `unixepoch()` 사용.

- [ ] **Step 3: 메인 루프에서 claim 적용**

처리 루프에서 각 task 처리 직전 삽입(이미 다른 인스턴스/이전 실행이 잡았으면 skip):
```javascript
if (!claimTask(r.id)) continue;
```
> ⚠️ Codex #7 회귀: claim이 **모든** 분기(codex/gemini/default 포함)보다 앞에 오면 그 분기들도 in_progress가 됨. 기존 분기는 Hermes/codex로 위임 후 status를 안 바꾸므로, claim 적용은 **claude-agent 분기에만** 하거나, 모든 분기가 끝에 finishTask로 done/실패를 찍도록 통일. → **본 plan: claim은 claude-agent 분기에서만**(기존 codex/gemini/default는 현행 유지, 회귀 0). 메인 루프 구조: 먼저 `claudeAgentCwd` 판정 → claude 대상이면 claim+실행+finish, 아니면 기존 분기 그대로.

- [ ] **Step 4: 문법 검증**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node --check ~/mission-control/c3_mc_to_hermes.js && echo "SYNTAX OK"'
```
Expected: `SYNTAX OK`

---

## Task 6: 연동 스크립트 — claude 실행 + 가시성 (spec §5.1)

**Files:**
- Modify: `~/mission-control/c3_mc_to_hermes.js`

> ⚠️ T1 실측: 기존 스크립트에 `execFileSync`(L6)·`fs`(L7)·`REPOBASE`·`PULL_SKIP`(T3) **이미 선언됨** → 아래 코드는 **재선언(`const fs=`/`const {execFileSync}=`) 금지**, 함수만 추가. status는 MC 기존값(`done`/`in_progress`) 사용, 실패도 `in_progress` 유지 + `error_message`/`outcome` 기록(임의 status 금지). 결과는 `dbw`(쓰기 conn)로 기록.

- [ ] **Step 1: runClaudeAgent 함수 추가 (재선언 없이)**

```javascript
const CLAUDE = "/home/bestconsulting/bin/claude";
const RELAY_LOG = "/home/bestconsulting/.c3-relay-logs";
function tstamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }

// 반환 result.outcome: ok / agent_not_found / timeout / bad_output / rate_limit / auth_expired / error
function runClaudeAgent(task, cwd, assignee) {
  fs.mkdirSync(RELAY_LOG, { recursive: true });
  const logPath = `${RELAY_LOG}/${task.id}-${assignee}-${tstamp()}.log`;
  const ghRepo = task.github_repo;

  // git pull (KNOWN_LOCAL/pullSkip 제외, ~/c3-repos 사본만) — 실패해도 진행
  if (!PULL_SKIP.has(ghRepo) && cwd.startsWith(REPOBASE)) {
    try { execFileSync("git", ["-C", cwd, "pull", "--ff-only"], { timeout: 60000 }); }
    catch (e) { fs.appendFileSync(logPath, `[warn] git pull failed: ${e.message}\n`); }
  }

  // claude --agent headless (timeout 300s + tree kill via timeout --kill-after)
  let out = "", code = 0;
  try {
    out = execFileSync(
      "timeout", ["--kill-after=10", "300",
        CLAUDE, "--agent", assignee, "-p", task.title,
        "--permission-mode", "acceptEdits", "--output-format", "json"],
      { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (e) {
    code = e.status || 1;
    out = (e.stdout || "").toString();
    fs.appendFileSync(logPath, `[exit ${code}] ${e.message}\n`);
  }
  fs.appendFileSync(logPath, out || "");

  // 판정 우선순위 (spec §5.1 Codex #4): timeout > exit nonzero > malformed > is_error > ok
  let parsed = null;
  try { parsed = JSON.parse(out); } catch {}
  if (code === 124) return { ok: false, outcome: "timeout", logPath };
  if (code !== 0) {
    const rl = parsed?.api_error_status || /rate.?limit|overloaded/i.test(out);
    return { ok: false, outcome: rl ? "rate_limit" : (/credential|oauth|auth/i.test(out) ? "auth_expired" : "error"), logPath, cost: parsed?.total_cost_usd };
  }
  if (!parsed || parsed.is_error) return { ok: false, outcome: "bad_output", logPath };

  // 변경 가시화 (자동 commit 안 함 — Codex #4)
  try {
    const diff = execFileSync("git", ["-C", cwd, "diff", "--stat"], { encoding: "utf8" });
    if (diff.trim()) fs.appendFileSync(logPath, `\n[git diff --stat]\n${diff}`);
  } catch {}

  return { ok: true, outcome: "ok", logPath, cost: parsed.total_cost_usd, result: parsed.result };
}
```

- [ ] **Step 2: finishTask — MC 기존 status + DB 결과 기록 + Telegram(대시보드 링크)**

```javascript
const HERMES = "/home/bestconsulting/bin/hermes";
const TG_HOME = "6206674018";
const DASH = "https://agents.bestconsulting.vip";
// outcome → 대표 친화 문구 (Gemini #D, deferred 용어 #C)
const FRIENDLY = {
  timeout: "AI 응답 지연으로 일시 중단됨", rate_limit: "오늘 사용량 한도 도달 — 잠시 후 자동 재개",
  auth_expired: "Claude 로그인 만료 — 재로그인 필요", bad_output: "AI 응답 형식 오류",
  agent_not_found: "지정한 에이전트를 찾을 수 없음(이름 확인)", error: "실행 오류", quota: "오늘 실행 한도 도달 — 내일 재개 예정"
};

// MC 기존 status만 사용(T1: 임의 status 금지). 성공=done / 실패=in_progress 유지 + error_message
function finishTask(taskId, result, assignee) {
  if (result.ok) {
    dbw.prepare("UPDATE tasks SET status='done', outcome=?, completed_at=unixepoch(), updated_at=unixepoch() WHERE id=?")
      .run((result.result || "").slice(0, 2000), taskId);
  } else {
    dbw.prepare("UPDATE tasks SET status='in_progress', error_message=?, retry_count=retry_count+1, updated_at=unixepoch() WHERE id=?")
      .run(result.outcome, taskId);
    notify(taskId, assignee, result);
  }
}

function notify(taskId, assignee, result) {
  const human = FRIENDLY[result.outcome] || result.outcome;
  const msg = `[멀티AI] '${assignee}' 작업 #${taskId} 실패: ${human}\n확인: ${DASH}`;
  try { execFileSync(HERMES, ["send", "-t", "telegram", "--to", TG_HOME, "-m", msg], { timeout: 30000 }); }
  catch (e) { fs.appendFileSync(`${RELAY_LOG}/notify-fail.log`, `${tstamp()} ${e.message}\n`); }
}
```

> ⚠️ `hermes send` 플래그는 T6 Step5에서 `~/bin/hermes send --help`로 확인 후 맞춘다(메모리: `hermes send -t telegram -f PATH` 패턴 가능 — `-m` 미지원이면 임시 파일 작성 후 `-f`). DASH 링크는 MC가 task 상세 deep-link 지원 시 `${DASH}/tasks/${taskId}`로 정밀화(carry).

- [ ] **Step 3: 메인 루프 통합 (claude 분기 — claim은 여기서만)**

기존 처리 루프에서, **기존 codex/gemini/default 분기보다 먼저** claude 판정:
```javascript
const guard = claudeAgentCwd(assignee, r.github_repo);
if (guard) {                                       // claude-agent 대상
  if (!guard.exists) {                             // 오타 등 — fallback 금지 (spec §5.1)
    finishTask(r.id, { ok: false, outcome: "agent_not_found", logPath: "(none)" }, assignee);
    continue;
  }
  if (!quotaOk()) {                                // rate limit (T7) — 원래 상태 유지(claim 안 함)
    notify(r.id, assignee, { outcome: "quota", logPath: "(none)" });
    continue;                                       // 다음 cron에서 재시도(status 그대로)
  }
  if (!claimTask(r.id)) continue;                  // 원자적 claim (claude 분기에서만)
  const result = runClaudeAgent({ id: r.id, title: r.title, github_repo: r.github_repo }, guard.cwd, assignee);
  bumpQuota(result.cost);                          // T7
  finishTask(r.id, result, assignee);
  continue;
}
// (이하 기존 codex/gemini/default 분기 — 현행 유지, claim 미적용 → 회귀 0)
```
> deferred status 신설 대신: quota 초과 시 **task status를 안 바꿈**(claim 전) → 다음 cron 자동 재시도 + 대표에겐 "한도 도달 후 재개" Telegram(Gemini #C 용어 해소).

- [ ] **Step 4: 문법 검증**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node --check ~/mission-control/c3_mc_to_hermes.js && echo "SYNTAX OK"'
```
Expected: `SYNTAX OK`

- [ ] **Step 5: hermes send 플래그 확인 + 보정**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc '~/bin/hermes send --help 2>&1 | head -20'
```
Expected: send 옵션 확인. `-m`/`--message` 미지원이면 notify()를 `-f <임시파일>` 방식으로 보정.

---

## Task 7: 연동 스크립트 — rate limit / 비용 제어 (spec §5.4 Codex #6 FAIL 해소)

**Files:**
- Modify: `~/mission-control/c3_mc_to_hermes.js`
- Create(runtime): `~/.c3-relay.lock`, `~/.c3-relay-quota.json`

- [ ] **Step 1: concurrency lock + 일 상한 함수**

```javascript
const LOCK = "/home/bestconsulting/.c3-relay.lock";
const QUOTA = "/home/bestconsulting/.c3-relay-quota.json";
const DAILY_LIMIT = parseInt(process.env.C4_DAILY_LIMIT || "30", 10);   // env override (Codex #6, E2E 테스트용)
const MAX_RETRY = parseInt(process.env.C4_MAX_RETRY || "2", 10);

function acquireLock() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); return true; }
  catch { return false; }     // 이미 실행 중 → 동시 실행 1개 보장
}
function releaseLock() { try { fs.unlinkSync(LOCK); } catch {} }

function today() { return new Date().toISOString().slice(0, 10); }
function quotaOk() {
  let q = {};
  try { q = JSON.parse(fs.readFileSync(QUOTA, "utf8")); } catch {}
  return (q[today()] || 0) < DAILY_LIMIT;
}
function bumpQuota(cost) {
  let q = {};
  try { q = JSON.parse(fs.readFileSync(QUOTA, "utf8")); } catch {}
  const d = today();
  q[d] = (q[d] || 0) + 1;
  q[`${d}_cost`] = (q[`${d}_cost`] || 0) + (cost || 0);
  fs.writeFileSync(QUOTA, JSON.stringify(q));
}
// 재시도 한도 (retry_count 컬럼 활용 — T1 실측: 컬럼 존재)
function retryExceeded(retryCount) { return (retryCount || 0) >= MAX_RETRY; }
```

- [ ] **Step 2: 메인 진입 lock + claude 분기 quota/retry 통합**

- 스크립트 최상단 메인 실행부: `if (!acquireLock()) { process.exit(0); }` + `process.on("exit", releaseLock)` (동시 실행 1개)
- quota/retry는 **T6 Step3 메인 루프에 이미 통합**(quotaOk → notify+continue / claim → run → bumpQuota). deferred status 신설 안 함 — quota 초과 시 status 그대로 두고 다음 cron 재시도.
- **retry 한도**: SELECT에 `t.retry_count`를 포함하고, claude 분기 진입 시 `if (retryExceeded(r.retry_count)) { dbw.prepare("UPDATE tasks SET status='in_progress', error_message='max_retry_exceeded' WHERE id=?").run(r.id); continue; }` (finishTask가 실패마다 retry_count+1 하므로 MAX_RETRY 도달 시 중단 — 무한 재과금 차단).
- SELECT 쿼리(기존 L56)에 `t.retry_count` 컬럼 추가 필요(없으면 r.retry_count undefined).

- [ ] **Step 3: 문법 검증 + lock 동작 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'node --check ~/mission-control/c3_mc_to_hermes.js && echo "SYNTAX OK"; rm -f ~/.c3-relay.lock'
```
Expected: `SYNTAX OK`

- [ ] **Step 4: 스냅샷 백업**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cp ~/mission-control/c3_mc_to_hermes.js ~/mission-control/c3_mc_to_hermes.js.c4-final'
```

---

## Task 8: fork — agents.display_name 마이그레이션 (spec §5.2-b, Codex #2 idempotency)

**Files:**
- Create: `~/mission-control/migrations/<next>_agents_display_name.sql` (또는 MC 마이그레이션 관례 경로 — Task 1에서 확인)

- [ ] **Step 1: MC 마이그레이션 관례 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'ls ~/mission-control/migrations/ 2>/dev/null | tail -5; echo "---runner---"; grep -rln "migrat" ~/mission-control/src/lib/ 2>/dev/null | head'
```
Expected: 마이그레이션 파일 네이밍/러너 위치 확인

- [ ] **Step 2: 마이그레이션 작성 — display_name + (source,name) UNIQUE 전환 (Codex #4)**

> ⚠️ 핵심: agents는 `name TEXT NOT NULL UNIQUE`(T1 실측). 여러 프로젝트 동명 agent를 위해 **name 단독 UNIQUE → (source,name) 복합 UNIQUE**로 전환해야 ON CONFLICT(source,name)이 작동. SQLite는 컬럼 UNIQUE 제약을 ALTER로 못 떼므로 → 기존 자동 UNIQUE index를 찾아 처리하거나, name UNIQUE가 테이블 정의에 인라인이면 **테이블 재생성** 또는 **부분 우회**. T1 실측상 `name TEXT NOT NULL UNIQUE`가 인라인 → SQLite는 인라인 UNIQUE에 자동 index 생성. 안전책: 새 복합 UNIQUE index 추가 + 애플리케이션은 (source,name)로 동작. 단 인라인 name UNIQUE가 남아 동명 INSERT를 막으므로, **테이블 재생성으로 name UNIQUE 제거**가 정석.

MC 러너 방식(Step 1 확인)에 맞춰 작성. 본 plan은 **better-sqlite3 직접 실행 스크립트**로 idempotent 마이그레이션 제공(러너가 raw SQL이면 SQL로 변환):

`~/mission-control/migrations/<next>_agents_c4_display_name_unique.sql` (또는 러너 관례 경로). 테이블 재생성 패턴:
```sql
-- C4: agents에 display_name 추가 + name 단독 UNIQUE 제거 + (source,name) UNIQUE
-- SQLite 테이블 재생성 (4단계). 기존 데이터 보존.
PRAGMA foreign_keys=OFF;
BEGIN;
ALTER TABLE agents RENAME TO agents_old_c4;
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  session_key TEXT UNIQUE,
  soul_content TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen INTEGER,
  last_activity TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  config TEXT,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  source TEXT DEFAULT 'manual',
  content_hash TEXT,
  workspace_path TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  working_memory TEXT DEFAULT '',
  runtime_type TEXT DEFAULT NULL,
  display_name TEXT
);
INSERT INTO agents (id,name,role,session_key,soul_content,status,last_seen,last_activity,created_at,updated_at,config,workspace_id,source,content_hash,workspace_path,hidden,working_memory,runtime_type)
  SELECT id,name,role,session_key,soul_content,status,last_seen,last_activity,created_at,updated_at,config,workspace_id,source,content_hash,workspace_path,hidden,working_memory,runtime_type FROM agents_old_c4;
DROP TABLE agents_old_c4;
CREATE UNIQUE INDEX idx_agents_source_name ON agents(source, name);
COMMIT;
PRAGMA foreign_keys=ON;
```
> ⚠️ 위 CREATE TABLE 컬럼은 T1 실측 DDL과 **정확히 일치**해야 함(Task 1 Step1에서 재확인한 컬럼 순서/타입 그대로 + display_name 추가). session_key UNIQUE는 유지. **실행 직전 T1 DDL과 1:1 대조 mandate**(스키마 drift 방지).
> ⚠️ idempotency: 이미 display_name 있으면 skip. better-sqlite3 스크립트로 `PRAGMA table_info(agents)`에 display_name 있으면 전체 마이그레이션 skip.

- [ ] **Step 3: 적용 + 검증 (node, sqlite3 CLI 없음)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "
const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\");
const cols=db.prepare(\"PRAGMA table_info(agents)\").all().map(c=>c.name);
console.log(\"display_name:\",cols.includes(\"display_name\"));
const idx=db.prepare(\"SELECT name FROM sqlite_master WHERE type=\"+String.fromCharCode(39)+\"index\"+String.fromCharCode(39)+\" AND tbl_name=\"+String.fromCharCode(39)+\"agents\"+String.fromCharCode(39)).all().map(r=>r.name);
console.log(\"idx_source_name:\",idx.includes(\"idx_agents_source_name\"));
console.log(\"row count:\",db.prepare(\"SELECT COUNT(*) c FROM agents\").get().c);
"'
```
Expected: `display_name: true` / `idx_source_name: true` / `row count: 2`(dogfood/yuanbao 보존)

- [ ] **Step 4: 재실행 idempotency 확인**

Run: 마이그레이션 재실행(또는 러너) → display_name 이미 있으면 skip, 에러 0
Expected: 두 번째 실행 에러 0 + row count 여전히 2

- [ ] **Step 5: 커밋 (WSL mission-control git)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && git add migrations/ && git commit -m "feat(c4): agents display_name + (source,name) unique (table rebuild, idempotent)"'
```

---

## Task 9: fork — scanProjectAgents (spec §5.2-a, Codex #2)

**Files:**
- Modify: `~/mission-control/src/lib/local-agent-sync.ts`

> 기존 `scanLocalAgents()`(전역 `source='local'`) 패턴을 모델로, 프로젝트별 스캔을 `source='claude-project:{repo}'`로 추가. upsert key=(source,name), ON CONFLICT 보존, 삭제→offline.

- [ ] **Step 1: getProjectAgentRoots() 추가**

`local-agent-sync.ts`에 공유 설정 + projects 테이블 기반 경로 산출:
```typescript
import { readFileSync as rf } from 'node:fs'

function loadRepoMap(): { repoBase: string; knownLocal: Record<string,string> } {
  try { return JSON.parse(rf('/home/bestconsulting/.c3-repo-map.json', 'utf8')) }
  catch { return { repoBase: '/home/bestconsulting/c3-repos', knownLocal: {} } }
}

// projects.github_repo → .claude/agents 경로 + repo 라벨
function getProjectAgentDirs(db: any): { repo: string; dir: string }[] {
  const map = loadRepoMap()
  const rows = db.prepare("SELECT github_repo FROM projects WHERE github_repo IS NOT NULL AND github_repo != ''").all()
  return rows.map((r: any) => {
    const repo = r.github_repo
    const base = map.knownLocal[repo] || `${map.repoBase}/${repo.replace('/', '__')}`
    return { repo, dir: `${base}/.claude/agents` }
  })
}
```

- [ ] **Step 2: scanProjectAgents() 작성 (upsert (source,name) + ON CONFLICT 보존 + offline)**

`syncLocalAgents()`의 INSERT/UPDATE/markRemoved 패턴을 복제하되 source=`claude-project:{repo}`:
```typescript
export async function syncProjectAgents(): Promise<{ inserted: number; updated: number; offline: number }> {
  const db = getDb()
  let inserted = 0, updated = 0, offline = 0
  for (const { repo, dir } of getProjectAgentDirs(db)) {
    const source = `claude-project:${repo}`
    const disk = scanAgentsInDir(dir)          // .md 파싱 (scanLocalAgents의 .md 파싱부 재사용/추출)
    const dbRows = db.prepare(
      "SELECT id, name, content_hash FROM agents WHERE source = ?"
    ).all(source) as { id: number; name: string; content_hash: string }[]
    const diskNames = new Set(disk.map(a => a.name))

    const upsert = db.prepare(`
      INSERT INTO agents (name, role, soul_content, status, source, content_hash, workspace_path, config, created_at, updated_at)
      VALUES (?, 'agent', ?, 'online', ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source, name) DO UPDATE SET
        soul_content=excluded.soul_content, content_hash=excluded.content_hash,
        workspace_path=excluded.workspace_path, config=excluded.config,
        status='online', updated_at=datetime('now')
    `)  // display_name·기타 사용자 데이터는 SET에서 제외 (보존, Codex #2)
    const markOffline = db.prepare("UPDATE agents SET status='offline', updated_at=datetime('now') WHERE id=?")

    db.transaction(() => {
      for (const a of disk) {
        const before = db.prepare("SELECT id FROM agents WHERE source=? AND name=?").get(source, a.name)
        upsert.run(a.name, a.soulContent, source, a.contentHash, a.dir, a.configContent)
        before ? updated++ : inserted++
      }
      for (const row of dbRows) if (!diskNames.has(row.name)) { markOffline.run(row.id); offline++ }
    })()
  }
  return { inserted, updated, offline }
}
```

- [ ] **Step 3: UNIQUE INDEX (source,name) 선행 확인 (T8에서 생성됨 — Codex #1·#4 순서)**

> ⚠️ ON CONFLICT(source,name)은 `idx_agents_source_name` UNIQUE 인덱스가 **먼저 존재**해야 작동. 이 인덱스는 **T8 마이그레이션에서 생성**(name 단독 UNIQUE 제거 + 복합 UNIQUE 추가)되므로, T9는 T8 완료 후 실행. T9 코드 작성 전 확인:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name=?\").get(\"idx_agents_source_name\")?\"INDEX OK\":\"INDEX MISSING — run T8 first\");"'
```
Expected: `INDEX OK` (없으면 T8 먼저). T9는 T8에 **의존** — 실행 순서 T8 → T9 mandate.

- [ ] **Step 4: 빌드 (타입 체크)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && pnpm build 2>&1 | tail -15'
```
Expected: 빌드 성공 (타입 에러 0)

- [ ] **Step 5: 커밋**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && git add src/lib/local-agent-sync.ts migrations/ && git commit -m "feat(c4): syncProjectAgents — per-project .claude/agents scan (source,name upsert)"'
```

---

## Task 10: fork — sync route `?source=projects` 분기 (spec §5.2-a)

**Files:**
- Modify: `~/mission-control/src/app/api/agents/sync/route.ts`

- [ ] **Step 1: route에 projects 분기 추가**

기존 `if (source === 'local')` 옆에:
```typescript
import { syncProjectAgents } from '@/lib/local-agent-sync'
// ...
if (source === 'projects') {
  const result = await syncProjectAgents()
  return NextResponse.json(result)
}
```

- [ ] **Step 2: 빌드**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && pnpm build 2>&1 | tail -10'
```
Expected: 빌드 성공

- [ ] **Step 3: 런타임 실측 (BC 12개 스캔) — 빌드 성공 후에만 재시작 (Codex #7)**

> 인증은 헤더의 "공용 검증 헬퍼" 방식(DB 토큰 조회 또는 프록시 헤더/UI). 아래는 DB 토큰 조회 가능 시:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && pnpm build 2>&1 | tail -3 | grep -qi "error" && { echo "BUILD FAIL — restart 금지"; exit 1; } || systemctl --user restart mission-control; sleep 5; TOKEN=$(node -e "const D=require(process.env.HOME+\"/mission-control/node_modules/better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});const r=db.prepare(\"SELECT token FROM user_sessions WHERE expires_at>unixepoch() ORDER BY expires_at DESC LIMIT 1\").get();process.stdout.write(r?r.token:\"\");"); curl -s -X POST "http://localhost:3005/api/agents/sync?source=projects" -H "Cookie: mc_session=$TOKEN"'
```
Expected: `{"inserted":12,...}` (BC 12개). 토큰이 해시 저장이라 빈 응답 401이면 → 헤더 헬퍼의 (b)프록시헤더 또는 (c)UI 버튼으로 전환.

- [ ] **Step 4: DB 확인 (node)**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});db.prepare(\"SELECT name, source FROM agents WHERE source LIKE ? LIMIT 15\").all(\"claude-project:%\").forEach(r=>console.log(r.name,\"|\",r.source));"'
```
Expected: BC 12개 agent가 source=claude-project:kjan00-ai/Best-Consulting 으로 표시

- [ ] **Step 5: 커밋**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && git add src/app/api/agents/sync/route.ts && git commit -m "feat(c4): sync route ?source=projects branch"'
```

---

## Task 11: fork — PATCH /api/agents/[id] (display_name) (spec §5.2-c)

**Files:**
- Modify: `~/mission-control/src/app/api/agents/[id]/route.ts` (없으면 Create)

- [ ] **Step 1: 기존 [id] route 존재 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'ls ~/mission-control/src/app/api/agents/\[id\]/route.ts 2>/dev/null && echo EXISTS || echo MISSING'
```

- [ ] **Step 2: PATCH 핸들러 작성/추가**

```typescript
// import는 기존 route 관례 따름: NextRequest/NextResponse, requireRole, getDb (없으면 추가)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'admin')   // super_admin 권한 (MC 관례 확인 — Step1)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await params
  const body = await request.json()
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : null
  const db = getDb()
  db.prepare("UPDATE agents SET display_name=?, updated_at=unixepoch() WHERE id=?").run(displayName, id)  // unixepoch (T1: updated_at INTEGER)
  return NextResponse.json({ ok: true, id, display_name: displayName })
}
```
> ⚠️ Codex #2: `requireRole`/`NextRequest`/`NextResponse`/`getDb` **import 누락 확인** — Step1에서 기존 [id]/route.ts의 import 블록 보고 맞춤. 권한(admin vs super_admin)은 spec §5.2-c super_admin이나 MC requireRole 레벨 관례 따름. params Promise 여부는 기존 route의 GET/다른 핸들러 시그니처와 동일하게.

- [ ] **Step 3: 빌드**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && pnpm build 2>&1 | tail -10'
```
Expected: 빌드 성공

- [ ] **Step 4: PATCH 후 sync 보존 실측 (핵심)**

Run (node로 display_name 세팅 → sync 재실행 → 보존 확인):
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\");db.prepare(\"UPDATE agents SET display_name=? WHERE source LIKE ? AND name=?\").run(\"프론트엔드 엔지니어\",\"claude-project:%\",\"frontend-engineer\");console.log(\"set OK\");"; TOKEN=$(node -e "const D=require(process.env.HOME+\"/mission-control/node_modules/better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});const r=db.prepare(\"SELECT token FROM user_sessions WHERE expires_at>unixepoch() ORDER BY expires_at DESC LIMIT 1\").get();process.stdout.write(r?r.token:\"\");"); curl -s -X POST "http://localhost:3005/api/agents/sync?source=projects" -H "Cookie: mc_session=$TOKEN" >/dev/null; node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});const r=db.prepare(\"SELECT name,display_name FROM agents WHERE name=? AND source LIKE ?\").get(\"frontend-engineer\",\"claude-project:%\");console.log(r.name,\"|\",r.display_name);"'
```
Expected: sync 재실행 후에도 `frontend-engineer | 프론트엔드 엔지니어` 보존 (ON CONFLICT SET에서 display_name 제외 검증)

- [ ] **Step 5: 커밋**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && git add "src/app/api/agents/[id]/route.ts" && git commit -m "feat(c4): PATCH agents display_name (sync-preserved)"'
```

---

## Task 12: fork — agents UI (역할 그룹핑 + 한글 중심 + 설명) (spec §5.2-d, Gemini UX)

**Files:**
- Modify: `~/mission-control/src/app/.../agents` 페이지/컴포넌트 (Task 1에서 위치 확인)

- [ ] **Step 1: agents 화면 컴포넌트 위치 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'find ~/mission-control/src/app -path "*agents*" -name "page.tsx" 2>/dev/null; find ~/mission-control/src/components -iname "*agent*" 2>/dev/null | head'
```

- [ ] **Step 2: 역할 분류 헬퍼 (name 접미사/description 키워드)**

```typescript
// .claude/agents는 role 필드 없음 → name 접미사로 역할 분류 (Gemini #B)
function agentRole(name: string): string {
  if (/-engineer$|backend|frontend|ai-/.test(name)) return '개발'
  if (/-designer$|ui-|ux-/.test(name)) return '디자인'
  if (/-reviewer$|review|verifier|fact-/.test(name)) return '검토'
  if (/-migrator$|schema|db-/.test(name)) return 'DB'
  if (/doc-|sns-|marketer/.test(name)) return '문서/마케팅'
  if (/qa-|test/.test(name)) return 'QA'
  if (/pmo|orchestr/.test(name)) return 'PMO'
  return '기타'
}
```

- [ ] **Step 3: 카드 렌더 — 한글 display_name 중심 + 영어 최소 + 설명**

claude-project agents를 역할별 그룹으로 묶고, 각 카드:
- 큰 글씨: `display_name ?? name` (한글 우선, Gemini #A·#3)
- 작은 회색: `name` (영어 실행 키, 툴팁/부제)
- 한 줄 설명: config.description (Gemini #D, 이미 파싱됨)
- 작은 배지: 모델(Claude) — 그룹 1차축은 역할, 모델은 보조
- display_name 인라인 편집 → PATCH 호출(Task 11)

> 기존 컴포넌트 구조/스타일 따름. AI별(Claude/Codex/Gemini)은 필터로 제공, 1차 그룹은 역할.

- [ ] **Step 4: 빌드 + 육안 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && pnpm build 2>&1 | tail -10'
```
Expected: 빌드 성공. 이후 `https://agents.bestconsulting.vip` agents 화면에서 BC 12개가 역할별 그룹 + 한글 이름 + 설명으로 표시(대표 육안).

- [ ] **Step 5: 커밋**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && git add src/ && git commit -m "feat(c4): agents UI — role grouping + korean display_name + description"'
```

---

## Task 13: 3층위 정합 E2E (spec §5.3, §8)

**Files:**
- Create: `docs/superpowers/reports/2026-06-07-c4-three-layer-alignment-e2e.md` (BC repo)

- [ ] **Step 1: [3]→[1] 정합 — 화면에 BC 12개 표시 확인**

`https://agents.bestconsulting.vip` → BC 프로젝트 agents 12개가 Claude 그룹/역할별로 표시 + frontend-engineer display_name 한글. (Task 10·12 결과 종합 육안 + DB 카운트)

- [ ] **Step 2: [1]→[2] 정합 — task 생성**

MC 대시보드에서 task 생성: title=임의, assignee=`frontend-engineer`, project=best-consulting-hp(github_repo 연결). DB 확인(node):
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});const r=db.prepare(\"SELECT id,title,assigned_to,status,github_repo FROM tasks WHERE assigned_to=? ORDER BY id DESC LIMIT 1\").get(\"frontend-engineer\");console.log(JSON.stringify(r));"'
```
Expected: 생성된 task (status=inbox/assigned/ready 중 하나 — MC 기본값 + github_repo=kjan00-ai/Best-Consulting)

- [ ] **Step 3: [2]→실행 정합 — 연동 스크립트 발동**

Run (수동 1회 실행):
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'rm -f ~/.c3-relay.lock; node ~/mission-control/c3_mc_to_hermes.js 2>&1 | tail -10'
```
Expected: claude --agent frontend-engineer 실행 → status in_progress→done

- [ ] **Step 4: 정합 입증 — 로그 + DB status 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'ls -t ~/.c3-relay-logs/*frontend-engineer* 2>/dev/null | head -1 | xargs grep -i "frontend-engineer\|result\|diff --stat" | head; cd ~/mission-control && node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\",{readonly:true});const r=db.prepare(\"SELECT id,status,outcome FROM tasks WHERE assigned_to=? ORDER BY id DESC LIMIT 1\").get(\"frontend-engineer\");console.log(\"task:\",JSON.stringify(r));"'
```
Expected: 로그에 frontend-engineer 정체성 응답(brainstorm 실측처럼) + DB status=done

- [ ] **Step 5: 회귀 — codex/gemini/default 분기 정상 확인**

Run: assignee=codex task 1건 + default task 1건 생성 → 스크립트 실행 → 기존대로 codex exec / Hermes 동작 + 이 task들은 claim 미적용(status 안 바뀜) 확인
Expected: 기존 3분기 회귀 0 (claude 분기만 claim — Codex #7)

- [ ] **Step 6: 정합 실패 차단 — 오타 assignee**

Run: assignee=`frontend-enginer`(오타) + project=BC task 생성 → 스크립트 실행 → status=in_progress + error_message='agent_not_found' + Telegram, default fallback 안 됨 확인
Expected: error_message=agent_not_found, Hermes로 안 흘러감

- [ ] **Step 7: 원자적 claim — 중복 pickup 차단 (lock과 분리, Codex #6)**

> ⚠️ lock이 켜져 있으면 2번째 프로세스가 claim 전 종료 → claim 자체를 검증 못 함. **lock을 우회**하고 claim만 본다:
Run: 동일 미처리 task 1건 + lock 파일 미생성 상태에서, claimTask를 직접 2회 호출하는 node 테스트:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cd ~/mission-control && node -e "
const D=require(\"better-sqlite3\");const db=new D(process.env.HOME+\"/mission-control/.data/mission-control.db\");
const t=db.prepare(\"SELECT id FROM tasks WHERE status IN (\"+[\"\x27inbox\x27\",\"\x27assigned\x27\",\"\x27ready\x27\"].join(\",\")+\") LIMIT 1\").get();
if(!t){console.log(\"no claimable task\");process.exit();}
const claim=id=>db.prepare(\"UPDATE tasks SET status=\x27in_progress\x27 WHERE id=? AND status IN (\x27inbox\x27,\x27assigned\x27,\x27ready\x27)\").run(id).changes;
console.log(\"claim1:\",claim(t.id),\"claim2:\",claim(t.id));
"'
```
Expected: `claim1: 1 claim2: 0` (원자적 — 1회만 성공)

- [ ] **Step 8: rate limit — env override + lock (Codex #6)**

Run (파일 수정 대신 env override):
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'rm -f ~/.c3-relay.lock ~/.c3-relay-quota.json; C4_DAILY_LIMIT=1 node ~/mission-control/c3_mc_to_hermes.js 2>&1 | tail -5; echo "---quota---"; cat ~/.c3-relay-quota.json'
```
(claude-agent task 2건 준비된 상태) Expected: 1건 done + quota=1 / 2번째는 quotaOk=false → notify("오늘 사용량 한도 도달") + status 그대로(다음 cron 재시도). lock은 단일 프로세스라 동시성은 별도 — 동시 실행 2개 시 2번째 즉시 exit 확인.

- [ ] **Step 9: E2E 보고서 작성 + 커밋 (BC repo)**

각 Step 결과(PASS/FAIL + 증거)를 `docs/superpowers/reports/2026-06-07-c4-three-layer-alignment-e2e.md`에 기록.
```bash
cd "C:/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp" && git add docs/superpowers/reports/2026-06-07-c4-three-layer-alignment-e2e.md && git commit -m "docs(c4): 3층위 정합 E2E 검증 보고서" && git push origin master
```

---

## Task 14: 운영 통합 — 연동 스크립트 cron 확인 + 핸드오프

**Files:**
- Modify: 위키 handoffs + BC `docs/pmo/` (종결 산출물 — 전역 종결 규약)

- [ ] **Step 1: mc-relay cron이 claude 분기 포함 신버전 실행하는지 확인**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc '~/bin/hermes cron list 2>&1 | grep -i relay; cat ~/.hermes/scripts/mc-relay-cron.sh 2>/dev/null'
```
Expected: cron이 `~/mission-control/c3_mc_to_hermes.js`(신버전) 실행 확인. lock 덕에 중첩 안전.

- [ ] **Step 2: C4 종결 핸드오프 + 위키 갱신** (전역 종결 규약 §세션/task 종결)

위키 `handoffs/SESSION-HANDOFF-c4-*.md` 작성(차기 진입점=④B 부트스트랩) + `_index.md` 갱신 + reviews 링크. CLAUDE.md OPEN 섹션 + 멀티AI 섹션 갱신.

- [ ] **Step 3: 최종 스냅샷 백업**

Run:
```bash
wsl -d Ubuntu -u bestconsulting -- bash -lc 'cp ~/mission-control/c3_mc_to_hermes.js ~/mission-control/c3_mc_to_hermes.js.c4-done'
```

---

## 검증 체크리스트 (완료 기준)

- [ ] claude `--agent frontend-engineer` headless 실행 PASS (E2E Step 3·4)
- [ ] 화면(BC 12개 역할 그룹 한글) = 지시(assignee) = 실행(claude --agent) 동일 (E2E Step 1·2·3)
- [ ] assignee 오타 → failed (fallback 금지) (E2E Step 6)
- [ ] 원자적 claim 중복 차단 (E2E Step 7)
- [ ] rate limit: quota 초과 시 status 유지 + 친화 알림 + 다음 cron 재시도 + lock 단일 실행 (E2E Step 8)
- [ ] 임의 status 미사용 — MC 기존값(in_progress/done)만 (T1·T6)
- [ ] 연동 스크립트 readonly 해제(쓰기 conn dbw) + fs/execFileSync 재선언 없음 (T5·T6)
- [ ] agents name 단독 UNIQUE → (source,name) 복합 UNIQUE 전환 (T8)
- [ ] display_name PATCH 후 sync 보존 (Task 11 Step 4)
- [ ] upsert (source,name) 동명 충돌 없음 (Task 9)
- [ ] 기존 codex/gemini/Hermes 회귀 0 (E2E Step 5)
- [ ] mission-control 빌드 성공 (Task 9·10·11·12)
