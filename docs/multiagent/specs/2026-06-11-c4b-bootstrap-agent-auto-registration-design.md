# C4B — 부트스트랩 에이전트 자동 연동 (Bootstrap Agent Auto-Registration) 설계

> 멀티AI 시스템 C cycle, C4(3층위 정합)의 후속 carry **④B**를 독립 cycle로 승격한 설계.
> 베이스: C4가 구축한 `scanProjectAgents`/`~/.c3-repo-map.json`/`agents.display_name`/`(source,name)` upsert 인프라.
> 목표: C4는 **이미 `.claude/agents`를 가진 기존 프로젝트(BC)**의 3층위 정합을 실증했고, C4B는 그 정합을 **신규 프로젝트가 부트스트랩되는 순간 자동 성립**시킨다.
>
> - 날짜: 2026-06-11
> - 작성: claude
> - 버전: **v2** (L2 검증 반영 — Codex 기술 FAIL 치명3+중요5 / Gemini UX 조건부 6건. 아래 §0 선행 blocker·정정 참조. v1 본문은 추적성 위해 보존하되 §0이 우선한다.)
> - 선행: C1(Hermes+Telegram) / R6(상시구동) / C2(위키보고) / C3(대시보드) / **C4(3층위 정합, T1~T14)**
> - SSOT: 멀티AI 지식=위키 원본, 코드/spec=repo 원본 + 위키링크
> - 대표 결재 사항: §3 에이전트 킷 구성(어떤 역할 N종) / §7 미해결

---

## 0. ★ L2 검증 반영 (v2) — 선행 blocker + 정정

> Codex(기술, VERDICT **FAIL**) + Gemini(UX, **조건부**). Claude 교차실측으로 치명1/2/5 전부 코드 확인. 본 §0이 v1 본문(§1~§9)에 **우선**한다. 상세 원본: 위키 `reviews/c4b-l2-codex-tech-20260611.md`·`c4b-l2-gemini-ux-20260611.md`.

### 0.1 ★★ 선행 blocker (이게 해결 안 되면 C4B 착수 불가)

- **[B-1] `agents.name` 전역 UNIQUE 제거 — C4B의 전제조건.**
  `schema.sql:25 name TEXT NOT NULL UNIQUE` + migration 051이 "name 단독 UNIQUE 유지" 명시. → **같은 킷을 둘째 프로젝트에 시딩하면 `frontend-engineer`가 `(source,name)` conflict 이전에 전역 name UNIQUE 위반으로 INSERT abort.** "킷을 모든 프로젝트에 자동 등록"이 원천 불가.
  - 해소: **별도 선행 migration**으로 agents 테이블 재생성(`name UNIQUE` 제거, `(source,name)` UNIQUE만 유지). FK 참조 2개(agents 참조) 보호 + 동반 수정 대상: `tasks.assigned_to`, `project_agent_assignments.agent_name`(schema:80~82), agent 통계 집계. → **C4B와 분리된 선행 cycle(C4B-0 마이그레이션)으로 격상.**
- **[B-2] repo path SSOT 통합 — 서버와 relay가 다른 작업트리.**
  서버 `projectAgentDir`=`repoBase/{owner__repo}`(local-agent-sync.ts:349) vs relay `resolveRepoPath`=`REPOBASE/{repoName}`(c3_mc_to_hermes.js:33). 같은 github_repo를 **서로 다른 경로**로 스캔/실행 → 3층위 정합 깨짐. → `resolveRepoPath`를 단일 SSOT(JS 모듈 또는 `.c3-repo-map.json` 계약)로 양쪽 공유. naming(`owner__repo` vs `repoName`) 중 하나로 통일 **결재 필요**.
- **[B-3] JS↔TS sync 계약 = 코드 공유로 격상.**
  v1 §4.3은 "계약 표"만으로 drift 방지하려 했으나 Codex 지적대로 부족. content_hash(sha256 원문전체)·frontmatter parser·config JSON·source resolve·upsert SQL을 **공유 JS 모듈 1개**로 추출해 서버(TS, dynamic import)와 헬퍼(JS)가 동일 코드 사용. 공유 불가 시 **필드별 golden fixture 테스트 필수**.

