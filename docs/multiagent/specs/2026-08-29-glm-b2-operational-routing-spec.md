# GLM B2 — 실운영 라우팅 spec (mc-relay Lane A 스왑, 거버넌스 유지)

- **문서유형**: spec (구현 전 동결 대상)
- **작성일**: 2026-08-29
- **상위**: 조건부 Go [[2026-07-05-glm-full-run-verdict]] / 거버넌스 [[2026-07-06-glm-05-governance-gate-spec]] + A2 [[2026-08-29-glm-phase2-egress-proxy-spec]] / 티어패널 [[2026-07-05-l2-tier-panel-wiring-spec]]
- **대상**: `~/mission-control/c3_mc_to_hermes.js`(**untracked 로컬 relay**, 백업 `.c4-tXX-final`). 설계정본만 이 repo doc. **default-off**(활성=대표 데이터 변경).

## 1. 문제
GLM은 `glm-launch.sh` 수동실행 PoC뿐 → **생성스트림 0** → concordance 실측·티어패널 codex 편익·A2 프록시 실사용 전부 대기. B2 = GLM을 MC 실작업 자동처리에 편입해 스트림 발생. 조건부 Go 스코프(린/CRUD·간결규율, 프론트·보험·금융 금지) + §0.5/A2 거버넌스 안에서만.

## 2. 지형 (실측)
- mc-relay(untracked): hermes cron(1m)이 `c3_mc_to_hermes.js` 실행 → MC task를 **agent 이름으로 라우팅**(`:242`), model/backend 인지 0.
- claude-branch `runClaudeAgent`(:141) → `execFileSync(timeout,[CLAUDE,"--agent",who,"-p",title,"--permission-mode","acceptEdits","--output-format","json"],{cwd,env:{...process.env,MC_TASK_ID}})`(:150-154). `CLAUDE=~/bin/claude`(:92).
- SELECT(:234)=`a.name`만(`a.config` JSON·`a.runtime_type` 미조회).
- **Lane A**(claude→glm-launch 스왑)=A2 egress 프록시+§0.5 게이트 경유(거버넌스 유지) / **Lane B**(Hermes 네이티브 `zai` provider+task `model_override`)=게이트·egress 우회+GLM키를 `~/.hermes/.env` 노출=**거버넌스 후퇴**.

## 3. 설계 결정 = Lane A (거버넌스 우선)
- Lane B 배제 — A2 전체가 거버넌스 목적. GLM 트래픽 전량이 §0.5 게이트(도메인·파일)+A2 egress 콘텐츠검사 경유해야 함.
- **신호 = agent 이름 prefix `glm`**(예 `glm-worker`). **agent-per**(task-per 아님) — 대표가 agent 단위 통제.
  - ★ 원안(config.backend='glm')은 **서버 syncProjectAgents가 md frontmatter 기준으로 config를 주기적으로 덮어써 임의키(backend)를 지움**(실측). sync 생존 필드는 model/tools/description뿐. 이름은 sync 무관하게 안정 + relay가 이미 이름(`who`)으로 라우팅 → 이름 prefix가 durable·자연스러운 신호. (config.model=glm*·backend='glm'도 override로 인정.)
- **default-off**: config.backend=glm agent 없으면 CLAUDE 그대로=거동 무변화. 활성=대표가 특정 agent config 설정 + task를 allowlist 레포에 배정.

