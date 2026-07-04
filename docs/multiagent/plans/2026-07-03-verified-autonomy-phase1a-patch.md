# Phase ①a 패치 — 가역성 다운그레이드 (분류기 코어, default-off)

> A2 owner-only T3 파일 편집이라 **대표 결재/적용 필요**. 두 파일, default-off(enabled:false)라 적용해도 동작 무변(no-op)까지가 ①a. 실제 발동은 ①b(훅 pre-image)+플래그 flip 후.

## 1) `~/.ai-bootstrap/risk-classify.js`

### (a) highRiskPaths 루프 (현재 L269) 교체
현재:
```js
      for (const h of policy.highRiskPaths || []) if (globToRe(h.glob).test(p)) pathMatch = higherMatch(pathMatch, { cls: h.class, reason: h.reason, ruleId: h.id })
```
변경:
```js
      // Phase①: 가역 다운그레이드 — Edit/Write 계열 + 대상 git추적(input.reversible) + 정책 enabled + 해당 rule에 reversibleClass 有.
      // secret-code/hook/maia-policy는 reversibleClass 필드가 없어 절대 다운그레이드 안 됨(데이터 제어). denylist/escalator/diff상향은 그대로 위에서 적용.
      const revCfg = policy.reversibilityDowngrade || {}
      const revEligible = revCfg.enabled === true
        && input.reversible === true
        && ['edit', 'write', 'multiedit', 'notebookedit'].includes(tool)
      for (const h of policy.highRiskPaths || []) {
        if (!globToRe(h.glob).test(p)) continue
        const useRev = revEligible && typeof h.reversibleClass === 'string'
        const cls = useRev ? h.reversibleClass : h.class
        pathMatch = higherMatch(pathMatch, {
          cls,
          reason: h.reason + (useRev ? ' (가역 다운그레이드·증거요구)' : ''),
          ruleId: h.id + (useRev ? '+rev' : ''),
        })
      }
```
근거: winner=max(base,escalators)라 escalator/denylist/diff상향은 여전히 위로 이김(안전). reversibleClass는 base(path tier)만 낮춤. `input.reversible`는 ①b에서 훅이 주입(git ls-files); 미주입 시 undefined→false→다운그레이드 안 됨(fail-safe).

## 2) `~/.ai-bootstrap/decision-policy.json`

### (a) 최상위에 config 추가 (denylist 앞 아무 곳)
```json
  "reversibilityDowngrade": {
    "enabled": false,
    "note": "Phase① Verified Autonomy. enabled=false(default-off). true 활성 전제: ①b PreToolUse pre-image 사전저장(fail-closed) 배선 완료 + 골든테스트 통과. reversibleClass 있는 highRiskPath만 대상, Edit/Write 계열+git추적 파일 한정. secret-code/hook/maia-policy/envfile는 reversibleClass 미부여=절대 비대상. spec: docs/multiagent/specs/2026-07-03-verified-autonomy-gate-redesign-spec.md"
  },
```

### (b) 안전 highRiskPaths에 reversibleClass 부여 (해당 rule에만)
대상(가역 코드편집): `auth, dispatch, scheduler, relay, i18n-config, generated, lockfile, pkgjson` → 각 항목에 `"reversibleClass": "T1"` 추가.
**미부여(절대 비대상)**: `migrations, secret-code, hook, envfile, maia-policy` — 그대로 T2/T3.
예:
```json
    { "id": "auth", "class": "T2", "reversibleClass": "T1", "glob": "**/auth*", "reason": "인증 코드" },
```

## 검증 (①a 적용 후, 대표 `!` 적용 뒤 내가 수행)
- 골든 단위테스트 신규(`risk-classify.test.js`): ① enabled:false → 다운그레이드 0(no-op 회귀). ② enabled:true+reversible+Edit+auth → T1. ③ secret-code/hook → reversibleClass 없어 T2/T3 유지. ④ Bash tool → 다운그레이드 안 됨. ⑤ denylist/escalator/diff상향이 reversibleClass 위로 이김. ⑥ input.reversible 미주입 → 다운그레이드 안 됨.
- `node --test risk-classify.test.js` + 기존 회귀 전건.
- 자체 L2(구현 diff 대상, codex∥gemini).

---

## ✅ 준비·검증 실측 (2026-07-03, scratchpad candidate)

A2 제약(risk-classify.js·decision-policy.json = owner-only T3)상 scratchpad byte-identical candidate에 패치 적용 → 실측 검증. canonical 미변경(대표 `!` 적용 대기).

- **골든 37/37 통과** (①~⑥ 6종 요건 + 자기보호 4종 + diff-bump 판별 + ⑦ override-bypass 7종).
- **회귀 203 pass / 1 fail** = canonical과 **완전 동일**(enabled:false=진짜 no-op 실증). 1 fail=`trusted backslash-cwd`, canonical에서도 동일 실패=데스크탑 이전(OneDrive→D:) 후 stale 테스트 데이터, 본 변경 무관.
- **자체 L2(codex∥gemini)**: A(가역 다운그레이드) **양 벤더 PASS**(구현 결함 0). 4조건 게이트 엄격·higherMatch 자기보호·fail-safe 정확 확인.

### ★ B) A2 override-bypass 수리 (codex BLOCKER — 기존 결함, ①a와 무관하나 함께 수리)
- **결함**: 프로젝트 `$cwd/.maia/risk-override.json`의 `pathOverrides`가 `highRiskPaths`를 short-circuit → gate-self-* T3 자기보호가 override(`**`→T0)로 무력화. **실측**: canonical(패치 전)에서 `risk-classify.js`/`decision-policy.json` 편집이 `T0 allow`로 뚫림(candidate 동일 = 본 패치가 만든 게 아님). denylist(secret/env)는 escalator라 override 무관 DENY 유지 → 구멍은 highRiskPaths 기반 T3 한정.
- **수리**: `nonOverridable:true` 플래그 도입. protected rule(gate-self-policy/classifier/hooks/b-pipeline + maia-policy) 매칭 시 protFloor를 먼저 계산, override가 매칭돼도 `higherMatch(override, protFloor)`로 protected class가 이김. 비-protected highRiskPath(auth 등)는 override 다운그레이드 기능 보존.
- **실측**: gate-self-* → override `**` T0에도 **T3 유지**, maia-policy → **T2 유지**, auth+override → **T1(기능 보존)**, rm-rf → **DENY 유지**.
- 정책: `decision-policy.json`의 5개 rule에 `"nonOverridable": true` 추가. 분류기 `if(p)` 블록에 protFloor 로직 추가(위 최종 diff 참조).

### 설계 인지 (IMPORTANT, 차단 아님)
1. **lockfile/pkgjson→T1** (codex 이견∥gemini 무해): 손편집 의존성/스크립트가 flip 후 auto-allow. `npm install`은 `pkg-install` T2로 여전히 방어. v6 spec 동결·default-off라 현 위험 0. **flip(①b 이후) 전 재검토**.
2. **①b 훅 하드 계약**(양 벤더 합의): ①b PreToolUse 훅은 caller의 `tool_input.reversible`을 신뢰 말고 **훅이 직접 `git ls-files`로 판별·주입**(오버라이드). 현재 ①a는 CLI가 `--reversible` 미파싱 → no-op이라 안전.

### 적용 후 SSOT 동기
- WSL canonical 편집(대표 `!` cp) → `node ~/.ai-bootstrap/maia-deploy.js`로 Windows byte-identical 동기 필수(dual hand-cp 금지, MAIA SSOT 규약).
