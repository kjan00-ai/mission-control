import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
import { existsSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// C4B-0: verify migration 052 (drop agents.name global UNIQUE + add tasks.agent_id)
// against a freshly-built schema AND, when present, a backup copy of the live DB.

const tmpDir = mkdtempSync(join(tmpdir(), 'c4b0-'))
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

describe('migration 052 — schema shape', () => {
  it('agents.name is no longer globally UNIQUE; (source,name) UNIQUE remains', () => {
    const db = freshDb()
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'`).get() as { sql: string }).sql
    expect(/\bname\b\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sql)).toBe(false)
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agents' AND name='idx_agents_source_name'`).all()
    expect(idx.length).toBe(1)
    db.close()
  })

  it('tasks.agent_id column + index exist, FK to agents(id)', () => {
    const db = freshDb()
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'agent_id')).toBe(true)
    const fks = db.prepare(`PRAGMA foreign_key_list(tasks)`).all() as Array<{ table: string; from: string }>
    expect(fks.some((f) => f.table === 'agents' && f.from === 'agent_id')).toBe(true)
    db.close()
  })

  it('same agent name across two projects coexists (the C4B blocker)', () => {
    const db = freshDb()
    const now = Math.floor(Date.now() / 1000)
    const ins = db.prepare(`INSERT INTO agents (name, role, status, source, workspace_id, created_at, updated_at) VALUES (?, 'agent', 'online', ?, 1, ?, ?)`)
    ins.run('frontend-engineer', 'claude-project:owner/x', now, now)
    // Pre-052 this would throw UNIQUE(name); now it must succeed with a different source.
    expect(() => ins.run('frontend-engineer', 'claude-project:owner/y', now, now)).not.toThrow()
    const rows = db.prepare(`SELECT source FROM agents WHERE name = 'frontend-engineer'`).all()
    expect(rows.length).toBe(2)
    // Same (source,name) must still be rejected.
    expect(() => ins.run('frontend-engineer', 'claude-project:owner/x', now, now)).toThrow()
    db.close()
  })

  it('foreign_key_check passes on a fresh fully-migrated DB', () => {
    const db = freshDb()
    expect((db.prepare(`PRAGMA foreign_key_check`).all()).length).toBe(0)
    db.close()
  })
})

// The agent_id-first routing JOIN shared by dispatch/requeue/review (task-dispatch.ts).
// Kept here verbatim so a routing regression (e.g. reverting to a plain name JOIN that
// double-dispatches same-name agents) fails this test.
const ROUTING_JOIN = `
  SELECT t.id, a.id AS agent_id, a.source AS agent_source
  FROM tasks t
  JOIN agents a ON (t.agent_id IS NOT NULL AND a.id = t.agent_id)
    OR (t.agent_id IS NULL AND a.name = t.assigned_to AND a.workspace_id = t.workspace_id
        AND (SELECT COUNT(*) FROM agents a2 WHERE a2.name = t.assigned_to AND a2.workspace_id = t.workspace_id) = 1)
  WHERE t.id = ?
`

function seedTwoProjectAgents(db: Database.Database) {
  const now = Math.floor(Date.now() / 1000)
  const px = db.prepare(`INSERT INTO projects (workspace_id, name, slug, ticket_prefix, github_repo, created_at, updated_at) VALUES (1, 'X', 'x', 'X', 'owner/x', ?, ?)`).run(now, now).lastInsertRowid as number
  const py = db.prepare(`INSERT INTO projects (workspace_id, name, slug, ticket_prefix, github_repo, created_at, updated_at) VALUES (1, 'Y', 'y', 'Y', 'owner/y', ?, ?)`).run(now, now).lastInsertRowid as number
  const insA = db.prepare(`INSERT INTO agents (name, role, status, source, workspace_id, created_at, updated_at) VALUES ('frontend-engineer', 'agent', 'online', ?, 1, ?, ?)`)
  const ax = insA.run('claude-project:owner/x', now, now).lastInsertRowid as number
  const ay = insA.run('claude-project:owner/y', now, now).lastInsertRowid as number
  return { px, py, ax, ay, now }
}