## 4. 구현 계약 (relay, untracked 로컬)
1. **SELECT**(:234): `a.config AS agent_config` 추가.
2. **신호 파싱**(:249, claude-branch에서만): `useGlm = who.startsWith('glm') || /^glm/i.test(cfg.model||'') || cfg.backend==='glm'`(이름 prefix가 주 신호=sync 생존). codex/gemini/default lane 무관. GLM agent md는 `model: sonnet`(claude-code는 `glm-5.2[1m]` 원문 미인식 → glm-launch가 sonnet→glm-5.2[1m] remap).
3. **`runClaudeAgent(task,cwd,assignee,useGlm)`**: spawn 바이너리 `useGlm ? GLM_LAUNCH : CLAUDE`. `GLM_LAUNCH="$HOME/.ai-bootstrap/glm-launch.sh"`. 인자·env·cwd 동일 — glm-launch가 `"$@"` 그대로 claude 전달(headless `-p` 통과 실증됨). useGlm 시 logPath에 `[backend=GLM via glm-launch]` 1줄.
4. **gate-deny exit-code 매핑(L2 `57014950`)**: 현 구조는 `execFileSync("timeout",["--kill-after=10","300", BIN, ...])` → catch에서 `code=e.status||1`. `timeout`은 **명령 exit code를 그대로 전파**(124=자체 timeout만 remap). glm-launch 게이트 거부=exit 3 → `timeout` 3 전파 → `e.status===3`. 따라서 `runClaudeAgent` catch에서 **`useGlm && code===3` → outcome `glm_gate_denied`**(기존 rate_limit/auth/error 분기보다 먼저). 별도 terminal 로직 불요 — `finishTask` 실패경로가 `retry_count++`, `MAX_RETRY=2`(:98)로 2회 후 max_retry 종료(무한재시도 없음). 게이트는 z.ai 호출 **전** exit3라 재시도 비용≈0. `glm_gate_denied`는 라벨만 구분(로그·telegram 명확화).
5. **경합/멱등(L2 `ab606507`)**: 신규 동시성 표면 없음 — GLM 경로도 claude-branch의 기존 **`claimTask`(원자 claim, status→in_progress, `changes===1`만 진행, :262)** 통과. 1m cron 재실행·중복은 기존 claim이 이미 차단(B2 상속). timeout=code 124(기존 처리) 유지.
6. 편집 전 현행 백업(`c3_mc_to_hermes.js.b2-bak-<stamp>`, `.c4-tXX-final` 관례).

## 5. 거버넌스 보장 (2중 방어 — 절대 아님, L2 `f1fe29f4`·`63aa7fa2`·`ed22e30f`)
- **1차 launch-gate(cwd 스코프)**: glm-launch가 task cwd(레포)에 §0.5 게이트 → allowlist 레포(현 SF)만 통과, BC(finance)=domainDenylist deny(exit3→glm_gate_denied). ⚠️ 게이트는 **cwd만** 검사 — relay가 `--add-dir` 미전달이라 cwd 밖 파일 참조는 launch-gate 미검. "confined"는 **cwd 기준이지 절대 아님**(over-claim 정정).
- **2차 egress 프록시(실전송 콘텐츠)**: cwd-gate가 못 본 것도 A2 프록시가 **실제 z.ai로 나가는 payload 전량**(금융/보험/PII) 검사→차단 = 1차 갭 보강(cwd 밖 내용도 프롬프트로 전송되면 여기서 걸림). 실키 프록시 단독보유(child=세션토큰).
- **활성 authz**: config.backend=glm 작성 자체엔 별도 DB-게이트 없음. 단 **ToS 하드경계(금융/보험→GLM)는 config 작성자 무관하게 gate+proxy가 강제**(누가 켜도 금융 차단) → config-authz는 비용/범위 심층방어이지 ToS 경계의 유일방어 아님. default-off + agent-per + gate+proxy = 다층.

## 6. 한계 (정직)
- **relay untracked (L2 blocker `d7ed6f7e`·`8106b58d`) = ✅ 해소**: 대표 결정 (A)로 relay를 MC repo tracking(§9). 버전관리·롤백·감사 확보. + 편집 전 타임스탬프 백업 병행.
- cwd-scope 갭은 §5 2차(egress 프록시)로 보강(절대 아님).
- Lane A는 A2 Tier A 잔여 계승(셸 agent 고의 키read=대표 `!` 동급). Lane B(성능) 미채택.

