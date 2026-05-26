import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookmarkId: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { bookmarkId } = await params;

    // Get the source bookmark
    const sourceBookmark = await db.bookmark.findUnique({
      where: { id: bookmarkId },
      include: {
        tags: { select: { id: true, name: true } },
      },
    });

    if (!sourceBookmark || sourceBookmark.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Bookmark not found' },
        { status: 404 }
      );
    }

    const relatedBookmarks = [];

    // 1. Find bookmarks with similar tags
    if (sourceBookmark.tags.length > 0) {
      const tagIds = sourceBookmark.tags.map((t) => t.id);
      const similarByTags = await db.bookmark.findMany({
        where: {
          userId: session.userId,
          isBookmarked: true,
          id: { not: bookmarkId },
          tags: {
            some: {
              id: { in: tagIds },
            },
          },
        },
        take: 10,
        include: {
          collections: { select: { id: true, name: true, color: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      });
      relatedBookmarks.push(
        ...similarByTags.map((b) => ({ ...b, relevanceScore: 10 }))
      );
    }

    // 2. Find bookmarks by the same author
    if (sourceBookmark.xAuthorUsername) {
      const sameAuthor = await db.bookmark.findMany({
        where: {
          userId: session.userId,
          isBookmarked: true,
          id: { not: bookmarkId },
          xAuthorUsername: sourceBookmark.xAuthorUsername,
        },
        take: 5,
        include: {
          collections: { select: { id: true, name: true, color: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      });
      relatedBookmarks.push(
        ...sameAuthor.map((b) => ({ ...b, relevanceScore: 5 }))
      );
    }

    // 3. Find bookmarks with similar content (simple keyword matching)
    const keywords = sourceBookmark.content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 5);

    if (keywords.length > 0) {
      const similarContent = await db.bookmark.findMany({
        where: {
          userId: session.userId,
          isBookmarked: true,
          id: {
            not: bookmarkId,
            notIn: relatedBookmarks.map((b) => b.id),
          },
          OR: keywords.map((kw) => ({
            content: { contains: kw },
          })),
        },
        take: 5,
        include: {
          collections: { select: { id: true, name: true, color: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      });
      relatedBookmarks.push(
        ...similarContent.map((b) => ({ ...b, relevanceScore: 3 }))
      );
    }

    // Deduplicate and sort by relevance
    const seen = new Set<string>();
    const uniqueBookmarks = relatedBookmarks.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });

    uniqueBookmarks.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return NextResponse.json({
      related: uniqueBookmarks.map(({ relevanceScore, ...rest }) => rest),
    });
  } catch (error) {
    console.error('Get related bookmarks error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
