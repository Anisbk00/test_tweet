import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isTwikitAvailable, twikitLoginWithCookies, xApiLoginWithOAuth2 } from '@/lib/twitter';
import { getCookieUserInfo, validateCookies, validateCookiesDetailed, normalizeCookies, constructTwid } from '@/lib/x-cookie-api';

/**
 * POST /api/auth/connect-twitter
 *
 * Connect a user's X/Twitter account. Supports two methods:
 *
 * 1. Cookie-based: Provide authToken, ct0, and optionally twid cookies
 *    - Validates cookies by fetching user info from X's internal API
 *    - Stores xUserId and xUsername automatically
 *    - Works without the Python Twikit service
 *
 * 2. OAuth 2.0 token-based (X API v2): Provide accessToken, refreshToken, expiresIn, xUserId, username
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      // Cookie-based fields
      authToken,
      ct0,
      twid, // Optional but recommended
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
        username: xUsername,
      });
    } else {
      // ---- Cookie-based connection ----
      // Normalize cookies (trim whitespace, decode URL-encoding)
      const normalized = normalizeCookies({ auth_token: authToken, ct0, twid: twid || undefined });
      
      // Build cookies object for storage
      const cookiesForStorage: Record<string, string> = {
        auth_token: normalized.auth_token,
        ct0: normalized.ct0,
      };
      if (normalized.twid) {
        cookiesForStorage.twid = normalized.twid;
      }

      // Validate cookies with detailed diagnostics
      let xUserIdFromCookies: string | null = null;
      let xUsernameFromCookies: string | null = null;
      let validationError: string | null = null;

      try {
        const validationResult = await validateCookiesDetailed({
          auth_token: normalized.auth_token,
          ct0: normalized.ct0,
          twid: normalized.twid,
        });

        if (validationResult.valid && validationResult.user) {
          xUserIdFromCookies = validationResult.user.id;
          xUsernameFromCookies = validationResult.user.username;
          console.log(`Cookie validation successful: @${validationResult.user.username} (ID: ${validationResult.user.id})`);
          
          // If we got user ID but no twid was provided, construct and store it
          if (!normalized.twid && xUserIdFromCookies) {
            const constructedTwid = constructTwid(xUserIdFromCookies);
            cookiesForStorage.twid = constructedTwid;
            console.log(`Constructed twid cookie from user ID: ${constructedTwid}`);
          }
        } else {
          validationError = validationResult.error || 'Cookie validation returned null user info';
          console.warn('Cookie validation failed:', validationError);
          
          // If the error is about missing twid, return a helpful error
          if (validationError.includes('twid') && !normalized.twid) {
            return NextResponse.json(
              {
                error: validationError,
                needsTwid: true,
              },
              { status: 400 }
            );
          }
        }
      } catch (error) {
        validationError = error instanceof Error ? error.message : 'Cookie validation failed';
        console.warn('Cookie validation error:', error);
        // We still store the cookies — they might work for sync even if user info fetch fails
      }

      await db.user.update({
        where: { id: session.userId },
        data: {
          xCookies: JSON.stringify(cookiesForStorage),
          xConnected: true,
          xAccessToken: authToken,
          xAuthMethod: 'cookie',
          // Store user info if we got it
          ...(xUserIdFromCookies && { xUserId: xUserIdFromCookies }),
          ...(xUsernameFromCookies && { xUsername: xUsernameFromCookies }),
        },
      });

      // Create/update sync status
      await db.syncStatus.upsert({
        where: { userId: session.userId },
        update: { provider: 'cookie' },
        create: { userId: session.userId, provider: 'cookie' },
      });

      // Try to authenticate with the Twikit service (if available)
      if (isTwikitAvailable()) {
        try {
          await twikitLoginWithCookies(session.userId, cookiesForStorage as any, xUsernameFromCookies || undefined);
        } catch (sessionErr) {
          console.warn('Failed to authenticate with Twikit service (cookies stored for direct API use):', sessionErr);
        }
      }

      // Log activity
      await db.activity.create({
        data: {
          userId: session.userId,
          type: 'twitter_connect',
          metadata: JSON.stringify({
            method: 'cookies',
            username: xUsernameFromCookies,
            twikitServiceAvailable: isTwikitAvailable(),
            cookieValidation: xUserIdFromCookies ? 'success' : 'failed',
            validationError: validationError,
            hasTwid: !!cookiesForStorage.twid,
          }),
        },
      });

      return NextResponse.json({
        success: true,
        message: xUsernameFromCookies
          ? `Connected as @${xUsernameFromCookies}. Cookies validated successfully.`
          : 'Twitter cookies stored. They will be validated during the first sync.',
        authMethod: 'cookie',
        username: xUsernameFromCookies,
        validationError: validationError,
      });
    }
  } catch (error) {
    console.error('Connect Twitter error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
