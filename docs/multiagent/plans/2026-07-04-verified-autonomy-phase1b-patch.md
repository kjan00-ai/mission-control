# Phase ①b 패치 — PreToolUse 훅: reversible 자체주입 + pre-image 사전저장 (default-off)

> A2 owner-only T3 파일(`~/.ai-bootstrap/hooks/pre-risk-classify.js`) 편집 → **대표 결재/적용 필요**. 단일 파일. `reversibilityDowngrade.enabled=false`(default-off) 유지라 **적용해도 게이트 실동작 무변(no-op)**. 실제 발동은 별건 ①b-flip(enabled→true).
> 선행: ①a(분류기 `reversibleClass`+`nonOverridable`, 적용됨). 후속: ①b-flip → ②(블로킹 검증 게이트). spec `docs/multiagent/specs/2026-07-03-verified-autonomy-gate-redesign-spec.md` §2.1·§4.

## 변경 (훅 1파일, 헬퍼 3 + main 2블록)

### (1) reversible 자체주입 — 하드계약 (spec §1, L2 `151bb836`)
- 훅이 `git ls-files --error-unmatch`로 **대상파일 추적여부를 직접 판정**해 `classify({...reversible})`에 주입. **caller의 `tool_input.reversible`은 절대 신뢰 안 함**.
- 대상 = `{Edit,Write,MultiEdit,NotebookEdit}` + file_path 有. Bash 파일쓰기는 비대상(L2 `4ff37595`).
- **`revDowngradeEnabled()` 게이트**: flag off면 `git ls-files` spawn조차 안 함 → 관측가능 부작용 0 = 완전 no-op.
- `absPath` = `path.isAbsolute(fp) ? fp : path.resolve(evt.cwd||cwd, fp)` — 상대경로 방어(L2 수리, 아래).

### (2) pre-image 사전저장 — fail-closed (spec §2.1, L2 `b34d0592`·`0f99ffca`)
- 트리거 = `permissionDecision==='allow'` **AND `reversible===true`** AND ruleId에 `+rev`(=가역 다운그레이드로만 allow). 자연 T1은 손 안 댐.
- 편집 *전* 원본 바이트를 `~/.ai-bootstrap/evidence/preimage/<pathKey>.<stamp>.pre`에 **byte-exact 저장**(마스킹 없음 → byte-identical 복원). dir 700 / blob 600. ledger append(path·sha·size).
- **저장 실패 = deny**(fail-closed) — evidence 없는 allow-with-evidence 원천 차단. cls는 T1 유지라 하위 queue(T3 전용) 미진입(gemini 확인).
- secret 안전: secret-code는 `reversibleClass` 없어 `+rev` 안 붙음 → pre-image가 민감경로를 애초에 회피(실측: `auth-secret.ts`→`**/secret*` 매칭→higherMatch로 T2 유지, 다운그레이드 안 됨).

## ✅ 검증 실측 (2026-07-04, scratchpad candidate)

- **e2e 골든 27/27** (격리 $HOME + throwaway git repo에 candidate 훅을 실제 subprocess로 구동):
  - OFF: tracked auth Edit→ask 유지·`reversible=false`·pre-image 0 (현행과 동일).
  - ON: tracked auth Edit→allow·`+rev`·**byte-exact pre-image**(blob sha==파일 sha)·dir 700·ledger 기록.
  - **하드계약**: untracked+caller `reversible:true` → 훅이 무시·false 도출 → ask(gated).
  - **상대경로**: `file_path` 상대 + `cwd`=repo → absPath 해소로 allow+pre-image(L2 수리 검증).
  - **A2 보존**: gate-self(nonOverridable) tracked Edit → **T3 deny 유지**·pre-image 0.
  - Bash tool → `reversible=false`(비주입). **fail-closed**: evidence 저장실패 → deny + systemMessage.
- **no-op 차등 8/8**: candidate(OFF) ≡ 현 canonical 훅 결정 동일(Edit/Write/Bash push·rm-rf·install·restart 등).

## 자체 L2 (codex 기술 ∥ gemini 운영/UX) — 1R + 수리 + 재검증

