# Verified Autonomy — Gate Redesign Spec (2026-07-03, v6 — 설계 동결)

> **한 줄**: 인간 게이트를 "모든 가역 작업 앞"에서 "비가역 전이 앞"으로 옮기고, 사전승인 대신 **근거기록(사전 스냅샷) + 필수·블로킹 검증(에이전트가 수행) + 가역 폴백**으로 안전을 담보한다.
> 대표 지시 4건 수렴(2026-07-03): ①시간절약([[maia-founding-purpose-save-owner-time]]) ②T2 형식모달→근거·검증·폴백([[t2-modal-formal-replace-with-evidence-verify-fallback]]) ③선택지 사전검증([[verify-decision-options-before-asking-owner]]) ④L2 강제·재시도·fail-closed([[l2-verification-mandatory-no-skip-retry-failclosed]]).
> **자기수정 보호 대상 정본(canonical, §1·§2·§4 전부 이 목록 참조)**: `~/.ai-bootstrap/decision-policy.json` · `~/.ai-bootstrap/c6-policy.json` · `~/.ai-bootstrap/risk-classify.js` · `~/.ai-bootstrap/policy-classify.js` · `~/.ai-bootstrap/maia-manifest.json` · `~/.ai-bootstrap/hooks/*`(+ 배포본 `~/.claude/hooks/*`). 편집=A2 owner-only T3 → 최종 diff 대표 결재.

## 0. 문제 (실측 근거)
- **T2 24건**. 대표가 만나는 대부분은 **highRiskPaths 파일 편집**(auth·scheduler·relay·i18n·lockfile·pkgjson·migrations·generated…). git 추적 편집은 되돌릴 수 있는데도 사전 모달 → 실질 99.9% Yes = 형식적 마찰.
- **검증 강제 부재**: Stop훅 `post-task-l2.js`=264B 심(`catch(e){process.exit(0)}`)=fail-open 비블로킹. 재시도 엔진은 견고(`l2-loop.js` `L2_MAX_ATTEMPTS=3`+backoff, terminal/transient, per-key 폴오버, 미검증=fail-closed 라벨 L640-642) — **갭은 엔진이 아니라 에이전트 강제**.

## 1. 원칙 — 가역성 경계로 게이트 이동

**가역(REVERSIBLE)** = git 추적 파일에 대한 **Edit/Write 도구** 편집이며 **편집 전 blob(pre-image)을 사전 확보**해 원상복구할 수 있는 경우. → `allow + 근거기록 + 필수 검증 + 가역 폴백`.
- ⚠️ **대상 도구 명시(L2 `151bb836`)** = `{Edit, Write, MultiEdit, NotebookEdit}` (PreToolUse가 tool_name으로 판정·대상 파일 사전 스냅샷). **Bash/exec의 파일 쓰기(리다이렉트·tee·sed -i·스크립트)는 다운그레이드 비대상** — 임의 명령효과 사전스냅샷 불가 → 기존 명령규칙 게이트 유지(L2 `4ff37595`, exec 우회 차단).
- ⚠️ **secret-code 경로는 가역 다운그레이드 비대상(L2 `056e31b7`)** — 민감내용 pre-image 저장 딜레마 회피 위해 **기존 T2 게이트 유지**(secret 파일 자체는 DENY). **정본 판정 = `decision-policy.json` highRiskPaths `secret-code` glob**(예: `**/auth/**`·`**/*secret*`·`**/*credential*`·`**/crypto/**`) — 범위 SSOT는 정책 rule(L2 `596fe58c`).
- ⚠️ "완전 가역"은 과장(L2 `222e20db`). **가역 판정·복구는 파일 단위 pre-image blob**로 정의(commit revert 아님 — 편집이 미커밋일 수 있음). 다중파일 편집은 **파일별 독립 pre-image**(교차 트랜잭션 가정 안 함). **사용자 미커밋 변경과 혼재** 시: pre-image는 편집 직전 파일 blob을 저장하고, 폴백은 그 파일을 pre-image로 복원하되 **직전 이후 외부 변경 감지 시 자동복원 중단→대표 알림**(사용자 변경 덮어쓰기 금지). git 미추적 신규파일·불명은 **가역 아님→기존 T2 유지**(fail-safe).