### 0.2 정정 (v1 본문 사실오류 — 실코드 기준)

- **§1·§5 정정**: "syncProjectAgents 호출처 0" → **틀림**. sync API는 이미 `?source=projects`로 호출 중(route.ts:20). **미배선은 scheduler·부팅1회뿐**. → §5 범위 = scheduler에 `project_agent_sync` task 신설(task등록/settings key/defaultEnabled/tick dispatch/status API/manual trigger 전부) + 부팅1회. API는 갱신 불요.
- **§4.3 정정**: "status 보존·extractRole 동일" → **틀림**. 실코드 upsert는 `role='agent'` 하드코딩, `status`는 sync가 online/offline 관리(보존 안 함). **보존되는 건 display_name뿐**(SET 절 제외 컬럼). → 헬퍼도 동일하게 role='agent', status=online으로 맞춤(extractRole 미사용). display_name·hidden만 보존.
- **§4.2 정정**: tools 파싱 — TS parser는 `tools: [Read, Edit]` JSON 배열형만 인식(local-agent-sync.ts:75), `tools: Read, Edit, Bash` 콤마형은 버림. → **킷 템플릿은 tools를 JSON 배열형으로 작성**(또는 parser를 yaml 패키지로 교체 — 결재). hash 대상=원문 UTF-8 전체, soul=frontmatter제거 body.trim 명문화.
- **§7-4 격상**: github_repo 미연결 fallback은 선택 아닌 **필수**. syncProjectAgents는 github_repo NOT NULL만(L361), relay도 없으면 claude 분기 금지(c3:68). → `projects.local_path`(부트스트랩 시 project_root 저장) + source=`claude-project-id:{project_id}`(repo 변경 무관 키). repo 후발생 시 source rename 전략 포함. **register-mc-project.js도 기존 row의 빈 github_repo 보존형 update 허용**(register:21 정정).
- **§3.6 보강**: 비파괴 원칙은 OK(lock/marker 기본기 init:21). 단 **부분 시딩 실패 시 일부 파일만 남아 "비어있지 않음"→킷 영구 skip** 버그 + bash 치환 특수문자/trailing newline 취약. → **temp 디렉터리에 전부 렌더 후 성공 시 atomic rename**, 치환은 Node 헬퍼로.

### 0.3 UX 반영 (Gemini)

- **킷 6종 → 3종 이하** (ai-engineer/code-reviewer/doc-manager). 특화역할은 대시보드 opt-in. (§3.2 대체)
- **지연형(lazy) 시딩 권장**: 자동 60카드 노이즈 회피. 스캐폴딩은 **시딩 보류**하고, 대시보드 첫 진입 시 "이 프로젝트 추천 작업자 N명 고용?" **원클릭 팝업** → 결재 시 등록. (`.no-agent-kit` 숨은 플래그보다 우선) — **자동 vs 지연형 최종 결재 필요**(이게 §2 결재 "자동 복사"를 일부 뒤집음).
- **default_display_name**: 템플릿 frontmatter에 한글 기본 표시이름 → 헬퍼가 **최초 INSERT시에만** 주입, UPDATE 보존.
- **카드 소속 프로젝트 배지 강제표시**(동명 혼동 방지) + **유령 에이전트**(.md 삭제 시 offline+경고배지, 이미 markOffline 존재 → UI 노출) + **온보딩 메시지에 대시보드 직결 URL + "작업자 N명 배치" 안내**.

### 0.4 개정 후 cycle 분해 (권고)

1. **C4B-0 (선행)**: agents.name UNIQUE 제거 migration + 식별자 스코프 재설계 (B-1) — **별도 cycle, 최우선**.
2. **C4B-1**: repo path SSOT 통합(B-2) + sync 공유모듈(B-3) + github_repo fallback(§7-4).
3. **C4B-2**: 킷 템플릿(3종, JSON tools, default_display_name) + atomic 시딩 + 헬퍼.
4. **C4B-3**: scheduler 배선 + 지연형 팝업 UX + 카드 배지/유령처리 + 온보딩 링크.

