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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const sort = searchParams.get('sort') || 'savedAt';
    const order = searchParams.get('order') || 'desc';
    const collectionId = searchParams.get('collection');
    const tagName = searchParams.get('tag');
    const mediaType = searchParams.get('mediaType');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const author = searchParams.get('author');

    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {
      userId: session.userId,
      isBookmarked: true,
    };

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

    if (mediaType) {
      where.mediaTypes = { contains: mediaType };
    }

    if (search) {
      where.content = { contains: search };
    }

    if (dateFrom || dateTo) {
      const postedAt: Record<string, Date> = {};
      if (dateFrom) postedAt.gte = new Date(dateFrom);
      if (dateTo) postedAt.lte = new Date(dateTo);
      where.postedAt = postedAt;
    }

    if (author) {
      where.OR = [
        { xAuthorName: { contains: author } },
        { xAuthorUsername: { contains: author } },
      ];
    }

    // Build order by
    const sortField = sort === 'likeCount' ? 'likeCount' : sort === 'postedAt' ? 'postedAt' : 'savedAt';
    const orderBy = { [sortField]: order === 'asc' ? 'asc' as const : 'desc' as const };

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

    return NextResponse.json({
      bookmarks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get bookmarks error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      xPostId,
      xAuthorId,
      xAuthorName,
      xAuthorUsername,
      xAuthorAvatar,
      content,
      mediaUrls,
      mediaTypes,
      previewUrls,
      replyCount,
      repostCount,
      likeCount,
      viewCount,
      bookmarkCount,
      postedAt,
      collectionIds,
      tagIds,
    } = body;

    if (!xPostId || !content) {
      return NextResponse.json(
        { error: 'xPostId and content are required' },
        { status: 400 }
      );
    }

    // Check if bookmark already exists
    const existing = await db.bookmark.findUnique({
      where: { xPostId },
    });

    if (existing) {
      // Update existing bookmark
      const updated = await db.bookmark.update({
        where: { id: existing.id },
        data: {
          content,
          mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : existing.mediaUrls,
          mediaTypes: mediaTypes ? JSON.stringify(mediaTypes) : existing.mediaTypes,
          previewUrls: previewUrls ? JSON.stringify(previewUrls) : existing.previewUrls,
          replyCount: replyCount ?? existing.replyCount,
          repostCount: repostCount ?? existing.repostCount,
          likeCount: likeCount ?? existing.likeCount,
          viewCount: viewCount ?? existing.viewCount,
          bookmarkCount: bookmarkCount ?? existing.bookmarkCount,
          isBookmarked: true,
          ...(collectionIds && {
            collections: {
              connect: collectionIds.map((id: string) => ({ id })),
            },
          }),
          ...(tagIds && {
            tags: {
              connect: tagIds.map((id: string) => ({ id })),
            },
          }),
        },
        include: {
          collections: { select: { id: true, name: true, color: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      });

      // Log activity
      await db.activity.create({
        data: {
          userId: session.userId,
          type: 'bookmark_update',
          metadata: JSON.stringify({ bookmarkId: updated.id }),
        },
      });

      return NextResponse.json({ bookmark: updated });
    }

    // Create new bookmark
    const bookmark = await db.bookmark.create({
      data: {
        userId: session.userId,
        xPostId,
        xAuthorId: xAuthorId || null,
        xAuthorName: xAuthorName || null,
        xAuthorUsername: xAuthorUsername || null,
        xAuthorAvatar: xAuthorAvatar || null,
        content,
        mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : '[]',
        mediaTypes: mediaTypes ? JSON.stringify(mediaTypes) : '[]',
        previewUrls: previewUrls ? JSON.stringify(previewUrls) : '[]',
        replyCount: replyCount || 0,
        repostCount: repostCount || 0,
        likeCount: likeCount || 0,
        viewCount: viewCount || 0,
        bookmarkCount: bookmarkCount || 0,
        postedAt: postedAt ? new Date(postedAt) : null,
        ...(collectionIds && {
          collections: {
            connect: collectionIds.map((id: string) => ({ id })),
          },
        }),
        ...(tagIds && {
          tags: {
            connect: tagIds.map((id: string) => ({ id })),
          },
        }),
      },
      include: {
        collections: { select: { id: true, name: true, color: true } },
        tags: { select: { id: true, name: true, color: true } },
      },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'bookmark_save',
        metadata: JSON.stringify({ bookmarkId: bookmark.id }),
      },
    });

    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (error) {
    console.error('Create bookmark error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