**비가역/자기수정(IRREVERSIBLE)** = 게이트 유지:
| 분류 | 해당 | 등급 |
|---|---|---|
| 자기수정(안전장치) | 정본 목록(상단 frontmatter) | **A2 owner-only T3** |
| 외부발신 / secret 파일 | external-send·secret-exfil / secret-file(.env·id_rsa) | DENY |
| 파괴적 시스템·이력 | rm-rf, fs-destructive, git-destructive, pipe-to-shell, shell-rc-write | DENY |
| 상태변경 실행 | pkg-install, migration(실행), sudo, eval, remote-run(npx/dlx) | T2 |
| 원격반영 | push (force/delete/tag=DENY) | T3 |
| process-kill | kill·pkill·killall(순간다운·비관리 프로세스 손실) | T2 |

**infra 세분(L2 `5f4b743f` — "안전기본값" 모호 제거)**:
- **DENY/T3(비가역·파괴)**: `terraform apply`·`ansible-playbook`·`kubectl delete`·`docker rm/rmi/system prune`·`crontab -r`
- **T2(상태변경·경계)**: `systemctl stop/disable`·`docker run`·`kubectl apply`
- **allow(읽기전용만)**: `systemctl status|is-active`·`docker ps/logs`·`kubectl get/logs`
- **verify-게이트(반영점, L2 `9da74f76`·`7c47d17f`)**: `systemctl restart|reload|start <서비스>` — 온디스크 코드를 운영에 싣는 반영점이라 allow 아님, push/배포와 동급 게이트

**경계 판정(실측)**: `interactive`(vi·less·tail -f·npm dev·REPL)는 가역성 문제가 아니라 **헤드리스 교착 방지 liveness 가드** → 재설계 범위 외(가드 유지, 에이전트가 배경실행/회피).

## 2. 3대 안전장치

### 2.1 근거 원장 (evidence) — 사전 확보·fail-closed (L2 `b34d0592`)
- **PreToolUse 훅이 편집 *전* pre-image를 저장**하고, **저장 실패 시 편집 차단**(fail-closed) — evidence 없는 allow-with-evidence 원천 차단.
- PostToolUse는 사후 상태(post-SHA·diff·commit SHA·task 맥락)만 append. PostToolUse 실패해도 pre-image가 있어 폴백 가능.
- **secret 취급(L2 `50f31036`·`0f99ffca`)**: 원장 디렉토리 접근제한(perm 700/파일 600). secret 파일=DENY·secret-code=비다운그레이드(§1)라 **pre-image가 민감경로를 애초에 피함** → 복구충돌 원천제거. **pre-image는 원본 그대로 저장(마스킹 금지)** — 마스킹하면 복원 blob이 원본과 달라져 byte-exact 폴백 불가(L2 `0f99ffca`).
- **라이프사이클(L2 `1f98012d`·`855b6127`)**: pre-image는 **async 검증 통과 후** '+N일' 또는 후속 commit 대체 시 prune — **검증 미완/실패 동안은 반드시 보존**(폴백 보장). git 장기보관 인수는 검증통과 코드에만. 무한증가 방지(보존창 정책값).

