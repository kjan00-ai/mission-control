# P2 — C6 증거 멀티프로젝트 확장 spec (label/trust/evidence/ready 프로젝트별 분리)

- **문서유형**: spec (구현 전 동결 대상, 동기 L2 대상)
- **작성일**: 2026-08-30
- **상위**: 자율화 완성 로드맵 범위 A(대표 2026-08-29) / P1 concordance [[2026-08-29-c6-concordance-evidence-spec]] / 메모리 [[autonomy-completion-program]]
- **대상(shared, maia-manifest)**: `c6-label.js`·`c6-trust.js`·`c6-evidence.js`·`c6-ready.js` 편집 + 신규 `c6-project.js`(+test). `c6-daily-batch.sh`(env-class, hermes) 편집. `register-mc-project.js` 재사용(ModuCare 등록·local_path backfill).
- **불변**: default-off·advisory·shadow·게이트 미변경. `decision-policy.json`·`c6-policy.json`·`risk-classify`·`policy-classify`(T3) **미접촉**.
- **⚠️ T3 자기보호 정정(실측 2026-08-30)**: `decision-policy.json` `gate-self-b-pipeline` glob=`**/.ai-bootstrap/{c6-activate,c6-ready,c6-evidence}.js` → **c6-evidence.js·c6-ready.js는 T3**(에이전트 자가편집 deny, 대표 `!`만). c6-label·c6-trust·c6-project·c6-concordance는 비보호(T2 자유편집). ⇒ P2 실행모델: 비보호 2파일+신규는 직접 편집, **c6-evidence/c6-ready는 staged 파일 완성 후 대표 `!` cp 적용**(A2 정석).

## 1. 문제 (실측)
증거 인프라 4파일이 프로젝트 인식이 없다. `--project`는 **출력 파일명/frontmatter만** 바꾸고 **입력은 전역 풀링**된다:
- `c6-label.js`: 입력=`~/.claude/projects/<slug>` 트랜스크립트(--project+cwd로 slug 유도 → 입력은 사실상 프로젝트별). BUT 출력 레코드 `modal-labels-*.jsonl`에 **project 스탬프 없음** → 하류가 분리 불가.
- `c6-trust.js`: 입력=`audit/risk-*.jsonl`(전역) + `modal-labels-*.jsonl`(전역). `--project`는 출력경로만. **완전 전역 풀링.**
- `c6-evidence.js`: 입력=`modal-labels-*.jsonl`(전역). state `batches`/`seenTuids` 전역. **완전 전역 풀링.**
- `c6-ready.js`: 입력=evidence ledger(전역 state) + `l2HealthFromBus`(전 review, **project_id 미필터**) + leak(전역). **완전 전역 풀링.**

결과: WSL 호스트에서 `.ai-bootstrap`·SF·MC 작업이 전부 `mission-control` 리포트 한 곳에 오염 병합. 프로젝트별 증거 볼륨(BC/SF/ModuCare)이 분리 축적되지 않음 → 로드맵 A의 "볼륨 확장" 미달.

## 2. 실측 재료
- 감사 레코드 `risk-*.jsonl` 키: `ts,tool,path,cmd,cwd,branch,reversible,cls,ruleId,decision` — **`cwd` 보유·`project` 없음.**
- 라벨 레코드 `modal-labels-*.jsonl` 키: `tuid,ts,tool,path,cmd,branch,cls,ruleId,humanLabel,c6,V,policy_version,sessionId,source` — **`cwd`·`project` 없음**(c6-label:102 레코드가 cwd 미보존).
- `projects` 테이블: General(1)·BC(2)·SF(3)·MC(5)·.ai-bootstrap(6). **`local_path`는 id=6만 채워짐**(나머지 null). ModuCare 미등록.
- repo-map `~/.c3-repo-map.json` `knownLocal`: BC→`/mnt/c/.../best-consulting-hp`, SF→`/mnt/d/Projects/Ai-Insight/StarFollow`(github_repo 키).
- 트랜스크립트 dir(이 WSL 호스트): `-home-bestconsulting`·`-home-bestconsulting-mission-control`·`-mnt-d-Projects-Ai-Insight-StarFollow`.
- `l2_reviews.project_id` 분포: null=74·BC=47·SF=9·MC=53(P1 concordance가 이미 사용).
- cron `c6-daily-batch`: `enabled:false·state:paused`(2026-08-29 대표 pause, 가역).

