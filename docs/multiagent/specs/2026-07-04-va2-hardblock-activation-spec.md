# VA② hardblock 승격 (W5a) — 반영점 verify-게이트 informed→hardblock (spec)

> date: 2026-07-04 · author: claude · status: **DEFERRED (needs-rework)** — L2(claude∥gemini) blocker 1 + 대표 결정 3.
>
> ## ⛔ L2 판정 (2026-07-04) — 플립 보류
> **flip 안 함.** L2가 ②hardblock as-designed의 근본 갭을 드러냄:
> - **`2c22a3e8` blocker**: hardblock은 `permissionDecision==='ask'`만 deny 승격 → **자율(allow) 반영경로가 우회**
>   (trustedPushMainProjects T1 push / C6 cutover ask→allow infra). hardblock이 *지키려는 자율 반영을 안 지킴* →
>   "미검증 반영 금지" 불성립. **enforce 층이 allow→deny도 강제해야** 함.
> - **`b1e02d8f`↔`9e9ff516` (대표결정)**: queued/unknown fail-open(가용성—인시던트 중 infra brick 방지) vs
>   fail-closed(보안—미검증 반영 차단). unknown open·queued closed = 내부 모순 지적.
> - **`b911a5b3`**: infra join cwd-coarse → 다른 cwd systemctl restart 시 relevant=∅→allow(미검증 반영). 서비스→
>   경로→원장키 매핑(W3 sub-4) 필요.
> - **`dacae949`**: unknown fail-open이 일시 git오류와 영구 commit 소실(rebase/gc, status128 항구 null)을 뭉갬 → 항구 우회.
> - **`2345cce0`/`8aff93ac` (문구)**: 실 델타=정책 1줄 플립(코드 이미 구현)·화이트리스트 문구 모호.
>
> **결정적 통찰**: hardblock 가치=**자율(allow) 반영 방어**인데 MC에선 그 경로가 현재 비활성(trusted-push=BC/SF만·
> MC push=T3 / cutover=default-off) → **②hardblock은 B/cutover가 자율 반영을 활성화하기 전엔 빈 경로 방어**.
> 재조정 "②hardblock+B(W5) 동반"과 일치. **권고: 플립 보류 → (1)allow→deny enforce (2)fail-open/closed 정책 대표결정
> (3)서비스→경로 스코핑을 B 활성화와 함께 W5로 묶어 재설계.** 아래 원안은 그 재설계의 출발점.
>
> ---
> date: 2026-07-04 · author: claude · status(원안): spec (L2 대상)
> 임계경로: A2✅→W1→①flip✅→W3✅→**A1✅**→**②hardblock(여기)+B**→C6정리. 전제 [[2026-07-04-va-c7-reconciliation-analysis]] W5.
> SSOT: `~/.ai-bootstrap/hooks/pre-risk-classify.js`(reflectionAdvisory·A2 T3) + `decision-policy.json`(reversibilityDowngrade.reflectionHardBlock·A2 T3).
> ⚠️ **라이브 deny 방향 게이트 활성** — 대표 `!` 결재 필수(T3). SDK/과금 무관.

## 전제 충족 (❹ — A1이 ② hardblock 전제)
- **A1 신뢰성 확보**: L2 transport 네이티브(claude -p 구독 + gemini REST) + **A1.4(나) evidenceEligible**(폴백/단일벤더
  verdict는 자동신뢰 증거 부적격) → 이제 L2 verdict를 hardblock 근거로 신뢰 가능(신뢰못할 CLI L2로 hardblock 금지 해제).
- **W3 informed 라이브**: 반영점 reflectionAdvisory가 verify-ledger 조인 + **content freshness**(git diff commitSha
  HEAD = 재편집 stale 감지, W3.1 D2) + evidenceEligible('ineligible' 별도 축) 표출 중.

## 무엇을 막나 (정직 스코핑, L2 §2.2 99999429)
- 대상 반영점: `isPush || ruleId∈{infra, pkg-install}`. **막는 것 = 반영(비가역 실행)** — 온디스크 코드를 운영에
  싣는 지점. "로컬 편집/실행을 막는다"고 과장 안 함.
