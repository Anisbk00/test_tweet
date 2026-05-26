import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * POST /api/sync/reset
 *
 * Reset a stuck sync lock (isSyncing = true) so the user can sync again.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    const syncStatus = await db.syncStatus.findUnique({
      where: { userId },
    });

    if (!syncStatus) {
      return NextResponse.json({ message: 'No sync status found' });
    }

    if (!syncStatus.isSyncing) {
      return NextResponse.json({ message: 'Sync is not stuck — no reset needed' });
    }

    // Clear the stuck lock
    await db.syncStatus.update({
      where: { userId },
      data: {
        isSyncing: false,
        lastError: 'Sync lock was manually reset',
      },
    });

    console.log(`[sync/reset] Cleared stuck sync lock for user ${userId}`);

    return NextResponse.json({
      message: 'Sync lock has been reset. You can now sync again.',
      wasStuck: true,
    });
  } catch (error) {
    console.error('[sync/reset] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
