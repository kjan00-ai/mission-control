# W3.1 — 글로벌 완결성 2건 (Windows 큐 드레인 크로스환경화 + stale-verify 조인 정밀화)

> date: 2026-07-04 · author: claude · status: design (L2 대상)
> 전제: [[SESSION-HANDOFF-verified-autonomy-global-live-w3-20260704]] 차기 진입점 1순위.
> SSOT 파일: `~/.ai-bootstrap/w3-async-verify.js`(shared, 배포 대상) · `~/.ai-bootstrap/hooks/pre-risk-classify.js`(A2 T3 게이트).

## 배경
W3 async검증(informed)은 자율 커밋(reversibleClass CODE / verifyRequiredPaths ARTIFACT)마다 PostToolUse가
detached로 `w3-async-verify.js`를 띄워 l2-loop 적대검증→verdict를 append-only `verify-ledger.jsonl`에 기록한다.
시간당 rate 초과 시 `verify-queue.jsonl`에 큐잉하고 hermes 크론(`preimage-prune-cron.sh`, daily 09:40)이
`--drain`으로 처리·컴팩트한다. 반영점(push/infra/pkg-install)에서 `reflectionAdvisory`가 verify-ledger를
조인해 "반영 대상 가역편집 검증: L2검증 N·미검증 M…"을 대표 승인에 informed로 표출한다(hardblock 아님).

## 결함 2건 (글로벌 완결성)

### D1 — 드레인이 WSL 큐만 청소 (크로스환경 미완결)
`drain(now)`는 WSL canonical `~/.ai-bootstrap/evidence/verify-queue.jsonl` **하나만** 처리한다.
BC/SF는 네이티브 Windows에서 Claude Code를 돌리므로 그들의 W3 워커(`main`)는
`C:\Users\design\.ai-bootstrap\evidence\verify-queue.jsonl`(Windows home)에 큐잉한다. Windows 스케줄러는
없다(G1과 동일 제약). 따라서 **Windows 큐 항목은 어떤 크론도 처리하지 않아 고아**가 된다(TTL 드롭조차 소유
env 드레인에서 일어나는데 그게 안 돎). → G1 `preimage-prune.runAll`/`scanEnvLedgers`가 확립한
"WSL 크론 1개가 전 env ledger 청소(`/mnt/c` 경유)" 패턴을 W3 큐/원장에도 미러링.

### D2 — reflectionAdvisory 조인이 path별 최신 verdict (재편집 stale)
`reflectionAdvisory`는 verify-ledger를 `absPath → 최신 verdict`로 평탄화 조인한다(ts 최신 승). 어떤 path가
커밋 A(contentKey_A)에서 verified(pass) 된 뒤 커밋 B에서 **재편집**되면, B의 새 contentKey는 아직 미검증인데
vmap은 여전히 path의 옛 pass를 표시 → 반영점에서 **stale "L2검증"**으로 오표기. informed라 안전하지만
정확도 결함(대표가 검증됐다고 오인). contentKey는 `sha(sorted paths + hash(diff))`로 **재편집엔 민감·rebase엔
안정**하도록 설계돼 있으므로, 조인 시 **현재 반영 내용으로 contentKey를 재산정**해 일치할 때만 verified 카운트.

## 설계

### D1 해법 — `w3-async-verify.js` drain 크로스환경화 (G1 미러)
1. **경로 변환 로컬 복제**: `toWslPath`/`usableWsl`를 w3에 **로컬 복제**(주석으로 preimage-prune=패턴 출처 명시).
   preimage-prune은 `wslOnly`(Windows 미배포), w3은 `shared`(Windows 배포) → Windows에서 w3 로드 시
   `require('./preimage-prune')`는 파일 부재로 throw. drain은 WSL 전용 경로지만 **모듈 top-level require는
   `main`(Windows PostToolUse) 로드에도 실행**되므로 top-level 의존 금지. 순수·안정한 5줄 함수라 복제 허용.
2. **`scanEnvEvidence()`**: WSL canonical(`~/.ai-bootstrap/evidence`) + 매니페스트 `targets[*].boot`를 `/mnt`로
   변환해 스캔. `path.resolve(evidence)`로 dedup(→ `wsl` 타겟과 canonical 동일경로=1회만). **evidence 디렉토리
   존재 시에만** 등재(G1 evOk와 동일 — Windows에 evidence/ 미생성이면 조용히 skip; flip 직후 현 상태).
   반환 `[{ evidence, queue, ledger }]`.
