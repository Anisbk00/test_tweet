import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { authToken, ct0 } = body;

    if (!authToken || !ct0) {
      return NextResponse.json(
        { error: 'auth_token and ct0 are required' },
        { status: 400 }
      );
    }

    // Build cookies object
    const cookies: Record<string, string> = {
      auth_token: authToken,
      ct0: ct0,
    };

    // Store cookies in user record - validation will happen during sync
    // This avoids the twikit service crashing on invalid cookie validation
    await db.user.update({
      where: { id: session.userId },
      data: {
        xCookies: JSON.stringify(cookies),
        xConnected: true,
        xAccessToken: authToken,
      },
    });

    // Create sync status if not exists
    await db.syncStatus.upsert({
      where: { userId: session.userId },
      update: {},
      create: { userId: session.userId },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'twitter_connect',
        metadata: JSON.stringify({}),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Twitter cookies stored. They will be validated during the first sync.',
    });
  } catch (error) {
    console.error('Connect Twitter error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
