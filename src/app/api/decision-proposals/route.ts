import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

const execFileAsync = promisify(execFile)

// C6-4 Phase 2 approval queue (default-off). SSOT is a JSON file managed by
// ~/.ai-bootstrap/c6-queue.js — this route mirrors the exec-approvals pattern
// (file-proxy, not DB): GET reads the queue file, POST shells out to the canonical
// c6-queue.js so the lock/atomic write logic stays single-sourced. The live decision
// gate is untouched; while queue.activated=false there are simply no proposals.

const ID_RE = /^[0-9a-f]{8}$/ // c6-queue idOf() = sha1(opKey).slice(0,8)

type ProposalStatus = 'pending' | 'approved' | 'vetoed'
interface Proposal {
  id: string
  opKey: string
  ruleId: string
  E: string
  enqueuedAt: number
  status: ProposalStatus
  decidedAt: number | null
  decidedBy: string | null
}

function queueStatePath(): string {
  return path.join(config.aiBootstrapHome, 'state', 'c6-queue.json')
}

function c6QueueScript(): string {
  return path.join(config.aiBootstrapHome, 'c6-queue.js')
}

/**
 * GET /api/decision-proposals — list pending + approved proposals from the C6 queue.
 * Fail-soft: missing/unparsable queue file → empty list (queue is default-off).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const raw = await readFile(queueStatePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    const all: Proposal[] = Array.isArray(parsed?.proposals) ? parsed.proposals : []
    // surface actionable (pending/approved) first, plus recently-decided for context
    const pending = all.filter((p) => p.status === 'pending' || p.status === 'approved')
    const decided = all
      .filter((p) => p.status === 'vetoed')
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
      .slice(0, 20)
    return NextResponse.json({ proposals: [...pending, ...decided] })
  } catch (err: any) {
    if (err?.code === 'ENOENT') return NextResponse.json({ proposals: [] })
    logger.warn({ err }, 'Failed to read c6-queue state')
    return NextResponse.json({ proposals: [] })
  }
}

/**
 * POST /api/decision-proposals — approve or veto a proposal.
 * admin-only (T3 r3_residual; stricter than exec-approvals' operator). Cloudflare Access
 * already gates the dashboard to 대표; this server-side spawn is the authenticated-rep
 * channel (agent tool-calls remain gate-DENIED by decision-policy c6-queue-approve).
 * Body: { id: string, action: 'approve' | 'veto' }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id?: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id || typeof body.id !== 'string' || !ID_RE.test(body.id)) {
    return NextResponse.json({ error: 'Missing or malformed field: id' }, { status: 400 })
  }
  if (body.action !== 'approve' && body.action !== 'veto') {
    return NextResponse.json({ error: "Invalid action. Must be 'approve' or 'veto'" }, { status: 400 })
  }

  const flag = body.action === 'approve' ? '--approve' : '--veto'
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [c6QueueScript(), flag, body.id],
      { timeout: 5000, env: { ...process.env, MAIA_AUTOL2_BOOT: config.aiBootstrapHome } },
    )
    const out = stdout.trim()
    // c6-queue prints "c6-queue: <id> → approved|vetoed" on success, or "id=<id> 없음" if not found.
    if (/없음/.test(out)) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    logger.info({ id: body.id, action: body.action, by: auth.user.username }, 'C6 proposal decided via dashboard')
    return NextResponse.json({
      ok: true,
      id: body.id,
      status: body.action === 'approve' ? 'approved' : 'vetoed',
    })
  } catch (err: any) {
    logger.error({ err }, 'c6-queue decision spawn failed')
    return NextResponse.json({ error: `Failed to apply decision: ${err?.message ?? 'spawn error'}` }, { status: 500 })
  }
}