3. **`drainEnv(env, now, rateState, cfg)`**: 기존 drain을 per-env 파라미터화.
   - `planDrain`(순수, 유지)으로 SNAPSHOT에서 rate-bounded `process[]` 선정. `processedKeys = Set(contentKey)`.
   - process 항목: Windows 항목이면 `cwd`를 `usableWsl(it.cwd)`로 번역해 `diffOf`/`runL2Verify` 실행,
     verdict를 **해당 env의 ledger**(`env.ledger`)에 append(Windows 반영점이 자기 원장을 읽어 informed).
   - **큐 재작성 = 레이스안전 재-read**(G1 blocker 9e2054eb 미러): 쓰기 시점에 `env.queue`를 **재-read**해서
     각 라인을 `drop = processedKeys.has(ck) || (이미 verified in 현재ledger) || TTL초과` 규칙으로 필터.
     → 스냅샷 이후 Windows 훅이 append한 신규 항목은 processed 아님·TTL 이내 → **보존**(유실 방지).
   - **원장 컴팩트**: `env.ledger` 재-read → contentKey별 최신 1건만 atomic 재작성(성장 상한).
   - shared `rateState`를 in/out으로 스레드(mutate).
4. **`drainAll(now)`**: WSL canonical rate 파일(`state/w3-rate.json`) 하나를 **단일 예산**으로 로드 →
   `scanEnvEvidence()` 순회하며 각 env를 shared rateState로 drainEnv → 최종 rate 1회 persist.
   근거: L2 검증은 WSL 기계 1대의 벤더 예산을 공유하므로 env별 별도 예산이 아니라 **전 env 통합 예산**이 옳다.
   `--drain` CLI → `drainAll`. 하위호환용 `drain(now)` export = `drainAll` 래퍼.
5. **파라미터화**: `appendLedger(ledgerPath, entry)`·`enqueue(queuePath, item)`로 변경, `main()`의 호출부는
   로컬 `VLEDGER`/`VQUEUE` 전달(main=소유 env 로컬 유지, 크로스환경 아님).

### D2 해법 — `reflectionAdvisory` 조인 정밀화
> ⚠️ **contentKey 재산정 방식은 L2 blocker(`534c84d2`)로 폐기**. 워커 contentKey는 `git show <sha>`(커밋
> 헤더 포함) 기반이라 반영시점 헤더없는 diff와 **절대 불일치** → 정상검증도 전부 stale 오표기. 대체 =
> **내용 diff**: 검증커밋과 현재 HEAD 사이 해당 path가 바뀌었나(`git diff --quiet <commitSha> HEAD -- paths`).

1. **`w3-async-verify.js`에 순수 함수 추가·export**(SSOT·테스트 용이):
   - `isEntryFresh(entry, changedSince)`: `changedSince(entry)` → `false`(불변)일 때 **만** fresh(true).
     `true`(재편집)·`null`(불확실: git실패/커밋 gc)·malformed → **false = 미검증(conservative)**. 즉 "증명된
     불변"만 verified로 카운트. → git 히컵/이력소실 시 stale pass를 통과시키지 않음(L2 `85901faf`: "절대
     false-verified 안 냄" 불변식 준수). 노이즈(git실패→미검증)는 드물고 안전방향. **rebase는 내용동일→diff
     빈=fresh**(SHA 아닌 내용 대조라 SHA-robust).
   - `reflectionTally(relevant, vmap, isFresh)`: 순수 집계. `isFresh(v)` 실패 시 미검증, 나머지는 기존 분기.
2. **`pre-risk-classify.js`(T3) 최소 편집**:
   - vmap 값에 `commitSha`·`paths`(rel) 보존.
   - `changedSince(entry)` 클로저 = `git diff --quiet <commitSha> HEAD -- paths` (exit0=불변·1=변경·기타=null).
     commitSha별 캐시. **range 비의존이라 push·infra·pkg-install 전 반영 타입에 균일 적용**(L2 `fda80094`:
     infra/pkg 미적용 결함 해소 — 글로벌 완결성 달성).
   - 집계 루프를 `W3.reflectionTally(...)` 호출로 치환. **hardblock 공식(§) 자체는 불변**이나, D2가 stale을
     unverified로 재분류하므로 `reflectionHardBlock=true` 환경에선 **재편집분이 올바르게 차단으로 반영**된다
     (의도된 정확도 개선; 현재 hardblock=default-off라 라이브 영향 0 — L2 `967a281c` 정정).
   - w3 require: shared(양쪽 존재). require throw → 외곽 catch = advisory 미표출(안전).

