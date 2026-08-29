#!/usr/bin/env node
// C3 연동 v4: MC tasks → assignee 분기 + project repo 자동 연결(자동 clone)
//   github_repo 있으면 ~/c3-repos/{repo} 에 없으면 자동 clone, 있으면 사용(+pull).
//   → 신규 프로젝트는 대시보드에서 github_repo만 넣으면 끝. 스크립트 불변.
const Database = require("better-sqlite3");
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");

const HOME = process.env.HOME;
const DB = HOME + "/mission-control/.data/mission-control.db";
const HERMES = HOME + "/bin/hermes";
const CODEX = HOME + "/bin/codex-wsl";
const GEMINI = HOME + "/bin/gemini-wsl";
const GIT = "/usr/bin/git";
const LOGDIR = HOME + "/.c3-relay-logs";
const NEUTRAL = HOME + "/.c3-workspace";
// C4: 공유 경로 규칙 (연동 스크립트 <-> mission-control fork 공유 SSOT)
const REPO_MAP = (() => { try { return require(HOME + "/.c3-repo-map.json"); } catch (e) { return {}; } })();
const REPOBASE = REPO_MAP.repoBase || (HOME + "/c3-repos");
const KNOWN_LOCAL = REPO_MAP.knownLocal || {};
const PULL_SKIP = new Set(REPO_MAP.pullSkip || []);
const HERMES_ROLES = ["default"];  // C4 정합 전: 역할 profile 폐기, default만
const CLI_ROLES = ["codex", "gemini"];

fs.mkdirSync(LOGDIR, { recursive: true });
fs.mkdirSync(NEUTRAL, { recursive: true });
fs.mkdirSync(REPOBASE, { recursive: true });

