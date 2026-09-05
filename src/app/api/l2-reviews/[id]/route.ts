import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope';

/**
 * GET /api/l2-reviews/[id] - One L2 review with its rounds (C5-2 durable bus).
 */
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const reviewId = parseInt(resolvedParams.id, 10);
    const wsResult = requireWorkspaceId(auth.user);
    if (!('workspaceId' in wsResult)) return wsResult.response;
    const { workspaceId } = wsResult;

    if (isNaN(reviewId)) {
      return NextResponse.json({ error: 'Invalid review ID' }, { status: 400 });
    }

    const review = db.prepare(`
      SELECT * FROM l2_reviews WHERE id = ? AND workspace_id = ?
    `).get(reviewId, workspaceId) as any;

    if (!review) {
      return NextResponse.json({ error: 'L2 review not found' }, { status: 404 });
    }

    const rounds = db.prepare(`
      SELECT * FROM l2_rounds WHERE review_id = ?
      ORDER BY round ASC, id ASC
    `).all(reviewId) as any[];

    return NextResponse.json({
      review: {
        ...review,
        reviewers: parseJson(review.reviewers) ?? [],
        metadata: parseJson(review.metadata) ?? {},
      },
      rounds: rounds.map((r) => ({
        ...r,
        reviewers: parseJson(r.reviewers) ?? [],
        canonical_items: parseJson(r.canonical_items) ?? [],
        parser_fails: parseJson(r.parser_fails) ?? [],
        raw_refs: parseJson(r.raw_refs) ?? [],
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/l2-reviews/[id] error');
    return NextResponse.json({ error: 'Failed to fetch L2 review' }, { status: 500 });
  }
}
