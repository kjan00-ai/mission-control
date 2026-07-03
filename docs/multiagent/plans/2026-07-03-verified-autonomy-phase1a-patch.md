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