// github_repo(owner/repo) → 로컬 작업 경로 (없으면 자동 clone)
function resolveRepoPath(ghRepo) {
  if (!ghRepo) return NEUTRAL;
  if (KNOWN_LOCAL[ghRepo]) return KNOWN_LOCAL[ghRepo];  // 기존 로컬 우선
  // C4B-1: 서버 projectAgentDir(local-agent-sync.ts)와 경로 SSOT 통일 —
  //        owner__repo 로 일치(basename은 owner 충돌·정합 깨짐 위험).
  const repoName = ghRepo.replace(/\//g, "__");
  const dest = REPOBASE + "/" + repoName;
  try {
    if (fs.existsSync(dest + "/.git")) {
      // 이미 있으면 pull (실패해도 진행)
      try { execFileSync(GIT, ["-C", dest, "pull", "--ff-only"], { encoding: "utf8", timeout: 60000 }); } catch (e) {}
      return dest;
    }
    // 자동 clone
    execFileSync(GIT, ["clone", "https://github.com/" + ghRepo + ".git", dest], { encoding: "utf8", timeout: 180000 });
    return dest;
  } catch (e) {
    console.error("repo clone 실패(" + ghRepo + "): " + (e.message || e) + " → 중립 cwd 사용");
    return NEUTRAL;
  }
}

// C4: claude-agent 분기 헬퍼 -----------------------------------------------
const RESERVED = new Set(["codex", "gemini", "default"]);

// 프로젝트 cwd의 .claude/agents/*.md 파일명(확장자 제거) 목록
function listClaudeAgents(cwd) {
  if (!cwd) return [];
  try {
    return fs.readdirSync(cwd + "/.claude/agents")
      .filter(f => f.endsWith(".md") && f !== "CLAUDE.md" && f !== "AGENTS.md")
      .map(f => f.replace(/\.md$/, ""));
  } catch (e) { return []; }
}

// 분기 진입 가드.
// null = claude 분기 아님(예약어/project 미지정) -> 기존 codex/gemini/default
// { cwd, exists } = claude 분기 대상. exists=false면 agent_not_found(failed, fallback 금지)
function claudeAgentCwd(assignee, ghRepo) {
  if (RESERVED.has(assignee)) return null;
  if (!ghRepo) return null;                 // project 미지정 -> claude 분기 금지
  const cwd = resolveRepoPath(ghRepo);
  if (!cwd || cwd === NEUTRAL) return null;  // repo 확정 실패 -> claude 분기 금지
  const agents = listClaudeAgents(cwd);
  return { cwd, exists: agents.includes(assignee) };
}
// -------------------------------------------------------------------------

// T14: cursor(lastId) 폐기 — status 필터 + 원자적 claim 으로 멱등성 보장

const db = new Database(DB, { readonly: true });
// C4: 쓰기 connection (claim/finishTask UPDATE). 읽기 db는 SELECT 유지.
const dbw = new Database(DB);
// 원자적 claim: 미처리(inbox/assigned/ready) -> in_progress. changes=1일 때만 소유.
// status는 MC kanban 인식값만 사용 (T1 실측: in_progress/done/failed OK).
function claimTask(taskId) {
  const r = dbw.prepare(
    "UPDATE tasks SET status='in_progress', updated_at=unixepoch() WHERE id=? AND status IN ('inbox','assigned','ready')"
  ).run(taskId);
  return r.changes === 1;
}
// C4: claude --agent 실행 + 가시성 + rate limit -----------------------------
const CLAUDE = HOME + "/bin/claude";
const DASH = "https://agents.bestconsulting.vip";
const TG_HOME = "6206674018";
const LOCK = HOME + "/.c3-relay.lock";
const QUOTA = HOME + "/.c3-relay-quota.json";
const DAILY_LIMIT = parseInt(process.env.C4_DAILY_LIMIT || "30", 10);
const MAX_RETRY = parseInt(process.env.C4_MAX_RETRY || "2", 10);
const FRIENDLY = {
  timeout: "AI 응답 지연으로 일시 중단됨", rate_limit: "오늘 사용량 한도 도달 - 잠시 후 자동 재개",
  auth_expired: "Claude 로그인 만료 - 재로그인 필요", bad_output: "AI 응답 형식 오류",
  agent_not_found: "지정한 에이전트를 찾을 수 없음(이름 확인)", error: "실행 오류",
  quota: "오늘 실행 한도 도달 - 잠시 후 자동 재개", max_retry: "재시도 한도 초과",
  veto: "대표 거부(veto) - 승인 대기열에서 반려됨"
};

// C6-4 ②: approval-queue linkage. The decision gate (when queue activated) enqueues T3 ops blocked during a
// relay-spawned agent run, tagging each proposal with MC_TASK_ID. We read that queue file to hold/resume tasks.
// Default-off safe: queue.activated=false → no proposals → these helpers are inert (empty list).
const QUEUE = (process.env.MAIA_AUTOL2_BOOT || (HOME + "/.ai-bootstrap")) + "/state/c6-queue.json";
function readQueue() { try { return JSON.parse(fs.readFileSync(QUEUE, "utf8")); } catch (e) { return { proposals: [] }; } }
function pendingProposalForTask(taskId) {
  return (readQueue().proposals || []).find(p => String(p.taskId) === String(taskId) && p.status === "pending");
}

function tstamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function dayKey() { return new Date().toISOString().slice(0, 10); }

function quotaOk() {
  let q = {};
  try { q = JSON.parse(fs.readFileSync(QUOTA, "utf8")); } catch (e) {}
  return (q[dayKey()] || 0) < DAILY_LIMIT;
}
function bumpQuota(cost) {
  let q = {};
  try { q = JSON.parse(fs.readFileSync(QUOTA, "utf8")); } catch (e) {}
  const d = dayKey();
  q[d] = (q[d] || 0) + 1;
  q[d + "_cost"] = (q[d + "_cost"] || 0) + (cost || 0);
  fs.writeFileSync(QUOTA, JSON.stringify(q));
}
function retryExceeded(rc) { return (rc || 0) >= MAX_RETRY; }

function acquireLock() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); return true; }
  catch (e) { return false; }
}
function releaseLock() { try { fs.unlinkSync(LOCK); } catch (e) {} }

