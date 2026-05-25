import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);

    // Heuristic-based recommendations:
    // 1. Find the user's most-used tags
    // 2. Find bookmarks with those tags that the user hasn't seen recently
    // 3. Mix in high-engagement bookmarks the user may have missed
    // 4. Add bookmarks from the user's top creators

    const recommendations: Array<{
      id: string;
      xPostId: string;
      content: string;
      xAuthorName: string | null;
      xAuthorUsername: string | null;
      xAuthorAvatar: string | null;
      likeCount: number;
      viewCount: number;
      savedAt: Date;
      reason: string;
      collections: Array<{ id: string; name: string; color: string | null }>;
      tags: Array<{ id: string; name: string; color: string | null }>;
    }> = [];

    // Get user's top tags
    const userTags = await db.tag.findMany({
      where: { userId },
      include: {
        _count: { select: { bookmarks: true } },
      },
      orderBy: { bookmarks: { _count: 'desc' } },
      take: 5,
    });

    // Get bookmarks from top tags (excluding very recent ones)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    if (userTags.length > 0) {
      const tagBookmarks = await db.bookmark.findMany({
        where: {
          userId,
          isBookmarked: true,
          savedAt: { lt: threeDaysAgo },
          tags: {
            some: {
              id: { in: userTags.map((t) => t.id) },
            },
          },
        },
        take: limit,
        orderBy: { likeCount: 'desc' },
        include: {
          collections: { select: { id: true, name: true, color: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      });

      recommendations.push(
        ...tagBookmarks.map((b) => ({
          ...b,
          reason: 'Based on your interests',
        }))
      );
    }

    // Get high-engagement bookmarks user may have missed
    if (recommendations.length < limit) {
      const existingIds = new Set(recommendations.map((r) => r.id));
      const highEngagement = await db.bookmark.findMany({
        where: {
          userId,
          isBookmarked: true,
          id: { notIn: Array.from(existingIds) },
          likeCount: { gt: 100 },
        },
        take: limit - recommendations.length,
        orderBy: { likeCount: 'desc' },
        include: {
          collections: { select: { id: true, name: true, color: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      });

      recommendations.push(
        ...highEngagement.map((b) => ({
          ...b,
          reason: 'Popular in your archive',
        }))
      );
    }

    // Get bookmarks from top creators
    if (recommendations.length < limit) {
      const existingIds = new Set(recommendations.map((r) => r.id));
      const topCreators = await db.bookmark.groupBy({
        by: ['xAuthorUsername'],
        where: {
          userId,
          isBookmarked: true,
          xAuthorUsername: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 3,
      });

      if (topCreators.length > 0) {
        const creatorBookmarks = await db.bookmark.findMany({
          where: {
            userId,
            isBookmarked: true,
            id: { notIn: Array.from(existingIds) },
            xAuthorUsername: {
              in: topCreators
                .map((c) => c.xAuthorUsername)
                .filter((x): x is string => x !== null),
            },
          },
          take: limit - recommendations.length,
          orderBy: { savedAt: 'desc' },
          include: {
            collections: { select: { id: true, name: true, color: true } },
            tags: { select: { id: true, name: true, color: true } },
          },
        });

        recommendations.push(
          ...creatorBookmarks.map((b) => ({
            ...b,
            reason: 'From your favorite creators',
          }))
        );
      }
    }

    return NextResponse.json({ recommendations: recommendations.slice(0, limit) });
  } catch (error) {
    console.error('Get recommendations error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
