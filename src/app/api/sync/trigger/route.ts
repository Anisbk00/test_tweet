import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { syncBookmarksDual } from '@/lib/dual-provider';

/**
 * POST /api/sync/trigger
 *
 * Trigger a bookmark sync using the dual-provider service.
 * Updated to use direct X API v2 + Cookie-based + Twikit fallback.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    // Check if already syncing (with auto-expire for stale locks)
    const syncStatus = await db.syncStatus.findUnique({
      where: { userId },
    });

    if (syncStatus?.isSyncing) {
      // Auto-expire stale sync locks older than 10 minutes
      const staleThreshold = 10 * 60 * 1000; // 10 minutes
      const updatedAt = syncStatus.updatedAt?.getTime() || 0;
      const isStale = Date.now() - updatedAt > staleThreshold;

      if (isStale) {
        console.warn(`[sync/trigger] Clearing stale sync lock for user ${userId} (stale since ${new Date(updatedAt).toISOString()})`);
        await db.syncStatus.update({
          where: { userId },
          data: { isSyncing: false, lastError: 'Previous sync timed out' },
        });
      } else {
        return NextResponse.json(
          { error: 'Sync already in progress' },
          { status: 409 }
        );
      }
    }

    // Get user's X connection status
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { xConnected: true, xAuthMethod: true },
    });

    if (!user?.xConnected) {
      return NextResponse.json(
        { error: 'X/Twitter not connected' },
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
      // Use the dual-provider sync service
      const result = await syncBookmarksDual(userId);

      // Update the user's auth method based on what was actually used
      if (user.xAuthMethod !== result.provider) {
        await db.user.update({
          where: { id: userId },
          data: { xAuthMethod: result.provider },
        });
      }

      // Update sync status
      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          lastSyncAt: new Date(),
          syncCount: (syncStatus?.syncCount || 0) + result.syncedCount,
          errorCount: 0,
          lastError: result.errors.length > 0 ? result.errors.join('; ') : null,
          provider: result.provider,
        },
      });

      // Log activity
      await db.activity.create({
        data: {
          userId,
          type: 'sync_complete',
          metadata: JSON.stringify({
            syncedCount: result.syncedCount,
            pages: result.pages,
            provider: result.provider,
            hasMore: result.hasMore,
          }),
        },
      });

      return NextResponse.json({
        success: true,
        syncedCount: result.syncedCount,
        pages: result.pages,
        hasMore: result.hasMore,
        provider: result.provider,
      });
    } catch (syncError) {
      const errorMessage = syncError instanceof Error ? syncError.message : 'Sync failed';
      console.error('[sync/trigger] Sync failed:', errorMessage);

      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          errorCount: (syncStatus?.errorCount || 0) + 1,
          lastError: errorMessage,
        },
      });

      // Return a more detailed error response instead of throwing
      return NextResponse.json(
        {
          error: errorMessage,
          success: false,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[sync/trigger] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
