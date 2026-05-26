import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure the response always includes xConnected and xAuthMethod fields
    // so the frontend can rely on them without undefined checks
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        avatarUrl: user.avatarUrl,
        xUserId: user.xUserId ?? null,
        xUsername: user.xUsername ?? null,
        xConnected: user.xConnected ?? false,
        xAuthMethod: user.xAuthMethod ?? null,
        xOAuth2ExpiresAt: user.xOAuth2ExpiresAt ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('[auth/me] Get profile error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile. Please try again.' },
      { status: 500 }
    );
  }
}
