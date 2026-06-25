---
type: patch-review
project: mission-control
date: 2026-06-25
phase: B.4 진입점1 (검증 예산/미검증 회계 fail-closed)
status: draft (동기 L2 대상)
---

# B.4 진입점1 패치 — 검증 예산/미검증 회계 수리 (fail-closed, 3분리)

> 대상 = `~/.ai-bootstrap/l2-loop.js`·`l2-schema.js` 변경(54+/15-). 적대검증 요청: 아래 설계·디프의 결함을 **능동적으로 최소 2건** 찾아라.

## 1. 문제 (수리 대상)
L2 deepen 루프가 round-1이 띄운 결함 수만큼 대질할 **예산이 없다**(`maxCalls=8`, reviewer 2 → round-1 2콜 → 대질 6콜뿐인데 9쟁점). 초과분은 **호출조차 안 하고** `resolveDeepen(item, [], false)`로 escalate 방출 → `resolution: 'unresolved'`. 이는 **진짜 parser-fail(대질했으나 응답 미파싱)과 출력상 구분 불가**. 렌더러는 둘 다 "대질 응답 부족(parser-fail)"로 거짓 표기 = 은폐.

**안전 치명**: 미검증(예산소진)을 통과/제외로 보면 = "검증 없이 진행한 것과 동일".

## 2. 수리 (3층, spec §9.4의 ⓐ예산 ⓑ3분리 ⓒfail-closed)
### ⓐ `l2-schema.js resolveDeepen` — 3분리 + `verified:boolean`
- `stances.length === 0` (대질 호출 자체 없음 = 예산 가드만 `[]` 전달) → `resolution:'unverified'`, `verified:false`.
- `stances.length>0 && valid.length===0` (대질 O, 전원 파싱실패) → `resolution:'parser_fail'`(구 'unresolved' 개명), `verified:false`.
- corroborated → `verified:true`. split/refuted/uncertain → `verified:true`(실신호 획득).
- 모든 리턴에 `verified` → 소비자(진입점3 지표)가 `!verified` 단일 술어로 fail-closed.

### ⓑ `l2-loop.js` 적응형 예산 + 하드캡
- round-1 agg 직후: `neededCalls = reviewers + Σ(confronters per deepen issue, 1회)`. `maxCalls = min(cap, max(maxCalls, needed))`. cap = `MAIA_L2_MAX_CALLS_CAP||24`. 캡 초과분만 unverified 잔존.
- 의도: round-1 결함을 *실제로* 대질해 미검증율↓ → gate가 영구 닫힘(autonomy 0) 회피하되, 하드캡으로 과금 폭주 차단.

### ⓒ fail-closed 회계 + 정직한 라벨
- bus 라운드/run-level counts에 `unverified`/`parserFail` 분리 집계. canonicalItems에 `verified` 영속(canonical_items JSON, 마이그레이션 불필요).
- 미검증 항목은 이미 `escalated[]`에 들어가 `finalVerdict='escalation'` → clean pass 불가(fail-closed 보장).
- `deepenAggMd` 대표 에스컬레이션 섹션: unverified="검증 예산 소진—대질 안 함" / parser_fail="대질했으나 파싱 실패" / refuted·split 구분. 은폐 제거.

## 3. 비범위 (진입점2/3)
- `c6-ready.js` 지표 재정의(round-1→deepen 종단판정)·X 임계 재도출은 **분리**. 본 패치는 `verified` 데이터를 **생산만**, 소비(게이트 차단)는 진입점3에서 계약대로.

## 4. 디프 (전문)
```diff
diff --git a/l2-loop.js b/l2-loop.js
index 12745ac..e3246c2 100755
--- a/l2-loop.js
+++ b/l2-loop.js
@@ -83,6 +83,37 @@ function notifyMediaFailure(artifact, reviewers, parserFails, aggName) {
   } catch (e) { /* best-effort */ }
 }
 
+// gemini 키 한도 소진 선제 알림(폴오버/전키소진) — 폴오버로 서비스가 유지돼도 대표가 충전 시점을 알도록 핑.
+// 스팸가드: 키-인덱스×종류별 쿨다운(기본 6h). 상태 = state/gemini-key-alert.json (atomic). auto-run 에서만(다른 알림과 동일).
+function alertCooldownOk(state, key, now, cooldownMs) { // 순수 — 테스트용
+  const last = state && state[key]
+  return !(typeof last === 'number') || (now - last) >= cooldownMs
+}
+function notifyKeyExhaustion(kind, idx, total) {
+  try {
+    if (process.env.MAIA_L2_ALERT_OFF === '1') return
+    if (!process.env.MAIA_L2_AUTO) return // auto-run 에서만(수동은 에이전트가 로그로 봄)
+    if (IS_WIN && !process.env.MAIA_L2_ALERT_CMD) return
+    const cooldownMs = Math.max(0, parseFloat(process.env.MAIA_GEMINI_ALERT_COOLDOWN_H || '6')) * 3600000
+    const stateFile = path.join(os.homedir(), '.ai-bootstrap', 'state', 'gemini-key-alert.json')
+    const key = `${kind}:${idx}`
+    const now = Date.now()
+    let state = {}
+    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {} } catch (e) { state = {} }
+    if (!alertCooldownOk(state, key, now, cooldownMs)) return // 쿨다운 내 → 도배 방지
+    const msg = kind === 'failover'
+      ? `🔁 [MAIA Auto-L2] gemini 주키 #${idx} 한도/인증 소진 → 보조키로 폴오버(서비스 유지).\n주키 충전/교체 권장. (총 ${total}키)`
+      : `🚨 [MAIA Auto-L2] gemini 전 키(${total}개) 한도 소진 — 2벤더 교차검증 불가(claude 단독).\n키 추가/충전 필요.`
+    const hermes = process.env.MAIA_L2_ALERT_CMD || path.join(os.homedir(), 'bin', 'hermes')
+    spawnSync(hermes, ['send', '-t', 'telegram', '-q'], { input: msg, timeout: 15000, stdio: ['pipe', 'ignore', 'ignore'] })
+    try {
+      state[key] = now
+      fs.mkdirSync(path.dirname(stateFile), { recursive: true })
+      fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state)); fs.renameSync(stateFile + '.tmp', stateFile)
+    } catch (e) {}
+  } catch (e) { /* best-effort: 알림 실패가 L2 를 깨지 않음 */ }
+}
+
 // C5-1b ③ output-dedup: on a successful AUTO run, drop a completion marker so the Stop hook promotes this
 // artifact pending→reviewed (spawn success alone never marks it reviewed → a crashed run gets retried, not
 // silently deduped for 7d). Keyed by the HOOK's slug (MAIA_L2_SLUG) so the marker matches the dedup key