### 2.2 필수·블로킹 검증 (verify) — 에이전트 강제 (대표 부담 아님)
- **핵심 오해 제거(L2 `2924907f`)**: 블로킹 대상은 **에이전트(claude)** 이지 대표가 아니다. 에이전트가 동기 L2를 돌리고 **blocker를 자율 반영**한 뒤, 대표는 **결과 + 최종 diff만** 본다. 대표 검토부담 증가 없음.
- **대상 좁힘**: `verifyRequiredPaths` = **결과에 영향 주는 산출물만** — `docs/multiagent/{plans,specs}/**`·`decisions/**` + T2+ 의사결정. **handoffs·log·_index·중간노트는 제외**(초안 반복도 비대상, 확정/commit 시점만).
- **run_key 바인딩(L2 `1f5d9972` blocker)**: verified 원장은 **(산출물 content-hash + commit 대상 SHA/diff-hash)에 바인딩**. 게이트 통과 조건 = ①현재 content-hash와 일치하는 verified 레코드 존재 AND ②verdict∈{settled,pass}(unverified/parser_fail/terminal 불가). **commit 순간 content-hash 재산정(check-and-commit 원자)** — 검증 후 변경분은 불일치로 차단(L2 `8ee26160` TOCTOU). stale·타 산출물·미검증 레코드 불일치→차단.
- **실행경로 정직 스코핑(L2 `99999429`·`873db022`·`fae387bb`)**: 블로킹 게이트는 **의사결정 산출물의 확정(commit)** 을 막는다. **"로컬 실행을 막는다"고 과장하지 않는다.** 가역 highRisk 코드는 async 검증 + **반영점(push/배포/install·migration·`systemctl restart|reload`)이 verify-게이트** — 반영점은 온디스크 코드를 운영에 싣는 지점이라 그 코드의 async 검증 pass를 요구(미검증 반영 차단, L2 `9da74f76`·`7c47d17f`·`c55903d2` 확정해소). `systemctl status|is-active`(읽기)만 allow. **자기 관리 서비스 화이트리스트(L2 `58c7a69a`)** — MC: `hermes-gateway·mission-control·cloudflared-c3`; 목록 밖 서비스는 T2.
- **코드 async 검증 계약(L2 `64832e0d` blocker — 측정가능 정의)**: **대상**=가역 highRisk 코드(reversibleClass 경로). **방법**=commit 후 async `l2-loop`(변경 diff). **합격**=verdict∈{settled,pass}. **원장키**=대상경로 상태에 바인딩(commit SHA + diff-hash). **만료**=후속 commit이 그 경로를 바꾸면 이전 원장을 HEAD 기준으로 대체. **push/배포 게이트 통과 조건 = 대상경로의 현재 HEAD net 상태가 합격 원장 보유**(개별 과거 commit 전수 아님 → 수정 commit 있는 정상 브랜치 영구차단 회피, L2 `021457c4`). 미검증·불합격이면 비가역 반영 차단. 검증 전 로컬 실행/테스트 오염은 **가역·evidence·async검증으로 경계된 수용 리스크**로 명시하고, **파생 의사결정 산출물은 §2.2로 재검증**.
- **재시도·fail-closed + break-glass(L2 `f28c7225`)**: 검증자 실패 시 엔진 재시도(3회, 기존). 소진 후:
  - **가역·비핵심 산출물** → 하드블록 아닌 **UNVERIFIED-LOGGED(정직 라벨, advisory)로 진행 허용** — 통과 위장 금지, 교착 회피(가역+폴백이 안전판).
  - **비가역·핵심(정책/보안/배포)** → 차단 유지 + **대표 break-glass**(L2 `52d2d1f9` 남용가드): **대표 `!` 명시 오버라이드가 해당 호출 1건에만 적용**(호출단위 단회, 시스템 상시 bypass 아님 — L2 `d42f9b0f` 문구명확화), owner `!`는 A2상 훅 미경유. **감사기록 주체(L2 `9d034f26`)** = 훅이 아니라 **세션 트랜스크립트 + 상시 감사싱크**(우회 경로에서도 남는 채널)에 주체·시각·대상·사유·해제게이트 기록. **감사싱크 기록 실패 시 break-glass 거부(fail-closed) — 무감사 우회 금지(L2 `2700292d`)**. 골든테스트로 회귀가드. 무기한 교착 없음.

### 2.3 가역 폴백 (fallback)
- 사후검증 결함 발견 → **대표 알림 + 원클릭/제안 revert = pre-image blob 복원**(§1). **헤드리스 자동 revert 금지**. 미커밋 사용자 변경 감지 시 자동복원 중단.
- **알림 등급(L2 `eb0c7a9f` — 피로 방지)**: 대표 Telegram은 **BLOCKER·terminal 검증실패·고위험경로 사후결함만**. "고위험 우선순위" = 정본 자기수정 목록 + `auth·secret-code·scheduler` 서브셋(명시). 그 외는 배치/억제.

## 3. 전역 적용 + 프로젝트별 상향
- 전역 SSOT → 모든 프로젝트. WSL canonical 편집→`maia-deploy` 동기(C5-2b).
- **상향 override 실측**: `risk-classify.js:264-284` — pathOverrides가 매칭 경로 클래스 무조건 설정→base→escalator만 상향. **경로 상향은 기계적으로 이미 작동**(BC `src/lib/auth/**`→T3). denylist는 override 불가(절대선). **단 현재 회귀가드(테스트) 없음 = 미테스트 상태**(작동≠검증완료, L2 `bb173a3c`).
- **액션**: (i) BC·SF **엄격 프로파일**(`.maia/risk-override.json`) 동봉, (ii) **골든 테스트 신규 추가로 상향 동작 잠금**(현재 미존재→구현 시 추가), (iii) 문서상 지원 승격.

