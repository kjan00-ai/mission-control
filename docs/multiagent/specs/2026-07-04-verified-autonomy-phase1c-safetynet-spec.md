# Verified Autonomy — Phase ①c 안전판 최소구현 Spec (2026-07-04, **v2** — L2 1R 반영)

> **한 줄**: ①b-flip(가역 다운그레이드 활성) 전제인 보상통제를 구현한다 — 홀드백(c-1)·**pre-image only-if-dirty + ledger 바인딩키(c-0, ①b 정합)**·prune(c-2)·가역 폴백 소비자(c-3)·반영점 verdict 게이트 포함 async 검증(c-4).
> 부모 spec = `2026-07-03-verified-autonomy-gate-redesign-spec.md`(v6 동결, §2.1 evidence·§2.2 verify·§2.3 fallback). flip 보류 근거 = `2026-07-04-verified-autonomy-phase1b-patch.md`.
> **자기수정 보호(A2 owner-only T3)**: `decision-policy.json`·`risk-classify.js`·`~/.ai-bootstrap/hooks/*`. 신규 `preimage-*.js`는 게이트 로직 아님(T1)이나 cron/hook 배선·manifest 등재=T2+. 최종 정책·훅 diff=대표 결재.

## 0. 문제 (실측 + 자체L2 codex∥gemini 2회 수렴)
- pre-image **소비 전무**(생산자=①b훅뿐, 복원도구 없음, `c6-rollback`=advisory). async 검증 **미배선**(post-task-l2=`.md`만). prune **부재**(무한증가·secret 누적). 홀드백 **불충분**(pkgjson scripts→`pnpm build`T1·tracked generated→`node dist/`T1).
- **L2 v1→v2 설계 blocker 3**: Q1(반영점 하드게이트 ②분리가 부모§2.2와 모순)·Q2(TTL이 §2.1 "pending/fail 보존"과 모순+secret)·Q4(①b ledger 바인딩키 부재→오바인딩).

## 1. 목표·범위
- **목표**: flip 후 자율 다운그레이드(auth·dispatch·scheduler·relay·i18n) 편집을 **가역성 실재+위생+탐지+반영점 informed 게이트**로 경계.
- **반영점 게이트 실측(load-bearing)**: flip=ON에서도 `push→T3`·`restart→T2`·`install→T2` 유지(2026-07-04 실측). ⟹ 미검증 코드 프로덕션 반영은 이미 인간(T3/T2) 경유.
- **Q1 해소(부모 §2.2 정합)**: 반영점 검증요구를 ②로 미루지 않는다. **c-4가 반영점(push/restart/install) 게이트에 대상경로 verdict를 주입** — ①c는 **default: informed(비블로킹 경고 표출)** = 대표 T3 승인이 "미검증 인지된 승인". **하드블록(미검증 push 자동 deny)은 동일 메커니즘의 config 토글**(default-off)로 동봉 → 안정 후 flip 가능. 이로써 §2.2 "반영점=verify 게이트"를 메커니즘으로 충족(강도만 단계적). ②는 별건 = 의사결정 **산출물 commit** 블로킹 게이트(run_key content-hash, 코드반영과 무관).

## 2. c-1 — 홀드백 (정책 데이터, 즉효)
`decision-policy.json`의 `pkgjson`·`lockfile`·`generated`에서 **`reversibleClass` 제거** → flip 후 base `T2` 유지. 남는 다운그레이드 대상 = `auth·dispatch·scheduler·relay·i18n-config`. candidate=canonical과 **3줄 삭제 diff**(검증됨). 골든 잠금. (Q5 확정: generated는 tracked 시 `node dist/`T1 실행벡터라 유지.)

## 3. c-0 — ①b 정합 리파인 (pre-image 생성정책 + ledger 바인딩키) ★신규(L2 blocker Q2·Q4)
①b 훅(`pre-risk-classify.js`)을 flip 전 아래로 보강(flag off라 여전히 no-op):
- **(a) pre-image ONLY-IF-DIRTY (Q2 근원해소)**: git이 tracked 파일의 pre-edit 상태를 이미 보유 → **대상 파일이 HEAD와 동일(clean)하면 blob 저장 안 함**(폴백=`git checkout`). **working-tree가 dirty(HEAD와 상이)일 때만 blob 저장**(git checkout이 사용자 미커밋분을 잃으므로 blob이 그 상태 보존). ⟹ 흔한 clean 편집엔 blob·secret 미생성. secret-bearing auth라도 clean이면 evidence에 안 들어감. dirty 케이스만 짧은 창.
  - clean/dirty 판정 = `git diff --quiet HEAD -- <file>`(exit0=clean). 판정 실패(미추적/비repo)=이미 reversible=false라 다운그레이드 비대상.
