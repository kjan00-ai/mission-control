# §6-3 L2 티어패널 배선 — 구현 기록 (2026-08-29)

- **문서유형**: 구현 기록 (frozen spec 이행)
- **상위 spec**: [[2026-07-05-l2-tier-panel-wiring-spec]] (동결 매핑) / 선결 [[2026-08-29-concordance-standing-metric-promotion]]
- **대상**: `~/.ai-bootstrap/l2-loop.js` + 신규 `~/.ai-bootstrap/l2-tier.json` + `maia-manifest.json`. shared 인프라(WSL canonical).

## 배경
frozen spec §2 티어→L2 패널 매핑을 코드에 배선. 단, spec §3/§4가 배선 전제로 둔 "GLM 실제 생성스트림"이 미충족(GLM=수동 opt-in PoC) → **채택: 메커니즘 전부 배선 + codex 비용은 단일 config 게이트(`codexT23Enabled`)로 대기**. flip 전까지 거동은 레거시(claude,gemini) 동일.

## 구현 계약

### l2-tier.json (신규, T2 ask-gate)
- `enabled`(마스터, false=완전 no-op) / `codexT23Enabled`(단일 codex 게이트) / `defaultTier` / `sampling{T0,T1}`(1-in-N) / `panels{T0..T3}` / `codexPanel` / `domains{T3,T2,T1,T0}`(정규식 배열).
- shipping 기본: `enabled:true, codexT23Enabled:false, sampling{T0:1,T1:1}`, base 패널 전부 `["claude","gemini"]`(레거시 동일), `codexPanel:["codex","gemini","claude"]`.

### l2-loop.js
- `loadTierPolicy()`: `__dirname/l2-tier.json` 로드. 파일 **부재**=silent fail-open(의도적 kill 경로 ③), **파싱실패(malformed)**=stderr LOUD 경고 후 fail-open(L2 `55e29bc8` — 잘못된 배포가 은밀히 정책 무력화하는 것을 관측 가능화).
- `deriveArtifactTier(artifactPath, body, tierPolicy)`: `basename+body` lowercase → domains 정규식 스캔, **최고 티어 매칭 승**(T3>T2>T1>T0), 무매칭=defaultTier. 순수·결정론. 런타임 방어(L2 `5da0e4de`): 스캔 haystack **64KB 상한**(최악 실행시간 유계)+각 정규식 **compile·exec try/catch**(불량 패턴 skip, 크래시/블록 차단; 패턴은 owner-gated·단순형). `risk-classify.classify()` 미사용(safePaths.docs가 모든 *.md를 T0 강제, 금융/PII 규칙 부재라 도메인 티어링 불가 — 실측).
- `sampledIn(slug, N)`: `sha1(slug)%N===0`, N≤1→항상 true. 결정론(라운드/재실행 재현, Math.random 미사용).
- `resolveReviewers(cliVal, opts)`: precedence CLI > env > `opts.tierReviewers` > `['claude','gemini']`. **하위호환**(opts 미전달=기존 동작).
- `resolveL2Plan({cliReviewers, artifactPath, body, slug, tierPolicy})`: off(정책없음/`enabled≠true`/`MAIA_L2_TIER_OFF=1`)면 정확히 레거시 반환. on이면 티어산정→패널(T2/T3 & codexOn→codexPanel) + T0/T1 샘플링(무override & sampled-out→`skip:true`=L2 전면 스킵). override(CLI/env)는 never sampled.
- main() 통합: `resolveReviewers` 호출을 `body` 읽은 뒤·**lock 획득 전**으로 이동(sampled-out lock churn 회피), `plan.skip`이면 `exit 0`(skip 사유는 stderr `[l2-tier] sampled-out` 기록). exports에 신규 순수함수 4종 추가. ※ off 경로도 `body`를 lock 전 읽지만 **원본도 동일하게 lock 전 무조건 read**(L2 `c0d0231a`) — reviewers 결과는 레거시와 byte-동일, I/O 실패모드 불변.

## 가역성 (3중 kill + override)
1. `enabled:false` → 완전 레거시. 2. `MAIA_L2_TIER_OFF=1` env kill-switch. 3. l2-tier.json 삭제 → fail-open 레거시.
- CLI `--reviewers` / env `MAIA_L2_REVIEWERS`는 티어패널을 **항상** override.
- codex on T2/T3 = `codexT23Enabled` 단일 boolean flip(코드변경 0, T2 ask-gate).

## 테스트·검증
- `node --test l2-loop.test.js` = **28/28 pass**(기존 22 회귀 0 + 신규 6: 티어산정·패널선택/codex flip·precedence·flag-off no-op·샘플링 결정성·정규식 방어).
- `maia-deploy --check` = **0 unclassified**(manifest 등재 정확), drift=편집한 canonical(배포 대상).

## L2 검증 이력 (codex ∥ gemini, 2026-08-29)
> 원장: reviews `2026-08-29-l2-tier-panel-wiring-impl-l2-aggregation-20260829-135836`(+r2/r3). 3라운드, verdict=수정필요.
- **합의(corroborated) 4건 반영**: `55e29bc8`(malformed fail-open→LOUD 경고) ✅ / `5da0e4de`(정규식 compile·ReDoS 방어=try/catch+64KB 상한) ✅ / `0d11b665`(skip 무기록 감사성)=샘플링 기본 off로 dormant, skip 사유 stderr 기록·durable 감사는 **샘플링 활성 시 follow-up** / `c0d0231a`(body-read 순서)=원본도 lock 전 무조건 read라 거동 동등, 문서 정밀화.
- **에스컬레이션(refuted) 2건 = 미반영(대표 보고)**: `76a5be83`(정규식 티어링 복잡성)·`2d177543`(risk-classify 미사용=전략적 취약)—둘 다 gemini의 모호한 systemic 우려, codex가 "구체적 오분류/frozen spec 위반 근거 없음 + kill-switch·no-op·override·테스트로 완화"로 반박. 판정=codex 동의(미반영).

## 미충족·후속 (정직)
- **GLM 생성스트림 여전히 0** → codex 활성화(A) 편익은 GLM 검증이 아닌 일반 고위험 L2 강화. shipping은 대기(B). codex flip/샘플링 활성은 대표 시점 결정.
- **skip durable 감사** = T0/T1 샘플링 활성화 시 동반(현 dormant).
- decision-policy.json/c6-policy.json(T3) 미접촉.
