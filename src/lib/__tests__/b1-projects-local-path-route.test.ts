// B1: MC 등록 transport — projects REST API 의 local_path 지원.
// 왜 필요한가: Windows 신규 프로젝트는 WSL 의 SQLite 파일에 닿을 수 없어 REST 로 등록해야 하는데,
// repo-less 프로젝트의 에이전트 귀속 키는 projects.local_path 다(syncProjectAgents:
// source=claude-project-id:{id}, dir=<local_path>/.claude/agents). API 가 그 컬럼을 못 받으면
// 프로젝트만 생기고 에이전트는 영영 안 붙는다 — 이 시험이 그 사슬을 끝까지 증명한다.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

const tmpRoot = mkdtempSync(join(tmpdir(), 'b1-localpath-'))
const DB_PATH = join(tmpRoot, 'mission-control.db')
process.env.MISSION_CONTROL_DATA_DIR = tmpRoot
process.env.MISSION_CONTROL_DB_PATH = DB_PATH

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: { id: 1, username: 'api', role: 'admin', workspace_id: 1, tenant_id: 1 },
  }),
}))

import { runMigrations } from '@/lib/migrations'

const AGENT = `---
name: b1-engineer
description: B1 전용 에이전트
tools: Read, Edit
model: claude-sonnet-4-6
---

당신은 B1 시험용 에이전트입니다.
`

const projectRoot = join(tmpRoot, 'ProjWinLike')
let raw: Database.Database

function post(body: unknown) {
  return new NextRequest('http://127.0.0.1:3005/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  raw = new Database(DB_PATH)
  raw.pragma('journal_mode = WAL')
  runMigrations(raw)
  mkdirSync(join(projectRoot, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(projectRoot, '.claude', 'agents', 'b1-engineer.md'), AGENT)
})

afterAll(() => {
  try { raw.close() } catch { /* already closed */ }
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('B1 — projects API local_path transport', () => {
  let projectId = 0

  it('POST /api/projects 가 local_path 를 저장하고 응답에 돌려준다', async () => {
    const { POST } = await import('@/app/api/projects/route')
    const res = await POST(post({ name: 'ProjWinLike', local_path: projectRoot }))
    expect(res.status).toBe(201)
    const json = await res.json() as { project: { id: number; local_path: string | null } }
    projectId = json.project.id
    expect(json.project.local_path).toBe(projectRoot)
    // DB 실측 — 응답만 믿지 않는다
    const row = raw.prepare('SELECT local_path FROM projects WHERE id = ?').get(projectId) as { local_path: string | null }
    expect(row.local_path).toBe(projectRoot)
  })

  it('GET /api/projects 목록이 local_path 를 노출한다(클라이언트 멱등 확인용)', async () => {
    const { GET } = await import('@/app/api/projects/route')
    const res = await GET(new NextRequest('http://127.0.0.1:3005/api/projects'))
    expect(res.status).toBe(200)
    const json = await res.json() as { projects: Array<{ id: number; local_path?: string | null }> }
    const mine = json.projects.find(p => p.id === projectId)
    expect(mine?.local_path).toBe(projectRoot)
  })

  it('PATCH 가 빈 local_path 를 채운다(기존 레코드 보강 경로)', async () => {
    raw.prepare('UPDATE projects SET local_path = NULL WHERE id = ?').run(projectId)
    const { PATCH } = await import('@/app/api/projects/[id]/route')
    const req = new NextRequest(`http://127.0.0.1:3005/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ local_path: projectRoot }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: String(projectId) }) })
    expect(res.status).toBe(200)
    const json = await res.json() as { project: { local_path: string | null } }
    expect(json.project.local_path).toBe(projectRoot)
  })

  it('PATCH local_path:null 은 값을 비운다(가역)', async () => {
    const { PATCH } = await import('@/app/api/projects/[id]/route')
    const req = new NextRequest(`http://127.0.0.1:3005/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ local_path: null }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: String(projectId) }) })
    const json = await res.json() as { project: { local_path: string | null } }
    expect(json.project.local_path).toBeNull()
    // 되돌려 놓고 다음 시험으로
    raw.prepare('UPDATE projects SET local_path = ? WHERE id = ?').run(projectRoot, projectId)
  })

  it('★ API 로 등록한 프로젝트의 에이전트가 syncProjectAgents 로 실제 귀속된다', async () => {
    const { syncProjectAgents } = await import('@/lib/local-agent-sync')
    const r = await syncProjectAgents()
    expect(r.ok).toBe(true)
    const agent = raw.prepare(
      'SELECT name, source, status, workspace_path FROM agents WHERE source = ?'
    ).get(`claude-project-id:${projectId}`) as { name: string; status: string; workspace_path: string } | undefined
    expect(agent?.name).toBe('b1-engineer')
    expect(agent?.status).toBe('online')
    expect(agent?.workspace_path).toBe(join(projectRoot, '.claude', 'agents', 'b1-engineer.md'))
  })
})