- **(b) ledger 바인딩키(Q4)**: pre-image ledger 엔트리에 **`tuid`(이벤트 tool_use_id)·`entryId`(안정 uuid/해시)·`preSha`·`headSha`·`dirty`** 기록. c-2/c-3/c-4가 **경로+타임스탬프 추측이 아니라 `entryId`로 바인딩**. MultiEdit=파일별 독립 엔트리(부모§1). tuid 없으면 `${ts}-${pathKey}-${pid}` 폴백.
- **(c) PostToolUse 사후 기록**: 편집 성공 후 훅이 **`postSha`·`diffHash`를 같은 `entryId`에 append**(별 ledger `evidence/post-ledger.jsonl`). c-3 정밀 변경감지·c-4 enqueue 트리거의 SSOT.

## 4. c-2 — prune 라이프사이클 (`preimage-prune.js` + hermes cron 일일)
- **§2.1 정합(Q2 blocker)**: **pending/fail pre-image는 절대 자동삭제 안 함**(보존 강제). prune 대상 = **①verified-pass(c-4 verdict∈{settled,pass}) OR ②후속 commit이 그 경로를 대체(headSha 진행+clean)** 인 blob만. 그중 `age>TTL`(기본 3d) 지난 것 정리.
- **aged-pending 처리**: 검증 pending인데 `age>maxRetainDays`(기본 7d)=**삭제 아님, Telegram 에스컬레이션**(검증 지연 이상신호). 무한증가는 only-if-dirty(§3a)로 이미 대폭 억제.
- **원자성·fail-safe**: ledger 임시파일 rename 교체. 오류/파싱실패=미삭제(보존 우선). 삭제=`unlinkSync`(비보안소거, 700 dir+dirty-only+짧은TTL로 완화, 잔여명시).

## 5. c-3 — 가역 폴백 소비자 (`preimage-restore.js` CLI, 제안형)
- **git-first 명문화**: 1차 폴백 = `git checkout -- <file>`(clean 편집 전건은 이걸로 충분, blob 없음). restore CLI = **dirty 케이스/정확 pre-edit 바이트** 전용.
- **CLI**: `--list`(path·entryId·age·verdict·dirty), `--entry <id>`|`--path <file>` 복원.
- **정밀 변경감지(Q3)**: ledger의 `postSha`와 **현재 파일 sha 비교** — 일치=에이전트 편집 그대로(안전복원), **불일치=사용자 후속수정 → 자동중단**(덮어쓰기 금지)+diff표출+`--force` 요구. postSha 없으면(사후훅 실패) diff+확인 폴백.
- **헤드리스 자동 revert 금지**(§2.3). 호출=대표(통보 수신) 또는 에이전트 제안. 복원 후 sha 재검증.

## 6. c-4 — async 검증 + 반영점 verdict 게이트 (탐지+informed 반영)
- **감지(Q4 정합)**: PostToolUse가 `post-ledger`에 기록한 **`entryId`(다운그레이드 편집=preimage 有 or +rev audit)** 를 트리거로 async 검증 enqueue. PreToolUse audit(SSOT)과 `tuid` 조인 — 재분류 아님.
- **검증**: 백그라운드 `l2-loop`를 `git diff -- <file>`에 실행 → verdict를 **verify-ledger(`evidence/verify-ledger.jsonl`)** 에 `entryId` 바인딩 append. dedup+cooldown(l2-loop 기존). 연속편집=최신 diff만.
- **알림 쓰로틀(중요, 피로방지)**: **verdict∈{settled-fail, blocker}인 고위험경로(auth·scheduler·secret 서브셋)만 Telegram**. `parser_fail·transient·terminal(재시도소진)`은 **알림 억제**(재시도는 엔진, 소진=`unverified-logged` 정직라벨 원장에만). 배치.
- **★ 반영점 verdict 게이트(Q1 해소)**: `pre-risk-classify.js`가 push/restart/install(반영점) 분류 시, **해당 반영이 싣는 대상경로들의 verify-ledger 최신 verdict를 조회**해 게이트 메시지에 주입:
  - **default(informed)**: 미검증/fail이면 gate reason에 `⚠ 대상경로 미검증(N)·fail(M)` 표출 → 대표 T3 승인이 informed. 결정등급 불변(비블로킹).
  - **토글 `reflectionHardBlock`(default-off)**: on이면 대상경로에 fail/미검증 있으면 push를 **deny로 승격**(자동 하드게이트, §2.2 완전충족). c-4 안정 실측 후 대표 승인으로 on.
  - 대상경로 추출: push=`git diff --name-only @{push}..HEAD`(또는 origin/BR..HEAD), restart/install=서비스/프로젝트 경로 매핑(보수적: 불명시 전체 경고).

