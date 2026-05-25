import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { twikitLoginWithCookies, twikitGetBookmarks, transformTwikitPost } from '@/lib/twitter';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    // Check if already syncing
    const syncStatus = await db.syncStatus.findUnique({
      where: { userId },
    });

    if (syncStatus?.isSyncing) {
      return NextResponse.json(
        { error: 'Sync already in progress' },
        { status: 409 }
      );
    }

    // Get user's Twitter cookies
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { xCookies: true, xConnected: true, xUsername: true },
    });

    if (!user?.xConnected || !user?.xCookies) {
      return NextResponse.json(
        { error: 'Twitter not connected' },
        { status: 400 }
      );
    }

    let cookies: Record<string, string>;
    try {
      cookies = JSON.parse(user.xCookies);
    } catch {
      return NextResponse.json(
        { error: 'Invalid Twitter cookies' },
        { status: 400 }
      );
    }

    // Mark as syncing
    await db.syncStatus.upsert({
      where: { userId },
      update: { isSyncing: true, lastError: null },
      create: { userId, isSyncing: true },
    });

    try {
      // Login to twikit-service with stored cookies
      await twikitLoginWithCookies(userId, cookies as any, user.xUsername || undefined);

      let allSynced = 0;
      let cursor: string | undefined = undefined;
      let hasMore = true;
      let pageCount = 0;
      const maxPages = 10;

      while (hasMore && pageCount < maxPages) {
        const result = await twikitGetBookmarks(userId, cursor, 50);

        if (!result.data || result.data.length === 0) break;

        for (const post of result.data) {
          try {
            const transformed = transformTwikitPost(post);
            await db.bookmark.upsert({
              where: { xPostId: transformed.xPostId },
              update: {
                content: transformed.content,
                xAuthorId: transformed.xAuthorId,
                xAuthorName: transformed.xAuthorName,
                xAuthorUsername: transformed.xAuthorUsername,
                xAuthorAvatar: transformed.xAuthorAvatar,
                mediaUrls: transformed.mediaUrls,
                mediaTypes: transformed.mediaTypes,
                replyCount: transformed.replyCount,
                repostCount: transformed.repostCount,
                likeCount: transformed.likeCount,
                viewCount: transformed.viewCount,
                bookmarkCount: transformed.bookmarkCount,
                postedAt: transformed.postedAt,
                isBookmarked: true,
              },
              create: {
                userId,
                ...transformed,
              },
            });
            allSynced++;
          } catch (err) {
            console.error(`Failed to sync post ${post.id}:`, err);
          }
        }

        hasMore = result.has_more;
        cursor = result.cursor || undefined;
        pageCount++;
      }

      // Update sync status
      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          lastSyncAt: new Date(),
          lastBookmarkId: cursor || syncStatus?.lastBookmarkId,
          syncCount: (syncStatus?.syncCount || 0) + allSynced,
          errorCount: 0,
          lastError: null,
        },
      });

      // Log activity
      await db.activity.create({
        data: {
          userId,
          type: 'sync_complete',
          metadata: JSON.stringify({ syncedCount: allSynced, pages: pageCount }),
        },
      });

      return NextResponse.json({
        success: true,
        syncedCount: allSynced,
        pages: pageCount,
        hasMore,
      });
    } catch (syncError) {
      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          errorCount: (syncStatus?.errorCount || 0) + 1,
          lastError: syncError instanceof Error ? syncError.message : 'Sync failed',
        },
      });

      throw syncError;
    }
  } catch (error) {
    console.error('Trigger sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
