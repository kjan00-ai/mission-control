# W3 — ② async 검증(informed) + B.1 인간관측 보존 설계 (2026-07-04, 옵션2)

> **L2 적대검증 대상.** flip 후 다운그레이드-편집 코드·확정 산출물을 async 검증(l2-loop)해 반영점(push/deploy/install)이 실제 verdict를 표출 → 대표 승인이 INFORMED. **hardblock 아님**(A1 전제, VA §2.2·[[va-c7-reconciliation-l2-confirmed]]). MAIA=글로벌: 전 컴포넌트 shared→BC/SF/신규 도달.
> **비용 범위(대표 승인 옵션2)**: async l2-loop = (a) reversibleClass **코드** commit + (b) **verifyRequiredPaths**(docs/multiagent/{plans,specs,decisions}) commit. dedup+rate-limit로 반복과금 제어.

## 컴포넌트

### 1. 트리거 — commit 시 async verify (post-exec-instrument.js 확장)
기존 PostToolUse가 자율 commit HEAD SHA를 이미 포착(A). 확장: downgrade enabled AND commit이 대상경로 포함 시 **detached async verify 프로세스** spawn(비블로킹).
- 대상 판정: `git show --name-only <sha>` 변경파일이 reversibleClass 글롭(코드) 또는 verifyRequiredPaths(산출물) 매칭.
- **비용 제어**: ①**dedup** — runKey(=sha256(정렬된 변경경로 + diff-hash)) 이미 verify-ledger에 있으면 skip. ②**rate-limit** — 시간당 N건 상한(초과=큐잉/스킵+로그). ③대상경로만(전 commit 아님). ④**기존 Auto-L2 재사용** — 산출물이 Stop훅 Auto-L2로 이미 검증됐으면 verdict 바인딩만(재검증 안 함).
- **Windows**: async l2-loop는 [[l2-avail-wsl-independence]] Windows 네이티브 폴백 경로로 구동.

### 2. verify 원장 (`~/.ai-bootstrap/evidence/verify-ledger.jsonl`) — v2 확정 계약
엔트리 `{contentKey, commitSha, paths[], kind:'code'|'artifact', verdict, source:'l2', ts, verifiedTs}`.
- **단일키 = `contentKey`**(정렬 변경경로 + diff-hash, **SHA독립**) → dedup·판정 기준. `commitSha`는 **감사 기록만**(rebase/amend 무영향).
- **pre-image 원장 미mutate**(❶): verdict는 verify-ledger에만 append. reflectionAdvisory가 **read시점 조인**(현 구현=path별 최신 verdict; HEAD-net contentKey 정밀재산정은 informed 근사 → W3.1 개선여지, L2 7d7c1f00).
- 원장 파일은 evidence dir 소속 → G2 containment 동일 보호.

### 3. B.1 인간관측 보존 (흡수 금지 — [[va-c7-reconciliation-l2-confirmed]])
verdict에 **`source` 명시**: `'l2'`(자동검증) vs `'human'`(인간이 holdback 표본 검토·거부0). **l2-검증을 인간관측으로 위장 금지.** reflection note는 **분리 카운트**: "L2-검증 N / 인간관측 M / 미검증 K". 향후 활성화(B)는 human-observation을 별도 요구 — W3는 그 채널을 삭제하지 않고 **스키마로 보존**(미측정≠증거, Silent Trigger 방지).

### 4. 반영점 verdict 소비 (reflectionAdvisory 소폭 갱신)
기존 reflectionAdvisory가 pre-image 원장 verdict를 읽음(현재 전부 null). W3가 **verdict WRITER를 추가**해 카운트가 유의미해짐. push/deploy/install 승인 시 "미검증 K건" 대신 "L2-검증 N/인간관측 M/미검증 K" informed 표출.

### 5. service→path→ledgerkey 매핑 (L2 7d8970e4)
config(`decision-policy.evidence.serviceMap` 또는 신규): `{hermes-gateway:[경로], mission-control:[repo], cloudflared-c3:[경로]}`. `systemctl restart <svc>` 반영점 → svc→경로→원장 verdict 카운트. informed 수준은 **coarse(repo-scoped)** 허용(미검증 상한=정직 superset).

## 불변식
- **informed 전용**(hardblock 아님) → 오검증이 자율을 막지도, 허위 통과시키지도 않음. A1 후 hardblock 승격.
- fail-safe: verify 실패/미완 = "미검증"으로 정직 표기(통과 위장 금지).
- async = 비블로킹(commit·편집 안 막음). 검증은 사후.
- 비용: dedup+rate-limit+대상한정+Auto-L2재사용 → 반복과금 상한.