## 7. flip 준비도 체크리스트 (①c 완료 = flip 적격)
1. c-1 홀드백(pkgjson·lockfile·generated 비다운그레이드) 골든 통과.
2. c-0 훅 리파인(only-if-dirty·바인딩키·postSha) 적용+e2e(clean=blob無·dirty=blob有·MultiEdit 파일별 entryId).
3. c-2 prune 라이브(verified/superseded만 삭제·pending 보존·aged-pending 에스컬레이션) 실측.
4. c-3 restore(list·복원·postSha 변경감지 자동중단·git-first) 실측.
5. c-4 감지→l2-loop→verify-ledger 바인딩 + **반영점 verdict 주입(informed)** + 고위험 fail만 알림 실측.
6. 반영점 게이트 회귀(push T3·restart/install T2) + 236/1 골든 + ①c 신규 골든 그린(1 fail=stale, 정리검토).
→ 충족 시 flip을 대표께 근거+체크리스트로 상신. (하드블록 토글은 flip 후 별도 승인 가능.)

## 8. 리스크·롤백
- c-2 과잉prune: verified/superseded만+pending보존+fail-safe(오류시 미삭제)+git 2차폴백. c-3 사용자변경: postSha 자동중단+제안형. c-4 폭주/피로: dedup+cooldown+error-type 쓰로틀. 롤백: c-1=정책 revert 1회, c-0=훅 revert(.bak), c-2/c-4 cron/hook 배선제거, 각 config 토글 보수default.
- **잔여(정직)**: 로컬 `node evil.js` RCE=blocklist 옵션A ambient(flip 무관 기존). secret=only-if-dirty로 clean케이스 근절, dirty만 짧은창(unlink 비보안소거 잔여). secret-code glob 대소문자 취약은 별도 보강거리(only-if-dirty가 1차 완화).

## 9. L2 반영 대장 (v1→v2)
| Q | sev | 반영 |
|---|---|---|
| Q1 반영점 하드게이트 | blocker×2 | **c-4에 반영점 verdict 게이트 편입**(informed default + hardblock 토글) — §2.2 메커니즘 충족, ②분리 철회 §1·§6 |
| Q2 TTL/secret/§2.1보존 | blocker×2 | **pre-image only-if-dirty(§3a)** 근원해소 + prune=verified/superseded만·pending보존(§4) |
| Q4 감지 바인딩키 | blocker | **①b ledger 스키마 강화**(tuid·entryId·preSha·headSha·dirty·postSha, §3b/c) → entryId 바인딩 |
| Q3 post-sha 변경감지 | important | postSha 기록→c-3 자동중단(§3c·§5) |
| Q1 보조 verdict표출 | important | 반영점 informed 경고 명문(§6) |
| Q2 보조 secret-code취약 | important | only-if-dirty 1차완화 명시, glob보강=별도거리(§8) |
| Q5 generated 홀드백 | nitpick | 유지 확정(§2) |

## 10. 검증 계획
- 골든: c-1 홀드백·반영점 게이트 유지·c-2 prune 순수함수(verified/superseded/pending/aged 분기)·c-3 postSha 변경감지·c-4 감지·verdict 주입.
- e2e: c-0 훅(clean/dirty/MultiEdit 격리 subprocess)·c-2 임시 ledger prune·c-3 복원왕복·c-4 편집→verdict 바인딩(l2-loop stub).
- 자체 L2: 본 v2 재검증(수렴확인) → 각 구현 diff별 L2.

## 11. 구현 완료 (2026-07-04, candidate — 대표 `!bash ~/p1c/apply.sh` 적용 대기)
5파일(default-off no-op): `decision-policy.json`(c-1 홀드백 3줄삭제) · `hooks/pre-risk-classify.js`(c-0 only-if-dirty+ledger바인딩키+c-4c 반영점게이트) · `hooks/post-exec-instrument.js`(c-4a postSha) · `preimage-prune.js`(신규 c-2) · `preimage-restore.js`(신규 c-3).
- **검증 실측**: c-1 골든13 · c-0 e2e22+OFF-noop8 · c-2 골든16+run7 · c-3 골든12+CLI5 · c-4 e2e11. 전 훅 OFF≡canonical(no-op).
- **자체 L2 2R(codex∥gemini)**: 1R서 **실질 blocker/important 5** 포착·수정 — ①prune superseded가 dirty blob(=U 유일본, git엔 V만) 삭제=§2.1위반·데이터손실→**verified-only 삭제** ②restore postSha null→change-guard 무력→**need-force(fail-safe)** ③postSha 바인딩 LIFO→**FIFO** ④only-if-dirty TOCTOU→**read후 재확인 승격** ⑤prune unlink 선행→**ledger rewrite 후 unlink**. 2R **양 벤더 CONVERGED**(blocker0·important0, nitpick=stale주석 정정).
- **핵심 성과**: only-if-dirty로 clean 편집=blob無=secret 근원차단(Q2). 반영점 informed 게이트로 대표 맹목승인 SPOF 차단(Q1). async 자동검증(비용)은 대표 승인 게이트로 ② 분리.
- **적용 후 남은 것(flip 전)**: prune hermes cron 등록(`jobs.json`, evidence 쌓이는 flip 시점) · reflectionHardBlock 토글(정책 `reversibilityDowngrade.reflectionHardBlock:true`) · TTL 튜닝(`evidence.preimageTtlDays`) · async 자동검증 ② · **flip(enabled→true)**.
