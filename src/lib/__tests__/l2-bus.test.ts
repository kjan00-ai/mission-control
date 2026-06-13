import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
import { rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// C5-2: migration 054_l2_durable_bus — l2_reviews / l2_rounds durable bus tables.
// 검증: 테이블/인덱스 생성, run_key UNIQUE 멱등, FK CASCADE, insert→read 라운드트립,
//   그리고 WSL writer(~/.ai-bootstrap/l2-db-writer.js)의 기대 컬럼 집합이 라이브 스키마와 일치하는지(드리프트 가드).

const tmpDir = mkdtempSync(join(tmpdir(), 'l2bus-'))
const cleanup: string[] = []
afterAll(() => {
  for (const f of cleanup) { try { rmSync(f, { force: true }) } catch { /* noop */ } }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
})

function freshDb(): Database.Database {
  const path = join(tmpDir, `fresh-${Math.floor(performance.now() * 1000)}.db`)
  cleanup.push(path)
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

// l2-db-writer.js 가 INSERT 전에 PRAGMA table_info 로 확인하는 필수 컬럼(계약 미러).
// writer 와 본 목록이 어긋나면 드리프트이므로 둘 다 갱신해야 한다 — 그것이 이 테스트의 목적.
const WRITER_REVIEW_COLS = [
  'run_key', 'artifact', 'project_id', 'task_id', 'trigger', 'final_verdict', 'status',
  'rounds_count', 'blocker_count', 'important_count', 'escalation_count', 'consensus_blocker_count',
  'content_hash', 'agg_ref', 'reviewers', 'metadata', 'workspace_id', 'created_at', 'completed_at',
]
const WRITER_ROUND_COLS = [
  'review_id', 'round', 'kind', 'reviewers', 'overall_verdict', 'canonical_items',
  'settled_count', 'deepen_count', 'escalate_count', 'parser_fails', 'raw_refs', 'agg_ref', 'workspace_id',
]

describe('migration 054 — l2 durable bus schema', () => {
  it('creates l2_reviews and l2_rounds tables', () => {
    const db = freshDb()
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('l2_reviews','l2_rounds')`).all() as Array<{ name: string }>
    expect(tables.map((t) => t.name).sort()).toEqual(['l2_reviews', 'l2_rounds'])
    db.close()
  })

  it('l2_reviews has run_key UNIQUE index + key lookup indexes', () => {
    const db = freshDb()
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='l2_reviews'`).all() as Array<{ name: string }>
    const names = idx.map((i) => i.name)
    expect(names).toContain('idx_l2_reviews_run_key')
    expect(names).toContain('idx_l2_reviews_artifact')
    expect(names).toContain('idx_l2_reviews_status')
    // run_key index must be UNIQUE (idempotency guard)
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_l2_reviews_run_key'`).get() as { sql: string }).sql
    expect(/UNIQUE/i.test(sql)).toBe(true)
    db.close()
  })

  it('live schema contains every column the WSL writer expects (drift guard)', () => {
    const db = freshDb()
    const reviewCols = new Set((db.prepare(`PRAGMA table_info(l2_reviews)`).all() as Array<{ name: string }>).map((c) => c.name))
    const roundCols = new Set((db.prepare(`PRAGMA table_info(l2_rounds)`).all() as Array<{ name: string }>).map((c) => c.name))
    for (const c of WRITER_REVIEW_COLS) expect(reviewCols.has(c), `l2_reviews.${c} missing`).toBe(true)
    for (const c of WRITER_ROUND_COLS) expect(roundCols.has(c), `l2_rounds.${c} missing`).toBe(true)
    db.close()
  })

  it('run_key UNIQUE rejects duplicates but allows multiple NULLs', () => {
    const db = freshDb()
    const ins = db.prepare(`INSERT INTO l2_reviews (run_key, artifact) VALUES (?, ?)`)
    ins.run('rk-1', 'art-a')
    expect(() => ins.run('rk-1', 'art-a-dup')).toThrow()
    // multiple NULL run_key rows must coexist (legacy/keyless)
    expect(() => { ins.run(null, 'art-n1'); ins.run(null, 'art-n2') }).not.toThrow()
    db.close()
  })

  it('ON CONFLICT(run_key) DO NOTHING is idempotent', () => {
    const db = freshDb()
    const ins = db.prepare(`INSERT INTO l2_reviews (run_key, artifact, status) VALUES (?, ?, 'running') ON CONFLICT(run_key) DO NOTHING`)
    const a = ins.run('rk-x', 'art-x')
    const b = ins.run('rk-x', 'art-x')
    expect(a.changes).toBe(1)
    expect(b.changes).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) c FROM l2_reviews WHERE run_key='rk-x'`).get() as { c: number }).c).toBe(1)
    db.close()
  })

  it('deleting a review cascades to its rounds', () => {
    const db = freshDb()
    const rev = db.prepare(`INSERT INTO l2_reviews (run_key, artifact) VALUES ('rk-c', 'art-c')`).run()
    const id = Number(rev.lastInsertRowid)
    db.prepare(`INSERT INTO l2_rounds (review_id, round) VALUES (?, 1)`).run(id)
    db.prepare(`INSERT INTO l2_rounds (review_id, round) VALUES (?, 2)`).run(id)
    expect((db.prepare(`SELECT COUNT(*) c FROM l2_rounds WHERE review_id=?`).get(id) as { c: number }).c).toBe(2)
    db.prepare(`DELETE FROM l2_reviews WHERE id=?`).run(id)
    expect((db.prepare(`SELECT COUNT(*) c FROM l2_rounds WHERE review_id=?`).get(id) as { c: number }).c).toBe(0)
    db.close()
  })

  it('insert→read roundtrip with JSON fields', () => {
    const db = freshDb()
    const rev = db.prepare(`
      INSERT INTO l2_reviews (run_key, artifact, final_verdict, status, blocker_count, consensus_blocker_count, reviewers, metadata)
      VALUES ('rk-rt', 'art-rt', 'deepen-settled', 'settled', 2, 1, ?, ?)
    `).run(JSON.stringify(['codex', 'gemini']), JSON.stringify({ stamp: '20260613' }))
    const id = Number(rev.lastInsertRowid)
    db.prepare(`INSERT INTO l2_rounds (review_id, round, kind, canonical_items) VALUES (?, 1, 'initial', ?)`)
      .run(id, JSON.stringify([{ severity: 'blocker', reviewers: ['codex', 'gemini'] }]))
    const row = db.prepare(`SELECT * FROM l2_reviews WHERE id=?`).get(id) as any
    expect(JSON.parse(row.reviewers)).toEqual(['codex', 'gemini'])
    expect(row.consensus_blocker_count).toBe(1)
    const rounds = db.prepare(`SELECT * FROM l2_rounds WHERE review_id=?`).all(id) as any[]
    expect(JSON.parse(rounds[0].canonical_items)[0].severity).toBe('blocker')
    db.close()
  })

  it('migration is idempotent (re-run is a no-op)', () => {
    const db = freshDb()
    expect(() => runMigrations(db)).not.toThrow()
    const tables = db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('l2_reviews','l2_rounds')`).get() as { c: number }
    expect(tables.c).toBe(2)
    db.close()
  })
})
