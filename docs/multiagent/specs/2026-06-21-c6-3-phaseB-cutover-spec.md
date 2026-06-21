---
intent: spec
project: mission-control
date: 2026-06-21
author: claude
version: v0.3 (구현 완료 — 메커니즘, 활성화 0)
track: C6-3 Phase B (검증-우선 cutover — 인간 모달 → C6 자율 검증)
status: implemented
l2_ref: "[[2026-06-21-c6-3-phaseb-cutover-spec-l2-deepen-r3-20260621-161839]]"
artifact_ref: 2026-06-21-c6-3-phaseB-cutover-spec
impl: "done — c6-cutover.js(decideCutover/holdback/rate/shadow, 10 픽스처) + 훅 배선(pre-risk-classify.js, fail-closed try-catch·generic msg) + c6-policy.cutover(default-off) + decision-policy maia-policy glob(E2: 정책편집=T2). L2 3R 수렴(5 settled+2 대표결정). ★ activated=false ⇒ 라이브 무변경 입증(T2 still ask·T3 still deny). 활성화 composition·kill-switch·rate-limit·holdback 검증. 전체 회귀 27/27. maia-deploy drift 0. ★ **활성화=O1(0). 카테고리 활성화는 라벨축적+🚨🚨=0 입증 후 대표 모달(편집 T2).**"
---

> **v0.2 변경(L2 3R 수렴)**: 5 settled + 2 대표 에스컬레이션 반영. (B1 `2899de6d` 관측성 모순) cutover=인간라벨 동결 → **홀드백 샘플링**(§2.5)으로 일부 ask 유지·라벨 지속수집. (B2 `1b629a28` 모달=자연 rate-limit 소실) **서킷브레이커**(§2.6). (I `76ccefdf`) fail-closed 하드닝(훅 try-catch·설정 가드). (I `d9f83fc7`) 롤백 '즉시' 한정(훅=호출당 신규프로세스 재독). (I `db1f038e`) **비동기 경보**(§2.7). 에스컬: (E1 `9fc08599`) AI-대면 메시지 메커니즘 숨김(대표 결정). (E2 `924f72d7`) **정책파일 편집=T2 게이트**(대표 결정, §2.8). ★ **활성화 verdict=O1(활성화 0)** — 안전보강+라벨축적 선행.

# C6-3 Phase B — 검증-우선 cutover

> C6 종착점(§2.1): 선택 카테고리에서 **인간 승인 모달(ask)을 C6 검증 결정으로 대체**. 현재 `policy-classify`/`c6-policy.json`은 **라이브 게이트 미배선 병렬 MVP**(c6-policy `_meta.note` "cutover = C6-3"). 본 스펙 = 그 배선을 **가역·기본끄짐·카테고리 단위**로 정의하고, **활성화 범위 3옵션을 L2 판정**에 부친다(대표 지시).
>
> - 선행: [[2026-06-21-c6-3-phaseA-trust-metrics-spec]](C5↔C6) / [[2026-06-21-c6-3-phaseA5-modal-labels-spec]](인간 라벨) / C6-0.2 분류기. SSOT: 코드/spec=repo, 지식=위키.
> - ★ **이 스펙은 메커니즘을 정의하되 어떤 카테고리도 자동 활성화하지 않는다.** 활성화 = 대표 최종 게이트.

## 0. ★ 근거 상태 (Phase A.5 라벨 실측 — 결정적)

| ruleId | 인간거부 | executed(상한) | 🚨🚨 |
|---|--:|--:|--:|
| hook | **1** | 54 | 0 |
| migration | 0 | 52 | 0 |
| git-commit:branch-gate | 0 | 40 | 0 |
| move-rename | 0 | 27 | 0 |
| process-kill | 0 | 18 | 0 |
| (그 외 9 카테고리) | 0 | 49 | 0 |

- 인간 거부 라벨 = **전체 1건**(hook). 나머지 13카테고리 0건. 나머지는 전부 `executed`(상한·정책드리프트, 인간 승인 미확정).
- **🚨🚨=0은 공허한 참**: 거부 데이터가 없어 "C6가 인간과 발산하지 않음"이 무의미. → **데이터 근거로 cutover를 정당화할 카테고리 = 현재 0개.**
- 결론: **메커니즘은 만들되, 데이터 기반 활성화는 시기상조.** 활성화는 L2 판정 + 대표 판단.