→ **차기: B-1/B-2 해결 가능성 실측 + 자동/지연형 시딩 최종 결재 후 plan.**

### 0.5 B-1/B-2 실측 결과 (2026-06-11, Claude)

- **B-2 (path SSOT) = 즉시 가능 (저위험)**. `~/c3-repos` 디스크 **완전 비어있음** → 마이그레이션할 기존 clone 0. 양쪽 다 `~/.c3-repo-map.json`(repoBase/knownLocal) 공유, 차이는 fallback naming 한 줄(서버 `owner__repo`(local-agent-sync.ts:349) vs relay `repoName`(c3:33)). → **relay를 `ghRepo.replace(/\//g,"__")`로 통일**(owner 충돌 회피). 단일 `resolveRepoPath` JS 모듈로 추출 권장. 비용 0.
- **B-1 (name UNIQUE 제거) = 가능하나 핵심은 "라우팅 스코프화"(중위험)**:
  - agents incoming FK 2개 모두 **`agent_id`(id 기반)**(migrations.ts:453,1306) → name UNIQUE 제거가 FK 무손상. 테이블 재생성 선례 존재(workspaces L963, api_keys L1051), 행 id 보존 복사로 child FK 유지(PRAGMA foreign_keys 처리).
  - **진짜 위험**: 전 프로젝트 `workspace_id=1` 공유(실측). dispatch JOIN `a.name = t.assigned_to AND a.workspace_id`(task-dispatch.ts:933/1111/1194)가 둘째 프로젝트 동명 에이전트에서 **2행 반환→오라우팅**. assigned_to는 `claude --agent <name>` 실행 키라 bare name 유지 필수 → 이름 네임스페이싱 불가.
  - **해소책**: tasks엔 이미 `project_id`(migration 710) + relay가 project_id→github_repo 해석(c3:189). → 모든 agents-by-name JOIN을 **`a.source='claude-project:'||p.github_repo`(project_id 경유)로 스코프화**. 블라스트 반경: task-dispatch.ts ×3 + agent-evals.ts(assigned_to/agent_name 통계) + db.ts:531 등 — **전수 누락 0 + golden 테스트 필수**.
  - **대안 B(더 견고, 더 큰 작업)**: `tasks.agent_id` FK 신설 → id로 라우팅, name은 표시·실행키 전용. 할당 경로(UI/API/dispatch/relay) 집중 수정.
- **판정**: B-2는 trivial. B-1은 **table recreate(쉬움) + 라우팅 스코프화(위험 집중)**가 본체 → 대안 A(source 스코프) vs 대안 B(tasks.agent_id) **결재 필요**. 둘 다 C4B-0 선행 cycle로 분리 타당.

#### 0.5.1 Blast radius 정밀 실측 (2026-06-11) + ★ Option C 발견

- **대안 A (source 스코프 JOIN)** = **~40+ 사이트** (넓음): name으로 agents 식별 — JOIN 6(task-dispatch:933/1111/1194, standup:155, notifications:31/247) + 단건조회 `WHERE name=? AND workspace_id=?` ~22(agents 관리 API: soul/heartbeat/hide/keys/diagnostics/wake/memory/attribution/register/connect…) + 통계집계 by name ~29(agent-evals:13, task-dispatch:4, mcp-audit:2…). **대부분 이미 `workspace_id`로 스코프 중** → source 추가는 전수 수정.
- **대안 B (tasks.agent_id FK)** = **~25 사이트** (중간, 기계적): migration+백필 + assigned_to 읽기/쓰기 ~24(tasks/standup/workload/diagnostics/attribution/search) + relay id→name 해석(c3:196 `who`) + UI 할당(task-board-panel 등).
- **★ Option C (신규 발견, 최소 비용)**: 코드의 실제 agent 식별자는 source가 아니라 **`(workspace_id, name)`** — 40+ 사이트 전부 이미 `AND workspace_id=?`. C4의 `(source,name)` UNIQUE는 쿼리층에 미전파(불일치). → **standalone `name UNIQUE` → `(workspace_id, name)` UNIQUE로 교체 + 프로젝트마다 별도 workspace_id 부여**. 기존 40+ 쿼리 **무수정 동작**(라우팅 재작성 ≈0). 비용 = 프로젝트별 workspace 할당(현재 전부 ws=1) + 부트스트랩/register-mc-project가 workspace 생성·매핑. **⚠️ 검증 필요: MC의 workspace는 멀티테넌트(users·workspaces 테이블) 개념 — "프로젝트=workspace" 재해석이 테넌시 모델/권한/UI와 충돌하는지 실측 후 결재.**
- **수정 권고**: B-1 3대안 = A(source 전파, 넓음) / B(agent_id, 중간) / **C(workspace=project, 라우팅 무수정이나 테넌시 의미 충돌 리스크)**.