// claude --agent headless 실행. 반환 outcome: ok/timeout/rate_limit/auth_expired/bad_output/error
function runClaudeAgent(task, cwd, assignee, useGlm) {
  const logPath = LOGDIR + "/" + task.id + "-" + assignee + "-" + tstamp() + ".log";
  // B2: GLM 백엔드 라우팅 — glm-launch.sh가 §0.5 게이트 + A2 egress 프록시를 경유(claude에 실키 대신 세션토큰).
  //   default-off: agent 이름이 'glm'으로 시작할 때만 useGlm=true. 인자는 glm-launch가 "$@" 그대로 claude 전달.
  const BIN = useGlm ? (HOME + "/.ai-bootstrap/glm-launch.sh") : CLAUDE;
  if (useGlm) fs.appendFileSync(logPath, "[backend=GLM via glm-launch]\n");
  // git pull (KNOWN_LOCAL/pullSkip 제외, c3-repos 사본만)
  if (!PULL_SKIP.has(task.github_repo) && cwd.startsWith(REPOBASE)) {
    try { execFileSync(GIT, ["-C", cwd, "pull", "--ff-only"], { timeout: 60000 }); }
    catch (e) { fs.appendFileSync(logPath, "[warn] git pull failed: " + e.message + "\n"); }
  }
  let out = "", code = 0;
  try {
    out = execFileSync("timeout", ["--kill-after=10", "300",
      BIN, "--agent", assignee, "-p", task.title,
      "--permission-mode", "acceptEdits", "--output-format", "json"],
      // C6-4 ②: expose MC task id so the decision gate tags any enqueued T3 proposal with it (relay hold/resume).
      { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env, MC_TASK_ID: String(task.id) } });
  } catch (e) {
    code = e.status || 1;
    out = (e.stdout || "").toString();
    fs.appendFileSync(logPath, "[exit " + code + "] " + e.message + "\n");
  }
  fs.appendFileSync(logPath, out || "");
  let parsed = null;
  try { parsed = JSON.parse(out); } catch (e) {}
  if (code === 124) return { ok: false, outcome: "timeout", logPath };
  if (useGlm && code === 3) return { ok: false, outcome: "glm_gate_denied", logPath }; // §0.5 게이트 거부(비-allowlist/도메인 deny) — glm-launch exit 3
  if (code !== 0) {
    const rl = (parsed && parsed.api_error_status) || /rate.?limit|overloaded/i.test(out);
    const au = /credential|oauth|invalid api|authentication/i.test(out);
    return { ok: false, outcome: rl ? "rate_limit" : (au ? "auth_expired" : "error"), logPath, cost: parsed && parsed.total_cost_usd };
  }
  if (!parsed || parsed.is_error) return { ok: false, outcome: "bad_output", logPath };
  try {
    const diff = execFileSync(GIT, ["-C", cwd, "diff", "--stat"], { encoding: "utf8" });
    if (diff.trim()) fs.appendFileSync(logPath, "\n[git diff --stat]\n" + diff);
  } catch (e) {}
  return { ok: true, outcome: "ok", logPath, cost: parsed.total_cost_usd, result: parsed.result };
}

function notify(taskId, assignee, outcome) {
  const human = FRIENDLY[outcome] || outcome;
  const msg = "[멀티AI] '" + assignee + "' 작업 #" + taskId + " 실패: " + human + "\n확인: " + DASH;
  try { execFileSync(HERMES, ["send", "--to", "telegram:" + TG_HOME, msg], { timeout: 30000 }); }
  catch (e) { fs.appendFileSync(LOGDIR + "/notify-fail.log", tstamp() + " " + e.message + "\n"); }
}

// 결과 -> MC 기존 status (성공 done / 실패 failed + error_message). dbw(쓰기) 사용.
function finishTask(taskId, result, assignee) {
  if (result.ok) {
    dbw.prepare("UPDATE tasks SET status='done', outcome=?, completed_at=unixepoch(), updated_at=unixepoch() WHERE id=?")
      .run(String(result.result || "").slice(0, 2000), taskId);
  } else {
    dbw.prepare("UPDATE tasks SET status='failed', error_message=?, retry_count=retry_count+1, updated_at=unixepoch() WHERE id=?")
      .run(result.outcome, taskId);
    notify(taskId, assignee, result.outcome);
  }
}

