import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { syncBookmarksDual } from '@/lib/dual-provider';

/**
 * POST /api/bookmarks/sync
 *
 * Sync bookmarks from X/Twitter using dual-provider support:
 * - X API v2 (primary) — direct from Next.js, works on Vercel
 * - Twikit (fallback) — via external Python service if available
 *
 * No Python service dependency for the primary method.
 */
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

    // Get user's X auth info
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        xConnected: true,
        xAuthMethod: true,
      },
    });

    if (!user?.xConnected) {
      return NextResponse.json(
        { error: 'X/Twitter not connected. Please connect your account first.' },
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
        syncedCount: result.syncedCount,
        pages: result.pages,
        hasMore: result.hasMore,
        provider: result.provider,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (syncError) {
      const errorMessage = syncError instanceof Error ? syncError.message : 'Sync failed';
      console.error('[bookmarks/sync] Sync failed:', errorMessage);

      // Mark sync as failed
      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          errorCount: (syncStatus?.errorCount || 0) + 1,
          lastError: errorMessage,
        },
      });

      // Return detailed error instead of throwing
      return NextResponse.json(
        { error: errorMessage, success: false },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Sync bookmarks error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
