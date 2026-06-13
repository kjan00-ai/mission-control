import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope';

/**
 * GET /api/l2-reviews - List MAIA L2 cross-verification runs (C5-2 durable bus).
 *
 * Read-only: rows are written directly to the DB by the WSL writer
 * (~/.ai-bootstrap/l2-db-writer.js), not via this API.
 *
 * Query params: artifact, project_id, status, trigger, limit (default 50, max 200).
 */
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapReviewRow(row: any) {
  return {
    ...row,
    reviewers: parseJson(row.reviewers) ?? [],
    metadata: parseJson(row.metadata) ?? {},
  };
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const wsResult = requireWorkspaceId(auth.user);
    if (!('workspaceId' in wsResult)) return wsResult.response;
    const { workspaceId } = wsResult;

    const { searchParams } = new URL(request.url);
    const artifact = searchParams.get('artifact');
    const status = searchParams.get('status');
    const trigger = searchParams.get('trigger');
    const projectIdRaw = searchParams.get('project_id');
    const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const where: string[] = ['workspace_id = ?'];
    const args: unknown[] = [workspaceId];
    if (artifact) { where.push('artifact = ?'); args.push(artifact); }
    if (status) { where.push('status = ?'); args.push(status); }
    if (trigger) { where.push('trigger = ?'); args.push(trigger); }
    if (projectIdRaw) {
      const pid = parseInt(projectIdRaw, 10);
      if (Number.isFinite(pid)) { where.push('project_id = ?'); args.push(pid); }
    }

    const rows = db.prepare(`
      SELECT * FROM l2_reviews
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...args, limit) as any[];

    return NextResponse.json({ reviews: rows.map(mapReviewRow) });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/l2-reviews error');
    return NextResponse.json({ error: 'Failed to fetch L2 reviews' }, { status: 500 });
  }
}