## 3. 설계 원칙
- **단일 귀속 메커니즘 = 해소된 project-roots 테이블에 대한 최장 prefix 매칭**(L2 `fc147f83`). SSOT는 `local_path` 단독이 아니라 **여러 소스(local_path ∪ repo-map ∪ 대체 호스트경로)에서 해소한 roots 테이블**. local_path/repo-map은 *소스*일 뿐 판정 메커니즘은 하나 → drift 없음.
- **프로젝트당 roots = 리스트(멀티루트)**(L2 `2b474f29`·`931e65a6`): 한 프로젝트가 여러 절대경로 root 보유 가능(예 BC `/mnt/c/.../best-consulting-hp` + `C:\Users\...\best-consulting-hp`). cross-host 경로변이를 **P2 내에서 닫음**(scope-dodge 아니라 격차 해소, "MAIA=글로벌" 불변법칙). 각 호스트는 자기 경로형으로 매칭.
- **fail-closed 귀속**: cwd가 어떤 root에도 매칭 안 되면 `unattributed`(특정 프로젝트에 절대 오귀속 금지). 안전측.
- **fail 검출(≠fail-soft 오인)**(L2 `334d9988`): roots **로드 자체가 실패**(DB/드라이버 오류)면 "안전한 no-op"이 아니라 **증거 누락 실패**다. helper는 `{ ok:false, reason }` 반환 → 호출자·daily-batch가 조용히 진행(unattributed/mission-control-only) 금지·**라우드 로그**. (DB *부재*=정상 무해 skip과 구분: 부재는 ok:true·roots:[].)
- **DB축 ⊥ cwd축 분리**(L2 `f0a893ea`): concordance·ready L2health는 `l2_reviews.project_id`(host 무관·항상 가용). name→project_id는 **roots 무관 직접 projects 조회**(root 없는 프로젝트도 DB축 증거 확보). cwd축(label/trust)만 roots에 의존.
- **환경 분리 인정**: 감사/트랜스크립트는 host-local(env-class). 각 호스트 daily-batch가 자기 호스트가 **실제로 볼 수 있는 root**(fs.existsSync)를 가진 프로젝트만 순회. Windows 네이티브 backfill은 여전히 그 호스트에서(멀티루트로 매칭은 양쪽 성립).
- **state 분리 = perProject 키드 단일 파일**(P1 concordance 선례 미러). 레거시 flat state는 전역오염이라 **마이그레이션 금지·무시**(fresh perProject). shadow+멱등+rolling 출력이라 재처리 무해.
- **Telegram 억제**: daily-batch 재개 선결. c6-evidence·c6-ready에 `--no-telegram`/`MAIA_C6_NO_TELEGRAM=1` 추가, daily-batch가 전달.

