import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const syncStatus = await db.syncStatus.findUnique({
      where: { userId: session.userId },
    });

    if (!syncStatus) {
      // Create a default sync status
      const newStatus = await db.syncStatus.create({
        data: { userId: session.userId },
      });
      return NextResponse.json({ status: newStatus });
    }

    return NextResponse.json({ status: syncStatus });
  } catch (error) {
    console.error('Get sync status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
