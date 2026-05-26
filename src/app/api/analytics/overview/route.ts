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

    // Total counts
    const [totalBookmarks, totalCollections, totalTags] = await Promise.all([
      db.bookmark.count({
        where: { userId, isBookmarked: true },
      }),
      db.collection.count({ where: { userId } }),
      db.tag.count({ where: { userId } }),
    ]);

    // Bookmarks added this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const bookmarksThisWeek = await db.bookmark.count({
      where: {
        userId,
        isBookmarked: true,
        savedAt: { gte: oneWeekAgo },
      },
    });

    // Bookmarks added this month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const bookmarksThisMonth = await db.bookmark.count({
      where: {
        userId,
        isBookmarked: true,
        savedAt: { gte: oneMonthAgo },
      },
    });

    // Top creators (by bookmark count)
    const topCreators = await db.bookmark.groupBy({
      by: ['xAuthorUsername', 'xAuthorName', 'xAuthorAvatar'],
      where: {
        userId,
        isBookmarked: true,
        xAuthorUsername: { not: null },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    // Media type distribution
    const allBookmarks = await db.bookmark.findMany({
      where: { userId, isBookmarked: true },
      select: { mediaTypes: true },
    });

    const mediaDistribution: Record<string, number> = { text: 0, photo: 0, video: 0, gif: 0 };
    for (const bookmark of allBookmarks) {
      try {
        const types = JSON.parse(bookmark.mediaTypes) as string[];
        if (!types || types.length === 0) {
          mediaDistribution.text++;
        } else {
          for (const type of types) {
            if (mediaDistribution[type] !== undefined) {
              mediaDistribution[type]++;
            } else {
              mediaDistribution[type] = 1;
            }
          }
        }
      } catch {
        mediaDistribution.text++;
      }
    }

    // Activity over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activities = await db.activity.findMany({
      where: {
        userId,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true, type: true },
    });

    // Group activities by date
    const activityByDate: Record<string, Record<string, number>> = {};
    for (const activity of activities) {
      const dateKey = activity.createdAt.toISOString().split('T')[0];
      if (!activityByDate[dateKey]) {
        activityByDate[dateKey] = {};
      }
      const type = activity.type;
      activityByDate[dateKey][type] = (activityByDate[dateKey][type] || 0) + 1;
    }

    const activityOverTime = Object.entries(activityByDate)
      .map(([date, counts]) => ({
        date,
        ...counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      totalBookmarks,
      totalCollections,
      totalTags,
      bookmarksThisWeek,
      bookmarksThisMonth,
      topCreators: topCreators.map((c) => ({
        username: c.xAuthorUsername,
        name: c.xAuthorName,
        avatar: c.xAuthorAvatar,
        bookmarkCount: c._count.id,
      })),
      mediaDistribution,
      activityOverTime,
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