## 4. 신규 `c6-project.js` (귀속 helper, 순수+IO, fail-soft/fail-detect)
```
loadProjectRoots(db?) → { ok, roots, reason }
  roots = [{ id, name, slug, roots:[<정규화 절대경로 prefix>...] }]
  · MC DB projects(id,name,slug,local_path,github_repo) 조회(readonly).
  · 각 프로젝트 roots 취합(소스, 중복제거): local_path + repo-map knownLocal[github_repo]
    + 알려진 대체 호스트경로(있으면; 예 BC /mnt/c ↔ C:\). 빈 root/root無 프로젝트(General) 제외.
  · 정규화: path.resolve + 후행 sep 제거.
  · DB 부재 → { ok:true, roots:[], reason:'no-db' }         // 정상 무해(모두 unattributed)
  · 드라이버 없음/open·query 오류 → { ok:false, roots:[], reason } // ★fail 검출(호출자 라우드 처리)
projectOf(cwd, roots) → { id, name } | null
  · cwd 정규화 후 전 roots 중 **최장 prefix**(root+sep 또는 정확일치) 매칭. 다중매칭=최장 root 승.
  · 매칭 없으면 null(=unattributed). cwd falsy=null.
keyOf(match) → match ? match.name : 'unattributed'
projectIdByName(db, name) → number | null     // ★roots 무관 직접 조회(DB축). name/slug 매칭. Number 강제.
```
- **경계 정확성**: prefix 매칭은 `cwd === root || cwd.startsWith(root + path.sep)`(부분 디렉토리명 오매칭 방지, 예 `/a/mc` vs `/a/mc-2`).
- **fail-soft vs fail-detect**: DB *부재*=ok:true·빈 roots(무해). 드라이버/쿼리 *오류*=ok:false(호출자가 WARN+skip, 오귀속 방출 금지).
- 순수부(`projectOf`,`keyOf`) 테스트 주입, IO부(`loadProjectRoots`,`projectIdByName`) 별도.

## 5. 파일별 변경

### 5.1 c6-label.js — 레코드에 project 스탬프(cwd 유도)
- reconcile: `uses.set`에 이미 `cwd` 보유(:73). 레코드에 `project: keyOf(projectOf(u.cwd, roots))` 추가(:102 records.push). roots는 opts로 주입(테스트 가능), main에서 `loadProjectRoots()` 1회.
- **per-op cwd 귀속**(run의 --project 아님): 세션이 복수 root 접촉 시 각 op가 실제 cwd 프로젝트로 귀속(하류 정확 필터). foreign-cwd op는 실제 프로젝트로 스탬프되어 공유 스트림에 append(전역 seenTuids dedup으로 중복 append 없음).
- **리포트 필터**: renderLabels/aggregateLabels는 `records.filter(r => r.project === runProject)`만 집계(--project 리포트 순수성). modal-labels 스트림 append는 전건(스탬프됨).
- state `c6-label.json` = flat `{seenTuids}` 유지(tuid 전역 유일 → 분리 불요, 첫 per-project run 재append 억제).
- 하위호환: 기존 modal-labels 레코드는 `project` 없음 → 하류에서 `unattributed` 취급.

### 5.2 c6-trust.js — risk 레코드 cwd 귀속 + 필터 + **누적 rolling**(watermark 제거)
- enrich: risk 레코드 `r.cwd` → `project = keyOf(projectOf(r.cwd, roots))` 부착.
- 필터: `--project X`면 `project===X`인 op만 aggregate. `--all`이면 프로젝트별 순회(각각 리포트).
- modal-labels join: 레코드 `project===X`만 aggregateLabels(스탬프 없는 레거시=unattributed 제외).
- **누적 재계산·무상태화**(L2 `6079d89f`): 기존 `lastTs`/`doneOps` watermark **제거** → 매 실행 그 프로젝트의 전 risk 레코드를 재집계(op는 run 내 `opId` Set으로 dedup). 표본 작아 재계산 무해·멱등.
- **출력 = rolling overwrite `C6-TRUST-<project>.md`**(dated 파일 증식 폐지). label/evidence/ready/concordance 회전 규약과 일치. atomicWrite(temp+rename). → **c6-trust state 파일 불요**(순수 리포트화; 기존 `c6-trust.json`은 무시).

