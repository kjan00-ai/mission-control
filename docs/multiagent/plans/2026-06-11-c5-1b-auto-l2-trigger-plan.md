# C5-1b 실행계획 — Auto-L2 자동발동 (Post-Task Stop 훅)

> MAIA 자율화: L2 검증을 **수동 호출 → Post-Task 자동발동**으로. 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.B/비전①④ + Auto-L2 규약.
> - 날짜: 2026-06-11 / 작성: claude / 버전: **v2 (L2 round1 반영 — quiet-period·snapshot·root제한·mark-after-spawn·watermark제거) · 라이브**
> - 선행: C5-1a(L2 엔진 `l2-loop.js`) ✅. SSOT: `~/.ai-bootstrap/{l2-auto.js,l2-loop.js}` + `~/.claude/hooks/post-task-l2.js`.

## 0. 한 줄 정의
Claude가 턴을 마치면(**Stop 훅 = Post-Task 신호**) risk audit를 스캔해, 이번에 생성/변경된 **spec/plan/design 산출물**을 자동으로 `l2-loop.js`에 백그라운드 발동. 결과는 위키 `reviews/`에 적재. 수동 호출 불요.

## 1. 목표 / 비목표
### 목표
- **자동발동**: Stop 훅이 산출물 변경을 감지 → l2-loop **detached spawn**(비블로킹). Auto-L2 규약("Post-Task 1회, 편집마다 아님") 준수.
- **스팸 방지**: content-hash dedup + per-artifact cooldown(15m) + max-per-stop(2).
- **무해 보장**: 훅은 **절대 블로킹/차단 안 함**(exit 0), fail-open, 킬스위치(`MAIA_AUTOL2_OFF=1`).
### 비목표
- **동일 세션 피드백 루프**(Stop이 L2 결과로 Claude를 재개) = 위험(분기·수 분 블로킹) → 제외. 결과는 위키+다음세션/알림.
- **T2+ 코드편집 발동**: 단일 artifact 모델이 아니라 diff 검토라 별도(diff-artifact 모델) → 이연. MVP는 spec/plan/design md만.
- **MC durable bus**(`l2_reviews/l2_rounds` 테이블) = C5-2.
- **실시간 BLOCKER 알림** = 후속(현재 위키 적재).

## 2. 메커니즘
### 선별 (`l2-auto.js`, 순수·주입식 — state 불변)
- `isQualifying(path)`: spec/plan/design md만(`/specs?|plans?|designs?/` 디렉토리 **또는** `-{spec,plan,design}.md` 접미사). **loose `(plan|spec)anything.md` 폐기**(meal-planner 오탐 차단, `cb2b3194`). reviews/·`-l2-` 제외(anti-recursion).
- `selectArtifacts({writes,state,now,cooldownMs,quietMs,max,hashOf})`: 경로별 최신 write → **quiet-period(`now-ts<quietMs`=편집중 skip, `6d0817b9`)** → hash 계산 → 신규/변경 판정(unchanged·cooldown skip) → max 캡(초과분 deferred). **state 미변경**(마킹은 훅이 spawn 후).
### Stop 훅 (`post-task-l2.js`)
- stdin drain → audit Edit/Write **최근 24h**(워터마크 아님 — reviewed-hash로 dedup, deferred 생존, `f7e074b0`) → **root 제한**(realpath이 repo/wiki 하위만, `7ececfe8`) → `selectArtifacts` → 선별마다: **① 스냅샷**(원본 복사본을 l2-loop에 전달 → read-time race 제거, `6e5ad8df`) **② detached spawn.unref()**(비블로킹) **③ spawn 성공 시에만 reviewed 마킹**(실패=다음 Stop 재시도, `743087fb`) → reviewed prune(7d) → atomic state 저장 → exit 0.
- env override(테스트): `MAIA_AUTOL2_BOOT`·`MAIA_L2LOOP`·`MAIA_AUTOL2_ROOTS`. 로직 모듈은 항상 실경로.

