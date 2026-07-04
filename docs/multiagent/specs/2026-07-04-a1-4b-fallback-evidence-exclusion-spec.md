# A1.4(나) — 폴백 transport verdict의 B 증거 자격 제외 (spec)

> date: 2026-07-04 · author: claude · status: spec (L2 대상)
> 전제: [[2026-07-04-va-c7-reconciliation-analysis]] — A1(L2 transport 신뢰성)=②hardblock·B의 전제.
> 로드맵: `docs/multiagent/plans/2026-06-24-a1-a2-b-roadmap.md` A1.4(나). SSOT 파일: `~/.ai-bootstrap/l2-loop.js`(+`l2-schema.js`).
> ⚠️ SDK/비용게이트 무관: Agent SDK는 2026-06-24 실측 기각(claude -p 구독=과금0), 본 작업은 순수 transport 태깅.

## 배경·결함
L2는 벤더 2관점(주=claude -p 네이티브·구독 / 2nd=gemini REST API)으로 교차검증하고, **폴백 CLI 경로**
(gemini CLI: 운영자 opt-in `MAIA_GEMINI_TRANSPORT=cli` **또는** 런타임 자동강등 `!HAS_FETCH` / codex CLI:
`--reviewers` opt-in)로 내려갈 수 있다. 트리거(명시/자동) 무관하게 CLI 경로는 저신뢰(인증·쿼터·timeout 미해결). 그런데 현재
`runReviewer`가 성공 verdict를 반환할 때 **그것이 primary transport인지 폴백인지 구분 태그가 없다**
(`{reviewer, raw, code, attempts}`만). 따라서 다운스트림(집계 → W3/B 증거)이 **폴백 verdict를 primary와 동일
신뢰로** 취급한다. 로드맵 A1.4(나)·L2 aa98e0b7: "폴백 결과가 B 증거에 섞이면 A1 신뢰성 전제 붕괴" — B(자율
활성화)나 ②hardblock이 폴백(저신뢰) verdict를 근거로 쓰면 **안전모델 과장**.

## 설계

### 1) transport 태깅 (l2-loop.js)
- `runReviewerOnce`의 각 경로가 반환 객체에 **`transport`** 필드를 실는다:
  - gemini API 직결(`runGeminiApi`) → `transport:'api'` (primary)
  - claude `-p` 네이티브 → `transport:'native'` (primary)
  - gemini CLI / codex CLI → `transport:'cli'` (**fallback**)
  - mock → `transport:'mock'` (테스트 — **증거 부적격**, §2에서 eligible 제외. primary 아님)
- `runReviewer`는 이 필드를 그대로 전파(재시도 계층은 transport 불변).
- **파생 불변식**: `viaFallback = (transport === 'cli')`. gemini는 API가 기본이므로 CLI 강등 시에만 fallback;
  codex는 항상 CLI라 opt-in 시 fallback. claude -p는 네이티브라 primary(외부 바이너리 셸아웃이나 A1.0
  주-검증기로 확정된 신뢰 경로 — 로드맵 A1.2 ※).

### 2) 증거 자격 판정 (runner 층 — L2 6af1d61c)
- **산출 위치 = l2-loop 메인 흐름**(runReviewer 결과 배열을 갖는 지점), `S.aggregate` 내부 아님.
  `parsed[i]`(verdict)와 `results[i].transport`를 index 조인해 계산(aggregate 입력엔 transport 불요).
- 집계 산출물(frontmatter)과 stdout에 **`evidenceEligible: boolean`** 방출.
- 규칙(보수): **(1) quorum ≥2 usable(parser ok) verdict**(A1=2관점 독립 교차검증; 단일벤더 pass는 교차검증
  과장 → 부적격, L2 99c85e91) **AND (2) 전부 `api`|`native`(실 primary)** → `true`. 하나라도 `cli`(폴백) 또는
  `mock`(테스트 오염 차단, L2 3816c516), 또는 usable<2 → `false`. (api=gemini·native=claude라 ≥2 primary=distinct 벤더.)