#### 0.5.2 ★ 결정 확정 (2026-06-11) — 대안 B (tasks.agent_id FK)

**Codex(기술)·Gemini(운영) 둘 다 독립적으로 B / confidence 상 → 만장일치 확정.** 결정문 SSOT: 위키 `decisions/2026-06-11-c4b-b1-routing-agent-id.md`.

- **B 채택**: `tasks.agent_id`(FK→agents.id)로 라우팅 주키 고정. `assigned_to`(name)는 표시·`claude --agent <name>` 실행키 전용. id 보존 테이블 재생성으로 `agents.name UNIQUE` 제거(`UNIQUE(source,name)` 유지). agents incoming FK 2개가 id 기반이라 FK 무손상 + 장기 유지보수 최안전.
- **A 기각**: name 기반 40~49 사이트 전수 수정, 누락 시 조용한 오라우팅 + 머지충돌 폭증.
- **C 기각**: tenant→workspace→projects 계층 역전, auth/session/UI 충돌 치명.
- **C4B-0 실행계획**(migration→agent_id→백필→쓰기경로 중앙화→JOIN 전환→relay→통계) + 회귀테스트(동명 2프로젝트 dispatch 1행 보장 등): 결정문 참조.
- **확정 분해**: **C4B-0**(본 결정, agent_id migration) → **C4B-1**(B-2 path SSOT + B-3 sync 공유모듈) → **C4B-2**(킷 3종/atomic 시딩/헬퍼) → **C4B-3**(scheduler 배선 + 지연형 팝업 UX + 카드 배지/유령처리/온보딩 링크). **차기 = C4B-0 plan 작성.**

---

## 1. 문제 정의

C4는 **BC repo가 손으로 만든 `.claude/agents` 12개**를 전제로 3층위 정합([3]정의→[1]화면→[2]실행)을 실증했다. 그러나 **신규 프로젝트**가 멀티AI 시스템에 들어올 때는:

| 단계 | 현재(C4 직후) 상태 | 문제 |
|---|---|---|
| 부트스트랩 스캐폴드 | `init-project.sh`가 CLAUDE/AGENTS/GEMINI.md + settings + 위키 + **MC 프로젝트 등록**까지 함 | `.claude/agents/*.md`는 **안 만듦** → 신규 프로젝트는 작업자(에이전트)가 **0명** |
| MC DB 에이전트 등록 | `scanProjectAgents()`/`syncProjectAgents()` 코드는 **존재(L303/L357)** | **아무 데서도 호출 안 됨** — sync API·scheduler 모두 `syncLocalAgents`만 발동. 프로젝트 에이전트 동기화 경로 **비활성** |
| 결과 | 신규 프로젝트는 대시보드에 에이전트 카드 0개 | "누구에게 시킬지" 자체가 불가 → 3층위 정합이 **신규 프로젝트엔 미적용** |

→ **C4B = 신규 프로젝트가 부트스트랩되는 순간 (a) 기본 작업자 셋을 갖고 (b) 그게 MC 대시보드에 자동 등록되어, 손대지 않아도 C4 3층위 정합이 성립**하게 만든다.

## 2. 목표 / 범위

**목표**: 신규 프로젝트 첫 진입 → `.claude/agents` 기본 킷 시딩 → MC 자동 등록 → 대시보드 표시 → task 지시 → relay가 `claude --agent`로 실행. **사람 손 0.**

