import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const sessionInfo = await getSession(request);

    if (sessionInfo) {
      await db.session
        .delete({
          where: { id: sessionInfo.sessionId },
        })
        .catch(() => {
          // Session might already be deleted
        });
    }

    return NextResponse.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