// C6-4 ②: reconcile held tasks (awaiting_owner) against the approval queue's decisions.
//   approved → assigned (re-dispatch; gate downgrades deny→allow within exec window)
//   vetoed   → failed (+notify)
//   pending  → leave held (no churn)
//   gone     → assigned (proposal expired/coalesced → conservative retry)
function reconcileHeldTasks() {
  let held;
  try { held = db.prepare("SELECT t.id, COALESCE(a.name, t.assigned_to, 'default') AS who FROM tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.status='awaiting_owner'").all(); }
  catch (e) { return; }
  if (!held.length) return;
  const proposals = readQueue().proposals || [];
  for (const h of held) {
    const decided = proposals.find(p => String(p.taskId) === String(h.id) && (p.status === "approved" || p.status === "vetoed"));
    if (decided && decided.status === "approved") {
      dbw.prepare("UPDATE tasks SET status='assigned', error_message=NULL, updated_at=unixepoch() WHERE id=? AND status='awaiting_owner'").run(h.id);
      console.log("MC task #" + h.id + " → RESUMED (approved → assigned)");
    } else if (decided && decided.status === "vetoed") {
      dbw.prepare("UPDATE tasks SET status='failed', error_message='대표 거부(veto)', updated_at=unixepoch() WHERE id=? AND status='awaiting_owner'").run(h.id);
      notify(h.id, h.who, "veto");
      console.log("MC task #" + h.id + " → FAILED (vetoed)");
    } else if (!proposals.some(p => String(p.taskId) === String(h.id) && p.status === "pending")) {
      dbw.prepare("UPDATE tasks SET status='assigned', error_message=NULL, updated_at=unixepoch() WHERE id=? AND status='awaiting_owner'").run(h.id);
      console.log("MC task #" + h.id + " → REQUEUED (proposal gone → assigned)");
    } // else: still pending → leave held (no churn)
  }
}
// ---------------------------------------------------------------------------

// C4: 동시 실행 1개 보장 (LOCK 상수/함수 정의 이후에 체크 — TDZ 회피)
if (!acquireLock()) { console.log("이미 실행 중 (lock) — skip"); process.exit(0); }
process.on("exit", releaseLock);

// C6-4 ②: before dispatch, resolve any tasks held on approval (no-op when queue inactive / none held).
reconcileHeldTasks();

// C4B-0: resolve the executing agent via agent_id (routing key) first; legacy rows
// (agent_id NULL) fall back to assigned_to. agent_name (from agents.id) wins over the
// raw assigned_to string so same-name agents across projects route to the right one.
const rows = db.prepare(
  "SELECT t.id, t.title, t.assigned_to, t.agent_id, a.name AS agent_name, a.config AS agent_config, t.retry_count, p.github_repo FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN agents a ON a.id = t.agent_id WHERE t.status IN ('todo','ready','inbox','assigned') ORDER BY t.id ASC LIMIT 20"
).all();

if (rows.length === 0) { console.log("미처리 task 없음"); process.exit(0); }

