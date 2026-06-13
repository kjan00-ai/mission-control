// C4B-1~3: project agent kit sync — migration 053 + helper↔server convergence.
// Proves register-mc-agents.js (JS, scaffold-time) and syncProjectAgents (TS,
// scheduler) produce byte-identical contract rows for the same .claude/agents,
// so the immediate + periodic upserts converge (spec §4.3 / §5).
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const tmpRoot = mkdtempSync(join(tmpdir(), 'c4b-kit-'))
const DB_PATH = join(tmpRoot, 'mission-control.db')
// Point both the raw connection AND the app singleton (getDatabase) at this file.
process.env.MISSION_CONTROL_DATA_DIR = tmpRoot
process.env.MISSION_CONTROL_DB_PATH = DB_PATH

import { runMigrations } from '@/lib/migrations'

const HELPER = join(homedir(), '.ai-bootstrap', 'register-mc-agents.js')
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// Two agents: one comma-form tools, one JSON-array form — both must parse identically.
const AGENT_FRONTEND = `---
name: frontend-engineer
description: UI 구현 담당
tools: Read, Edit, Bash
model: claude-sonnet-4-6
---

당신은 프로젝트의 프론트엔드 엔지니어입니다.
`
const AGENT_REVIEWER = `---
name: code-reviewer
description: 변경 리뷰
tools: ["Read", "Grep"]
model: claude-sonnet-4-6
---

당신은 코드 리뷰어입니다.
`
const KIT: Record<string, string> = {
  'frontend-engineer.md': AGENT_FRONTEND,
  'code-reviewer.md': AGENT_REVIEWER,
}

function seedProject(dir: string) {
  const ad = join(dir, '.claude', 'agents')
  mkdirSync(ad, { recursive: true })
  for (const [f, c] of Object.entries(KIT)) writeFileSync(join(ad, f), c)
  // noise files that must be ignored
  writeFileSync(join(ad, 'CLAUDE.md'), '# not an agent')
  writeFileSync(join(ad, 'AGENTS.md'), '# not an agent')
}

const projDir1 = join(tmpRoot, 'proj-alpha')
const projDir2 = join(tmpRoot, 'proj-beta')

let raw: Database.Database
let id1 = 0  // proj-alpha id (NOT assumed — migrations may seed a default project at id 1)
let id2 = 0  // proj-beta id
let src1 = ''
let src2 = ''

beforeAll(() => {
  raw = new Database(DB_PATH)
  // WAL so the helper (separate process) and getDatabase() can read/write
  // concurrently with this open connection — matches the live MC server.
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  runMigrations(raw)
  const now = Math.floor(Date.now() / 1000)
  const ins = raw.prepare(
    `INSERT INTO projects (workspace_id, name, slug, ticket_prefix, status, local_path, created_at, updated_at)
     VALUES (1, ?, ?, ?, 'active', ?, ?, ?)`
  )
  id1 = Number(ins.run('proj-alpha', 'proj-alpha', 'PA', projDir1, now, now).lastInsertRowid)
  id2 = Number(ins.run('proj-beta', 'proj-beta', 'PB', projDir2, now, now).lastInsertRowid)
  src1 = `claude-project-id:${id1}`
  src2 = `claude-project-id:${id2}`
  seedProject(projDir1)
  seedProject(projDir2)
})

afterAll(() => {
  try { raw.close() } catch { /* noop */ }
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* noop */ }
})

describe('migration 053 — projects.local_path', () => {
  it('adds local_path column', () => {
    const cols = raw.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'local_path')).toBe(true)
  })
})

describe('register-mc-agents.js (scaffold-time helper)', () => {
  it('upserts repo-less project agents under claude-project-id:{id}, ignoring CLAUDE/AGENTS.md', () => {
    if (!existsSync(HELPER)) { console.warn('helper absent — skip'); return }
    execFileSync('node', [HELPER, 'proj-alpha', '', projDir1], {
      env: { ...process.env, MC_DB: DB_PATH }, encoding: 'utf8',
    })
    const rows = raw.prepare(`SELECT name, role, status, content_hash, config, soul_content FROM agents WHERE source = ? ORDER BY name`).all(src1) as any[]
    expect(rows.map((r) => r.name)).toEqual(['code-reviewer', 'frontend-engineer'])
    const fe = rows.find((r) => r.name === 'frontend-engineer')!
    expect(fe.role).toBe('agent')
    expect(fe.status).toBe('online')
    expect(fe.content_hash).toBe(sha256(AGENT_FRONTEND))            // full-file hash
    expect(fe.soul_content).toBe('당신은 프로젝트의 프론트엔드 엔지니어입니다.')
    expect(JSON.parse(fe.config)).toEqual({                          // comma tools → array
      model: 'claude-sonnet-4-6', tools: ['Read', 'Edit', 'Bash'], description: 'UI 구현 담당',
    })
    const cr = rows.find((r) => r.name === 'code-reviewer')!
    expect(JSON.parse(cr.config).tools).toEqual(['Read', 'Grep'])    // JSON tools → array
  })

  it('is idempotent (re-run updates in place, no duplicate rows)', () => {
    if (!existsSync(HELPER)) return
    execFileSync('node', [HELPER, 'proj-alpha', '', projDir1], { env: { ...process.env, MC_DB: DB_PATH }, encoding: 'utf8' })
    const n = raw.prepare(`SELECT COUNT(*) c FROM agents WHERE source = ?`).get(src1) as { c: number }
    expect(n.c).toBe(2)
  })
})

describe('helper ↔ syncProjectAgents convergence', () => {
  it('server sync over helper rows is a no-op on contract columns + preserves display_name', async () => {
    if (!existsSync(HELPER)) return
    // Tag a helper-made row with a user override that must survive.
    raw.prepare(`UPDATE agents SET display_name = '프론트', hidden = 1 WHERE source = ? AND name = 'frontend-engineer'`).run(src1)
    const before = raw.prepare(`SELECT content_hash, config, soul_content FROM agents WHERE source=? AND name='frontend-engineer'`).get(src1) as any

    const { syncProjectAgents } = await import('@/lib/local-agent-sync')
    await syncProjectAgents() // scans proj-alpha (helper-made) + proj-beta (fresh)

    // 1) contract columns unchanged on the helper-made row
    const after = raw.prepare(`SELECT content_hash, config, soul_content, display_name, hidden, role, status FROM agents WHERE source=? AND name='frontend-engineer'`).get(src1) as any
    expect(after.content_hash).toBe(before.content_hash)
    expect(after.config).toBe(before.config)
    expect(after.soul_content).toBe(before.soul_content)
    // 2) user data preserved
    expect(after.display_name).toBe('프론트')
    expect(after.hidden).toBe(1)
    // 3) server produced byte-identical rows for the untouched project
    const a1 = raw.prepare(`SELECT content_hash, config, soul_content FROM agents WHERE source=? AND name='code-reviewer'`).get(src1) as any
    const a2 = raw.prepare(`SELECT content_hash, config, soul_content FROM agents WHERE source=? AND name='code-reviewer'`).get(src2) as any
    expect(a2).toEqual(a1)
  })
})
