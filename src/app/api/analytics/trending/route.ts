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

    // Trending tags - most used tags in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const tags = await db.tag.findMany({
      where: { userId },
      include: {
        _count: {
          select: { bookmarks: true },
        },
      },
      orderBy: {
        bookmarks: {
          _count: 'desc',
        },
      },
      take: 20,
    });

    // Extract trending topics from bookmark content using simple keyword extraction
    const recentBookmarks = await db.bookmark.findMany({
      where: {
        userId,
        isBookmarked: true,
        savedAt: { gte: thirtyDaysAgo },
      },
      select: { content: true },
      take: 100,
    });

    // Simple keyword extraction - find most common meaningful words
    const wordFreq: Record<string, number> = {};
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or',
      'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
      'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
      'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
      'because', 'if', 'when', 'while', 'how', 'what', 'which', 'who',
      'whom', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'me',
      'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
      'they', 'them', 'their', 'amp', 'rt', 'via', 'like', 'get', 'got',
      'one', 'two', 'new', 'now', 'know', 'see', 'go', 'going', 'think',
      'make', 'really', 'still', 'want', 'need', 'good', 'great', 'much',
    ]);

    for (const bookmark of recentBookmarks) {
      const words = bookmark.content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));

      for (const word of words) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }

    const trendingTopics = Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([word, count]) => ({ word, count }));

    return NextResponse.json({
      trendingTags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        bookmarkCount: t._count.bookmarks,
      })),
      trendingTopics,
    });
  } catch (error) {
    console.error('Analytics trending error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