@@ -263,15 +294,45 @@ function unquote(v) {
   if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) v = v.slice(1, -1)
   return v.trim()
 }
-function geminiApiKey() {
-  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) return unquote(process.env.GEMINI_API_KEY)
+// 키 풀 — `GEMINI_API_KEY`(주, gemini CLI 호환) + `GEMINI_API_KEY_2..9`(폴오버용). env 우선, 없으면 ~/.gemini/.env(동일 번호).
+// 한 키가 한도(429)/인증 소진되면 runGeminiApi 가 다음 키로 폴오버한다. MAIA_GEMINI_KEY_FAILOVER=0 → 주 키만(현행).
+// .env 값이 따옴표로 감싸였을 수 있어(`KEY="..."`) unquote — 안 하면 따옴표째 헤더 전송 → 401.
+function geminiApiKeys() {
+  const out = []
+  const add = (v) => { if (v == null) return; const u = unquote(String(v)).trim(); if (u && !out.includes(u)) out.push(u) }
+  add(process.env.GEMINI_API_KEY)
+  if (process.env.MAIA_GEMINI_KEY_FAILOVER === '0') return out.length ? [out[0]] : []
+  for (let i = 2; i <= 9; i++) add(process.env['GEMINI_API_KEY_' + i])
   // gemini CLI는 임의 cwd에서 ~/.gemini/.env를 자동 로드하지 않으므로 API 경로도 동일 파일에서 키를 읽는다.
-  // .env 값이 따옴표로 감싸였을 수 있어(`KEY="..."`) unquote — 안 하면 따옴표째 헤더 전송 → 401.
   try {
-    const m = fs.readFileSync(path.join(os.homedir(), '.gemini', '.env'), 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)
-    if (m) return unquote(m[1])
+    const txt = fs.readFileSync(path.join(os.homedir(), '.gemini', '.env'), 'utf8')
+    const m1 = txt.match(/^GEMINI_API_KEY=(.+)$/m); if (m1) add(m1[1])
+    for (let i = 2; i <= 9; i++) { const m = txt.match(new RegExp('^GEMINI_API_KEY_' + i + '=(.+)$', 'm')); if (m) add(m[1]) }
   } catch (e) {}
-  return ''
+  return out
+}
+// 단일 키(CLI 경로·export 호환). SSOT = geminiApiKeys()[0].
+function geminiApiKey() { return geminiApiKeys()[0] || '' }
+// ~/.gemini/.env 에서 임의 `name=value` 한 줄 읽기(키 리더와 동일 파일/패턴) → 모델 등 gemini 설정을 키 옆에 둔다.
+function geminiEnvFileVar(name) {
+  try {
+    const m = fs.readFileSync(path.join(os.homedir(), '.gemini', '.env'), 'utf8').match(new RegExp('^' + name + '=(.+)$', 'm'))
+    if (m) { const v = unquote(m[1]).trim(); return v || null }
+  } catch (e) {}
+  return null
+}
+// 모델 우선순위: process.env(브리지/명시 override) > ~/.gemini/.env(대표 설정) > 기본. (순수 — 테스트용)
+function resolveGeminiModel(envVal, fileVal) {
+  return (envVal && String(envVal).trim()) || (fileVal && String(fileVal).trim()) || 'gemini-2.5-pro'
+}
+// per-key 소진 판정 — 이 사유면 같은 키 재시도는 무의미하고 *다른 키*로 폴오버할 가치가 있다(429/쿼터/인증).
+// finishReason/blockReason/5xx/timeout 등 비-키 사유는 false(폴오버 안 함 → 기존 outer 재시도/terminal 처리에 위임).
+function geminiKeyExhausted(res) {
+  if (!res) return false
+  if (res.code === 429 || res.code === 401 || res.code === 403) return true
+  const r = res.raw || ''
+  if (res.code === -1 && /api key/i.test(r)) return true
+  return /RESOURCE_EXHAUSTED|UNAUTHENTICATED|PERMISSION_DENIED|\bquota\b|insufficient|invalid\s+api\s+key|api\s+key\s+not\s+valid/i.test(r)
 }
 
 // gemini responseSchema = OpenAPI subset. JSON Schema와 두 가지가 다르다:
@@ -290,11 +351,33 @@ function geminiSchema(s) {
   return out
 }
 
