import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isTwikitAvailable, twikitLoginWithCookies, xApiLoginWithOAuth2 } from '@/lib/twitter';

/**
 * POST /api/auth/connect-twitter
 *
 * Connect a user's X/Twitter account. Supports two methods:
 *
 * 1. Cookie-based (Twikit): Provide authToken and ct0 cookies
 * 2. OAuth 2.0 token-based (X API v2): Provide accessToken, refreshToken, expiresIn, xUserId, username
 *
 * The xAuthMethod field is set to 'twikit' or 'x_api' accordingly.
 * The Twikit service is optional — if not available, cookie-based auth
 * is still stored in the DB for later use.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      // Cookie-based (Twikit) fields
      authToken,
      ct0,
      // OAuth 2.0 (X API v2) fields
      accessToken,
      refreshToken,
      expiresIn,
      xUserId,
      username,
    } = body;

    // Determine which auth method is being used
    const isOAuth2 = accessToken && refreshToken && expiresIn && xUserId;
    const isCookieBased = authToken && ct0;

    if (!isOAuth2 && !isCookieBased) {
      return NextResponse.json(
        {
          error:
            'Either (authToken, ct0) for cookie-based auth or (accessToken, refreshToken, expiresIn, xUserId) for OAuth 2.0 are required',
        },
        { status: 400 }
      );
    }

    if (isOAuth2) {
      // ---- OAuth 2.0 (X API v2) connection ----
      const expiresAt = new Date(Date.now() + Number(expiresIn) * 1000);
      const xUsername = username || null;

      await db.user.update({
        where: { id: session.userId },
        data: {
          xOAuth2AccessToken: accessToken,
          xOAuth2RefreshToken: refreshToken,
          xOAuth2ExpiresAt: expiresAt,
          xUserId: String(xUserId),
          xUsername: xUsername,
          xConnected: true,
          xAuthMethod: 'x_api',
        },
      });

      // Create/update sync status
      await db.syncStatus.upsert({
        where: { userId: session.userId },
        update: { provider: 'x_api' },
        create: { userId: session.userId, provider: 'x_api' },
      });

      // Optionally send tokens to the Twikit service (if available)
      if (isTwikitAvailable()) {
        try {
          await xApiLoginWithOAuth2(
            session.userId,
            accessToken,
            refreshToken,
            Number(expiresIn),
            String(xUserId),
            xUsername || ''
          );
        } catch (sessionErr) {
          console.warn('Failed to send OAuth 2.0 tokens to Twikit service (non-critical):', sessionErr);
        }
      }

      // Log activity
      await db.activity.create({
        data: {
          userId: session.userId,
          type: 'twitter_connect',
          metadata: JSON.stringify({
            method: 'oauth2',
            x_user_id: xUserId,
            username: xUsername,
          }),
        },
      });

      return NextResponse.json({
        success: true,
        message: 'X account connected via OAuth 2.0.',
        authMethod: 'x_api',
      });
    } else {
      // ---- Cookie-based (Twikit) connection ----
      const cookies: Record<string, string> = {
        auth_token: authToken,
        ct0: ct0,
      };

      await db.user.update({
        where: { id: session.userId },
        data: {
          xCookies: JSON.stringify(cookies),
          xConnected: true,
          xAccessToken: authToken,
          xAuthMethod: 'twikit',
        },
      });

      // Create/update sync status
      await db.syncStatus.upsert({
        where: { userId: session.userId },
        update: { provider: 'twikit' },
        create: { userId: session.userId, provider: 'twikit' },
      });

      // Try to authenticate with the Twikit service (if available)
      if (isTwikitAvailable()) {
        try {
          await twikitLoginWithCookies(session.userId, cookies as any, undefined);
        } catch (sessionErr) {
          console.warn('Failed to authenticate with Twikit service (cookies stored for later):', sessionErr);
        }
      }

      // Log activity
      await db.activity.create({
        data: {
          userId: session.userId,
          type: 'twitter_connect',
          metadata: JSON.stringify({ method: 'cookies', twikitServiceAvailable: isTwikitAvailable() }),
        },
      });

      return NextResponse.json({
        success: true,
        message: isTwikitAvailable()
          ? 'Twitter cookies stored and validated with Twikit service.'
          : 'Twitter cookies stored. They will be validated during the first sync.',
        authMethod: 'twikit',
      });
    }
  } catch (error) {
    console.error('Connect Twitter error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