- **push는 이미 T3(deny)** → 에이전트엔 hardblock 무관(대표 `!` 전용). **실 효과 = infra(`systemctl restart|reload`
  자기관리 서비스)·pkg-install(T2 ask)를, 반영 대상 가역편집이 비-신뢰 상태면 ask→deny로 승격.**
- 자기관리 서비스 화이트리스트(MC: `hermes-gateway·mission-control·cloudflared-c3`) — 목록 밖은 기존 T2 유지.

## hardblock 조건 (verdict 상태별)
reflectionAdvisory 집계 상태 → block 판정(`reflectionHardBlock=true`일 때만):
| 상태 | 의미 | hardblock |
|---|---|---|
| l2pass | 신뢰 L2 pass(freshness ok·evidenceEligible) | 통과 |
| humanObs | 인간관측 pass(B.1) | 통과 |
| failed | L2 수정필요/blocker | **deny** |
| queued | 검증 대기중 | **deny**(미검증 반영 금지) |
| ineligible | 폴백/단일벤더 검토(자동신뢰 부적격) | **deny**(신뢰 아님) |
| unverified-noverdict | 원장에 verdict 없음 | **deny** |
| unverified-stale | 재편집됨(검증 후 변경, freshness=stale 확정) | **deny**(TOCTOU, L2 8ee26160) |
| **fresh-unknown** | **git 오류로 freshness 판정 불가** | **통과(fail-OPEN)** ← 신규 |

### ⚠️ 핵심 안전 설계 — fresh-unknown은 hardblock fail-OPEN (신규)
현재 `isEntryFresh`는 git 실패(null)를 conservative=stale로 접어 **unverified**에 합산 → hardblock이면 **git 히컵에
infra 재시작이 DENY**(서비스 brick 위험). informed 단계선 안전(노트만)이나 **hardblock에선 가용성 위협**.
- **결정(권고)**: hardblock 판정에서 **fresh-unknown(git 오류)은 통과(fail-open)**. 근거: ①git 오류는 인프라
  일시장애(콘텐츠 미검증 신호 아님) ②backstop 이중화 — async W3 재검증이 실제 미검증을 다음 반영점에 표출 +
  push=T3 방어선 + 대표 `!` break-glass ③가용성(서비스 재시작 차단)이 이 경우 리스크>이득. **informed 노트엔
  fresh-unknown을 계속 경고 표출**(투명). 확정 stale(재편집)·no-verdict·failed·queued·ineligible은 fail-closed 유지.
- 구현: `reflectionTally`가 `unverified`를 **`stale`(확정)/`unknown`(git오류)** 로 분리. hardblock 집합 =
  `failed+queued+ineligible+noVerdict+stale`(unknown 제외). informed risk·note는 unknown 포함(경고 유지).

## 안전판 / 가역
- **break-glass**: 대표 `!` 실행은 PreToolUse 훅 미경유 → hardblock 우회(단건, A2). 명문화.
- **default-off·플립 가역**: `reflectionHardBlock` 기본 false. 활성=`true`(T3 대표 `!` + maia-deploy). 롤백=`false`
  1줄(`decision-policy.json.bak-pre-hardblock` 백업). 즉시 informed로 복귀.
- **무회귀**: false면 현행 informed 완전 동일(block 항상 false). true여도 l2pass/humanObs 전건이면 절대 안 막음.
- **글로벌(불변법칙)**: 플래그는 공유 정책 → 전 환경 동시 발효. Windows도 훅 동기됨(반영점 방어).

## 검증
- 단위테스트(pre-risk-classify 없으므로 w3 reflectionTally 확장): stale/unknown 분리 카운트 · hardblock 집합이
  unknown 제외·stale 포함 · l2pass/humanObs 전건 → block 없음.
- 실측: `reflectionHardBlock=true` + 미검증 pre-image 반영(infra) → deny / 전건 pass → allow / git-fail → allow(노트 경고).
- L2 적대검증(codex∥gemini) — deny 방향 게이트라 오차단·우회·brick 시나리오 집중.

## 범위 밖(후속)
- 서비스→코드경로→원장키 정밀 매핑(❺ W3 sub-4): 현재 infra는 cwd-coarse(단일 서비스 repo서 방어 가능) —
  다중 서비스 정밀 스코핑은 후속. B 양성증거 활성화(W5b)는 별건.