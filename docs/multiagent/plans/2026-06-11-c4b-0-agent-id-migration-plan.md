# C4B-0 구현 plan — agents.name UNIQUE 제거 + tasks.agent_id 라우팅

> 결정 SSOT: 위키 `decisions/2026-06-11-c4b-b1-routing-agent-id.md` (대안 B, Codex·Gemini 만장일치).
> spec: `docs/multiagent/specs/2026-06-11-c4b-bootstrap-agent-auto-registration-design.md` §0.5.2.
> 목표: C4B(킷 자동등록)의 선행 blocker B-1 해소. **둘째 프로젝트에 동명 에이전트(frontend-engineer)를 등록·라우팅 가능**하게 만든다.
> 범위: 이 plan은 **C4B-0만**(agent_id migration + 라우팅 전환). 킷/시딩/scheduler/UX는 C4B-1~3.
> 날짜: 2026-06-11 / 작성: claude / 버전: **v2 (L2 검증 반영 — Codex FAIL 치명1+중요5 / Gemini FAIL 5건. 아래 ★v2 섹션이 v1 Phase 본문에 우선)**

---

## ★ v2 — L2 검증 반영 (Codex 기술 FAIL + Gemini 운영 FAIL)

> Claude 교차실측으로 P1 데이터손실(Codex 로컬 재현)·누락 쓰기경로 3건 확인. 원본: 위키 `reviews/c4b0-plan-l2-codex-20260611.md`·`c4b0-plan-l2-gemini-20260611.md`. **본 섹션이 §1~§8에 우선.**

### V1. ★★ P1 전면 교체 — `legacy_alter_table` 폐기 (데이터 손실)

- **폐기 사유**: `legacy_alter_table=ON`+`foreign_keys=ON`에서도 `ALTER TABLE agents RENAME TO agents_old`가 **자식 FK(direct_connections/spawn_history)의 parent 참조를 agents_old로 재작성** → `DROP agents_old`가 **CASCADE 삭제 / SET NULL** 유발 + `foreign_key_check`는 PASS(= 무결성통과+데이터손실). Codex가 better-sqlite3 12.6.2/SQLite 3.51.2에서 재현. `foreign_keys` PRAGMA는 트랜잭션 내 no-op.
- **확정 접근 = 러너 트랜잭션 밖 표준 FK-OFF 12단계**:
  1. `src/lib/migrations.ts` `Migration` 타입에 `transactional?: boolean` 추가. 러너 루프(L1460): `transactional===false`면 `db.transaction()` 래핑 없이 `up(db)` 직접 실행(+ schema_migrations 기록은 up 성공 후). 052만 `transactional:false`.
  2. 052 `up()`(트랜잭션 밖): `db.pragma('foreign_keys=OFF')` → `db.exec('BEGIN')` → agents 재생성(실 DDL, 아래 V2) → 인덱스 복원 → `tasks.agent_id` 추가 → `db.exec('COMMIT')` → `const fk=db.pragma('foreign_key_check'); if(fk.length) throw` → `db.pragma('foreign_keys=ON')`. 실패 시 catch에서 `ROLLBACK`+FK ON 복구.
  3. 시작 시 `PRAGMA foreign_key_list(agents)`/incoming 참조 assert로 자식 FK가 **정확히 2개**(direct_connections, spawn_history)인지 확인 — 예상외 FK 있으면 abort.
- **대안(트랜잭션 고수 시)**: agents 재생성 후 DROP 전에 direct_connections·spawn_history도 새 agents 참조로 동시 재생성(컬럼/인덱스/ON DELETE 완전 보존). 더 위험 → 비채택, 위 FK-OFF 우선.

### V2. P1 실 DDL 고정 (의사코드 금지)

```sql
CREATE TABLE agents_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                       -- ★ UNIQUE 제거
  role TEXT NOT NULL,
  session_key TEXT UNIQUE,                  -- 유지
  soul_content TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen INTEGER, last_activity TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  config TEXT,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  source TEXT DEFAULT 'manual',
  content_hash TEXT, workspace_path TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  working_memory TEXT DEFAULT '',
  runtime_type TEXT DEFAULT NULL,
  display_name TEXT
);
INSERT INTO agents_new (id,name,role,session_key,soul_content,status,last_seen,last_activity,created_at,updated_at,config,workspace_id,source,content_hash,workspace_path,hidden,working_memory,runtime_type,display_name)
  SELECT id,name,role,session_key,soul_content,status,last_seen,last_activity,created_at,updated_at,config,workspace_id,source,content_hash,workspace_path,hidden,working_memory,runtime_type,display_name FROM agents;
DROP TABLE agents; ALTER TABLE agents_new RENAME TO agents;  -- ★ FK-OFF 상태라 자식 재작성 안전
-- 인덱스 복원:
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_workspace_id ON agents(workspace_id);
CREATE INDEX idx_agents_source ON agents(source);
CREATE UNIQUE INDEX idx_agents_source_name ON agents(source, name);
-- idx_agents_session_key: session_key UNIQUE가 autoindex 생성 → 명시 인덱스 중복. 기존 schema.sql 일관성 위해 생성하되 의도적 결정으로 주석.
```
> ★ `name TEXT NOT NULL` 만 남기고 UNIQUE 제거가 본 migration의 유일 목적. 나머지 18컬럼·기본값·session_key UNIQUE 그대로.