## L2 검증 이력 (codex ∥ gemini, 2026-08-29)
> 원장 `2026-08-29-glm-b2-operational-routing-spec-l2-aggregation-20260829-150936`(+r2/r3). 3R, **settled 6 반영 + refuted 1**.
- `d7ed6f7e`·`8106b58d`(blocker, 양벤더): relay untracked → §6 완화 3종 + §9 tracking 권고(대표 결정).
- `ed22e30f`: config 활성 authz → §5 "ToS 경계는 config작성자 무관 gate+proxy 강제, config-authz=비용/범위 심층방어" 명확화.
- `f1fe29f4`·`63aa7fa2`: 거버넌스 over-claim → §5 "cwd 기준·절대 아님, egress 2차 보강" 정정.
- `ab606507`: 경합/멱등 → §5 기존 `claimTask` 원자 claim 상속 명시.
- `57014950`(refuted, gemini): exit-code 매핑 → §4.4에서 `timeout` exit3 전파·execFileSync e.status 명시로 해소(구조충돌 없음).

## 9. 대표 결정 — relay tracking = ✅ (A) 채택 (2026-08-29, blocker 근본해소)
양 L2 벤더 blocker(relay untracked) → **대표 확정 (A) tracking**. `.gitignore`에 `!c3_mc_to_hermes.js` negation 추가(`c3_*` 백업 무시 유지) → relay를 MC repo tracking. **버전관리·롤백·감사·리뷰 확보로 blocker 해소.** B2 diff도 정식 커밋. relay=HOME-상대·무-secret 확인. glm-launch 등 다른 local glue tracking은 추후 별건 검토.

## 7. 검증
- relay 구문(`node --check`)·단위(신호 파싱·바이너리 분기·exit3 처리).
- E2E 3케이스: ① config.backend=glm agent + allowlist 레포 task → glm-launch 경유(로그 `[backend=GLM]`·프록시 기동) ② 비-allowlist 레포 → `glm_gate_denied` terminal ③ default agent → CLAUDE 무변화. (z.ai 실호출은 fake-claude 스텁으로 통제.)
- default-off: 마킹 agent 없으면 거동 무변화.

## Path A 활성 실측 (2026-08-29 — SF 정식 배선)
- 배선: repo-map `knownLocal["kjan00-ai/StarFollow"]=allowlist경로`+pullSkip / SF project#3 github_repo 설정 / `SF/.claude/agents/glm-worker.md`(name glm-*, model sonnet) + register-mc-agents 등록.
- **파이프라인 end-to-end 실증**: relay가 task를 `cwd=/mnt/d/…/StarFollow`(allowlist)에서 glm-worker로 라우팅 → **glm-launch 발동**(로그 `[backend=GLM(glm-5.2[1m]) via egress 프록시 127.0.0.1:… → api.z.ai]`) → §0.5 게이트 통과 → A2 프록시 → **z.ai 실제 도달**. 라우팅·게이트·프록시·egress 전 계층 정상.
- **유일 블로커 = z.ai 계정 잔액**: z.ai 429 `[1113] Insufficient balance or no resource package. Please recharge.` → **대표 과금(z.ai/GLM Coding Plan 충전)** 필요. 충전 후 동일 task가 실산출.
- 검증 발견(반영됨): ① 신호=이름 prefix(config.backend는 sync가 삭제) ② model=sonnet(remap). `unrecognized_model glm-5.2[1m]` 경고는 무해(z.ai가 모델 수용, 429는 잔액).

## 8. 활성화 (대표, 메커니즘 배선 후)
대표가 (a) GLM 담당 agent에 `config.backend=glm` 설정(mc CLI/DB), (b) 그 agent의 린/CRUD task를 allowlist 레포(SF)에 배정 → GLM 스트림 발생 → concordance 실측 개시·B1(codex flip) 편익 실현. 비용/범위=대표 활성 판단.
