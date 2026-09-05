# C5-2 — L2 Durable Bus (L2 검증결과 파일 → MC task DB 승격) 설계

> MAIA L2 교차검증(Codex ∥ Gemini) 결과를 위키 마크다운 단독 저장에서 **MC task DB의 구조화 테이블(`l2_reviews`/`l2_rounds`)로 승격**한다. 위키 md는 §1.1대로 사람이 읽는 SSOT로 유지하고, DB는 그 옆에 얹는 **감사·재현·합의/거부권 신호의 저장층**이다.
>
> - 날짜: 2026-06-13 / 작성: claude / 버전: **v1.0 (L2 codex∥gemini 반영 — 6 corroborated 전건 해소, 1 escalation 설계반영)**
> - L2 검토: [[2026-06-13-c5-2-l2-durable-bus-design-l2-aggregation-20260613-170235]] (round1) → [[2026-06-13-c5-2-l2-durable-bus-design-l2-deepen-r2-20260613-170235]] (round2)
> - 선행: [[2026-06-11-c5-1a-l2-loop-engine-plan]] (l2-loop 엔진) · C5-1b (자동발동·output-dedup)
> - 후속: C5-2b (UI 패널) · C6 (거부권/합의 *집행* — 본 작업은 저장+읽기까지)
> - 범위: mission-control repo(migration·읽기 API·CLI) + `~/.ai-bootstrap`(writer, wslOnly) + `maia-manifest.json`
> - SSOT: 코드/spec=이 repo, 지식/결정=위키 + 위키링크

---

## 0. 문제 정의

현재 L2 결과는 `l2-loop.js`(WSL 전용)가 위키 `reviews/*.md`에만 기록한다. 사람이 읽기엔 충분하나 **구조화 쿼리·감사·재현·합의신호 추출**의 기반이 없다:

- "C6 spec이 받은 최종 verdict는?" → md를 일일이 열어야 함.
- "최근 7일 escalation 몇 건?" / "이 artifact의 blocker가 양 reviewer 합의인가?" → 집계 불가.
- C6(Verification over Approval)가 소비할 **거부권/합의 신호의 durable 저장층**이 없음.

→ L2 run을 **두 테이블로 승격**해 쿼리·감사·재현을 가능케 한다. (거부권 *집행* 게이트는 C6.)

---

## 1. 설계 결정

- **쓰기 경로 = MC DB 직접 INSERT** (서버 API POST 아님). 선례 `~/.ai-bootstrap/register-mc-agents.js`가 이미 MC DB를 직접 upsert(`MC_DB`/`MISSION_CONTROL_DATA_DIR` 해석 + `busy_timeout` + WAL 동시성). l2-loop은 background Stop 훅에서도 돌기에 **서버 가용성 비의존** 직접쓰기가 견고. fail-soft(쓰기 실패가 L2 흐름을 절대 깨지 않음).
- **읽기 경로 = API + CLI** (headless 우선). UI 패널 = C5-2b 이연.
- **테이블 2개**. 개별 canonical item은 `l2_rounds.canonical_items`에 JSON 저장(`json_extract` 쿼리 가능). 완전 정규화(`l2_items`)는 필요 시 후속.
- **드리프트 가드**: writer는 INSERT 전 `PRAGMA table_info`로 필수 컬럼 확인, 없으면 fail-soft + LOUD 로그. migration(repo)이 스키마 SSOT.
- **기록 단위 = 완료된 run 1회**. l2-loop `main()` 끝에서 전체 round를 단일 트랜잭션으로 1회 기록(부분 run은 위키에만 — MVP). 크래시 시 위키에 partial 잔존, DB는 settled run만.

---

## 2. 데이터 모델 (migration 054 `054_l2_durable_bus`)

### `l2_reviews` — L2 run 1건당 1행
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK | |
| artifact | TEXT NOT NULL | slug |
| artifact_ref | TEXT | 위키링크/repo 경로 |
| project_id | INTEGER | nullable FK projects(id) |
| task_id | INTEGER | nullable FK tasks(id) |
| trigger | TEXT NOT NULL DEFAULT 'manual' | manual \| auto |
| final_verdict | TEXT | pass \| deepen-settled \| escalation \| 수정필요 |
| status | TEXT NOT NULL DEFAULT 'settled' | settled \| escalation \| pass (coarse) |
| rounds_count | INTEGER NOT NULL DEFAULT 1 | |
| blocker_count / important_count / escalation_count | INTEGER NOT NULL DEFAULT 0 | 집계 denorm |
| content_hash | TEXT | dedup (auto-L2 hash 동일 키) |
| agg_ref | TEXT | 위키 aggregation md 백링크 |
| reviewers | TEXT | JSON 배열 |
| metadata | TEXT | JSON |
| workspace_id | INTEGER NOT NULL DEFAULT 1 | |
| created_at | INTEGER NOT NULL DEFAULT (unixepoch()) | |
| completed_at | INTEGER | |

인덱스: `(artifact)`, `(content_hash)`, `(status)`, `(created_at)`, `(project_id)`.