| finding | 벤더 | 판정·조치 |
|---|---|---|
| WRITE_TOOLS에 codex/gemini 도구명 누락(blocker) | gemini | **refuted** — 이 훅=Claude Code PreToolUse 전용, 분류기와 동일 도구목록. 타 에이전트 미경유 |
| secret-code 경로방어 불완전(important) | codex | **refuted(실측)** — `auth-secret.ts`→T2 secret-code(higherMatch가 T1 이김). ※auth파일 내 secret은 flip 전 재검토 carry |
| 상대경로 `evt.cwd` 미반영 | codex·gemini×2 | **수리** — `absPath` 해소, e2e 케이스 추가 |
| chmod 실패가 allow로 샘(important) | codex | **수리** — blob mode 사후검증(`&0o077!==0`→throw→fail-closed) |
| `/\+rev\b/` 느슨→OFF I/O(important) | gemini | **수리** — `reversible===true` 가드로 OFF 완전 무력화(ruleId 문자열 무관) |
| pre-image↔edit 경합(nitpick) | codex·gemini | spec §6 인지 한계, 무변 |

## 적용 (대표 `!`)
```
!bash ~/p1b/apply.sh
```
= 백업 → canonical 훅 교체 → `maia-deploy`(Windows byte-identical 동기) → markers 검증 → **flag false 재확인**. 롤백 = `cp ~/.ai-bootstrap/hooks/pre-risk-classify.js.bak-pre-1b …` 1회.

## flip 전 재검토 결론 (2026-07-04, 실측 + 자체L2 codex∥gemini)

**결정: ①b-flip 보류(HOLD).** 양 벤더 D=blocker 수렴 + 독립 실측 일치. flip은 **①c(안전판 최소구현)** 완료 후로 미룸.

- **재검토① 공급망 = real**: flip=ON 실측 — `package.json` Edit→`T1 pkgjson+rev`, `pnpm build`/`npm run build`/`pnpm test`→`T1 default-cmd`. ⟹ scripts 하이재킹→build 자율실행(RCE), install(T2) 우회. **pkgjson 홀드백 필요**. lockfile은 발동명령 `pnpm install/add`가 T2라 즉시RCE 필수성은 약하나 무결성핀 방어로 홀드백 유지가 깔끔.
- **재검토① 추가발견(홀드백 불충분)**: tracked `generated`(`dist/bundle.js`)→`T1 generated+rev` + `node dist/bundle.js`→`T1` = **pkgjson 없이도 편집→실행 벡터**. `generated`도 홀드백(또는 tracked 실행산출물 제외) 필요. ※ generated는 대개 gitignore→미추적→미발동이나 tracked면 성립.
- **재검토② auth-secret = 부분 refuted**: `secret-code` glob(`**/secret*`)이 대소문자·구분자 취약 — `authSecret.ts`·`Secret.ts`는 미탐지→`T1 auth+rev`로 pre-image 저장대상. "700/600 owner-only 수용"만으론 불충분, **TTL/prune/alert 필요**.
- **★ 재검토 D = flip 시기상조(blocker, 양 벤더 + 실측)**:
  1. **async 검증 미배선**: `post-task-l2.js`/l2-auto는 spec/plan/design `.md`만 대상. auth/pkg/generated **코드 편집 사후검증이 0**. 다운그레이드 자율편집이 아무 검증도 안 받음.
  2. **가역 폴백 미연결**: `c6-rollback.js`="proposer/advisory; never executes", **pre-image blob 복원 경로 없음**(①b 훅이 유일 생산자, 소비자 부재). flip 후 T1 allow는 사후 차단·자동복구 없이 실행.
  3. **prune 부재**: `evidence/preimage`·ledger 무한증가(비밀 누적).
  - ⟹ pre-image는 저장만 되고 소비·검증·정리 전무 = 자율 정당화하는 보상통제 없음. HMR/구동중 데몬이 auth/scheduler T1 편집 즉시로드하는 경로도 명령게이트 재통과 안 함(spec 수용리스크 명문화 or live-service cwd flip 제외).

## 차기 = ①c (안전판 최소구현, flip 전제)
1. **홀드백**: `decision-policy.json`에서 `pkgjson`·`lockfile`·`generated` `reversibleClass` 제거(정책 데이터편집, A2 T3).
2. **prune 라이프사이클**: evidence/preimage TTL + async검증 통과/후속commit 시 prune(§2.1) — cron.
3. **가역 폴백 소비자**: preimage-ledger 읽어 복원(§2.3, 헤드리스 자동revert 금지=제안형) — 또는 git-checkout 폴백으로 명문화·pre-image는 미커밋혼재 전용.
4. **다운그레이드 코드편집 async 검증 배선**(§2.2 코드 async 검증 계약) — 반영점(push/restart) verify-게이트가 실제 코드 async pass 요구.
그 후 flip. ②(산출물 commit 블로킹 검증 게이트, run_key content-hash)는 별 phase.
