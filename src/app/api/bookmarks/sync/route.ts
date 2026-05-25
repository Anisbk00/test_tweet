import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { fetchBookmarksFromTwitter } from '@/lib/twitter';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if already syncing
    const syncStatus = await db.syncStatus.findUnique({
      where: { userId: session.userId },
    });

    if (syncStatus?.isSyncing) {
      return NextResponse.json(
        { error: 'Sync already in progress' },
        { status: 409 }
      );
    }

    // Mark as syncing
    await db.syncStatus.upsert({
      where: { userId: session.userId },
      update: { isSyncing: true },
      create: {
        userId: session.userId,
        isSyncing: true,
      },
    });

    try {
      // Fetch bookmarks from twikit-service
      const result = await fetchBookmarksFromTwitter(
        session.userId,
        syncStatus?.lastBookmarkId || undefined
      );

      let syncedCount = 0;
      const errors: string[] = [];

      for (const tweet of result.bookmarks) {
        try {
          // Upsert bookmark
          await db.bookmark.upsert({
            where: { xPostId: tweet.id },
            update: {
              content: tweet.text,
              xAuthorId: tweet.author_id,
              xAuthorName: tweet.author_name,
              xAuthorUsername: tweet.author_username,
              xAuthorAvatar: tweet.author_avatar,
              mediaUrls: JSON.stringify(tweet.media_urls),
              mediaTypes: JSON.stringify(tweet.media_types),
              replyCount: tweet.reply_count,
              repostCount: tweet.repost_count,
              likeCount: tweet.like_count,
              viewCount: tweet.view_count,
              bookmarkCount: tweet.bookmark_count,
              postedAt: tweet.created_at ? new Date(tweet.created_at) : null,
              isBookmarked: true,
            },
            create: {
              userId: session.userId,
              xPostId: tweet.id,
              content: tweet.text,
              xAuthorId: tweet.author_id,
              xAuthorName: tweet.author_name,
              xAuthorUsername: tweet.author_username,
              xAuthorAvatar: tweet.author_avatar,
              mediaUrls: JSON.stringify(tweet.media_urls),
              mediaTypes: JSON.stringify(tweet.media_types),
              replyCount: tweet.reply_count,
              repostCount: tweet.repost_count,
              likeCount: tweet.like_count,
              viewCount: tweet.view_count,
              bookmarkCount: tweet.bookmark_count,
              postedAt: tweet.created_at ? new Date(tweet.created_at) : null,
            },
          });
          syncedCount++;
        } catch (err) {
          errors.push(
            `Failed to sync tweet ${tweet.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      }

      // Update sync status
      await db.syncStatus.update({
        where: { userId: session.userId },
        data: {
          isSyncing: false,
          lastSyncAt: new Date(),
          lastBookmarkId: result.last_cursor || syncStatus?.lastBookmarkId,
          syncCount: (syncStatus?.syncCount || 0) + syncedCount,
          errorCount: errors.length,
          lastError: errors.length > 0 ? errors[0] : null,
        },
      });

      // Log activity
      await db.activity.create({
        data: {
          userId: session.userId,
          type: 'sync_complete',
          metadata: JSON.stringify({ syncedCount, errorCount: errors.length }),
        },
      });

      return NextResponse.json({
        syncedCount,
        errorCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        hasMore: result.has_more,
      });
    } catch (syncError) {
      // Mark sync as failed
      await db.syncStatus.update({
        where: { userId: session.userId },
        data: {
          isSyncing: false,
          errorCount: (syncStatus?.errorCount || 0) + 1,
          lastError:
            syncError instanceof Error
              ? syncError.message
              : 'Sync failed',
        },
      });

      throw syncError;
    }
  } catch (error) {
    console.error('Sync bookmarks error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