for (const r of rows) {
  const title = String(r.title || "untitled").slice(0, 500);
  const who = (r.agent_name || r.assigned_to || "default").toLowerCase();
  // B2: agent 이름이 'glm'으로 시작하면 GLM 백엔드로 실행(claude-branch에서만). default-off(그 외=Claude).
  //   ★ 신호=agent 이름 prefix. sync 생존(이름은 안정)·model과 독립. GLM agent의 md는 model: sonnet를 쓰고
  //     glm-launch가 ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2[1m]로 remap한다(claude-code는 glm-5.2[1m] 원문 미인식).
  //     config.model=glm* / backend='glm'도 명시 override로 인정.
  let useGlm = false;
  try { const _c = JSON.parse(r.agent_config || "{}"); useGlm = who.startsWith("glm") || /^glm/i.test(_c.model || "") || _c.backend === "glm"; } catch (e) { useGlm = who.startsWith("glm"); }
  try {
    // C4: claude-agent 분기 (기존 CLI/Hermes보다 먼저, claim은 여기서만 → 회귀 0)
    const guard = claudeAgentCwd(who, r.github_repo);
    if (guard) {
      if (!guard.exists) {                       // 오타 등 — fallback 금지
        finishTask(r.id, { ok: false, outcome: "agent_not_found" }, who);
        console.log("MC task #" + r.id + " → FAILED (agent_not_found: '" + who + "')");
        continue;
      }
      if (retryExceeded(r.retry_count)) {
        dbw.prepare("UPDATE tasks SET status='failed', error_message='max_retry' WHERE id=?").run(r.id);
        notify(r.id, who, "max_retry");
        console.log("MC task #" + r.id + " → FAILED (max_retry)");
        continue;
      }
      if (!quotaOk()) {                          // 일 상한 — status 그대로(다음 cron 재시도)
        notify(r.id, who, "quota");
        console.log("MC task #" + r.id + " → DEFERRED (quota)");
        continue;
      }
      if (!claimTask(r.id)) continue;            // 원자적 claim (이미 처리중이면 skip)
      console.log("MC task #" + r.id + " → claude --agent " + who + " (cwd=" + guard.cwd + ") 실행중...");
      const result = runClaudeAgent({ id: r.id, title: title, github_repo: r.github_repo }, guard.cwd, who, useGlm);
      bumpQuota(result.cost);
      // C6-4 ②: if the gate enqueued a T3 op for this task (queue active), hold it instead of done/failed churn.
      if (pendingProposalForTask(r.id)) {
        dbw.prepare("UPDATE tasks SET status='awaiting_owner', error_message=?, updated_at=unixepoch() WHERE id=?")
          .run("승인 대기열 등록(T3) — 대표 승인 후 재개", r.id);
        console.log("MC task #" + r.id + " → HELD (awaiting_owner: 승인 대기)");
        continue;
      }
      finishTask(r.id, result, who);
      console.log("MC task #" + r.id + " → " + (result.ok ? "DONE" : "FAILED(" + result.outcome + ")") + " [" + result.logPath + "]");
      continue;
    }
    if (CLI_ROLES.includes(who)) {
      if (!claimTask(r.id)) continue;            // T14: status 기반 멱등성 (cursor 폐기)
      const cwd = resolveRepoPath(r.github_repo);  // 자동 clone/경로 유도
      const logf = LOGDIR + "/mc" + r.id + "-" + who + ".log";
      const bin = who === "codex" ? CODEX : GEMINI;
      const args = who === "codex"
        ? ["exec", "--skip-git-repo-check", title]
        : ["-p", title, "-y"];
      const out = fs.openSync(logf, "a");
      const child = spawn(bin, args, { detached: true, stdio: ["ignore", out, out], cwd });
      child.unref();
      console.log("MC task #" + r.id + " → " + who + " CLI (cwd=" + cwd + ", pid=" + child.pid + ")");
    } else if (HERMES_ROLES.includes(who)) {
      if (!claimTask(r.id)) continue;            // T14: status 기반 멱등성
      const out = execFileSync(HERMES, ["kanban", "--board", "c3-tasks", "create", "--assignee", who, title], { encoding: "utf8" });
      console.log("MC task #" + r.id + " → Hermes(" + who + "): " + out.trim().split("\n").pop());
    } else {
      if (!claimTask(r.id)) continue;            // T14: status 기반 멱등성
      execFileSync(HERMES, ["kanban", "--board", "c3-tasks", "create", "--assignee", "default", title], { encoding: "utf8" });
      console.log("MC task #" + r.id + " → Hermes(default, '" + who + "' 미허용)");
    }
  } catch (e) {
    console.error("MC task #" + r.id + " 실패: " + (e.message || e));
  }
}
console.log("처리 완료 (" + rows.length + "건 검토)");