## 1. 목표 / 비목표
**목표**
- G1. **가역 cutover 메커니즘**: T2(ask) op 중 **활성화된 카테고리**에서 C6가 **양성 검증(allow+V floor+무위험)** 하면 ask→allow 다운그레이드. 라이브 게이트 배선.
- G2. **3중 가역 + fail-closed + 다운그레이드-only** 불변식(§3). 관측성 유지(`c6-cutover-allow` 마커).
- G3. **섀도우 검증**: 활성화 전 카테고리별 blast-radius + 🚨🚨 dry-run.
- G4. **활성화 옵션 3종을 L2 판정**(§5) → 대표 게이트.

**비목표**
- N1. 카테고리 자동 활성화 **아님**(activatedRules 기본 빈). N2. ask→deny/deny→allow 등 **다운그레이드(ask→allow) 외 변경 아님**. N3. risk-classify(C5 라이브 분류) 수정 **아님**(병렬 C6 오버레이만 배선).

## 2. 설계

### 2.1 `c6-cutover.js` — `decideCutover(pc, ruleId, cfg, env)` (pure)
순수 결정 함수. `pc` = `classifyPolicy(op)` 결과, `cfg` = `c6-policy.cutover`, `env` = process.env.
1. `env.MAIA_C6_CUTOVER_OFF` truthy → `{allow:false, reason:'killswitch'}`.
2. `cfg.activated !== true` **||** `!cfg.activatedRules.includes(ruleId)` → `{allow:false, reason:'not-activated'}`.
3. `!pc` (null/throw) → `{allow:false, reason:'failclosed'}`.
4. **양성 검증**: `pc.effectiveDecision==='allow'` && `vRank(pc.verificationDepth) >= vRank(cfg.vFloor)` && `(pc.riskFlags||[]).length===0` && `!pc.blocking` → `{allow:true, reason:'c6-verified', pc}`.
5. else `{allow:false, reason:'c6-not-allow'}`.
- `vRank`: V0<V1<V2<V3; `not_applicable`=−1(차단). 기본 `cfg.vFloor='V1'` → **V0 자율 금지**(검증 없는 완화 차단, Phase A.5 §2.2 V-floor 승계).
- 실측 함의: `git-commit:branch-gate`=V0 → 활성화해도 **ask 유지**(다운그레이드 안 됨). `move-rename`=V1 → 적격. ⇒ blast-radius는 라벨 수보다 좁음(섀도우로 정량화).

### 2.2 라이브 훅 배선 `~/.ai-bootstrap/hooks/pre-risk-classify.js`
- 기존 `permissionDecision` 산출 직후, **전체를 try-catch로 감싸 어떤 throw도 ask 유지**(I-B fail-closed, `76ccefdf`):
```js
if (permissionDecision === 'ask') {
  try {
    let pc = null; try { pc = classifyPolicy({ tool, path: filePath, command }) } catch (e) {}
    let cfg = {}; try { cfg = loadC6().cutover || {} } catch (e) {}        // parse-fail → {} → not-activated
    if (!holdback(result.ruleId, cfg)) {                                    // §2.5: 일부는 ask 유지(라벨수집)
      const cut = decideCutover(pc, result.ruleId, cfg, process.env)
      if (cut.allow && rateOk(result.ruleId, command, filePath, cfg)) {     // §2.6: 서킷브레이커
        permissionDecision = 'allow'; cutover = cut
      }
    }
  } catch (e) { /* keep ask */ }
}
```
- audit `decision: cutover ? 'c6-cutover-allow' : permissionDecision` + `ruleId`/`E`/`V` → c6-trust/digest가 **계속 관측**.
- **systemMessage(자율 시, E1 `9fc08599` — 메커니즘 숨김)**: 일반 문구만 — `자율 실행: C6 검증 통과. 이의 있으면 중단하세요.` ★ kill-switch 환경변수명·정책파일명 **미노출**(AI 자가조작 차단). 롤백 메커니즘은 **감사 레코드·운영문서에만**.
- shim 호출경로·risk-classify 무변경. policy-classify fail-safe(에러→DENY)라 다운그레이드는 양성 allow에서만.