### V3. P2 백필 보강

- source 우선 UPDATE에도 **`COUNT(*)=1` 게이트** 추가(scalar subquery 다중행 방어) + `JOIN projects p ON p.id=tasks.project_id AND p.workspace_id=tasks.workspace_id`(cross-workspace 오염 차단). fallback은 기존 `(workspace_id,name) COUNT=1` 유지.

### V4. P3 쓰기경로 누락 보강 (실측 확인)

POST/queue-claim/PATCH 외 **반드시 포함**: `src/lib/recurring-tasks.ts`(INSERT) / `src/app/api/tasks/[id]/comments/route.ts:222`(mention auto-assign UPDATE) / `src/lib/task-dispatch.ts`(scheduler auto-route UPDATE ×2, ~1657/1671) / github webhook·import 계열. → **모두 중앙 헬퍼 `resolveAgentId(name, projectId, workspaceId)` 경유 강제**(누락 시 agent_id NULL 양산).

### V5. P4 읽기 fallback 단일매칭 제한

dispatch JOIN(933/1111/1194)의 `agent_id NULL` legacy fallback을 `name+workspace_id` 단순 JOIN으로 두면 **동명 2행 중복 dispatch 재발** → fallback도 `COUNT(*)=1` 또는 project-source 1행 조건. (notifications:31/247은 task 라우팅 아님 → 후순위.)

### V6. P5 relay claim 경합 보강

현 claim은 status만 변경(c3:85). 폴링 SELECT의 `agent_id/assigned_to`와 claim 대상 동일성 조건 추가 또는 claim `RETURNING`으로 확정행 재독 후 실행(폴링↔실행 사이 재할당 경합 시 구 assignee 실행 방지).

### V7. ★ 배포·롤백 전면 개정 (Gemini) — §7/§8 대체

- **순서 역전 금지**: build/test가 migration보다 **먼저**. 절차: ① 로컬/CI `build & test` 완료 → ② **relay cron 정지**(`hermes cron pause mc-relay` 또는 jobs.json enabled=false) → ③ **mission-control 서비스 정지**(`systemctl --user stop mission-control`) → ④ **안전 백업** `sqlite3 mission-control.db ".backup mc.bak"`(WAL 켜진 채 `cp` 금지 — 손상) → ⑤ 새 빌드 배포 + 서비스 재기동(부팅 시 자동 migration) → ⑥ `foreign_key_check`·백필 진단 확인 → ⑦ relay cron 재개.
- **롤백 = 코드 롤백 우선**: 이 변경은 하위호환(UNIQUE 제거+컬럼 추가) → 장애 시 **코드만 이전버전**으로(그 사이 신규 task 보존). DB 복원은 P1 물리손상 시 최후수단.
- **★ 2단계 배포 (권고, 1인 운영 리스크 분산)**: **Step1** = 스키마(migration) + 쓰기경로(agent_id 저장) 배포 / 읽기·relay는 기존 name 유지 → 백필 수행·검증. **Step2** = 백필 검증 후 읽기 JOIN·relay를 agent_id 기준으로 전환 배포. 문제 시 Step 단위 즉시 롤백.
- **무중단 불가 시**: migration 동안 relay·서비스 정지(다운타임)로 race 원천 차단 — 1인 운영엔 이쪽이 안전.

### V8. 통계 동명 왜곡 명시 (경미)

workload:225·standup name 집계는 동명 agent 도입 직후 합산/중복 표시 가능 → C4B-0 범위 밖이면 **"알려진 왜곡, C4B-3에서 agent_id 전환"**으로 명시.

---

## 0. 실측 전제 (확정)