## 4. 구현 (파일별 · 전부 A2 T3 → 대표 diff 결재)
- `risk-classify.js`: **가역성 입력**(PreToolUse가 git 추적 여부 산정·주입) → highRiskPaths 신규 `reversibleClass` 채택 vs 기존 `class`. 명령규칙·denylist 불변.
- `decision-policy.json`: highRiskPaths에 `reversibleClass`, 신규 `verifyRequiredPaths`(좁힘), infra 세분 규칙, 신규 decision `allow-with-evidence`, 정책·훅 `version` 필드.
- `~/.ai-bootstrap/hooks/`: (i) **PreToolUse**: 가역성 산정 + **pre-image 사전저장(실패=차단)**, (ii) 의사결정 산출물 commit 시 **run_key content-hash 바인딩 verified 원장 요구 블로킹 게이트**, (iii) PostToolUse exec instrumentation 배선.
- 골든 테스트(CI 회귀가드): 상향 override·가역 다운그레이드·verify 블로킹(content-hash 불일치 차단)·pre-image 실패 차단·denylist 불변·break-glass.
- `maia-manifest.json`: 신규 shared 등재.

## 5. 리스크·롤백
- **가역성 오판**: 추적+확인 경로만 가역, 불명=T2 유지(fail-safe).
- **verify 교착**: 재시도·per-key 폴오버·break-glass·가역은 advisory 진행(§2.2)로 무기한 블록 회피.
- **전역 완화 파급**: 프로젝트 상향 프로파일 + denylist 절대선.
- **부분배포·버전 스큐(L2 `dee94990`)**: 정책·훅 `version` 상호검증 — 분류기가 **불일치 시 fail-closed(기존 보수 등급 유지)+Telegram**. `maia-deploy` md5 매니페스트 대조(기존 maia-health) + 드라이런.
- **롤백**: 정책=데이터 파일 → 이전 `decision-policy.json`/훅 revert 1회. **각 메커니즘 default-off 토글**(가역 다운그레이드·verify게이트·break-glass 개별) 단계 활성.

## 6. 검증 (이 spec 자체) — 지시 ④ 자기적용
- **사이클1(v1→v2)**: codex∥gemini, 심화 9건 전부 corroborated·settled → v2가 12건 반영. 원장 [[2026-07-03-verified-autonomy-gate-redesign-spec-l2-aggregation-20260703-121043]].
- **사이클2(v2→v3)**: 확인 재-L2 — 5 settled(blocker 2 포함) + 에스컬레이션 2(둘 다 refuted: `8ee26160`=content-hash로 기이해결, `2148cb80`=대표 확정 철학). v3가 6건(5+TOCTOU) 반영. 원장 [[2026-07-03-verified-autonomy-gate-redesign-spec-l2-deepen-r2-20260703-121819]].
- **사이클3(v3→v4)**: 재-L2 — 5 settled(blocker 1 `64832e0d` 포함) + refuted 2(`c88ef0fb` 락모델·`d42f9b0f` 문구 = 구현 디테일). v4가 5건 반영(코드검증 계약·secret-code 비다운그레이드·도구목록·서비스 화이트리스트·break-glass 감사싱크). 원장 [[2026-07-03-verified-autonomy-gate-redesign-spec-l2-deepen-r2-20260703-122421]].
- **사이클4(v4 검증)**: v4 재-L2 — **corroborated 설계 blocker 0**(blocker 2건 refuted=구현디테일), 단 corroborated important 4(내 v4 편집 모순 2 포함: 마스킹훼손·코드검증 만료충돌). v5가 4건 반영.
- **6 L2 사이클 완주**(codex∥gemini, 미검증 0·파싱실패 0, ~40 findings 반영). 원장 reviews `...-l2-aggregation-*` 6세트.
- **수렴 데이터(정직)**: corroborated 설계 blocker는 사이클마다 0~1(대부분 refuted 또는 v3 `systemctl restart` 오판정 재발→v6 확정해소). **v6 잔여 corroborated 4건은 전부 비-설계**: `f7e9d98f`=이 §6 문구 자기참조(메타)·`aed9d89f`=명시적으로 구현으로 미룬 락모델·`1726fed3`=PreToolUse↔edit 경합(구현 동시성)·`a85e8da7`="골든테스트 미작성"=구현 작업 자체.
- **★ 설계 동결 판정**: 설계는 v2 이후 안정. L2는 이제 **구현계약(락·동시성·테스트·glob)·메타 수준만 반환** — 설계 spec에서 해소 불가, **구현 diff의 자체 L2에서 확정·검증**. 여기서 동결(design-level converged); 추가 설계-L2는 음의 ROI([[maia-founding-purpose-save-owner-time]]). 이 판정은 **6사이클 데이터 기반**이며, 스킵-동결(v4 오류)과 달리 corroborated 잔여가 비-설계임을 실증한 동결.