## 3. 안전/리스크
- **블로킹 금지**: detached+unref → 훅은 즉시 반환, l2-loop는 턴 종료 후 백그라운드 진행(수 분).
- **무한루프 금지**: 차단(block) 결정 미반환 → Stop 재귀 없음. l2-loop의 위키 write는 node가 수행(Claude tool 아님)·reviews/는 비qualifying → 재발동 없음.
- **스팸**: hash dedup(동일내용 재검토 안 함) + cooldown(활성 편집 중 디바운스) + max/stop. l2-loop 자체 lockfile로 중복 spawn 무해.
- **fail-open**: 모든 예외 exit 0. audit/state 손상·정책로드 실패 시 무발동(세션 보호).
- **비용**: spec/plan/design 변경 시에만, 회당 ≤2, l2-loop 내부 max-calls≤8.
- **한계(수용)**: ① 결과가 **비동기**(현 세션은 못 봄) → 다음 세션 위키 픽업, 실시간 알림은 후속. ② "Post-Task 경계"를 Stop(매 턴)+hash/cooldown으로 근사 → 활성 iteration 중 중간본 발동 가능(cooldown 완화).

## 4. 검증 계획
- `l2-auto.test.js`(14): isQualifying(plan/spec/design yes·reviews/·.ts no) / select(신규·unchanged·cooldown·max·newest-ts).
- Stop 훅 시뮬(mock l2-loop): 신규 plan→spawn·state기록 / 변경없음→무발동. (완료.)
- 라이브: 이 plan 생성→다음 Stop서 자동 L2 발동 관찰(위키 reviews/).

## 4.1 L2 검증 결과 (dogfounding — 2026-06-11~12, 2라운드 → 수렴)
- **L2-1**: codex 5 + gemini 4. **실 결함 6건 코드 반영(v2)**: 워터마크→deferred 영구누락(`f7e074b0`)·spawn전 마킹→실패 누락(`743087fb`)·매턴 Stop 활성draft 스팸(`6d0817b9`)·read-time race(`6e5ad8df`)·경로 미검증(`7ececfe8`)·정규식 과탐(`cb2b3194`).
- **L2-2(v2)**: **신규 코드버그 0** — 전부 본질 tradeoff/경계된 정제/후속. **수렴.** 테스트 16 + 훅 시뮬 4종 통과.

## 4.2 아키텍처 원칙·수용 한계 (L2-2 반영)
- **★ auto-L2 = 비동기 안전망, 세션 게이트 아님 (`edf5ccd6`/`baf36f8e`)**: 비블로킹이 설계 핵심(턴마다 수 분 블로킹 거부). 따라서 자동 L2는 결함 plan으로의 즉시 구현을 *막지 않는다*. **운용 규칙**: 게이트가 필요한 중요 산출물(spec/plan/design 확정)은 **에이전트가 동기 L2를 직접 수행**(`l2-loop` 호출→결과 확인 후 진행, 이번 세션 내내 실천). auto는 누락분을 사후 포착하는 안전망. async 발견 BLOCKER는 **실시간 알림(후속)**으로 폐루프.
- **spawn≠완료 silent failure (`425e15ad`/`0aa0eb60`)**: spawn 성공 마킹은 l2-loop 크래시/타임아웃 시 재검증 누락 가능. **7d prune로 재검증 경계**(영구 아님). 완전 해소 = **output기반 dedup**(review md 존재로 판정) 후속.
- **state 락(`97dc2b30`)**: atomic write + l2-loop lockfile + 턴 순차성으로 완화. 다중 세션 동시성은 잔여(저빈도).
- **무관측 fail-open(`e5fb29f8`)**: 손상 시 조용히 무발동 → **health heartbeat**(hermes-cron이 "reviews 산출 중?" 점검) 후속.
- **reviews md lifecycle(`02a41937`)**: 자동 누적 → 그래프 오염. settled 아카이브 자동화 후속.

## 4.3 후속 과제 (우선순위)
1. **실시간 BLOCKER 알림** (`5ba3f411`/`edf5ccd6`, gemini 3세션 연속) — l2-loop 완료 시 escalation/blocker를 hermes/telegram 통지. async 폐루프의 핵심.
2. **output기반 dedup** — spawn 대신 review md 존재로 재검증 판정(silent failure 제거).
3. **health heartbeat + reviews 아카이브** — 무발동 관측 + 그래프 오염 방지.

## 5. 롤백
- `~/.claude/settings.json` hooks.Stop 제거(1블록) → 자동발동 중단(l2-loop 수동 호출은 유지). 또는 `MAIA_AUTOL2_OFF=1`.

## 6. 관련
- 설계 [[2026-06-11-maia-autonomy-overhaul]] §2.B / 선행 [[c5-1a-l2-loop-engine-20260611]] / [[c5-0a-ext-bash-autonomy-plan]]