**대표 결재 결정 (2026-06-11)**:
- **에이전트 시딩** = **기본 에이전트 킷 자동 복사** (옵션 A)
- **등록 트리거** = **즉시(스캐폴드 시점) + 주기(서버 스캔) 둘 다**

**범위 (3 컴포넌트)**:
- **① 에이전트 킷 템플릿 SSOT** — `~/.ai-bootstrap/templates/agents/*.md` 신설 + `init-project.sh` 시딩 로직
- **② 즉시 등록 헬퍼** — `register-mc-agents.js` (스캐폴드 끝에서 1회, DB 직접 upsert)
- **③ 주기 등록 배선** — `syncProjectAgents()`를 scheduler(`local_agent_sync` 또는 신규 task)·sync API에 실제 연결

**범위 밖 (carry)**: 역할 선택형 라이브러리 UI / task 생성 시 에이전트 추천 태그 / Codex·Gemini 에이전트 시딩(claude 먼저 검증 후 확대).

## 3. 컴포넌트 ① — 에이전트 킷 템플릿 (SSOT)

### 3.1 위치·형식
- SSOT: `~/.ai-bootstrap/templates/agents/<name>.md` (기존 `templates/project-*.md`와 동일 디렉토리 관례).
- 형식: Claude Code 서브에이전트 표준 frontmatter — `name` / `description` / `tools` / `model`. (BC `ai-engineer.md` 실측 포맷 준수.)
- 치환: 본문에 `{{PROJECT_NAME}}` 플레이스홀더 → `init-project.sh`가 BC 스캐폴드와 동일 방식(`${content//\{\{PROJECT_NAME\}\}/...}`)으로 치환.

### 3.2 킷 구성 (대표 결재 필요 — 제안)
**프로젝트 비종속 범용 역할**만 담는다 (BC 12개는 BC 도메인 특화라 킷에 넣지 않음). 제안 셋:

| name | 역할 | model(기본) |
|---|---|---|
| `frontend-engineer` | UI/화면 구현 | claude-sonnet-4-6 |
| `backend-engineer` | API/서버/DB 로직 | claude-sonnet-4-6 |
| `code-reviewer` | 변경 리뷰·품질 | claude-sonnet-4-6 |
| `qa-tester` | 테스트·검증 | claude-haiku-4-5-20251001 |
| `doc-manager` | 문서·README·위키 | claude-haiku-4-5-20251001 |
| `pmo-orchestrator` | 작업 분해·라우팅(선택) | claude-sonnet-4-6 |

- 본문은 **범용 골격**(역할·원칙·산출물 기준)만, 프로젝트 고유 스택은 `{{PROJECT_NAME}}` 안내 + "이 프로젝트 CLAUDE.md 참조" 1줄. 작성자가 이후 직접 특화/추가/삭제.
- `tools` 기본: `Read, Edit, Write, Bash, Glob, Grep` (reviewer/qa는 Write 제외 등 역할별 최소 권한 — §7-1 결재).

### 3.3 시딩 로직 (`init-project.sh` 확장)
스캐폴드 §3.5(settings 생성) 뒤에 블록 추가:
```
# 3.6) seed default agent kit (only if .claude/agents empty/absent)
AGENTS_DIR="$PROJECT_ROOT/.claude/agents"
KIT="$TEMPLATES/agents"
if [ -d "$KIT" ] && { [ ! -d "$AGENTS_DIR" ] || [ -z "$(ls -A "$AGENTS_DIR" 2>/dev/null)" ]; }; then
  mkdir -p "$AGENTS_DIR"
  for tmpl in "$KIT"/*.md; do
    [ -e "$tmpl" ] || continue
    dest="$AGENTS_DIR/$(basename "$tmpl")"
    [ -f "$dest" ] && continue                      # 개별 보존
    content="$(cat "$tmpl")"
    printf '%s\n' "${content//\{\{PROJECT_NAME\}\}/$PROJECT_NAME}" > "$dest" || ok=0
    created="$created .claude/agents/$(basename "$tmpl")"
  done
fi
```
- **비파괴 mandate**: `.claude/agents`가 **비어있을 때만** 시딩. 작성자가 이미 1개라도 넣었으면 킷 전체 skip(작성자 의도 우선). 개별 파일도 존재 시 skip.
- `ok`/`created`/marker 기존 로직에 자연 합류 → 멱등(마커 있으면 스캐폴드 자체가 skip).

