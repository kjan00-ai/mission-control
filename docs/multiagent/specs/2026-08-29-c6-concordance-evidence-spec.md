# P1 — concordance 기반 증거 조립 spec (프로젝트별 L2 검증 상시 원장)

- **문서유형**: spec (구현 전 동결 대상)
- **작성일**: 2026-08-29
- **상위**: 자율화 완성 로드맵(범위 A, 대표 2026-08-29) / concordance 승격 [[2026-08-29-concordance-standing-metric-promotion]] / 로드맵 B [[2026-06-24-a1-a2-b-roadmap]] / 증거벽 [[2026-07-05-c6-3-w5-hardblock-evidence-wall-convergence]]
- **대상**: 신규 `~/.ai-bootstrap/c6-concordance.js`(+test, shared). `c6-ready.js`(T3) 재사용만·미편집(이번). **default-off·advisory·게이트 미변경**(활성화=P3/P4 이연).

## 1. 문제
자율화 증거의 인간라벨 축(observedPositive)은 "MC에 자율경로 없음+대표 `!` bypass"로 **구조적 기아**(2026-07-19 종결). 로드맵 B의 정공법=증거를 **"MAIA L2 검증(concordance)"**으로 전환. #2에서 concordance를 상시지표로 **승격**했으나 **실제 산정·누적 파이프라인이 없음**(개념·재료만 존재).

## 2. 실측 (재료는 있고 조립기만 없음)
- L2 결과 store: `mission-control.db` `l2_reviews`(컬럼 **`project_id`·`final_verdict`·`consensus_blocker_count`·`blocker_count`·`content_hash`·`created_at`** 보유; 분포 BC=47·SF=9·MC=52·null=74) + `l2_rounds`(`canonical_items` JSON).
- 판정로직 존재: `c6-ready.js:35 classifyReviewTerminal`(honest=전 item `verified` 보유) + `:63 classifyIssue`(real/refuted/unverified) + `:74 l2HealthFromBus`(artifact별 최신 dedup·honest 코퍼스·blockerRate/unverifiedRate).
- **갭**: ① l2HealthFromBus가 **project_id 미필터**(전역) ② **순간 window rate라 누적 원장 없음**(매일 재계산·폐기) ③ 프로젝트별 상시 산정·리포트 없음.

## 3. 설계 = 프로젝트별 concordance 상시 원장 (advisory·누적·review-id 워터마크)
- **개념**: concordance = *프로젝트 P의 honest L2 코퍼스에서 산출물이 surviving real-blocker 없이 통과한 비율* + 검증 커버리지(미검증율). = #2 승격 지표의 상시 산정 실체. **이번엔 게이트가 아니라 누적·표출**(활성화 P3/P4).
- **event-stream 의미(L2 `217f87bc` 해소)**: 원장은 **review 이벤트 단위**(각 L2 review 1건 = 데이터 1점). artifact 재리뷰=새 이벤트(증거 순증, 정상). "artifact별 최신 1회"는 *순간 snapshot rate*용이지 누적 원장용 아님 — 혼용 제거.
- **워터마크 멱등(L2 `d1f3a17d`·`08449092` 해소)**: dedup 키 = **`l2_reviews.id`(단조·항상 존재)**. content_hash 불필요(NULL 붕괴·무한 seen배열 제거). state = per-project `{ lastReviewId }` watermark + 누적 카운터. 매 실행 `id > lastReviewId`만 처리→카운트→watermark 전진. 상태 유계(정수+카운터, 배열 없음)·완전 멱등.
- **산정 단위 = 프로젝트별**(project_id). null project_id = `unattributed` 버킷(별도, 게이트 미산입).

