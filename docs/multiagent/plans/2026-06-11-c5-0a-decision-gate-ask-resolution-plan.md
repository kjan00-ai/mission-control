# C5-0a 실행계획 — Decision Gate + ask 해소 (정책·훅 dry-run·가역 권한)

> MAIA 자율화(Verified Autonomy) 로드맵 **첫 단계**. 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.A/§2.C + L2 round1 만장일치 반영(검증엔진 선행).
> - 날짜: 2026-06-11 / 작성: claude / 버전: **v2 (L2 round1 반영 — 훅 enforce 전환)**
> - SSOT: 코드/spec=repo, 지식/결정=위키 + 위키링크
> - 선행: 없음(로드맵 최초) / 후속: C5-1a(schema l2-loop) → C5-0b(commit allow)
> - 대표 결재: 로드맵 재배열 승인(2026-06-11) + 세부결재 2건(아래 §0)

---

## 0. 확정 전제 (대표 결재 2026-06-11)

1. **T0/T1 가역 allow 방식 = risk classifier.** path allow가 아니라 `path + command + diff scope + runtime target` 분류기. Edit/Write는 전 경로 허용하되 **고위험 경로/op는 classifier가 자동 제외→ask**. (Codex BLOCKER#1 반영)
2. **Auto-L2 자동발동 임계 = spec/plan/design/위험수정.** 일상 T0/T1은 자동 L2 제외(비용·속도 균형). 규약만 C5-0a에서 명문화, 엔진은 C5-1a.
3. **commit/push는 C5-0a 범위 밖** — C5-0b(commit, feat/* 한정)·C5-0c(push, branch protection 병행)로 분리.
4. **이번 단계 훅 = enforce(classifier-gated, day 1부터 차단 active)** — ★ L2 round1 수정(만장일치 BLOCKER): 광범위 allow와 "항상 exit 0 dry-run"을 결합하면 T3/DENY까지 무방비가 되므로, 훅이 `permissionDecision`으로 **T0/T1 통과 / T2 ask / T3·DENY deny**를 실제 강제한다. **"dry-run"은 "차단 미적용"이 아니라 "classifier 정확도 측정(audit 로그)"으로 의미를 좁힌다** — allow(=blanket ask 제거)와 훅(=위험 재게이트)은 반드시 한 쌍.

---

## 1. 목표 / 비목표

### 목표 (C5-0a 산출물)
- **(D1) Decision Gate 정책 문서** — T0~T3 분류 + **항상금지 denylist** + 에스컬레이션 규칙. 글로벌 `~/.claude/CLAUDE.md`에 "Decision Gate" 섹션 + **`~/.ai-bootstrap/decision-policy.yaml`(분류표·denylist·고위험경로 SSOT, JS가 파싱)** — 코딩 없이 정책 갱신(Gemini 제안5).
- **(D2) risk classifier** `~/.ai-bootstrap/risk-classify.js` — 입력(tool, path, command, diff scope) → `{class: T0|T1|T2|T3|DENY, reason}`. 순수함수 + 단위테스트(golden fixture). **정책은 D1 yaml + 프로젝트 로컬 override `$(pwd)/.maia/risk-override.json` 병합**(프로젝트별 고위험경로 하향 위임 — Gemini 중요3).
- **(D3) PreToolUse 훅(enforce)** `~/.claude/hooks/pre-risk-classify.sh` — classifier 호출 → `permissionDecision` 반환: **T0/T1 → exit 0(통과) / T2 → ask / T3·DENY → deny(exit 2)**. 전건을 `~/.ai-bootstrap/audit/risk-YYYYMMDD.jsonl`에 기록. ★ L2 round1 반영: detect-only 금지, day 1부터 차단 active.
- **(D3b) audit 집계 CLI** `maia audit --summary [--since N]` — jsonl→"총 N건/클래스별/T2+ 차단 K건/오탐 후보" 터미널·md 리포트. 대표가 5분 내 C5-0b 결재 판단(Gemini 중요2).
- **(D4) settings allow 확장 (가역 T0/T1만)** — Edit/Write 전 경로 + `git add`(staging, 가역). **commit/push/rm/mv/migration 제외**. ★ allow는 "blanket ask 제거"용이고, D3 훅이 고위험을 ask/deny로 재게이트(한 쌍).
- **(D5) Auto-L2 트리거 규약** — 글로벌 CLAUDE.md "Auto-L2" 섹션. 발동 시점 = **Post-Task(작업/PR 완료=Handoff 직전) 1회**(편집마다 아님 — L2 스팸 방지, Gemini 중요4). 대상 = spec/plan/design 산출 또는 T2+ 수정 포함 작업. 엔진은 C5-1a, C5-0a는 규약·발동조건만.

### 비목표 (명시적 제외)
- commit/push allow (C5-0b/c) · L2 loop 엔진 구현(C5-1a) · MC durable bus(C5-1b/C5-2) · 서브에이전트 기본킷(C4B) · GitHub branch protection 설정(C5-0c) · 훅 실제 enforce(dry-run만).

---

## 2. Decision Gate 정책 (D1)

### 2.1 분류표 (risk classifier 규칙의 근거)
| 클래스 | 정의 | C5-0a 처리 | 예 |
|---|---|---|---|
| **T0 자명·가역** | 영향 국소, 즉시 되돌림 | **자율**(audit 로그) | docs/tests/messages Edit, 리팩터, 테스트 작성 |
| **T1 검증필요·가역** | 설계·접근 선택, 되돌림 가능 | **자율** + (산출물이면 Auto-L2 트리거 규약 표기) | src 일반 코드 Edit, spec/plan 작성 |
| **T2 위험·준가역** | 되돌림 비용 큼 | **C5-0a에선 ask 유지**(classifier가 audit에 T2 표기, enforce는 C5-0b+) | 고위험 경로 수정, migration(dev), dep bump |
| **T3 비가역·외부** | 되돌릴 수 없음/외부 영향 | **항상 대표 게이트** | main merge, push, prod DB, secret, 외부발신 |
| **DENY** | 항상 금지(클래스 무관) | **무조건 차단** | 아래 §2.2 |

### 2.2 항상금지 denylist (Codex 제안 반영)
classifier가 클래스보다 **우선** 적용:
- secret/credential **출력·로그·wiki md 저장**, `.env`/`~/.git-credentials`/key 파일 수정
- `git push --force`, tag/release push, delete ref, `HEAD:main` refspec, 타 remote push
- destructive fs: `rm -rf /` 계열, 대량 `rm/mv/chmod/chown`, `git reset --hard`/`clean -fdx`
- prod endpoint write, paid external API 호출, 외부발신(메일/SNS/배포)

### 2.3 고위험 경로 (T2로 강등 — risk classifier 핵심)
`src/**`라도 아래 경로는 T2(가역·국소 아님): `**/auth*`, `**/task-dispatch*`, `**/scheduler*`, `migrations/**`, `**/secret*`, `**/*hook*`, `src/i18n/config*`, `**/*.lock`, lockfile, generated(`*.gen.*`, `.next/**`). + command 기준: `git`, `npm/pnpm install`, `docker`, `systemctl`, `cron`, `sed/perl -i` 대량.

---

## 3. risk classifier (D2)

`~/.ai-bootstrap/risk-classify.js` — `classify({tool, path, command, diffStat}) → {cls, reason}`:
1. **denylist 매칭 우선** → `DENY`.
2. **command 기반** — git/install/docker/systemctl/cron/대량 sed → 최소 T2, push/force/main → T3.
3. **path 기반** — 고위험 경로(§2.3) → T2; src 일반 → T1; docs/tests/messages → T0.
4. **diff scope** — 대량(예 >300 LOC 또는 >10 파일) → 한 단계 상향.
5. **runtime target** — prod 연결 문자열·외부 endpoint 탐지 → T3.
- 출력은 **가장 높은 위험도** 채택(보수적). reason에 매칭 규칙 명시.
- **golden fixture 테스트**: C4B B-3 패턴 재사용(R5 drift 방어). 케이스 ≥20(각 클래스·denylist·고위험경로·우회시도: `git -c alias`, `bash -lc`, symlink, path traversal).

---

## 4. PreToolUse 훅 — enforce (D3) ★ L2 round1 수정

`~/.claude/hooks/pre-risk-classify.sh` (matcher: `Edit|Write|MultiEdit|Bash`):
- PreToolUse 입력에서 추출 — Edit/Write는 `.tool_input.file_path`, Bash는 `.tool_input.command`(Codex 확인: 추출 경로가 tool별로 다름) → `risk-classify.js` 호출.
- **판정 → `permissionDecision` 반환(실제 게이팅)**:
  - **T0/T1** → `exit 0` (통과, blanket ask 제거 효과).
  - **T2** → `{"hookSpecificOutput":{"permissionDecision":"ask"}}` + `exit 2` (대표 승인 요청).
  - **T3·DENY** → `{"hookSpecificOutput":{"permissionDecision":"deny"}, "systemMessage": reason}` + `exit 2` (차단).
- 전건을 `~/.ai-bootstrap/audit/risk-YYYYMMDD.jsonl` 기록(`{ts, tool, path, cmd, cls, reason, decision}`) — **차단과 별개로 정확도 측정용**.
- "dry-run"의 의미 = **차단 미적용이 아니라 audit 기반 정확도 튜닝**. 차단은 day 1 active.
- ⚠️ Codex 경고: 명령 문자열만 보지 말고 `git -c`/shell expansion/`bash -lc`/npm script 내부 git/symlink를 classifier가 normalize. 미상이면 보수적으로 상위 클래스(→ ask/deny).

---

## 5. settings allow 확장 (D4)

대상: **글로벌 `~/.claude/settings.json`**(현 read-only ~50패턴) + 프로젝트 `.claude/settings.json`(현 빈 `[]`). 추가(가역 T0/T1만):
- `Edit`, `Write`, `MultiEdit` — 전 경로 allow(blanket ask 제거). **단 D3 훅이 T2+ 경로를 ask/deny로 재게이트하므로 안전** — allow와 훅은 한 쌍(L2 BLOCKER 핵심).
- `Bash(git add:*)` (staging, 가역) · `Bash(git diff:*)`, `Bash(git status:*)` 등 read-only git 보강.
- **추가 안 함**: `git commit/push`, `rm/mv`, `migration`, `pnpm install`, secret, 외부발신 → ask/deny 유지(= T2/T3/DENY, 훅 강제).
- deny 목록에 §2.2 denylist의 정적 매칭 가능분(`Bash(git push --force:*)` 등) 명시(훅 + 정적 이중방어).

---

## 6. Auto-L2 트리거 규약 (D5)

글로벌 CLAUDE.md "Auto-L2" 섹션(엔진은 C5-1a, 여기선 **규약만**):
- **발동 시점 = Post-Task** (작업/PR 완료 = Handoff 직전) **1회** — ★ L2 수정: PreToolUse(편집마다)면 L2 스팸·비용폭증, 작업 단위로 묶어 1회.
- **발동 조건**: `spec`/`plan`/`design` 문서 생성·중대개정, 또는 **T2+ 수정이 포함된 작업**.
- **제외**: 일상 T0/T1만의 작업, 사소수정, 문서 오타.
- **수렴**: 만장일치(항목단위) → settled / 비만장일치 → 심화 L2(deepen-budget 2~3) / 미합의·T3 → 대표 에스컬레이션(근거 3줄+롤백 커맨드, Gemini 제안).
- **산출 위치**: wiki `reviews/{artifact}-l2-{ai}-{YYYYMMDD}[-r{n}].md`(§2.E.1).
- verdict 스키마(C5-1a에서 강제): `artifact_id/round/item_id/severity/claim/evidence_refs/status/hash`.

---

## 7. 검증 계획

- **classifier 단위테스트** golden fixture ≥20 케이스 PASS(우회시도 포함). 특히 **미탐 0**(고위험을 T0/T1로) 케이스 필수.
- **enforce 실측**: C5-0a 적용 후 **최소 3일 또는 PR 5개**(Gemini 중요2) 실작업 → `maia audit --summary`로 오탐(가역인데 T2+→불필요 ask)·미탐(고위험인데 통과) 집계. 목표 오탐<10%, **미탐 0**.
- **차단 동작 검증**: T3/DENY op(예 `git push --force`, secret 경로 Edit)이 실제 deny되는지 + T2가 ask 뜨는지 실측.
- **settings 회귀**: read-only 50패턴 유지 확인(`pnpm`/git 조회 ask 미발생).
- **이 plan 자체 Auto-L2**(dogfounding) — round1 완료([[c5-0a-plan-l2-aggregation-20260611]]), v2 반영.

## 8. 리스크 / 완화 (설계 §4 + L2 보강)
- classifier 미탐(고위험 통과) → **이제 enforce라 미탐은 실피해 직결** → golden fixture 미탐0 게이트 + 보수적 상향 기본값(미상=상위클래스) + audit 조기검출.
- 오탐 과다(불필요 ask 스팸) → audit 집계로 튜닝 + 프로젝트 override(D2)로 완화.
- 우회(alias/expansion/symlink) → normalize + 미상은 상위 클래스 + wrapper command(C5-0b).
- audit 파일 폭증 → 일자별 rotate + **retention 14일 초과 자동삭제/압축**(Gemini 제안6).
- 글로벌 CLAUDE.md 비대 → Decision Gate/Auto-L2는 요약 + `decision-policy.yaml` 링크.

## 9. 잔여 결재 / 후속
- 고위험 경로 목록(§2.3) 1차 확정 → enforce 실측으로 보정(yaml SSOT라 코딩 없이).
- diff scope 임계(300 LOC/10 파일) 실측 튜닝.
- **후속**: C5-1a(schema l2-loop+린터 필수+PreWrite hook) → C5-0b(commit allow + 훅에 commit 게이팅 추가).

## 10. 관련
- 설계: [[2026-06-11-maia-autonomy-overhaul]] / repo `docs/multiagent/specs/2026-06-11-maia-autonomy-overhaul-design.md` §2.A/§2.C/§3/§7
- L2 근거: [[maia-autonomy-l2-aggregation-20260611]] / [[maia-autonomy-l2-codex-20260611]] / [[maia-autonomy-l2-gemini-20260611]]
- classifier 테스트 패턴: C4B B-3 공유모듈/golden fixture

## 11. L2 검증 결과 (dogfounding round 1 — 2026-06-11)
이 plan을 Auto-L2(Codex∥Gemini)에 통과 → **만장일치 "수정필요"**(충돌 0건, 심화 불필요). 집계 [[c5-0a-plan-l2-aggregation-20260611]].
- **만장일치 BLOCKER(독립 수렴)**: "dry-run(항상 exit 0) + 광범위 allow = 탐지만, 보호 없음". Codex가 훅 API(`permissionDecision`)로, Gemini가 운영 모순으로 동일 결론. → **§0.4/D3/§4 enforce 전환 반영(v2)**.
- **settled 보강 반영**: audit 집계 CLI(D3b) · 프로젝트 override(D2) · Auto-L2 Post-Task 시점(D5) · denylist yaml 외부화(D1) · retention(§8).
- 대표 결재와 충돌 없음(plan-내부 안전강화) → 즉시 v2. **착수 가능.**