### 5.3 c6-evidence.js — modal-labels project 필터 + perProject batches
- default(cron) 경로: modal-labels 로드 후 `records.filter(r => (r.project||'unattributed') === runProject)`. formBatch는 필터된 레코드만.
- state `c6-evidence.json` = `{ perProject: { <proj>: { batches, seenTuids } }, _v:2 }`. 레거시 flat(top-level batches/seenTuids) 무시·fresh.
- **락/원자성 명시**(L2 `50c5057c`): 기존 **글로벌 `withLock`(state/c6-evidence.lock hard-link) + `writeAtomic`(temp+rename) 유지**. perProject RMW는 **락 내부에서 전체파일 read → `perProject[runProject]` 서브트리 변이 → 전체파일 원자 write**. 글로벌 락이 프로젝트 간·병렬 실행을 직렬화 → lost-update 없음(daily-batch도 serial 루프). 서브트리 부분편집이 아님을 명시.
- `--ack`/`--show`/`--list`: `--project` 스코프의 서브트리 대상(ack CTA에 project 포함). batchId content-addressed 유지(프로젝트 내 tuid).
- writeDigest: 프로젝트별(기존 outDir 이미 `projects/<project>/evidence` rolling — 유지). Telegram=`--no-telegram` 억제 가능.

### 5.4 c6-ready.js — l2Health project_id 필터 + evidence perProject 소비
- `l2HealthFromBus(reviews, ..., projectId)`: reviews를 `Number(r.project_id)===Number(projectId)`로 필터(신규 인자·**타입 강제**, L2 `d17fbe93`). readBus가 `project_id` SELECT 추가(:151).
- **name→id = `projectIdByName(db, project)` 직접 조회**(L2 `f0a893ea`, roots 무관). root 없는 프로젝트도 DB축 health 확보. **name-not-found → WARN + fail-closed**(projectId=null → 해당 프로젝트 review 0 → honestTotal 0 → not-ready, 조용한 제외 아님·로그 명시).
- computeReadiness: evidence ledger를 `c6-evidence.json.perProject[project].batches`에서 로드(전역 batches 아님). leak=전역 유지(진입점4 harvest, 프로젝트 축 P3 이연 — 명시).
- decideReady/게이트 로직 **불변**(T3 미접촉). 출력 `projects/<project>/eligibility/C6-READY-<project>.md` rolling 유지. Telegram=`--no-telegram` 억제.
- ⚠️ project_id 없는(null) review는 특정 프로젝트 health에서 제외(unattributed는 게이트 미산입, fail-closed).

### 5.5 c6-daily-batch.sh — 프로젝트 순회 루프
- 프로젝트 목록: `c6-project.js --list-visible`(신규 서브커맨드) = `loadProjectRoots` 결과 중 **이 호스트에서 root 하나라도 `fs.existsSync`인 active 프로젝트 name 배열**(local_path 유무 아니라 실제 가시성, L2 `931e65a6`).
- **fail 검출**(L2 `334d9988`): roots 로드가 `ok:false`면 프로젝트 목록 대신 **`[ATTRIBUTION-FAIL] reason` 라우드 로그 + last_error 노출**(cron `last_status`) → mission-control-only 조용한 진행 금지. `ok:true·빈 목록`(가시 프로젝트 0)=정상 skip.
- 각 프로젝트마다 label→evidence→trust→ready 실행(`--project <name> --no-telegram`). rollback/digest/leak은 전역 유지(프로젝트 축 P3 이연 — 주석 명시).
- **unattributed 가시성**(L2 `db541482` suggest): 각 tool이 unattributed 카운트를 stdout에 출력, batch 로그에 집계 → 운영자가 root 매핑 갭 인지.
- Telegram 전면 억제(`--no-telegram`) — 재개 선결. 로그만.

### 5.6 ModuCare 등록 + local_path/멀티루트 backfill
- `register-mc-project.js ModuCare "" /mnt/d/Projects/Ai-Insight/ModuCare`(github_repo 없음). 기존 backfill 로직이 빈 local_path만 채움(멱등).
- backfill(각 빈 local_path만): MC=`/home/bestconsulting/mission-control`, SF=`/mnt/d/Projects/Ai-Insight/StarFollow`, **BC=`/mnt/c/Users/user/OneDrive/Documents/Projects/Ai-Insight/best-consulting-hp`**(repo-map WSL 경로 — BC 포함, L2 `2b474f29`).
- **멀티루트 대체경로**: `local_path`는 단일 컬럼이라 호스트별 대체형(BC `C:\...`)을 담을 수 없음 → `c6-project.js`가 **repo-map + 알려진 대체경로 규칙**으로 프로젝트당 roots 리스트를 합성(§4). DB backfill=1차 root, 대체=helper 합성. (스키마 변경 없이 멀티루트 달성.)
- **resume는 대표 결정**(대표가 "무의미"로 pause). Telegram 억제 구현 후 대표께 "재개할까요?" 제시(자동 resume 금지).