## 4. 컴포넌트 ② — 즉시 등록 헬퍼 (`register-mc-agents.js`)

### 4.1 배선
`init-project.sh` §4.5(`register-mc-project.js`) **직후**, 프로젝트 등록이 성공한 뒤 호출:
```
node "$HOME/.ai-bootstrap/register-mc-agents.js" "$PROJECT_NAME" "$GH_SLUG" "$PROJECT_ROOT" >> "$LOG" 2>&1 || log "MC agent register skip"
```

### 4.2 동작 (DB 직접 upsert — 서버 비의존)
`register-mc-project.js`와 동형. MC 서버가 **꺼져 있어도** 동작해야 하므로(스캐폴드는 임의 시점) better-sqlite3로 DB 직접 접근:
1. MC DB 없으면 조용히 skip(exit 0).
2. `projects`에서 이 프로젝트 row 확인(없으면 §4.5가 막 만들었으므로 재조회) → `id`/`github_repo` 확보.
3. `<PROJECT_ROOT>/.claude/agents/*.md` 스캔 → frontmatter(name/description/tools/model) 파싱.
4. **upsert**: `source = 'claude-project:{github_repo}'`, key = `(source, name)` →
   `INSERT ... ON CONFLICT(source,name) DO UPDATE SET role=…, description→config, tools→config, content_hash=…, updated_at=…` —
   **`display_name`·`status`·`hidden` 등 사용자 데이터는 SET 절에서 제외(보존)**. (C4 §2-a 계약 그대로.)
5. 결과 로그(`inserted/updated`).

### 4.3 ★ SSOT 계약 (mandate)
서버의 `syncProjectAgents()`(TS)와 이 헬퍼(JS)는 **반드시 동일한 upsert 규칙**을 따른다 — `source` 포맷, `(source,name)` 키, display_name/status 보존, content_hash 계산, role 추출(`extractRole`). 두 경로의 결과가 달라지면 즉시→주기 사이에 row가 흔들린다.
- 구현 권고: 스캔/파싱/upsert의 **계약을 §6 부록에 표로 고정**하고 양쪽이 그 표를 구현. (JS↔TS 코드 공유는 빌드 복잡도상 비채택, 계약 표가 단일 진실.)
- 검증: 헬퍼 즉시등록 직후 row와, 서버 `syncProjectAgents` 1회 실행 후 row가 **content_hash·source·name 동일**(diff 0)임을 E2E에서 확인(§5 step 4).

## 5. 컴포넌트 ③ — 주기 등록 배선 (`syncProjectAgents` 활성화)

현재 `syncProjectAgents()`는 export만 되고 **호출처 0**. 두 곳에 배선:

1. **scheduler** (`src/lib/scheduler.ts`): 기존 `local_agent_sync` task가 `syncLocalAgents()`만 호출(L463/L537). →
   - (택1-a) 동일 task가 `syncLocalAgents()` **+ `syncProjectAgents()`** 둘 다 실행하도록 확장, 또는
   - (택1-b) 신규 task id `project_agent_sync` 추가(독립 주기·독립 실패격리). **권고 = 1-b**(전역 에이전트와 프로젝트 에이전트의 실패가 서로를 막지 않게).
2. **sync API** (`src/app/api/agents/sync/route.ts`): 이미 `syncProjectAgents`를 **import만** 하고 L26은 `syncLocalAgents`만 호출 → 프로젝트 동기화도 함께 호출(또는 `?scope=project` 쿼리). 수동 "지금 동기화" 버튼이 프로젝트 에이전트도 잡게.
3. **부팅 1회**: scheduler 시작 시(`tickInterval` 등록부 인근) 최초 1회 `syncProjectAgents()` 즉시 실행 — 서버 재기동 후 갱신 지연 제거.