### 2.3 `c6-policy.json` 활성화 블록 (정책=json만)
```json
"cutover": { "activated": false, "activatedRules": [], "vFloor": "V1",
  "holdbackRate": 0.1, "rateLimit": { "maxPerKey": 5, "windowMin": 10 },
  "_note": "C6-3 Phase B. 활성화=대표 게이트(편집자체 T2). 롤백: activated:false | activatedRules 비우기 | MAIA_C6_CUTOVER_OFF=1." }
```
- **3중 가역**(코드변경 0): ① `activated:false` ② `activatedRules` 비우기 ③ `MAIA_C6_CUTOVER_OFF=1`(env). ★ 롤백 '즉시' 한정(`d9f83fc7`): 훅은 **호출당 신규 node 프로세스** → env·json을 매 호출 재독 ⇒ *다음 tool-call부터* 즉시 반영(실행중 프로세스 전파 아님). json write는 atomic(tmp+rename), 파싱실패→`{}`→not-activated(fail-closed).

### 2.4 섀도우 검증 `c6-cutover.js --shadow` (활성화 전 필수)
- historical `modal-labels-*.jsonl` 위 dry-run: 카테고리별 "**가정 활성화** 시 ask→auto-allow 될 N건 + 그중 🚨🚨(인간거부를 자율허용 — 절대 0)". V floor 적용 실제 blast-radius. read-only. 대표 결정 입력.

### 2.5 홀드백 샘플링 (B1 `2899de6d` — 관측성 동결 해소)
- ★ 모순 인정: cutover된 op은 인간 모달이 없으므로 **그 카테고리의 인간 라벨 수집이 멈춘다**(증거 동결, 단방향). 따라서 "라이브 라벨 계속 수집"은 cutover 카테고리엔 거짓.
- **해소**: `holdback(ruleId, cfg)` — 활성 카테고리라도 `holdbackRate`(기본 10%) 비율은 **ask 유지**(랜덤) → 인간 라벨 지속 유입 → c6-trust가 활성 후에도 카테고리별 🚨🚨를 계속 감시. 동결을 "샘플 모니터링"으로 전환.

### 2.6 서킷브레이커 / rate-limit (B2 `1b629a28` — 모달=자연 rate-limit 소실 해소)
- 인간 모달은 AI 오류루프의 **자연적 속도제한**이었음. 자동허용은 이를 제거 → 토큰폭주·교착 위험.
- `rateOk(ruleId, cmd, path, cfg)`: dedupKey(tool+정규화 cmd/path)별 자동허용을 TTL 상태(`state/c6-cutover-rate.json`)에 기록. `windowMin`(기본10분) 내 `maxPerKey`(기본5) 초과 → **false → ask로 강등**(루프 차단). 상태 atomic.

### 2.7 비동기 경보 (I `db1f038e` — FP 사후 부각)
- 자율건이 로그에만 쌓이면 오발동을 놓침. ★ 라이브 훅은 빠르고 fail-open이어야 하므로 **훅에서 Telegram 직접호출 금지**(지연·실패위험). 대신 서킷브레이커 발동 시 훅이 `decision:'c6-cutover-ratelimit'` 감사마커를 남기고, **배치(c6-digest anomaly / healthwatch 15분)가 이 마커·cutover 급증을 포착해 hermes Telegram 경보**(기존 anomaly/sendAlert 경로 재사용). 운영자 비동기 인지→롤백.

### 2.8 활성화 거버넌스 (E2 `924f72d7` — 대표 결정)
- ★ 현 라이브 게이트는 `c6-policy.json` 편집을 **T1(자율)**로 분류 → AI가 cutover를 스스로 켤 수 있는 구멍. **해소(대표 승인)**: `decision-policy.json` highRiskPath에 `**/.ai-bootstrap/*.json`(정책데이터) 추가 → 편집이 **T2(대표 모달+감사)**. 활성화 = 대표 승인·감사된 행위. (정책=json만 수정, 코딩 불요.)

## 3. ★ 안전 불변식 (L2 핵심 검토대상)
- **I-A 다운그레이드-only**: ask→allow만. T3/DENY·deny 결정 절대 무접촉(코드상 `permissionDecision==='ask'` 분기 내에서만).
- **I-B fail-closed**: pc null/에러/미활성/V부족/riskFlags/blocking → **ask 유지**(자율화는 양성 allow에서만).
- **I-C V floor**: V0/not_applicable 자율 금지(검증 없는 완화 차단).
- **I-D 관측성**: 자율건도 `c6-cutover-allow`로 감사 → c6-trust/digest 지속 감시(섀도우 아님, 라이브 라벨 계속 수집).
- **I-E 3중 가역**: 코드변경 없이 다음 tool-call부터 즉시 롤백(§2.3, 호출당 신규프로세스).
- **I-F 자기보호 승계**: gate self-protection globs 경로는 애초에 allow 안 나옴 → cutover 무영향.
- **I-G rate-limit**: dedupKey별 windowMin 내 maxPerKey 초과 → ask 강등(루프 차단, §2.6).
- **I-H 홀드백**: 활성 카테고리도 holdbackRate는 ask 유지 → 인간라벨 지속수집(§2.5).
- **I-I 메시지 불투명**: AI-대면 systemMessage에 kill-switch·정책파일 미노출(§2.2, E1).
- **I-J 활성화 게이트**: cutover 활성화 편집(c6-policy.json) 자체가 T2 대표 모달+감사(§2.8, E2).