## L2 반영 v2 (codex∥gemini 6 settled — 구현 계약 확정)
- **❶ 원장 레이스(blocker `9fd42e81`)**: verify-ledger = **append-only**(verdict마다 새 줄, reader는 runKey별 최신 채택). **pre-image 원장을 mutate하지 않음** — verdict는 verify-ledger에만 append하고 reflectionAdvisory가 **read시점 조인**(commitSha/contentKey). prune은 G1 id-filter 재-read 패턴 재사용. → detached 다중 verify·prune 경합서도 유실/손상 없음(append는 원자·조인은 읽기전용).
- **❷ runKey 충돌·rebase dedup(blocker `3931e5fc`·`8c027827`)**: **2키 분리**. **`contentKey`=sha256(정렬 변경경로 + diff-hash)** = **dedup·HEAD-net 판정 단일기준**(rebase/amend로 SHA 바뀌어도 같은 diff→같은 contentKey→재검증 안 함). **`commitSha`는 기록만**(감사). 반영점 게이트 = 현재 HEAD의 net 변경으로 contentKey 재산정→합격 verdict 조회.
- **❸ rate-limit 커버리지 손실(`aa3d0602`·`d06c1df9`)**: 초과 시 **스킵 아니라 영속 큐**(`verify-queue.jsonl`) enqueue + **verdict:'queued' 원장 기록**(reflection이 "미검증" 아닌 "검증대기 K"로 정직표출). 드레인=prune cron이 겸함(TTL·retry상한). 조용한 손실 없음.
- **❹ Windows async 실구동(`714e367b`)**: 트리거가 spawn하는 것 명시 = `node <l2-loop 경로> <diff아티팩트> --reviewers codex,gemini`(detached). Windows는 [[l2-avail-wsl-independence]] 폴백 경로. **spawn 실패=verdict:'verify-unavailable' 원장 기록**(정직 degrade, "미검증"과 구분). 실패감지=exit code + 타임아웃.
- **❺ 인간관측 위조 게이트(`52f486f4`)**: **W3는 source='l2'만 씀. human은 절대 안 씀**(스키마 예약만). human 엔트리 writer는 **향후 B단계 대표-게이트 컴포넌트**(owner `!`/대시보드)만. reflectionAdvisory는 source별 신뢰경계 분리 카운트, W3가 human을 못 만드니 위조 불가. 미측정≠증거 유지.

## 구현 완료 (2026-07-04, ~/p1c/candidates/)
- **`w3-async-verify.js`(신규 shared)**: classify·**contentKey(경로+diffHash, SHA독립=rebase안정)**·dedup(verify-ledger read)·rate→**영속 큐+verdict:'queued'**·`runL2Verify`(diff→temp md→l2-loop spawn→집계 verdict 매핑; 실패=verify-unavailable)·**append-only 원장**·`--drain`(planDrain: rate-bounded 처리+TTL 드롭+compact).
- **`post-exec-instrument.js`(훅)**: 자율 commit시 enabled면 워커 **detached spawn**(unref·windowsHide, 비블로킹).
- **`pre-risk-classify.js` reflectionAdvisory(훅)**: verify-ledger **read시점 조인**(pre-image 원장 미mutate), path별 최신 verdict, **source 분리**(L2검증/인간관측/검증실패/검증대기/미검증) informed 표출. all-pass=✓통과·risk=⚠검토권장. hardblock(default-off)은 non-pass에만.
- **prune cron 연동**: 드레인+compact 겸함. **매니페스트 shared 등재**(Windows 동기 → BC/SF 워커 구동).
- **검증**: 순수로직 27/27(contentKey·classify·조인·verdict·rate·planDrain) + reflection 조인 e2e 6/6(미검증/L2검증/실패/인간관측) + 회귀 c-0 22·c-4 11 무회귀.
- **비용(옵션2)**: dedup(contentKey)+rate-cap(12/h)+큐+대상경로한정. rebase/amend 재검증 안 함.

## 적대검증 요청 (의심 축)
- **A. 비용 런어웨이**: dedup(runKey)·rate-limit이 실제로 반복 l2-loop 폭주를 막나? 리베이스·amend·CI 재commit로 같은 diff 재검증? 상한 초과 시 조용한 커버리지 손실을 로그하나?
- **B. runKey 정합**: content-hash+SHA 바인딩이 TOCTOU(검증 후 재편집)·stale·타산출물 혼동을 막나? 반영점 "현재 HEAD net" 판정이 수정-commit 브랜치를 영구차단 안 하나(021457c4)?
- **C. 인간관측 보존**: source='l2'/'human' 분리가 실제로 Silent Trigger를 막나? W3가 human 채널을 삭제/위장하지 않음을 스키마·소비지점에서 보장?
- **D. 비블로킹 레이스**: detached verify가 pre-image 원장 verdict를 쓰는 동안 prune(G1)/다른 verify와 경합? 원장 write 원자성?
- **E. Windows async verify**: BC/SF에서 l2-loop 네이티브 폴백이 실제 구동? 미구동 시 "미검증" 정직표기로 degrade?
- **F. informed 무해성**: 오검증(FP/FN)이 hardblock 아니므로 안전한가? 대표가 informed note를 과신할 위험(라벨 정직성)?
