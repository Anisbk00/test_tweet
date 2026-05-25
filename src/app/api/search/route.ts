import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const mediaType = searchParams.get('mediaType');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const author = searchParams.get('author');
    const collectionId = searchParams.get('collection');
    const tagName = searchParams.get('tag');
    const sort = searchParams.get('sort') || 'relevance';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const skip = (page - 1) * limit;

    if (!q && !author && !tagName && !mediaType) {
      return NextResponse.json(
        { error: 'At least one search parameter is required' },
        { status: 400 }
      );
    }

    // Build where clause
    const where: Record<string, unknown> = {
      userId: session.userId,
      isBookmarked: true,
    };

    if (q) {
      where.OR = [
        { content: { contains: q } },
        { xAuthorName: { contains: q } },
        { xAuthorUsername: { contains: q } },
      ];
    }

    if (mediaType) {
      where.mediaTypes = { contains: mediaType };
    }

    if (dateFrom || dateTo) {
      const postedAt: Record<string, Date> = {};
      if (dateFrom) postedAt.gte = new Date(dateFrom);
      if (dateTo) postedAt.lte = new Date(dateTo);
      where.postedAt = postedAt;
    }

    if (author) {
      if (where.OR) {
        // Merge with existing OR clause
        const existingOr = where.OR as Record<string, unknown>[];
        where.AND = [
          { OR: existingOr },
          {
            OR: [
              { xAuthorName: { contains: author } },
              { xAuthorUsername: { contains: author } },
            ],
          },
        ];
        delete where.OR;
      } else {
        where.OR = [
          { xAuthorName: { contains: author } },
          { xAuthorUsername: { contains: author } },
        ];
      }
    }

    if (collectionId) {
      where.collections = {
        some: { id: collectionId },
      };
    }

    if (tagName) {
      where.tags = {
        some: { name: tagName },
      };
    }

    // Build order by
    let orderBy: Record<string, string>;
    if (sort === 'savedAt') {
      orderBy = { savedAt: 'desc' };
    } else if (sort === 'postedAt') {
      orderBy = { postedAt: 'desc' };
    } else if (sort === 'likeCount') {
      orderBy = { likeCount: 'desc' };
    } else {
      // relevance - default to savedAt desc
      orderBy = { savedAt: 'desc' };
    }

    const [bookmarks, total] = await Promise.all([
      db.bookmark.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          collections: {
            select: { id: true, name: true, color: true, icon: true },
          },
          tags: {
            select: { id: true, name: true, color: true },
          },
        },
      }),
      db.bookmark.count({ where }),
    ]);

    // Simple relevance scoring - boost bookmarks that have the query in the beginning
    const scoredBookmarks = bookmarks.map((bookmark) => {
      let score = 0;
      if (q) {
        const lowerContent = bookmark.content.toLowerCase();
        const lowerQ = q.toLowerCase();
        const index = lowerContent.indexOf(lowerQ);
        if (index === 0) score += 10;
        else if (index > 0) score += 5;
        // Boost by engagement
        score += Math.min(bookmark.likeCount / 100, 5);
        score += Math.min(bookmark.viewCount / 1000, 3);
      }
      return { ...bookmark, _score: score };
    });

    // Sort by relevance score if applicable
    if (sort === 'relevance' && q) {
      scoredBookmarks.sort((a, b) => b._score - a._score);
    }

    return NextResponse.json({
      bookmarks: scoredBookmarks.map(({ _score, ...rest }) => rest),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
