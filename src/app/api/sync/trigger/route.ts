import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { triggerFullSync } from '@/lib/twitter';

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

    // Mark as syncing
    await db.syncStatus.upsert({
      where: { userId },
      update: { isSyncing: true, lastError: null },
      create: {
        userId,
        isSyncing: true,
      },
    });

    // Try to trigger the twikit service
    const result = await triggerFullSync(userId);

    // Update sync status
    await db.syncStatus.update({
      where: { userId },
      data: {
        isSyncing: false,
        lastSyncAt: new Date(),
        syncCount: (syncStatus?.syncCount || 0) + result.syncedCount,
        errorCount: result.success ? (syncStatus?.errorCount || 0) : (syncStatus?.errorCount || 0) + 1,
        lastError: result.error || null,
      },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId,
        type: result.success ? 'sync_complete' : 'sync_error',
        metadata: JSON.stringify({
          syncedCount: result.syncedCount,
          error: result.error,
        }),
      },
    });

    return NextResponse.json({
      success: result.success,
      syncedCount: result.syncedCount,
      error: result.error,
    });
  } catch (error) {
    console.error('Trigger sync error:', error);

    // Try to reset sync status
    try {
      await db.syncStatus.update({
        where: { userId: session.userId },
        data: {
          isSyncing: false,
          lastError: error instanceof Error ? error.message : 'Sync failed',
        },
      });
    } catch {
      // Ignore update error
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