describe('migration 052 — agent_id routing', () => {
  it('dispatch JOIN returns exactly the project-scoped agent (no same-name double dispatch)', () => {
    const db = freshDb()
    const { px, ax, ay, now } = seedTwoProjectAgents(db)
    // Task in project X, routed by agent_id to X's frontend-engineer.
    const tid = db.prepare(`INSERT INTO tasks (title, status, assigned_to, agent_id, project_id, workspace_id, created_at, updated_at) VALUES ('t', 'assigned', 'frontend-engineer', ?, ?, 1, ?, ?)`).run(ax, px, now, now).lastInsertRowid as number
    const rows = db.prepare(ROUTING_JOIN).all(tid) as Array<{ agent_id: number; agent_source: string }>
    expect(rows.length).toBe(1)
    expect(rows[0].agent_id).toBe(ax)
    expect(rows[0].agent_source).toBe('claude-project:owner/x')
    expect(ay).not.toBe(ax)
    db.close()
  })

  it('legacy NULL agent_id with ambiguous name routes to NOBODY (count-gated fallback)', () => {
    const db = freshDb()
    const { px, now } = seedTwoProjectAgents(db)
    // agent_id NULL + two agents named frontend-engineer → fallback must NOT pick either.
    const tid = db.prepare(`INSERT INTO tasks (title, status, assigned_to, agent_id, project_id, workspace_id, created_at, updated_at) VALUES ('t', 'assigned', 'frontend-engineer', NULL, ?, 1, ?, ?)`).run(px, now, now).lastInsertRowid as number
    expect((db.prepare(ROUTING_JOIN).all(tid)).length).toBe(0)
    db.close()
  })

  it('legacy NULL agent_id with a unique name still routes (single-match fallback)', () => {
    const db = freshDb()
    const now = Math.floor(Date.now() / 1000)
    const a = db.prepare(`INSERT INTO agents (name, role, status, source, workspace_id, created_at, updated_at) VALUES ('solo', 'agent', 'online', 'manual', 1, ?, ?)`).run(now, now).lastInsertRowid as number
    const tid = db.prepare(`INSERT INTO tasks (title, status, assigned_to, agent_id, workspace_id, created_at, updated_at) VALUES ('t', 'assigned', 'solo', NULL, 1, ?, ?)`).run(now, now).lastInsertRowid as number
    const rows = db.prepare(ROUTING_JOIN).all(tid) as Array<{ agent_id: number }>
    expect(rows.length).toBe(1)
    expect(rows[0].agent_id).toBe(a)
    db.close()
  })
})

describe('migration 052 — against live DB backup (skipped if absent)', () => {
  const livePath = join(process.cwd(), '.data', 'mission-control.db')

  it('preserves agents + child-FK rows and runs cleanly on real data', async () => {
    if (!existsSync(livePath)) { return } // CI / no live data → skip
    const src = new Database(livePath, { readonly: true })
    const copyPath = join(tmpDir, 'live-copy.db')
    cleanup.push(copyPath)
    await src.backup(copyPath)
    src.close()

    const db = new Database(copyPath)
    db.pragma('foreign_keys = ON')
    const beforeAgents = (db.prepare(`SELECT COUNT(*) c FROM agents`).get() as { c: number }).c
    const beforeDC = (db.prepare(`SELECT COUNT(*) c FROM direct_connections`).get() as { c: number }).c
    const beforeSH = (db.prepare(`SELECT COUNT(*) c FROM spawn_history`).get() as { c: number }).c

    runMigrations(db) // applies 052 (live DB is at 051)

    // recreate must preserve every agents row (id-stable) and child-FK rows.
    expect((db.prepare(`SELECT COUNT(*) c FROM agents`).get() as { c: number }).c).toBe(beforeAgents)
    expect((db.prepare(`SELECT COUNT(*) c FROM direct_connections`).get() as { c: number }).c).toBe(beforeDC)
    expect((db.prepare(`SELECT COUNT(*) c FROM spawn_history`).get() as { c: number }).c).toBe(beforeSH)
    expect((db.prepare(`PRAGMA foreign_key_check`).all()).length).toBe(0)
    // schema actually changed + agent_id present.
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'agent_id')).toBe(true)
    db.close()
  })
})
