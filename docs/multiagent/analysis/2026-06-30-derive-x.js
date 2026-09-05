#!/usr/bin/env node
// 진입점2 — 임계 X 실데이터 재도출 (read-only 측정). sqlite3 CLI 덤프(reviews.json/rounds.json) 입력.
'use strict'
const fs = require('fs')
const SP = __dirname
const reviews = JSON.parse(fs.readFileSync(SP + '/reviews.json', 'utf8'))
const rounds = JSON.parse(fs.readFileSync(SP + '/rounds.json', 'utf8'))
const roundsByReview = new Map()
for (const r of rounds) { if (!roundsByReview.has(r.review_id)) roundsByReview.set(r.review_id, []); roundsByReview.get(r.review_id).push(r) }
function J(s) { try { return JSON.parse(s || '[]') } catch (e) { return [] } }

// artifact별 최신 review (c6-ready dedup)
const latestByArtifact = new Map()
for (const r of reviews) { const p = latestByArtifact.get(r.artifact); if (!p || r.created_at > p.created_at) latestByArtifact.set(r.artifact, r) }

function classifyReview(reviewId) {
  const rds = (roundsByReview.get(reviewId) || []).slice().sort((a, b) => a.round - b.round)
  const terminal = new Map(); let hasVerifiedField = false
  for (const rd of rds) for (const it of J(rd.canonical_items)) {
    const cid = it.parent_item_id || it.canonical_item_id || it.id; if (!cid) continue
    if (Object.prototype.hasOwnProperty.call(it, 'verified')) hasVerifiedField = true
    terminal.set(cid, {
      severity: it.severity || 'suggest', resolution: it.resolution || null,
      status: it.status || (it.consensus === 'unanimous' ? 'settled' : 'initial'),
      consensus: it.consensus || null,
      verified: Object.prototype.hasOwnProperty.call(it, 'verified') ? it.verified : undefined,
    })
  }
  return { terminal, hasVerifiedField }
}
function classifyIssue(t) {
  if (t.verified === false) return 'unverified'
  if (t.status === 'settled' && (t.resolution === 'corroborated' || t.consensus === 'unanimous')) return 'real'
  if (t.verified === true && (t.resolution === 'split' || t.resolution === 'uncertain')) return 'real'
  if (t.verified === true && t.resolution === 'refuted') return 'refuted'
  if (t.consensus === 'unanimous') return 'real'
  return 'resolved-initial'
}
const isImp = s => s === 'blocker' || s === 'important'
const isBlk = s => s === 'blocker'

const rows = []
for (const [artifact, r] of latestByArtifact) {
  const { terminal, hasVerifiedField } = classifyReview(r.id)
  if (!hasVerifiedField) continue
  let realImp = 0, realBlk = 0, refuted = 0, unvImp = 0, total = 0
  for (const [, t] of terminal) { total++; const c = classifyIssue(t)
    if (c === 'real' && isImp(t.severity)) realImp++
    if (c === 'real' && isBlk(t.severity)) realBlk++
    if (c === 'refuted') refuted++
    if (c === 'unverified' && isImp(t.severity)) unvImp++ }
  rows.push({ artifact, trigger: r.trigger, total, realImp, realBlk, refuted, unvImp,
    hasRealImp: realImp > 0, hasRealBlk: realBlk > 0, hasUnvImp: unvImp > 0 })
}

const N = rows.length
const cnt = k => rows.reduce((a, r) => a + (r[k] ? 1 : 0), 0)
const hasRealImp = cnt('hasRealImp'), hasRealBlk = cnt('hasRealBlk'), hasUnv = cnt('hasUnvImp')
const cleanV = rows.filter(r => !r.hasRealImp && !r.hasUnvImp).length
const pct = n => N ? (100 * n / N).toFixed(1) + '%' : 'n/a'

console.log('=== honest 집합 (post-진입점1) per-artifact 종단 분류 ===\n')
console.log('artifact'.padEnd(56), 'trig'.padEnd(6), 'iss', 'rImp', 'rBlk', 'refut', 'unvImp')
for (const r of rows) console.log(r.artifact.padEnd(56), r.trigger.padEnd(6),
  String(r.total).padStart(3), String(r.realImp).padStart(4), String(r.realBlk).padStart(4),
  String(r.refuted).padStart(5), String(r.unvImp).padStart(6))

console.log('\n=== 분포 (N =', N, 'distinct artifacts) ===')
console.log(`hasBlocker(important+, 검증된 진짜결함):  ${hasRealImp}/${N} = ${pct(hasRealImp)}`)
console.log(`hasBlocker(blocker severity만):           ${hasRealBlk}/${N} = ${pct(hasRealBlk)}`)
console.log(`미검증 보유(important+, fail-closed 대상): ${hasUnv}/${N} = ${pct(hasUnv)}`)
console.log(`검증완료 & clean:                          ${cleanV}/${N} = ${pct(cleanV)}`)
const tUnv = rows.reduce((a, r) => a + r.unvImp, 0)
const tImp = rows.reduce((a, r) => a + r.realImp + r.unvImp + r.refuted, 0)
console.log(`\nimportant+ 이슈 중 미검증 비율: ${tUnv}/${tImp} = ${tImp ? (100 * tUnv / tImp).toFixed(1) + '%' : 'n/a'}`)

// 참고: legacy 포함 전체(round-1 방식)와 대조 — 왜 legacy로는 못 하는지
let legacyN = 0, legacyBlk = 0
for (const [artifact, r] of latestByArtifact) {
  const { hasVerifiedField, terminal } = classifyReview(r.id); if (hasVerifiedField) continue
  legacyN++; for (const [, t] of terminal) if (isImp(t.severity) && (t.consensus === 'unanimous' || t.status === 'escalate')) { legacyBlk++; break }
}
console.log(`\n[대조] legacy(오염) 집합: N=${legacyN}, escalate/unanimous 보유 artifact(미검증 혼재)=${legacyBlk} → ${legacyN ? (100*legacyBlk/legacyN).toFixed(1)+'%' : 'n/a'} (예산소진 미검증 포함=노이즈 바닥)`)