## 4. ★ 정직한 한계
- H-B1: cutover의 신뢰근거는 **C6 분류기 정확도**(advisory). 인간 라벨로 카테고리별 입증 전까지는 "정책 자기일관성"이지 "인간 합치"가 아님 → **활성화는 카테고리별 인간라벨 축적 후가 정도**(O1 권장 근거).
- H-B2: `executed` 상한(Phase A.5 H3′)으로는 "C6=인간"을 못 세움 → 활성화 정당화에 executed 단독 사용 금지.
- H-B3: 섀도우의 🚨🚨=0도 **거부 라벨 희소**(1건)면 약한 보증 → blast-radius·가역성·대표 판단 병행.
- **H-B4 (B1 — 증거 동결)**: cutover는 그 카테고리의 인간 라벨 수집을 **단방향으로 멈춘다**. 홀드백 샘플(§2.5)이 일부 유입을 유지하나 전수는 아님 → 활성 카테고리의 인간합치는 **샘플 추정**(전수 입증 아님). 활성화는 비가역적 증거손실을 동반 → 신중.

## 5. ★ 활성화 옵션 (L2 판정 대상 — 대표 지시 "3옵션 모두 L2 검증")
- **O1 메커니즘만, 활성화 0**(권장): `activatedRules:[]`. 행동변화 0. 라벨 축적되며 c6-trust가 카테고리별 🚨🚨=0 입증 → 대표가 json 1줄로 점진 활성화. 허위신뢰 0.
- **O2 메커니즘 + 파일럿 1**: 대표 선정 저위험·고가역(예: `move-rename` R0·V1·가역) 1카테고리 라이브, kill-switch 장전. 데이터 아닌 판단 근거. cutover 실효 관측.
- **O3 대표 지정 집합**: 대표가 명시한 카테고리 즉시 활성화(근거 오버라이드). 최대 자율, 최대 위험.
→ L2(Codex 기술 ∥ Gemini 운영)가 **각 옵션의 위험/이득/불변식 충분성**을 적대 판정·수렴 → 대표 최종 게이트.

**★ L2 수렴 verdict (3R)**: 메커니즘 자체에 다수 BLOCKER(증거동결·rate-limit 부재 등)가 있었고 거부 라벨이 1건뿐 → **현 시점 데이터·안전성으로는 어떤 카테고리도 활성화 부적격 ⇒ O1(메커니즘만, 활성화 0)**. 안전보강(§2.5~2.8) 반영 + 라벨 축적 + 카테고리별 🚨🚨=0 입증 후, 대표가 카테고리별로 활성화(편집 자체가 T2 대표 모달). O2/O3는 그 입증 전엔 허위신뢰.

## 6. 검증 계획
- 골든픽스처(`c6-cutover.test.js`): 활성/비활성·룰 in/out·effectiveDecision allow/delay/deny·V0/V1/V2·riskFlags 유무·blocking·kill-switch·pc null(fail-closed). I-A~I-C 직접 단언.
- 훅 통합: stdin 페이로드로 (활성룰+C6allow+V1)→allow / (활성룰+V0)→ask / (비활성룰)→ask / (T3)→deny 불변.
- 섀도우: 카테고리별 blast-radius 리포트, 🚨🚨=0.
- default-off 라이브 무변경: 실제 ask op 여전히 ask(감사 decision).
- maia-deploy drift 0. 전체 C6 회귀.

## 7. 매니페스트/SSOT
- `c6-cutover.js`·`c6-cutover.test.js` → manifest shared.boot. `pre-risk-classify.js`(hooks shared)·`c6-policy.json` 수정. 코드=repo, 활성화상태=c6-policy(배포추적).