> 멱등성: 즉시(헬퍼) + 주기(서버)가 같은 row를 **(source,name) upsert**로 수렴 → 중복 row 불가(§4.3 계약 준수 전제). last-write-wins이되 보존 컬럼은 불변.

## 6. 데이터 흐름

```
[부트스트랩]  신규 git repo 첫 Claude 진입
   └ SessionStart hook → init-project.sh
        ├ CLAUDE/AGENTS/GEMINI.md + settings + 위키            (B-cycle 기존)
        ├ register-mc-project.js   → MC projects upsert         (C4 기존)
        ├ §3.6 킷 시딩            → .claude/agents/*.md 생성     (C4B 신규 ①)
        └ register-mc-agents.js    → MC agents upsert(즉시)      (C4B 신규 ②)
                                          │
[MC SQLite]  agents (source=claude-project:{repo}, display_name=NULL→name)
   ▲                                      │
   └ syncProjectAgents (주기+부팅)  ──────┘  (C4B 신규 ③, 보존 upsert로 수렴)
                                          │
[대시보드]  agents 화면 — Claude 그룹에 신규 프로젝트 작업자 표시 (C4 §2-d UI 재사용)
   └ task 생성: assignee=frontend-engineer, project=신규
        │
[relay]  c3_mc_to_hermes.js → claude --agent frontend-engineer (cwd=resolveRepoPath, C4 기존)
        → tasks.status=done + git diff --stat 로그
```

## 7. 미해결 / 결재 대기

1. **킷 역할 셋 확정** (§3.2): 6종 제안. 대표가 가감(예: ui-designer 포함? orchestrator 제외?). 역할별 `tools` 최소권한 표도 함께 결재.
2. **킷 본문 깊이**: 범용 골격만 vs 스택 추정(Next.js 등) 포함. 범용 권고(특화는 작성자 몫) — 결재.
3. **scheduler 주기 값**: `project_agent_sync` 간격(기존 `local_agent_sync`와 동일? 더 길게?). repo가 KNOWN_LOCAL 아니면 `~/c3-repos/{repo}` clone/pull 비용 → 주기 신중(§ relay와 pull 중복 주의).
4. **신규 프로젝트 repo 미연결 시**: `github_repo` 없는 프로젝트는 `source=claude-project:{repo}` 키가 안 만들어짐 → 로컬 경로 기반 fallback source 필요? (C4는 github_repo 전제) — 결재.
5. **킷 시딩 opt-out**: 일부 프로젝트는 기본 킷이 노이즈일 수 있음 → `.ai-bootstrap`에 skip 플래그(`.no-agent-kit`) 둘지 — 결재.

## 8. 검증 (E2E)

신규 임시 repo로:
1. 빈 git repo 생성 → Claude 첫 진입 → `init-project.sh` 발동.
2. `.claude/agents/`에 킷 N개 `.md` 생성 + `{{PROJECT_NAME}}` 치환 확인(①).
3. MC DB `agents`에 `source=claude-project:{repo}` N행 즉시 등록 확인(②). 멱등 재실행 침묵.
4. **계약 일치**: 서버 `syncProjectAgents` 1회 실행 후 동일 N행, content_hash diff 0(③·§4.3).
5. 대시보드 agents 화면에 신규 작업자 표시 → task assignee=킷 에이전트 → relay 실행 → done.
6. **신규 프로젝트가 손 안 대고 3층위 정합 성립** → C4B 입증.
7. 비파괴: 작성자가 미리 넣은 `.claude/agents/custom.md`가 있으면 킷 시딩 skip + custom 보존 확인.

## 9. 관련 참조
- [[2026-06-07-c4-agent-three-layer-alignment-design]] (C4 spec — 인프라 베이스)
- [[SESSION-HANDOFF-c4-t14-20260608]] (④B carry 출처)
- [[bootstrap-onboarding-message-20260607]] (B-cycle 스캐폴드 안내)
- 코드: `~/.ai-bootstrap/init-project.sh` / `register-mc-project.js` / `src/lib/local-agent-sync.ts`(scanProjectAgents L303·syncProjectAgents L357) / `src/lib/scheduler.ts`(L463) / `src/app/api/agents/sync/route.ts`
