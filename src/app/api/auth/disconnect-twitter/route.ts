import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { twikitLogout } from '@/lib/twitter';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try to logout from twikit-service (non-critical if fails)
    try {
      await twikitLogout(session.userId);
    } catch {
      // Ignore twikit logout errors
    }

    // Remove Twitter connection from user
    await db.user.update({
      where: { id: session.userId },
      data: {
        xCookies: null,
        xConnected: false,
        xUsername: null,
        xAccessToken: null,
        xRefreshToken: null,
        xUserId: null,
      },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'twitter_disconnect',
        metadata: JSON.stringify({}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Disconnect Twitter error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