### `l2_rounds` — review 내 round 1건당 1행
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK | |
| review_id | INTEGER NOT NULL | REFERENCES l2_reviews(id) ON DELETE CASCADE |
| round | INTEGER NOT NULL | |
| kind | TEXT NOT NULL DEFAULT 'initial' | initial \| deepen |
| reviewers | TEXT | JSON 배열 |
| overall_verdict | TEXT | 이 round 집계 verdict |
| canonical_items | TEXT | JSON: [{canonical_item_id,severity,claim,consensus,reviewers,evidence_refs}] |
| settled_count / deepen_count / escalate_count | INTEGER NOT NULL DEFAULT 0 | |
| parser_fails | TEXT | JSON 배열 |
| raw_refs | TEXT | JSON 배열(위키 raw md 링크) |
| agg_ref | TEXT | 이 round 위키 aggregation md |
| workspace_id | INTEGER NOT NULL DEFAULT 1 | |
| created_at | INTEGER NOT NULL DEFAULT (unixepoch()) | |

인덱스: `(review_id)`, `(round)`.

---

## 3. 컴포넌트

### repo (mission-control)
1. `src/lib/migrations.ts` — `054_l2_durable_bus` (053 스타일: 멱등 `IF NOT EXISTS`).
2. `src/app/api/l2-reviews/route.ts` — GET 목록(필터 artifact/project_id/status/limit). `requireRole('viewer')`+`requireWorkspaceId`+`db.prepare` (선례 `src/app/api/tasks/route.ts`). 읽기 전용.
3. `src/app/api/l2-reviews/[id]/route.ts` — GET 단건 + `l2_rounds` 조인.
4. `scripts/mc-cli.cjs` — `l2 list` / `l2 get --id N`.
5. `src/lib/__tests__/l2-bus.test.ts` — 테이블 생성/라운드트립/드리프트/CASCADE.

### MAIA shared (`~/.ai-bootstrap`, wslOnly)
6. `l2-db-writer.js` (신규) — `writeReview({...})`. DB 경로·busy_timeout은 `register-mc-agents.js` 미러. review+rounds 단일 트랜잭션 INSERT. `PRAGMA table_info` 드리프트 체크. 전부 fail-soft.
7. `l2-loop.js` — `main()` 끝(`writeDoneMarker` 직후) round 수집 → writer try/catch 1회. `MAIA_L2_BUS_OFF=1` 끄기.
8. `l2-db-writer.test.js` (신규) — 임시 DB DDL 적용 후 insert/read·fail-soft 검증.
9. `maia-manifest.json` — `l2-db-writer.js` wslOnly 등재 → `maia-deploy.js`.

---

## 4. 검증

- repo: `pnpm test l2-bus` / `pnpm typecheck` / `pnpm lint` / 회귀 `pnpm test`(gnap-sync 8 fail=기존 환경요인 무시).
- writer: `node ~/.ai-bootstrap/l2-db-writer.test.js`.
- E2E: mock l2-loop → `l2_reviews`/`l2_rounds` 행 생성 확인 → `pnpm mc l2 list/get`.
- 드리프트: `maia-deploy.js --check` (분기 0).

---

## 5. L2 검증 반영 (codex ∥ gemini, 2026-06-13)

round1 9 canonical(blocker 2·important 5·suggest 2) → round2 대질: **6 corroborated + 1 escalation**. 전건 설계·구현 반영:

| id | sev | 지적 | 해소 |
|---|---|---|---|
| `be274c5c` | blocker | 멱등성 부재 → 중복 승격 | `run_key`(=aggName, run당 고유) UNIQUE 인덱스 + writer `ON CONFLICT DO NOTHING` / completeReview 재실행 시 rounds 교체 |
| `89da0e80` | blocker | fail-soft 조용한 누락 → 신뢰 불가 | **2단계 기록(running→completed)**: begin 이 'running' 행을 남겨 크래시·실패 run 도 관측됨 + 모든 skip/error 를 audit jsonl 기록 |
| `c6f10495` | important | writer가 workspace 우회, 기본값 1 | `resolveProject`: 프로젝트명/slug → projects 행의 `workspace_id`·`project_id` 귀속 |
| `d02d9ed8` | important | status/verdict 매핑 모순 | `deriveStatus` 명시: escalation>0→escalation / pass→pass / 그 외→settled. running=미완료 |
| `5f29d5d8` | important | JSON 합의/거부권 쿼리 취약 | `consensus_blocker_count`(reviewers≥2 blocker) 헤드라인 denorm. item 상세는 JSON. l2_items 정규화 이연(현 규모 불요) |
| `069fa0a9` | important | project_id/task_id 추출전략 누락 | writer가 project 명으로 projects 조회 → project_id 해석. task_id=artifact-driven run 은 null(문서화) |
| `9ed46ff5` | important(esc) | pending/running 상태 부재 | 2단계 기록의 'running' 행으로 진행상태 가시화. 중복발동 방지는 l2-loop **lock + auto-L2 hash-dedup**이 이미 담당(상류) |

검증: writer 유닛 13/13 · repo migration 8/8(드리프트 가드 포함) · E2E(mock l2-loop→DB 2-round 행 생성, status 승격 확인).

## 6. 범위 밖 (후속)

- UI 패널(L2 타임라인) = C5-2b.
- 거부권/합의 *집행* 게이트 = C6.
- `l2_items` 완전 정규화 = 필요 시(현 규모에선 denorm + JSON 충분).
