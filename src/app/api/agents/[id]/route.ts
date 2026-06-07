import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { requireRole } from '@/lib/auth'

/**
 * PATCH /api/agents/[id] - Update agent display_name (C4).
 * admin role (대표). display_name은 화면 한글 이름이며 sync가 덮어쓰지 않음(보존).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { id } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const displayName =
    typeof body?.display_name === 'string' ? body.display_name.trim() || null : null

  const db = getDatabase()
  const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get(id)
  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  db.prepare('UPDATE agents SET display_name = ?, updated_at = ? WHERE id = ?').run(
    displayName,
    Math.floor(Date.now() / 1000),
    id
  )
  logAuditEvent({
    action: 'agent_display_name_update',
    actor: auth.user.username,
    detail: { agent_id: id, display_name: displayName },
  })
  return NextResponse.json({ ok: true, id, display_name: displayName })
}