## 6. 검증
- 단위 `c6-project.test.js`: 최장 prefix·경계(`/a/mc` vs `/a/mc-2`)·다중매칭·null cwd·빈 roots(fail-soft)·정규화(후행 sep).
- 각 4파일 test 확장: project 스탬프·필터(타 프로젝트 op 제외)·perProject state 분리(A 처리가 B 미오염)·레거시 flat 무시·unattributed 버킷.
- 실측: 실 audit/트랜스크립트로 MC vs SF 리포트 분리 sanity(교차 오염 0). concordance(P1) 프로젝트별 숫자와 정합.
- maia-deploy `--check` 0 drift·0 unclassified.

## 7. 게이트/가역성
- 4파일+신규=shared(maia-manifest 등재). T3 파일 미접촉(귀속·필터·표출만) → 대표 `!` 편집 불요.
- default-off·advisory·shadow 유지 = 무해(리포트 분리·볼륨 축적만). 가역(state·리포트 삭제, daily-batch 재-pause).
- 커밋=ai-bootstrap T2·MC docs T2·push=대표 `!`. resume=대표 결정.

## 8. 범위 밖 (P3/P4 이연)
- concordance/evidence를 게이트에 배선(활성화)·per-rule 승격 — 증거 성숙 후 대표 결재.
- leak/rollback/digest 프로젝트 축.
- 공용 `c6-verdict.js` 추출(판정로직 복제 통합) — P3에서 c6-ready 손댈 때.
- ※ cross-host BC 경로변이는 §4 멀티루트로 **P2 내 해소**(더 이상 이연 아님). 잔여=Windows 호스트에서의 DB backfill 실행(감사는 host-local이라 각 호스트 daily-batch가 자기 audit 산정, 매칭은 멀티루트로 양쪽 성립).

## L2 검증 이력 (codex ∥ gemini, 2026-08-30)
> 원장 `2026-08-30-c6-p2-multiproject-evidence-spec-l2-aggregation-20260830-032148`(+deepen-r2). round1 codex 6·gemini 3 → canonical 9, deepen 7 **전건 settled(corroborated)**, blocker 0. evidenceEligible=false(폴백 transport, informed).
- `fc147f83`: 이중 SSOT → 귀속 SSOT를 "해소된 roots 테이블"로 재정의(local_path/repo-map=소스, 메커니즘=최장 prefix 단일).
- `2b474f29`+`931e65a6`: BC/cross-host 제외 → 프로젝트당 **멀티루트 리스트**로 P2 내 해소 + daily-batch는 fs.existsSync 가시성 기준 순회(BC 포함).
- `334d9988`: DB 오류 조용한 진행 → `loadProjectRoots {ok,reason}` + daily-batch `[ATTRIBUTION-FAIL]` 라우드 검출(부재≠오류 구분).
- `f0a893ea`+`d17fbe93`: ready name→id의 roots 의존·타입 → `projectIdByName` 직접조회(DB축 분리) + `Number()` 강제 + not-found fail-closed 로그.
- `50c5057c`: evidence lost-update → 기존 글로벌 withLock+atomicWrite가 perProject 전체파일 RMW 감쌈을 명시.
- `6079d89f`: trust dated 파일 증식 → 누적 rolling overwrite `C6-TRUST-<project>.md`(watermark 제거·무상태).
- `db541482`(suggest): unattributed 운영부담 → 카운트 stdout/로그 표출로 갭 가시화.