-function runGeminiApiOnce(prompt, schema) {
-  const key = geminiApiKey()
+// 키 풀 폴오버 — 현재 키가 per-key 소진(429/쿼터/인증)이고 다음 키가 있으면 다음 키로 재시도. 모든 키 소진 시 마지막 결과 반환.
+// 비-키 실패(5xx/timeout/finishReason 등)·성공은 즉시 반환(outer runReviewer 재시도/terminal 계층에 위임).
+function runGeminiApi(prompt, schema) {
+  return (async () => {
+    const keys = geminiApiKeys()
+    if (!keys.length) return { reviewer: 'gemini', raw: 'invalid api key: GEMINI_API_KEY not found (~/.gemini/.env)', code: -1 }
+    let last = null
+    for (let i = 0; i < keys.length; i++) {
+      const res = await runGeminiApiOnce(prompt, schema, keys[i])
+      last = res
+      if (geminiKeyExhausted(res) && i < keys.length - 1) {
+        console.error(`  [l2-loop] gemini key #${i + 1} 한도/인증 소진(code ${res.code}) → key #${i + 2} 폴오버 (${keys.length}키 중)`)
+        notifyKeyExhaustion('failover', i + 1, keys.length) // 주키 죽음 — 서비스는 유지되나 충전 알림
+        continue
+      }
+      // 마지막 키도 소진 = 전 키 소진(2벤더 불가) → critical 알림
+      if (geminiKeyExhausted(res)) notifyKeyExhaustion('all', keys.length, keys.length)
+      return res
+    }
+    return last
+  })()
+}
+
+function runGeminiApiOnce(prompt, schema, key) {
   // 키 없음 = 인증 결함 → terminal(재시도 무의미). classifyFailure가 'invalid api key'를 terminal로 잡는다.
   if (!key) return Promise.resolve({ reviewer: 'gemini', raw: 'invalid api key: GEMINI_API_KEY not found (~/.gemini/.env)', code: -1 })
-  const model = process.env.MAIA_GEMINI_MODEL || 'gemini-2.5-pro'
+  const model = resolveGeminiModel(process.env.MAIA_GEMINI_MODEL, geminiEnvFileVar('MAIA_GEMINI_MODEL'))
   const timeoutMs = Math.max(1000, parseInt(process.env.MAIA_GEMINI_API_TIMEOUT_MS || '120000', 10))
   const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
   const body = {
@@ -339,7 +422,7 @@ function runGeminiApiOnce(prompt, schema) {
 function runReviewerOnce(reviewer, prompt, mockDir, round, schema) {
   // A1.3: gemini 기본 transport = API 직결. MAIA_GEMINI_TRANSPORT=cli로 기존 CLI 경로 복귀(3중 가역). fetch 없으면 CLI로 자동 강등.
   if (!mockDir && reviewer === 'gemini' && (process.env.MAIA_GEMINI_TRANSPORT || 'api') !== 'cli' && HAS_FETCH) {
-    return runGeminiApiOnce(prompt, schema)
+    return runGeminiApi(prompt, schema) // 키 풀 폴오버(429 → 다음 키)
   }
   return new Promise((resolve) => {
     fs.mkdirSync(TMP, { recursive: true })
@@ -554,6 +637,12 @@ ${body}
 // deepen-round aggregation: per-issue outcome + escalation summary (근거 3줄 + 롤백) for status=escalate.
 function deepenAggMd(artifact, round, resolved, rawLinks, round1Agg) {
   const ICON = { settled: '✅ 합의', escalate: '🚩 에스컬레이션', pending: '↻ 심화지속' }
+  // B.4 진입점1: escalate 의 정체를 정직하게 — 미검증(예산소진/파싱실패)을 "진짜 이견"과 섞지 않는다(은폐 제거).
+  const escReason = (r) =>
+    r.resolution === 'unverified' ? '검증 예산 소진 — 대질 안 함(미검증, fail-closed: 통과·제외 금지).' :
+    r.resolution === 'parser_fail' ? '대질했으나 응답 파싱 실패(미검증, fail-closed).' :
+    r.resolution === 'refuted' ? '대질자가 결함 아님으로 반박 — 제기자와 미합의.' :
+    r.resolution === 'split' ? '대질자 의견 분열.' : '대질 미해결.'
   const issue = (r) => {
     const stanceLine = r.stances.map(s => `${s.reviewer}=${s.stance || 'fail'}${s.reason ? `(${s.reason})` : ''}`).join(' / ')
     return `### \`${r.parent_item_id}\` ${ICON[r.status] || r.status} — ${r.severity} (${r.resolution})\n` +
@@ -564,8 +653,8 @@ function deepenAggMd(artifact, round, resolved, rawLinks, round1Agg) {
   const escBlock = esc.length ? `\n## 🚩 대표 에스컬레이션 (${esc.length}) — 판정 필요\n` + esc.map(r =>
     `**\`${r.parent_item_id}\` (${r.severity}, ${r.resolution})**\n` +
     `1. 제기(${r.raisers.join('+')}): ${r.claim}\n` +
-    `2. 대질: ${r.stances.map(s => `${s.reviewer}=${s.stance || 'fail'}`).join(' / ')}\n` +
-    `3. ${r.resolution === 'refuted' ? '대질자가 결함 아님으로 반박 — 제기자와 미합의.' : r.resolution === 'split' ? '대질자 의견 분열.' : '대질 응답 부족(parser-fail).'}\n` +
+    `2. 대질: ${r.stances.length ? r.stances.map(s => `${s.reviewer}=${s.stance || 'fail'}`).join(' / ') : '(호출 안 됨 — 예산소진)'}\n` +
+    `3. ${escReason(r)}\n` +
     `   - 롤백: 미합의 쟁점 → 해당 산출물에 미반영(섹션 보류). 코드·commit 대상이면 \`git revert <sha>\` / 미push면 reset.`
   ).join('\n\n') : ''
   return `---
@@ -597,7 +686,9 @@ async function main() {
   const reviewers = resolveReviewers(opt('reviewers', null))
   const round = parseInt(opt('round', '1'), 10)
   const mockDir = opt('mock', null)
-  const maxCalls = parseInt(opt('max-calls', '8'), 10)
+  let maxCalls = parseInt(opt('max-calls', '8'), 10) // B.4: adaptive — raised after round-1 to confront all raised issues (cap below)
+  // hard cap: bounds runaway cost (spec §3 예산한도). floor = 설정 maxCalls(상향 전용 보장 — cap이 8 미만이어도 하향 금지, L2 dd28db07).
+  const maxCallsCap = Math.max(maxCalls, reviewers.length, parseInt(process.env.MAIA_L2_MAX_CALLS_CAP || '24', 10))
   const maxRounds = parseInt(opt('max-rounds', '3'), 10)
   const deepenBudget = parseInt(opt('deepen-budget', '2'), 10)
   if (reviewers.length > maxCalls) { console.error('max-calls 초과'); process.exit(2) }
@@ -669,11 +760,25 @@ async function main() {
     if (agg.parserFails.length) console.log(`  ⚠️ parser fail: ${agg.parserFails.join(', ')}`)
 
     // durable bus: 초기 round 레코드 수집(canonical item 별 severity/consensus/근거).
+    // B.4 L2 finding 91c25e7f: initial 항목도 `verified` 를 실어야 진입점3 소비자의 `!verified` 가 `!undefined=true`(전건 미검증→
+    //   gate 영구차단)로 오작동하지 않는다. 의미: consensus(≥2 reviewer 합의)=교차확인됨→verified:true / single-source=대질 전→
+    //   verified:false(deepen terminal 레코드가 supersede). ★계약(진입점3 소비자 필수):
+    //     (1) per-issue TERMINAL(deepen parent_item_id가 initial canonical_item_id 를 덮어씀)을 읽을 것 — initial verified:false 는
+    //         deepen 결과로 갱신됨.
+    //     (2) 버전가드(L2 fc1814f4): 본 패치 *이전* 레코드엔 verified 필드가 없다 → `!verified`(=!undefined=true) 로 평가하면 legacy
+    //         전건이 '미검증→영구 fail-closed'. 소비자는 `verified === false` 만 미검증으로 취급하고 verified===undefined(legacy)는
+    //         별도 처리(terminal verdict 폴백 or 윈도우 제외). DDL 변경은 불필요(canonical_items JSON)하나 *의미적* 백필은 필요.
+    //     (3) severity 스코프(L2 3d28fa53): deepen 은 important+ 만(l2-schema.js:138) → suggest 급 single-source 는 verified:false 로
+    //         남되 이를 덮을 deepen terminal 이 안 생긴다. fail-closed 게이트는 deepen 적격(important+) 에만 적용 — suggest 는
+    //         자문(advisory)일 뿐 게이트 대상 아님. 소비자는 verified 게이트 전에 severity(important+) 로 먼저 필터할 것.
     busRounds.push({
       round, kind: 'initial', reviewers: agg.reviewers, overallVerdict: overall,
       canonicalItems: agg.canonical.map(c => ({
         canonical_item_id: c.canonical_item_id, severity: c.severity, claim: c.claim,
         consensus: c.consensus, reviewers: c.reviewers, evidence_refs: c.evidence_refs,
+        // ⚠️ c.consensus 는 'unanimous'|'single' 문자열(l2-schema.js:133) → !!c.consensus 는 항상 truthy(fail-OPEN, L2 blocker 5cab813a).
+        //   교차확인(verified)은 'unanimous' 뿐. single-source 는 verified:false(deepen terminal 이 supersede).
+        verified: c.consensus === 'unanimous',
       })),
       settledCount: agg.settled.length, deepenCount: agg.deepen.length, escalateCount: 0,
       parserFails: agg.parserFails, rawRefs: rawLinks, aggRef: aggName,
@@ -681,6 +786,17 @@ async function main() {
 
     // === round 2+ : deepen important+ single-source issues (scope-narrowed 3-way confrontation) ===
     let pending = agg.deepen.map(d => ({ ...d }))
+    // B.4 진입점1 (spec §9.4): size the verification budget to the issue count so round-1 결함을 *실제로* 대질한다
+    //   (안 본 것을 escalate로 방출하는 미검증을 줄임). needed = round-1 calls + Σ(confronters per deepen issue, 1회 대질).
+    //   maxCalls 를 needed 까지 자동 상향하되 hard cap 으로 폭주 차단. cap 초과분만 'unverified' 로 fail-closed 잔존.
+    const neededCalls = reviewers.length + pending.reduce((s, item) => {
+      const cf = reviewers.filter(rv => !(item.reviewers || []).includes(rv))
+      return s + (cf.length || reviewers.length)
+    }, 0)
+    const adaptiveCalls = Math.min(maxCallsCap, Math.max(maxCalls, neededCalls))
+    if (adaptiveCalls > maxCalls) console.log(`[l2-loop] 적응형 예산: max-calls ${maxCalls} → ${adaptiveCalls} (deepen ${pending.length}건 대질, cap ${maxCallsCap})`)
+    if (neededCalls > maxCallsCap) console.log(`[l2-loop] ⚠️ 결함 ${pending.length}건 대질에 ${neededCalls}콜 필요하나 cap ${maxCallsCap} → 초과분 미검증(unverified, fail-closed)`)
+    maxCalls = adaptiveCalls
     let callsUsed = reviewers.length
     let r = round
     const escalated = [], deepSettled = []
@@ -694,22 +810,32 @@ async function main() {
       const byReviewer = {} // reviewer -> [{item, stance}] for raw md
       for (const item of pending) {
         let confronters = reviewers.filter(rv => !(item.reviewers || []).includes(rv))
-        if (!confronters.length) confronters = reviewers.slice() // self-deepen if single-reviewer run
+        const selfDeepen = !confronters.length // single-reviewer run: same vendor self-confronts (NOT independent, 1794981e)
+        if (selfDeepen) confronters = reviewers.slice()
         if (callsUsed + confronters.length > maxCalls) { // budget guard → escalate remainder
-          const res = S.resolveDeepen(item, [], false)
-          res.note = 'max-calls 도달 — 미대질 에스컬레이션'
+          // B.4 L2 finding 1eba8b58: a CARRIED item (already confronted in a prior round, has _priorRes)
+          //   must NOT be relabeled 'unverified(대질 안 함)' — that re-introduces the hiding the patch removes.
+          //   Preserve its last real resolution(split/refuted/uncertain/parser_fail); only NEVER-confronted → 'unverified'.
+          const res = item._priorRes
+            ? { ...item._priorRes, status: 'escalate', note: '재대질 예산 소진 — 직전 라운드 판정 유지(미대질 아님)' }
+            : Object.assign(S.resolveDeepen(item, [], false), { note: 'max-calls 도달 — 한 번도 대질 안 함(미검증)' })
           resolvedThisRound.push(res); escalated.push(res); continue
         }
         const stanceRaw = await Promise.all(confronters.map(rv =>
           runReviewer(rv, buildDeepenPrompt(rv, artifactPath, body, item, r), mockDir, r, raw => S.parseStance(rv, raw).parser_status === 'ok', STANCE_SCHEMA)))
-        callsUsed += confronters.length
+        callsUsed += confronters.length // ⚠️ L2 finding 085eab6a: 실패/parse-fail 콜도 예산 소진 → 일시 매체장애가 후속 쟁점을
+        //   budget-guard 로 밀어 'unverified'화하는 cascade 가능. 단 그 결과는 parser_fail/unverified 라벨로 *가시화*되므로 은폐는
+        //   아님(fail-closed 유지). 실패콜 비과금/재시도 정밀화는 후속(진입점3 신뢰성 측정 레이어)으로 분리.
         const stances = stanceRaw.map(sr => S.parseStance(sr.reviewer, sr.raw))
         stances.forEach(s => { (byReviewer[s.reviewer] = byReviewer[s.reviewer] || []).push({ item, stance: s }) })
         const res = S.resolveDeepen(item, stances, moreAllowed)
+        // 1794981e: self-deepen(동일 벤더 자가대질)의 corroborate 는 독립 교차검증이 아니므로 verified:true 를 주장하면 안 됨
+        //   (initial 의 'unanimous=≥2 reviewer' 비대칭). 단일벤더 저하 런에서 fail-closed 가 보호해야 할 바를 과장 표기 금지.
+        if (selfDeepen && res.verified) { res.verified = false; res.note = (res.note ? res.note + '; ' : '') + 'self-deepen(동일 벤더) — 독립 교차검증 아님' }
         resolvedThisRound.push(res)
         if (res.status === 'settled') deepSettled.push(res)
         else if (res.status === 'escalate') escalated.push(res)
-        else carry.push(item) // pending → next deepen round
+        else carry.push({ ...item, _priorRes: res }) // pending → next round; remember it WAS confronted (1eba8b58)
       }
 
       // write raw deepen md per confronter + deepen aggregation (§1.1 strict)
@@ -725,25 +851,52 @@ async function main() {
       console.log(`[l2-loop] round ${r} 대질: settled=${resolvedThisRound.filter(x => x.status === 'settled').length} escalate=${resolvedThisRound.filter(x => x.status === 'escalate').length} pending=${carry.length} (calls=${callsUsed})`)
       console.log(`  → wiki: reviews/${dAgg}.md`)
 
-      // durable bus: deepen round 레코드(item 별 resolution/status).
+      // durable bus: deepen round 레코드(item 별 resolution/status/verified). B.4: 미검증 2모드 분리 집계.
       busRounds.push({
         round: r, kind: 'deepen', reviewers, overallVerdict: null,
         canonicalItems: resolvedThisRound.map(res => ({
           parent_item_id: res.parent_item_id, severity: res.severity, claim: res.claim,
-          resolution: res.resolution, status: res.status, raisers: res.raisers,
+          resolution: res.resolution, status: res.status, verified: res.verified, raisers: res.raisers,
         })),
         settledCount: resolvedThisRound.filter(x => x.status === 'settled').length,
         deepenCount: carry.length,
         escalateCount: resolvedThisRound.filter(x => x.status === 'escalate').length,
+        unverifiedCount: resolvedThisRound.filter(x => x.resolution === 'unverified').length,
+        parserFailCount: resolvedThisRound.filter(x => x.resolution === 'parser_fail').length,
         parserFails: [], rawRefs: dRawLinks, aggRef: dAgg,
       })
       pending = carry
     }
-    // anything still pending after budget exhausted → escalate
-    for (const item of pending) { const res = S.resolveDeepen(item, [], false); res.note = 'deepen-budget 소진'; escalated.push(res) }
+    // anything still pending after rounds exhausted → escalate (carried items were confronted → preserve, 1eba8b58/0c7cb44a).
+    const postLoop = []
+    for (const item of pending) {
+      const res = item._priorRes
+        ? { ...item._priorRes, status: 'escalate', note: 'deepen-budget 소진 — 직전 라운드 판정 유지(미대질 아님)' }
+        : Object.assign(S.resolveDeepen(item, [], false), { note: 'deepen-budget 소진 — 한 번도 대질 안 함(미검증)' })
+      escalated.push(res); postLoop.push(res)
+    }
+    // cd0c8a18: post-loop escalation 도 busRounds 에 기록 — 안 하면 해당 item 의 bus 마지막 레코드가 carry 당시 'pending' 으로
+    //   고착돼 per-issue TERMINAL 을 읽는 소비자가 escalate 를 '심화지속'으로 오독. 합성 final round 로 terminal 을 정정.
+    if (postLoop.length) {
+      busRounds.push({
+        round: r + 1, kind: 'deepen', reviewers, overallVerdict: null,
+        canonicalItems: postLoop.map(res => ({
+          parent_item_id: res.parent_item_id, severity: res.severity, claim: res.claim,
+          resolution: res.resolution, status: res.status, verified: res.verified, raisers: res.raisers,
+        })),
+        settledCount: 0, deepenCount: 0, escalateCount: postLoop.length,
+        unverifiedCount: postLoop.filter(x => x.resolution === 'unverified').length,
+        parserFailCount: postLoop.filter(x => x.resolution === 'parser_fail').length,
+        parserFails: [], rawRefs: [], aggRef: null,
+      })
+    }
 
-    if (escalated.length) console.log(`[l2-loop] 🚩 대표 에스컬레이션 ${escalated.length}건 — 위키 deepen 집계의 "대표 에스컬레이션" 섹션 참조`)
-    else if (agg.deepen.length) console.log(`[l2-loop] ✅ 심화 ${agg.deepen.length}건 전부 수렴 (settled=${deepSettled.length})`)
+    if (escalated.length) {
+      const unv = escalated.filter(r => r.resolution === 'unverified').length
+      const pf = escalated.filter(r => r.resolution === 'parser_fail').length
+      const disagree = escalated.length - unv - pf
+      console.log(`[l2-loop] 🚩 대표 에스컬레이션 ${escalated.length}건 (이견 ${disagree} · 미검증/예산 ${unv} · 파싱실패 ${pf}) — fail-closed, 위키 deepen 집계 참조`)
+    } else if (agg.deepen.length) console.log(`[l2-loop] ✅ 심화 ${agg.deepen.length}건 전부 수렴 (settled=${deepSettled.length})`)
 
     if (!mockDir && agg.parserFails.length >= reviewers.length) {
       console.error(`[l2-loop] ⚠️ L2 미수행(매체 실패) — 전 reviewer 출력 파싱 실패(${agg.parserFails.join(', ')}). verdict=incomplete. 자체검증으로 대체 시 'L2 미수행(매체 실패)' 명시 필수.`)
@@ -756,14 +909,20 @@ async function main() {
     // counts 는 l2-loop 이 직접 산출(예산소진 escalation 포함). finalVerdict = 종료 상태. fail-soft.
     try {
       if (BUS) {
+        // B.4 진입점1: run-level counts = 런 전체의 AUTHORITATIVE 총계(in-round budget-guard + post-loop 미검증 모두 포함).
+        //   per-round busRound.unverifiedCount/parserFailCount 는 라운드별 *내역*일 뿐 — 소비자는 둘을 합산하지 말고 run-level 총계만
+        //   쓸 것(이중계상 방지, L2 b19774b6). escalated[] 는 모든 미검증을 한 번씩 담으므로 filter 가 정확한 총계.
+        const unverified = escalated.filter(r => r.resolution === 'unverified').length
+        const parserFail = escalated.filter(r => r.resolution === 'parser_fail').length
+        // fail-closed: 미검증이 1건이라도 있으면 clean pass 금지 → finalVerdict='escalation'(이미 escalated 에 포함돼 보장됨).
         const finalVerdict = escalated.length ? 'escalation' : (agg.deepen.length ? 'deepen-settled' : overall)
         const blocker = agg.canonical.filter(c => c.severity === 'blocker').length
         const important = agg.canonical.filter(c => c.severity === 'important').length
         const consensusBlocker = agg.canonical.filter(c => c.severity === 'blocker' && (c.reviewers || []).length >= 2).length
         BUS.completeReview({
           ...busCtx, finalVerdict, rounds: busRounds,
-          counts: { blocker, important, consensusBlocker, escalation: escalated.length },
-          metadata: { stamp, maxRounds, deepenBudget, deepSettled: deepSettled.length, parserFails: agg.parserFails },
+          counts: { blocker, important, consensusBlocker, escalation: escalated.length, unverified, parserFail },
+          metadata: { stamp, maxRounds, maxCalls, deepenBudget, deepSettled: deepSettled.length, parserFails: agg.parserFails },
         })
       }
     } catch (e) { /* fail-soft: bus 실패가 L2 를 깨지 않음 */ }
@@ -777,4 +936,4 @@ if (require.main === module) {
   main().catch(e => { console.error('l2-loop error:', e.message); process.exit(1) })
 }
 
-module.exports = { classifyFailure, runReviewer, L2_MAX_ATTEMPTS, L2_TERMINAL_RE, L2_TERMINAL_SUBSTR_RE, geminiSchema, geminiApiKey, resolveReviewers }
+module.exports = { classifyFailure, runReviewer, L2_MAX_ATTEMPTS, L2_TERMINAL_RE, L2_TERMINAL_SUBSTR_RE, geminiSchema, geminiApiKey, geminiApiKeys, geminiKeyExhausted, runGeminiApi, resolveGeminiModel, geminiEnvFileVar, alertCooldownOk, resolveReviewers }
diff --git a/l2-schema.js b/l2-schema.js
index ae08f87..f75273d 100755
--- a/l2-schema.js
+++ b/l2-schema.js
@@ -184,26 +184,48 @@ function parseStance(reviewer, raw) {
  * @param {object} item - a round-1 deepen canonical issue (has canonical_item_id, severity, claim, reviewers)
  * @param {Array} stances - parseStance results from confronters
  * @param {boolean} budgetLeft - whether another deepen round is permitted
+ *
+ * B.4 진입점1 (spec §9.4) — every return carries `verified:boolean`, the single fail-closed predicate.
+ * 미검증의 두 모드를 명확히 구별한다(출력상 동일하던 것을 분리):
+ *   ② budget-exhausted (confronters NEVER called; budget guard passes []) → 'unverified'
+ *   ① parser-fail (confronters CALLED but every reply unparseable)        → 'parser_fail'
+ * 둘 다 verified:false. 미검증을 통과/clean으로 둔갑시키는 것 금지(안전 치명) → 소비자는 `verified === false` 로 게이트 닫음
+ *   (`!verified` 금지 — legacy 레코드의 verified===undefined 가 !undefined=true 로 오판, L2 fc1814f4).
+ *
+ * ★ `verified` 의미(L2 finding 42d89d1a) = "검증이 *수행됨*"(대질 스탠스를 얻음)이지 "판정이 *옳다/안전하다*"가 아니다.
+ *   refuted/split/uncertain 도 verified:true — 단일 confronter 의 반박이 틀릴 수 있으나 그건 *신뢰성* 축(진입점3 적응형
+ *   사다리 L3 3벤더, spec §3·§7-4)의 문제. 진입점3 소비자는 verified 로 "검증 수행 여부"만 게이트하고, 고-stakes refuted 의
+ *   *신뢰*는 사다리로 별도 판정해야 한다 — verified:true 를 "결함 해소 확정"으로 오해석 금지.
  */
 function resolveDeepen(item, stances, budgetLeft) {
-  const valid = (stances || []).filter(s => s.parser_status === 'ok')
+  const sArr = stances || []
+  const valid = sArr.filter(s => s.parser_status === 'ok')
+  // L2 finding 99f737ee: parser_fail 은 *전원* 실패에만 나므로, ≥2 confronter 중 일부만 파싱된 '부분 패널 유실'이
+  //   '전원 성공'과 동일 라벨이 된다. confronter 카운트 + partial 플래그로 *구별 가능*하게 한다(소비자가 부분유실 인지).
+  const partial = sArr.length > 0 && valid.length > 0 && valid.length < sArr.length
   const base = {
     parent_item_id: item.canonical_item_id,
     severity: item.severity,
     claim: item.claim,
     raisers: (item.reviewers || []).slice(),
-    stances: stances || [],
+    stances: sArr,
+    confronters: { total: sArr.length, parsed: valid.length }, // 패널 완전성(부분유실 가시화)
+    partial,
   }
+  // corroborated: every usable confronter agrees → confirmed real defect (verified).
   if (valid.length && valid.every(s => s.stance === 'corroborate')) {
-    return { ...base, resolution: 'corroborated', status: 'settled' }
+    return { ...base, resolution: 'corroborated', status: 'settled', verified: true }
   }
-  let resolution = 'unresolved' // no usable confronter reply (all parser-fail)
+  // genuine signal from ≥1 confronter → split/refuted/uncertain (verified: a stance WAS obtained).
   if (valid.length) {
     const hasR = valid.some(s => s.stance === 'refute')
     const hasC = valid.some(s => s.stance === 'corroborate')
-    resolution = hasR && hasC ? 'split' : hasR ? 'refuted' : 'uncertain'
+    const resolution = hasR && hasC ? 'split' : hasR ? 'refuted' : 'uncertain'
+    return { ...base, resolution, status: budgetLeft ? 'pending' : 'escalate', verified: true }
   }
-  return { ...base, resolution, status: budgetLeft ? 'pending' : 'escalate' }
+  // not verified: distinguish ② never-confronted (empty stances) from ① confronted-but-all-fail.
+  const resolution = sArr.length ? 'parser_fail' : 'unverified'
+  return { ...base, resolution, status: budgetLeft ? 'pending' : 'escalate', verified: false }
 }
 
 module.exports = { SCHEMA_VERSION, STANCES, parseVerdict, aggregate, overallVerdict, parseStance, resolveDeepen, extractJson, tokens, jaccard, sha8 }
```

## 5. 자체 검증 결과
- 단위테스트: l2-schema 24 pass(신규 3분리 케이스 포함)·l2-loop 12·l2-db-writer 13.
- 산술: 9쟁점·reviewer2 → needed 11 → maxCalls 8→11(이전 6개만 대질, 3개 미검증이던 것 전부 대질). 3분리 출력 [unverified/false, parser_fail/false, corroborated/true] 확인.

## 6. 적대검증 포인트 (검토자에게)
- 적응형 `neededCalls` 산식이 multi-confronter(reviewer 3+) 또는 self-deepen(single-reviewer) 경계에서 정확한가?
- `verified:true`를 split/refuted/uncertain에 부여하는 것의 위험(refuted=대질자가 틀리게 반박했을 가능성 — spec §7-4)? 본 패치 범위에서 옳은가?
- post-loop 미검증(`deepen-budget 소진`)이 bus round엔 없고 run-level counts로만 잡히는 누락 위험?
- 하드캡 24가 reviewer 다수·쟁점 다수 조합에서 여전히 미검증을 남기는데, 그때 fail-closed가 실제로 닫히는가?

---

## 7. 동기 L2 round-1 결과 + 반영 (2026-06-25, claude 단독 — gemini 429)
> ⚠️ gemini terminal 429(쿼터 소진) → 2벤더 미완(claude 단독=부분 자기검토). 그럼에도 claude가 실질 결함 5건 포착(전부 코드추적 확인). 새 라벨링 실증: 에스컬레이션 "이견 0 · 미검증/예산 0 · 파싱실패 2"(gemini 429를 parser_fail로 정직 분류, unverified와 구분).

- **`1eba8b58` (important) 반영**: 적응형 예산이 1회 대질만 산정 → round-2서 대질·carry된 항목이 round-3 예산초과 시 'unverified(미대질)' 오라벨(은폐 재도입). → carry에 `_priorRes` 부착, budget-guard/post-loop에서 **직전 판정 유지**(never-confronted만 unverified).
- **`91c25e7f` (important) 반영**: round-1(initial) busRound에 `verified` 부재 → 진입점3 `!verified` 균일적용 시 전건 미검증→gate 영구차단. → initial canonicalItems에 `verified`(consensus=교차확인) 추가 + ★계약: 진입점3는 per-issue TERMINAL(deepen이 initial supersede) 읽기.
- **`42d89d1a` (suggest) 반영**: `verified`=검증 *수행됨*(스탠스 획득)이지 판정 *옳음* 아님 명확화(신뢰성=진입점3 사다리 L3). 주석.
- **`085eab6a` (suggest) 반영**: 실패콜 예산소진 cascade → parser_fail/unverified 라벨로 가시화(은폐 아님), 비과금/재시도는 후속 분리. 주석.
- **`0c7cb44a` (suggest) 반영**: post-loop 오라벨 → 1eba8b58 수정으로 동시 해소(_priorRes 보존).

**재검증**: 단위 24+12+13 pass, carry 오라벨 수정 합성검증 통과. **2벤더(gemini) 동기 L2는 쿼터 회복 후 carry.**

## 8. 동기 L2 round-2/3 (2026-06-25, claude 단독 — gemini 계속 429)
- **round-2 (수정본)**: blocker 1 + important 2 + suggest 1. ★ `5cab813a` **blocker** = 내가 91c25e7f 수정을 거꾸로 함(`!!c.consensus`가 항상 truthy → fail-OPEN). `verified: c.consensus === 'unanimous'`로 정정. + `b19774b6`(run-level 총계 주석 정정) `fc1814f4`(legacy 버전가드: 소비자는 `verified===false`만, `!verified` 금지) `dd28db07`(cap floor=max(maxCalls,...)).
- **round-3 (재수정본)**: blocker 0(술어 확정). important 3 + suggest 2 반영: `1794981e`(self-deepen=동일벤더 자가대질→verified:true 박탈) `cd0c8a18`(post-loop escalation을 합성 final busRound로 기록→bus terminal 정정) `3d28fa53`(계약 severity 스코프: 게이트는 important+만, suggest=advisory).

### ★ 수렴 관찰 (spec §9 thesis 실증)
- gemini가 3라운드 연속 terminal 429 → **2벤더 교차검증 불가**, claude 단독(부분 자기검토)만 누적. 라운드마다 5→4→5건씩 *나옴*(트집율 현상, spec §9의 "round-1 거의 항상 blocker"와 동일).
- = **2nd 벤더(독립 adjudicator)가 죽으면 "어느 게 진짜 release-blocker인지" 판정 자체가 안 된다** — 이 패치가 고치려는 바로 그 구조(검증이 실제로 돌아야 상위 판정이 의미)를 라이브로 실증.
- 명확히 옳은 결함(자가도입 blocker·통합성·정확성)은 전부 반영. 남은 단일벤더 findings는 nuanced 계약 edge라 2벤더 adjudication 없이 무한 반복 위험 → **여기서 정지**.

## 9. ★ 진짜 2벤더 동기 L2 (2026-06-25, claude∥gemini — gemini 키 폴오버로 부활)
> gemini 키 풀 폴오버(키#1·#2 429 → 키#3 성공) + 모델 gemini-2.5-flash 로 **2벤더 교차검증 carry 해소**. 양쪽 parser=ok.
> 결과: round-1 claude 5 ∥ gemini 2 → canonical 7, deepen 5. round-2 **settled(corroborated) 3** / round-3 **escalate 2(이견)**.
> **🚩 에스컬레이션 2건 = 이견 2 · 미검증/예산 0 · 파싱실패 0** → 건강한 2벤더 런에서 패치의 정직 회계 입증(예산소진 둔갑 없음, 2건은 진짜 벤더 간 이견=설계대로 대표 판정행).

### 반영
- `233ba9b9`(claude)/`026580ba`(gemini) — §4 디프가 stale(round-3 수정 미반영)이라 "미구현" 오판 → **§4 디프 실코드로 갱신**(코드는 정상, 아티팩트 문제였음).
- `99f737ee`(claude imp) — 부분 confronter 유실 은폐 → `resolveDeepen`에 `confronters:{total,parsed}`+`partial` 추가(전원성공과 구별, 25 test). 2벤더 기본엔 미발동, L3 3+벤더 대비.

### 알려진 한계(후속, 안전방향이라 비차단)
- `e3aa4d7c`(gemini imp)/085eab6a — 실패콜이 예산 소진→cascade로 후속 쟁점 'unverified'화. **라벨로 가시화돼 fail-closed 유지(미검증을 *늘리는* 안전 방향)**. 비과금 재시도 정밀화 = 후속.
- `e7447b00`(claude imp) — 적응형 예산=1라운드 대질분 → split/uncertain의 다라운드 재수렴은 잔여 예산 한도. **미수렴 이견은 escalate(=설계 의도, 대표 판정)**. doc 과장 정정(본 절).
- `b2d44f5d`(claude sug) — `MAIA_L2_MAX_CALLS_CAP`<설정 maxCalls 불가(floor). env명이 천장 시사하나 하한 보장 — 의도(상향 전용)이나 명명 혼동, 후속 rename 후보.
- `23aef258`(claude sug) — 단일벤더 자기참조 우려 → **본 2벤더 런으로 해소**.

→ 코어 패치는 2벤더로 검증됨. 잔여는 문서/미래(L3)/안전방향 견고성. **carry(2벤더 재검증) 종료.**