## 4. 구현 계약 (`c6-concordance.js`, Node stdlib, better-sqlite3 fail-soft)
- **입력**: `--project <name>`(→project_id via `projects` 조회) or `--all`(프로젝트별 순회). `--days` window(honest rate 표출용 snapshot에만; 누적 원장은 watermark라 window 무관).
- **판정로직 = c6-concordance 내 복제(L2 `830c3a1c`·`541a7ecc` 해소)**: `classifyReviewTerminal`·`classifyIssue`·`isImportantPlus`를 **c6-ready.js에서 복사**(≈30줄 순수·안정). **c6-ready.js(T3) 미편집** = 회귀·대표 `!` 마찰 회피. ⚠️ 상단 주석에 "c6-ready.js SSOT 미러 — 판정 계약 변경 시 동기 의무" 명시. (후속 P3에서 c6-ready 손댈 때 공용 `c6-verdict.js` 추출 검토.)
- **산정**: better-sqlite3로 `l2_reviews`(`id,project_id,created_at`)+`l2_rounds`(`review_id,round,canonical_items`) 조회 → project 필터 → `id > lastReviewId` 신규만 → `classifyReviewTerminal`로 honest 판정(비-honest=skip, 단 watermark는 전진) → honest review는 `classifyIssue`로 important+ 이슈 종단분류 → `pass`(real 0)·`fail`(real≥1)·`unverified`(unverified 존재) 1건 계수.
- **누적 원장**: `state/c6-concordance.json` = `{ perProject: { <project>: { lastReviewId, pass, fail, unverified, honestTotal, updatedAt } } }`. **원자적 write(temp+rename)+락(L2 `5367b678`)**: 기존 l2-loop lock/atomicWrite 패턴 미러 — 병렬 lost-update·깨진 JSON 방지, 부분실패 시 원본 보존.
- **표출**: 위키 `projects/<project>/evidence/C6-CONCORDANCE-<project>.md`(rolling overwrite, **atomicWrite**) — 누적 pass/fail/unverified + concordance rate + snapshot(window). **텔레그램 없음**.
- **게이트 미변경**: `decideReady`·`c6-policy.json`·`c6-ready.js` 미편집. advisory 원장만.

## 5. 검증
- 단위(`c6-concordance.test.js`): mock rows로 pass/fail/unverified 분류·**watermark 멱등**(재실행 순증0·`id>lastReviewId`만 처리)·비-honest skip 시 watermark 전진·project 필터·null project_id `unattributed` 버킷·**원자성/병렬**(temp+rename·동시 실행 lost-update 없음·부분실패 원본보존)·fail-soft(DB/드라이버 없음=조용히 skip).
- 실측: 실 `l2_reviews`로 프로젝트별 산정(BC·SF·MC honest 코퍼스 concordance 숫자 sanity).
- 판정로직 복제 = c6-ready.js 원본과 **동작 동일성** 스팟체크(동일 canonical_items→동일 분류).

## 6. 게이트/가역성
- 신규 `c6-concordance.js`/`.test.js` = shared(maia-manifest 등재). **c6-ready.js·c6-policy.json·decision-policy.json(T3) 전부 미접촉**(판정로직 복제로 T3 회피). = 대표 `!` 편집 불요.
- default-off·advisory·게이트 미변경 = 완전 무해(누적·표출만). 가역(파일·state 삭제).
- 커밋=ai-bootstrap T2·push=대표 `!`.

## L2 검증 이력 (codex ∥ gemini, 2026-08-29)
> 원장 `2026-08-29-c6-concordance-evidence-spec-l2-aggregation-20260829-195434`(+r2/r3). settled 5 반영 + refuted 1.
- `d1f3a17d`(blocker)+`217f87bc`+`08449092`: content_hash NULL 붕괴·artifact/review 혼용·seen배열 무한증가 → **review-id 워터마크**로 일괄 재설계(멱등·유계·event-stream).
- `5367b678`: state/위키 원자성·병렬 → temp+rename+락.
- `830c3a1c`+`541a7ecc`(refuted): c6-ready T3 export 모순·회귀우려 → **판정로직 c6-concordance 복제**(c6-ready 미편집=T3 회피, 동기의무 주석).

## 7. 범위 밖 (P3/P4 이연)
- concordance를 per-rule 증거원으로 승격(observedPositive 대체/보완)·`decideReady` 게이트 배선 = **활성화 트랙**(증거 성숙 후 대표 결재).
- artifact→ruleId 매핑(카테고리축 귀속) = 상동. 이번은 **프로젝트 단위**까지만.