- agents 컬럼 19개: id, name, role, session_key, soul_content, status, last_seen, last_activity, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path, hidden, working_memory, runtime_type, display_name. **재생성 시 전부 보존.**
- agents UNIQUE 2개(autoindex): `name`(제거 대상), `session_key`(유지). 인덱스 5개 복원: session_key/status/workspace_id/source/source_name(UNIQUE).
- agents incoming FK 2개(둘 다 id 기반, 재생성에 무손상): `direct_connections.agent_id`→CASCADE(mig016), `spawn_history.agent_id`→SET NULL(mig 'spawn_history').
- migration 러너: `src/lib/migrations.ts` `migrations: Migration[]`(L17), 각 `{id, up(db)}`, `schema_migrations`로 멱등 추적(L1448~), 루프 트랜잭션(L1460). 마지막 = `051_*`.
- task 쓰기 중심: POST `tasks/route.ts`(`resolveTaskAssignee`→INSERT L247), claim `tasks/queue/route.ts`(UPDATE SET assigned_to L119).
- 라우팅 JOIN(전환 대상): task-dispatch.ts:933/1111/1194, standup:155, notifications:31/247, workload:225.
- relay: `c3_mc_to_hermes.js` 폴링쿼리 L189(assigned_to+project_id→github_repo), 실행 L196 `who=assigned_to`.

---

## 1. Phase 1 — Migration `052` (스키마)

**파일**: `src/lib/migrations.ts` (배열 끝, `051` 다음에 추가)

```
{ id: '052_c4b0_agents_drop_name_unique_tasks_agent_id',
  up(db) {
    db.pragma('foreign_keys = OFF')
    db.exec('BEGIN')           // ※ 러너가 이미 트랜잭션이면 SAVEPOINT 또는 러너 패턴 따름 — 실측 후 결정
    // 1) agents 재생성: name UNIQUE 제거, 나머지 19컬럼·기본값·session_key UNIQUE 보존
    db.exec(`CREATE TABLE agents_new ( ... 19컬럼, name TEXT NOT NULL(=UNIQUE 제거), session_key TEXT UNIQUE, ... )`)
    db.exec(`INSERT INTO agents_new (id, name, ...19컬럼...) SELECT id, name, ... FROM agents`)  // id 보존
    db.exec(`DROP TABLE agents`)
    db.exec(`ALTER TABLE agents_new RENAME TO agents`)
    // 2) 인덱스 복원
    db.exec(`CREATE INDEX idx_agents_session_key ON agents(session_key)`)   // 주의: session_key UNIQUE면 중복
    db.exec(`CREATE INDEX idx_agents_status ON agents(status)`)
    db.exec(`CREATE INDEX idx_agents_workspace_id ON agents(workspace_id)`)
    db.exec(`CREATE INDEX idx_agents_source ON agents(source)`)
    db.exec(`CREATE UNIQUE INDEX idx_agents_source_name ON agents(source, name)`)
    // 3) tasks.agent_id
    const tcols = db.prepare(`PRAGMA table_info(tasks)`).all()
    if (!tcols.some(c=>c.name==='agent_id'))
      db.exec(`ALTER TABLE tasks ADD COLUMN agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id)`)
    db.exec('COMMIT')
    const fk = db.pragma('foreign_key_check')   // 4) 무결성 검증
    if (fk.length) throw new Error('FK check failed: '+JSON.stringify(fk))
    db.pragma('foreign_keys = ON')
  } }
```

**★ 실측 확정 (P1 핵심 — 위 의사코드의 `foreign_keys=OFF`/`BEGIN`은 폐기)**:
- 러너(`runMigrations` L1460)가 각 `up(db)`를 **`db.transaction()`으로 감쌈** → migration 내 `db.exec('BEGIN')`은 에러, `PRAGMA foreign_keys=OFF`는 **트랜잭션 내 no-op**(무효). 표준 12단계 OFF 접근 사용 불가.
- 런타임 **`foreign_keys = ON`**(db.ts:48, 확인=1). FK 강제 활성.
- workspaces 재생성 선례(migrations.ts:963)는 **incoming FK 0개**(workspace_id는 plain INTEGER, REFERENCES 없음)라 안전했음. **agents는 실제 incoming FK 2개**(direct_connections.agent_id, spawn_history.agent_id) → 선례 직접 이식 불가: `RENAME agents→agents_old` 시 SQLite가 자식 FK를 `agents_old`로 **자동 재작성** → DROP 후 dangling.
- **확정 접근**: 트랜잭션 내 설정 가능한 **`PRAGMA legacy_alter_table = ON`** 사용 →
  ```
  up(db) {                                    // 러너 트랜잭션 안에서 실행됨
    db.pragma('legacy_alter_table = ON')      // RENAME이 자식 FK를 재작성하지 않게
    db.exec(`ALTER TABLE agents RENAME TO agents_old`)   // 자식은 여전히 "agents" 참조
    db.exec(`CREATE TABLE agents ( ...19컬럼, name TEXT NOT NULL, session_key TEXT UNIQUE... )`)
    db.exec(`INSERT INTO agents (id,name,...19) SELECT id,name,...19 FROM agents_old`)  // id 보존
    db.exec(`DROP TABLE agents_old`)          // 아무도 agents_old 참조 안 함 → 안전
    db.pragma('legacy_alter_table = OFF')
    // 인덱스 복원 + tasks.agent_id (위 2~3단계)
    const fk = db.pragma('foreign_key_check')
    if (fk.length) throw new Error('FK check failed: '+JSON.stringify(fk))   // throw → 러너 트랜잭션 롤백
  }
  ```