- ⚠️ **L2 verdict 자체(수정필요/무결/escalation)는 불변** — evidenceEligible은 **별도 축**. 허위 pass 방지용
  `incomplete`(parser-fail·매체실패)와도 구분.
- 표출: `evidenceEligible:false`면 집계 md에 "⚠️ 폴백/비-primary transport 포함 — 자동신뢰(B/②) 증거 부적격.
  **검토 자체는 수행됨**(informed)." 명시.

### 3) W3 소비 배선 (L2 dfdc6de6 blocker — 범위 포함, B는 계약만)
> 방출만 하고 소비자를 안 고치면 기존 W3가 폴백 verdict를 계속 pass로 승격 → 결함 미해소. **live 소비자 W3는 본
> spec서 배선**한다. B(미구축)는 계약만.
- **W3**(`w3-async-verify.runL2Verify`): reviewers=primary(claude,gemini) 고정. 집계 `evidenceEligible:false`면
  clean verdict를 `pass`로 승격하지 않고 **신규 verdict `'ineligible'`**(= "L2검토됨·비-primary transport·
  informed only·자동증거 부적격")로 기록. ⚠️ **`'verify-unavailable'`(매체실패=검증 못함)과 구분**(L2 0c856f0d·
  d64ce27f: 폴백은 검토를 *했다* — informed 가치 보존). 'fail'은 폴백이어도 fail 유지(안전 신호 보존).
- **`'ineligible'`은 TERMINAL**(재검증 안 함, L2 671fd612): 폴백이 영속(`MAIA_GEMINI_TRANSPORT=cli`/`!HAS_FETCH`)
  이면 재검증이 매 커밋 벤더비용을 무한 소모하고 primary에 도달 못 함. 검토는 이미 됨(informed 확보); 내용이
  바뀐 새 커밋(fresh contentKey)은 어차피 primary로 검증. dedup 재검증 대상 = `queued`·`verify-unavailable`만.
- **reflectionAdvisory**(`pre-risk-classify.js`): `'ineligible'`을 별도 카운트 "L2검토(폴백·증거부적격) N"로
  표출, risk 집합에 포함(자동신뢰 불가 → 반영 전 검토 권장). l2pass(신뢰 증거)와 분리.
- **B**(미구축, c6-evidence): L2 concordance 적재 시 `evidenceEligible:true`만 카운트 — 계약만(구현 B 트랙).

## 불변식 / 안전
- **verdict 무변경**: 집계·심화·escalation 로직(`l2-schema.js`) 불변. transport/evidenceEligible은 **부가 축**.
- **보수 방향**: 폴백 섞이면 evidenceEligible=false(증거 부적격). 절대 폴백을 신뢰 증거로 승격 안 함.
- **가역**: transport env 스위치(`MAIA_GEMINI_TRANSPORT`) 불변. 태깅은 순수 관측(동작 무변경).
- **무회귀**: 기존 reviewers=claude,gemini 기본 경로는 전부 primary → evidenceEligible=true(현행과 동일 소비).
- **default-off 무관**: L2는 상시 동작(태깅만 추가). VA flip과 독립.

## 검증
- 단위테스트(l2-loop.test.js 확장): transport 태깅(api/native/cli/mock)·`evidenceEligible` 규칙(전 primary→true /
  한 폴백→false)·verdict 불변(폴백이어도 수정필요는 수정필요).
- 무회귀: l2-loop 19 tests·집계 로직 불변. maia-deploy drift0.
- 실측: `MAIA_GEMINI_TRANSPORT=cli` 강제 시 집계 evidenceEligible=false 확인.

## 범위 밖(후속)
- A1.1 in-session Agent/Workflow 경로(편의) · 총 wall-clock 상한(현 per-attempt+killTimer로 부분 커버).
- W3/B의 evidenceEligible 실소비 배선(각 트랙).
