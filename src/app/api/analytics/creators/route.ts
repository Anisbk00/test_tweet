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
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    // Top creators with detailed stats
    const creators = await db.bookmark.groupBy({
      by: ['xAuthorUsername', 'xAuthorName', 'xAuthorAvatar'],
      where: {
        userId,
        isBookmarked: true,
        xAuthorUsername: { not: null },
      },
      _count: { id: true },
      _sum: {
        likeCount: true,
        viewCount: true,
        repostCount: true,
      },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    const creatorsWithStats = creators.map((c) => ({
      username: c.xAuthorUsername,
      name: c.xAuthorName,
      avatar: c.xAuthorAvatar,
      bookmarkCount: c._count.id,
      totalLikes: c._sum.likeCount || 0,
      totalViews: c._sum.viewCount || 0,
      totalReposts: c._sum.repostCount || 0,
      avgLikes:
        c._count.id > 0
          ? Math.round((c._sum.likeCount || 0) / c._count.id)
          : 0,
    }));

    return NextResponse.json({ creators: creatorsWithStats });
  } catch (error) {
    console.error('Analytics creators error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
