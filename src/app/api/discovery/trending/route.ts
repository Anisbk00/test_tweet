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

    // Trending in the last 7 days based on user's archive
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Trending tags - tags with most bookmarks added recently
    const trendingTags = await db.tag.findMany({
      where: { userId },
      include: {
        _count: {
          select: { bookmarks: true },
        },
      },
      orderBy: {
        bookmarks: { _count: 'desc' },
      },
      take: 10,
    });

    // Trending topics - extract from recent bookmarks
    const recentBookmarks = await db.bookmark.findMany({
      where: {
        userId,
        isBookmarked: true,
        savedAt: { gte: sevenDaysAgo },
      },
      select: { content: true, likeCount: true },
      take: 50,
      orderBy: { likeCount: 'desc' },
    });

    // Simple keyword extraction from high-engagement bookmarks
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'as', 'and', 'but', 'or', 'not', 'so', 'yet', 'this', 'that', 'it',
      'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
      'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
      'how', 'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few',
      'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same',
      'than', 'too', 'very', 'just', 'can', 'about', 'up', 'out', 'if',
    ]);

    const topicScore: Record<string, { count: number; totalLikes: number }> = {};
    for (const bookmark of recentBookmarks) {
      const words = bookmark.content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 4 && !stopWords.has(w));

      const uniqueWords = [...new Set(words)];
      for (const word of uniqueWords) {
        if (!topicScore[word]) {
          topicScore[word] = { count: 0, totalLikes: 0 };
        }
        topicScore[word].count++;
        topicScore[word].totalLikes += bookmark.likeCount;
      }
    }

    const trendingTopics = Object.entries(topicScore)
      .map(([word, data]) => ({
        topic: word,
        count: data.count,
        avgLikes: Math.round(data.totalLikes / data.count),
      }))
      .sort((a, b) => b.count * b.avgLikes - a.count * a.avgLikes)
      .slice(0, 15);

    // Trending creators in user's archive
    const trendingCreators = await db.bookmark.groupBy({
      by: ['xAuthorUsername', 'xAuthorName', 'xAuthorAvatar'],
      where: {
        userId,
        isBookmarked: true,
        savedAt: { gte: sevenDaysAgo },
        xAuthorUsername: { not: null },
      },
      _count: { id: true },
      _sum: { likeCount: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    return NextResponse.json({
      trendingTags: trendingTags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        bookmarkCount: t._count.bookmarks,
      })),
      trendingTopics,
      trendingCreators: trendingCreators.map((c) => ({
        username: c.xAuthorUsername,
        name: c.xAuthorName,
        avatar: c.xAuthorAvatar,
        bookmarkCount: c._count.id,
        totalLikes: c._sum.likeCount || 0,
      })),
    });
  } catch (error) {
    console.error('Discovery trending error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