- throw 시 러너 `db.transaction()`이 **자동 롤백** → 부분상태 잔존 없음. schema_migrations에도 미기록(재시도 가능).
- `INSERT ... SELECT`로 id 보존 → direct_connections/spawn_history agent_id FK 유효 유지(foreign_key_check로 입증).
- ⚠️ **이 접근(legacy_alter_table)은 L2(Codex) 검증 대상** — SQLite 버전별 RENAME/FK 재작성 동작 + 트랜잭션 내 legacy_alter_table 유효성 교차확인.

## 2. Phase 2 — 백필 (기존 task → agent_id)

migration `052` 내 마지막 단계 또는 직후 1회 스크립트:
```
UPDATE tasks SET agent_id = (
  SELECT a.id FROM agents a JOIN projects p ON p.id = tasks.project_id
  WHERE a.source = 'claude-project:'||p.github_repo AND a.name = tasks.assigned_to)
WHERE agent_id IS NULL AND assigned_to IS NOT NULL;
-- fallback: project 없는 legacy → (workspace_id,name) 단일매칭(2행 이상이면 skip)
UPDATE tasks SET agent_id = (
  SELECT a.id FROM agents a WHERE a.name = tasks.assigned_to AND a.workspace_id = tasks.workspace_id)
WHERE agent_id IS NULL AND assigned_to IS NOT NULL
  AND (SELECT COUNT(*) FROM agents a WHERE a.name=tasks.assigned_to AND a.workspace_id=tasks.workspace_id)=1;
```
- 미매칭 행은 `agent_id NULL` 유지 + 진단 로그(개수·task id 목록).
- 현 DB 실측: 동명 충돌 0(BC 12개만) → 백필 깔끔할 것.

## 3. Phase 3 — 쓰기 경로 중앙화 (agent_id 저장)

- **`src/app/api/tasks/route.ts` POST**(L216~247): `resolveTaskAssignee`로 name 확정 후, **그 name+project_id로 agent_id 조회**(source 우선, fallback 단일매칭) → INSERT 컬럼에 `agent_id` 추가, 저장. `assigned_to=name`도 동시 저장(실행키·표시).
- **`src/app/api/tasks/queue/route.ts` claim**(L119): `UPDATE ... SET status='in_progress', assigned_to=?, agent_id=?` — claim 시 agent_id 동기 기록.
- **`tasks/[id]/route.ts` PATCH**(재할당 경로 있으면): assigned_to 변경 시 agent_id 재해석.
- 권고: name→agent_id 해석을 **단일 헬퍼 `resolveAgentId(name, projectId, workspaceId)`**(db.ts)로 중앙화 → 모든 쓰기 경로 공유(불일치 방지).

## 4. Phase 4 — 읽기/라우팅 JOIN 전환

- **dispatch/requeue/review** (task-dispatch.ts:933/1111/1194): `LEFT JOIN agents a ON a.name=t.assigned_to AND a.workspace_id=t.workspace_id` → **`LEFT JOIN agents a ON a.id = t.agent_id`**. (agent_id NULL legacy는 기존 name 매칭 fallback 1줄 유지 — COALESCE 또는 분기.)
- standup:155 / workload:225 / notifications:31,247: 동일 패턴 전환(가능한 곳부터; notifications는 recipient=name이라 별도 검토 — task 라우팅 아님, 후순위 가능).
- 통계(diagnostics/attribution/standup/agent-evals): `assigned_to=name` 집계는 **동명 합산 위험** 있으나 C4B-0 핵심(dispatch)은 아님 → agent_id 기준으로 점진 전환, 표시명은 agents 조인. **C4B-0 필수 = dispatch 3곳 + relay**, 통계는 후속 허용(plan에 명시).