## 7. L2 반영 대장 (v1→v2)
| id | sev | 반영 |
|---|---|---|
| `99999429` | blocker | 실행경로 정직 스코핑 §2.2 — 게이트=의사결정 확정, 로컬실행 과장제거, 파생산출물 재검증 |
| `1f5d9972` | blocker | run_key를 content-hash+SHA 바인딩·verdict∈{settled,pass} §2.2 |
| `222e20db` | important | "완전가역" 완화, 파일별 pre-image blob·다중파일·미커밋 혼재 처리 §1 |
| `b34d0592` | important | evidence를 **PreToolUse 사전저장·실패시 차단** §2.1 |
| `e922bc49` | important | 자기수정 보호 **정본 목록** frontmatter 단일화 |
| `873db022` | important | async 검증 오염=경계 수용리스크 명시+파생 재검증+하드게이트 §2.2 |
| `2924907f` | important | 블로킹 대상=에이전트(대표 아님)·verifyRequiredPaths 좁힘 §2.2 |
| `f28c7225` | important | break-glass + 가역은 advisory 진행 → 무기한 교착 제거 §2.2 |
| `5f4b743f` | important | infra 세분(DENY/T3·T2·allow) §1 |
| `dee94990` | suggest | 버전 스큐 fail-closed + 매니페스트 대조 §5 |
| `eb0c7a9f` | suggest | 알림 등급·고위험 서브셋 명시 §2.3 |
| `1f98012d` | suggest | evidence 라이프사이클 보존창 §2.1 |
| **사이클2 (v2→v3)** | | |
| `4ff37595` | blocker | 가역 다운그레이드 Edit/Write 한정·Bash/exec 우회 차단 §1 |
| `c55903d2` | blocker | systemctl restart=운영 allow(하드스톱 아님) 모순제거 §2.2 |
| `fae387bb` | important | push/배포 게이트가 코드 async 검증 pass 요구 §2.2 |
| `52d2d1f9` | important | break-glass 스코프·감사필드·단회·골든가드 §2.2 |
| `50f31036` | important | pre-image secret 마스킹·SHA만 저장·접근제한 §2.1 |
| `8ee26160` | (refuted→강화) | commit 순간 content-hash 원자 재산정(TOCTOU) §2.2 |
| `2148cb80` | (refuted) | 사전승인→사후검증 전환 = 대표 확정 철학, 미변경 |
| **사이클3 (v3→v4, 설계 동결)** | | |
| `64832e0d` | blocker | 코드 async 검증 계약(대상·방법·합격·원장키·만료) §2.2 |
| `056e31b7` | important | secret-code 가역 비다운그레이드(복구충돌 제거) §1·§2.1 |
| `151bb836` | important | 대상 도구 명시 {Edit,Write,MultiEdit,NotebookEdit} §1 |
| `58c7a69a` | important | 자기 관리 서비스 = 프로젝트별 화이트리스트 §2.2 |
| `9d034f26` | important | break-glass 감사=트랜스크립트+상시싱크(우회경로 무관) §2.2 |
| `c88ef0fb` | (refuted) | check-and-commit 락모델 = 구현 디테일, 구현 diff에서 |
| `d42f9b0f` | (refuted→문구) | break-glass "호출단위 단회" 명확화 §2.2 |
| **사이클4→5 (v4→v5, blocker 0)** | | |
| `0f99ffca` | important | pre-image 마스킹 제거(byte-exact 복원, 내 v4모순) §2.1 |
| `021457c4` | important | 코드검증 게이트=HEAD net 상태(만료충돌 제거, 내 v4모순) §2.2 |
| `2700292d` | important | break-glass 감사싱크 실패 시 fail-closed §2.2 |
| `bb173a3c` | important | §3 상향=작동하나 미테스트, 골든테스트 신규추가(문구정합) §3 |
| `5dec0e39`·`9ab5929d`·`a79abd0d` | (refuted) | restart우회·락모델·폴백UX = 구현디테일/이미해결 |
| **사이클5→6 (v5→v6)** | | |
| `9da74f76` | blocker | `systemctl restart`=verify-게이트 반영점(allow 오판정 확정해소) §1·§2.2 |
| `7c47d17f` | important | 동상 — restart 서비스중단 리스크도 게이트로 커버 §2.2 |
| `855b6127` | important | pre-image prune=async 검증 통과 후만(폴백 보장) §2.1 |
| `596fe58c` | important | secret-code 정본=정책 rule glob §1 |
| `5f401eaa`·`ca0935a3` | (refuted) | 구현디테일 |