**보수성(수용)**: "증명된 불변"만 verified → git 실패·commit gc·malformed는 미검증. 절대 false-verified 안 냄
(안전방향). 노이즈는 드묾.

## 불변식 / 안전
- **informed only**: 두 결함 다 hardblock 아님. D1은 큐 처리 범위, D2는 표기 정확도. flip 게이트 로직 불변.
- **default-off 무회귀**: `reversibilityDowngrade.enabled=false`면 `main`/`drain`/`reflectionAdvisory` 전부 no-op.
- **레이스안전**: 큐/원장 재작성은 전부 재-read-후-drop-by-key(G1과 동일 불변식) → 크로스환경 동시 append 보존.
- **fail-safe**: scan/translate/git/require 실패 → 해당 env skip 또는 verdict 보존(현행 동작), 절대 오차단 없음.
- **A2/T3**: `pre-risk-classify.js` 편집은 게이트 로직 파일=대표 `!` 커밋. w3=shared=maia-deploy 후 대표 push.

## 검증
- 단위테스트 `w3-async-verify.test.js` 신설(10 tests, 전부 pass): contentKey 순서안정·toWslPath/usableWsl·
  rateOk·planDrain(rate/TTL/기검증/shared state)·scanEnvEvidence dedup·drainEnv(레이스안전 재read 보존·TTL드롭·
  rate-defer 유지·기검증 제거)·isEntryFresh(불변→fresh / 재편집→stale / null·malformed→conservative)·reflectionTally.
- 회귀: l2-loop 19/19·c6-queue 8/8 pass. risk-classify 5실패 = **선재**(flip 커밋 `1b93cbc`가 canonical을
  enabled:true로 바꿔 테스트 `polOff=loadPolicy()`의 enabled:false 가정 깨짐 — W3.1 무관, 별건 보고).
- 실 `--drain` 라이브: `processed=0 requeued=0 envs=1`(WSL canonical만 evidence 존재, 큐 없음).
- maia-deploy `--check` byte동기 확인.
- **자체검토(대표 "확인해봐") 발견·수정**: drainEnv가 큐파일 부재 시 조기 return→**원장 컴팩션 누락 회귀**(WSL
  canonical은 원장O·큐X라 실발생). 수정=`hadQueue` 추적으로 조기return 제거·큐 없으면 큐재작성만 skip·컴팩션 항상
  수행·빈 파일 스퍼리어스 생성 방지. 전용 테스트 추가(11 tests 전부 pass). 재배포 byte동기·Windows 11/11.

## L2 반영 (round 1, codex∥gemini, 6 findings → 5 settled·1 escalate)
- `534c84d2` **blocker**(codex): contentKey 재산정 mismatch → **내용 diff 방식으로 전면 교체**(위 D2).
- `d2cd4401` **blocker**(codex): 큐 재작성 재-read도 rename 직전 append 유실 가능 → **과claim 정정 + benign
  bound 명시**(유실=안전한 미검증·절대 false-verified 아님·enqueue는 원장 'queued' 마커 병기·승인된 G1 선례
  동급·창=read→rename 몇 fs op). 크로스-OS(drvfs) lock-free 완전제거 불가 = 정직한 한계.
- `85901faf` **important**(codex): git실패 fail-safe가 stale pass 통과 → **null→conservative 미검증**으로 수정.
- `967a281c` **important**(codex): hardblock 불변 주장 부정확 → **문서 정정**(공식불변·재분류가 hardblock=true서
  올바르게 반영·현재 default-off).
- `fda80094` **important**(gemini): D2 infra/pkg 미적용 → 내용diff 방식이 range 비의존 → **전 반영타입 균일 적용**.
- `ca19f887` **important**(gemini, 🚩escalate·codex refute): 경로변환 로컬복제 DRY. codex 반박=Windows shared
  top-level require 실패 회피 제약 대응·순수 5줄 한정. **대표 판정 대상** — 권고=로컬복제 유지(대안 lazy-require는
  wslOnly↔shared 경계서 자체 취약·유지부담 미미). 롤백 시 lazy-require 전환 가능.