## 5. Phase 5 — relay 전환

**`c3_mc_to_hermes.js`**:
- 폴링쿼리 L189: `SELECT t.id, t.title, t.assigned_to, t.agent_id, t.retry_count, p.github_repo, a.name AS agent_name FROM tasks t LEFT JOIN projects p ON t.project_id=p.id LEFT JOIN agents a ON a.id=t.agent_id WHERE ...`
- 실행 L196: `who = (r.agent_name || r.assigned_to || 'default').toLowerCase()` — agent_id 해석된 name 우선, legacy fallback assigned_to.
- 나머지(claudeAgentCwd/runClaudeAgent)는 name 기반 유지(`claude --agent <name>` 실행키 불변).
- ⚠️ relay는 라이브 cron(every 1m) → 배포 시 원자 교체 + `node --check` + 1회 dry-run.

## 6. Phase 6 — 회귀 테스트 (필수, vitest)

1. **동명 2프로젝트**: 프로젝트 X(repo a/x)·Y(repo a/y)에 각각 `frontend-engineer` 삽입 → agents 2행(source 다름) 공존(과거 name UNIQUE면 실패하던 케이스).
2. **dispatch 1행 보장**: X의 task(assigned_to=frontend-engineer, project=X) → dispatch JOIN이 X의 agent 1행만 반환(Y 아님).
3. **백필**: legacy task(agent_id NULL) → 백필 후 정확한 agent_id, 미매칭은 NULL+진단.
4. **relay name 해석**: agent_id→name→`claude --agent` who 정확.
5. **FK check**: migration 후 `foreign_key_check` 빈 결과. direct_connections/spawn_history.agent_id 유지.
6. **쓰기 불일치**: POST/claim 후 `agent_id`↔`assigned_to` 정합(헬퍼 경유).

## 7. 검증·배포 순서

1. 로컬 `.data` 백업(`cp mission-control.db .bak`) → migration 적용 → `foreign_key_check`·백필 진단 확인.
2. `pnpm typecheck && pnpm test`(신규 회귀 포함) → `pnpm build`.
3. relay dry-run(`node --check c3_mc_to_hermes.js` + 1폴링 수동).
4. ⚠️ **이 repo는 WSL credential 미설정으로 push 보류 상태** → 커밋은 로컬, push는 별도 인증 후(CLAUDE.md carry). 서비스 재기동(`systemctl --user restart mission-control`)은 migration 자동적용 확인.

## 8. 리스크 / 롤백

- **R1 테이블 재생성 중 실패** → agents 유실 위험. 완화: migration 전 DB 파일 백업 mandate + agents_new 검증 후에만 DROP + 부분실패 시 수동복구 절차.
- **R2 [해소] 러너 트랜잭션 ↔ foreign_keys PRAGMA** → 실측 확정: foreign_keys=OFF 무효이므로 **`legacy_alter_table=ON` 경로**로 전환(P1 ★실측 확정 참조). 잔여 리스크 = SQLite 버전별 동작 → L2 Codex 검증 + foreign_key_check 게이트.
- **R3 쓰기 경로 누락**(assigned_to만 갱신, agent_id 누락) → 라우팅 NULL. 완화: 중앙 헬퍼 강제 + 불일치 테스트 + dispatch fallback(name 매칭) 한시 유지.
- **롤백**: schema_migrations에서 052 제거 불가(down 없음) → DB 백업 복원이 정식 롤백. 배포 전 백업 필수.

## 9. 체크리스트 (Task 추적)

- [ ] P1 migration 052 작성(agents 재생성 + tasks.agent_id) + 러너 트랜잭션/PRAGMA 패턴 실측
- [ ] P2 백필 SQL + 진단 로그
- [ ] P3 resolveAgentId 헬퍼 + POST/claim/PATCH 쓰기 경로
- [ ] P4 dispatch JOIN ×3 전환(+fallback) / 통계 점진
- [ ] P5 relay 쿼리·who 해석 전환 + dry-run
- [ ] P6 회귀 테스트 6종
- [ ] P7 백업→적용→typecheck/test/build→재기동 검증

## 10. 관련
- 결정: [[2026-06-11-c4b-b1-routing-agent-id]]
- spec §0: `docs/multiagent/specs/2026-06-11-c4b-bootstrap-agent-auto-registration-design.md`
- 후속: C4B-1(path/sync SSOT) → C4B-2(킷/시딩) → C4B-3(scheduler/UX)
