import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exchangeOAuth2Code, getMe } from '@/lib/x-api';
import { isTwikitAvailable, xApiLoginWithOAuth2 } from '@/lib/twitter';
import { redirectUrl } from '@/lib/url';

/**
 * GET /api/auth/x/callback
 *
 * OAuth 2.0 callback handler for X.
 * Works directly from Next.js — no Python service dependency.
 *
 * Flow:
 * 1. Receives the authorization code and state from X
 * 2. Looks up the state in the DATABASE (not cookies) to find the
 *    code_verifier, userId, and redirectUri
 * 3. Exchanges the code for tokens directly via X API v2
 * 4. Fetches user info (x_user_id, username) using the access token
 * 5. Stores tokens in the database (User model)
 * 6. Optionally sends tokens to the Twikit service (if available)
 * 7. Redirects to the app with success/error
 *
 * NOTE: We use the database instead of cookies because when the app runs
 * in a preview iframe on a different domain than the OAuth callback URL,
 * cookies are lost during the cross-domain redirect from X back to our
 * callback. The database is domain-agnostic and always accessible.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    console.log('[OAuth Callback] Received:', { code: !!code, state: !!state, error });

    // If X returned an error, redirect with the error
    if (error) {
      const redir = redirectUrl(request, '/');
      redir.searchParams.set('error', 'x_oauth_denied');
      redir.searchParams.set('error_detail', errorDescription || error);
      return NextResponse.redirect(redir);
    }

    // Validate required parameters
    if (!code || !state) {
      const redir = redirectUrl(request, '/');
      redir.searchParams.set('error', 'x_oauth_invalid_callback');
      redir.searchParams.set('error_detail', 'Missing authorization code or state');
      return NextResponse.redirect(redir);
    }

    // Look up the OAuth state in the DATABASE
    const oauthState = await db.oAuthState.findUnique({
      where: { state },
    });

    console.log('[OAuth Callback] DB lookup for state:', state.substring(0, 8) + '...', 'found:', !!oauthState);

    if (!oauthState) {
      const redir = redirectUrl(request, '/');
      redir.searchParams.set('error', 'x_oauth_invalid_state');
      redir.searchParams.set('error_detail', 'OAuth state not found or expired. Please try again.');
      return NextResponse.redirect(redir);
    }

    // Check if the state has expired
    if (new Date() > oauthState.expiresAt) {
      // Clean up the expired state
      await db.oAuthState.delete({ where: { state } }).catch(() => {});
      const redir = redirectUrl(request, '/');
      redir.searchParams.set('error', 'x_oauth_expired');
      redir.searchParams.set('error_detail', 'OAuth session expired. Please try again.');
      return NextResponse.redirect(redir);
    }

    const { codeVerifier, userId, redirectUri } = oauthState;

    // Delete the state immediately (one-time use — prevents replay attacks)
    await db.oAuthState.delete({ where: { state } }).catch(() => {});

    console.log('[OAuth Callback] Found state in DB:', {
      hasVerifier: !!codeVerifier,
      userId,
      redirectUri,
    });

    // Step 1: Exchange the authorization code for tokens directly via X API v2
    console.log('[OAuth Callback] Exchanging code for tokens, redirectUri:', redirectUri);
    const tokenData = await exchangeOAuth2Code(code, codeVerifier, redirectUri);
    console.log('[OAuth Callback] Token exchange successful, expires_in:', tokenData.expires_in);

    // Step 2: Get the authenticated user's info using the access token
    let xUserId = '';
    let xUsername = '';

    try {
      const meResult = await getMe(tokenData.access_token);
      if (meResult) {
        xUserId = meResult.id;
        xUsername = meResult.username;
        console.log('[OAuth Callback] Got user info:', xUsername, xUserId);
      }
    } catch (meErr) {
      console.error('[OAuth Callback] Failed to fetch user info from X API:', meErr);
      // Continue — we still have the tokens
    }

    // Step 3: Store the OAuth 2.0 tokens in the database
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    await db.user.update({
      where: { id: userId },
      data: {
        xOAuth2AccessToken: tokenData.access_token,
        xOAuth2RefreshToken: tokenData.refresh_token || '',
        xOAuth2ExpiresAt: expiresAt,
        ...(xUserId ? { xUserId } : {}),
        ...(xUsername ? { xUsername } : {}),
        xConnected: true,
        xAuthMethod: 'x_api',
      },
    });

    // Create/update sync status
    await db.syncStatus.upsert({
      where: { userId },
      update: { provider: 'x_api' },
      create: { userId, provider: 'x_api' },
    });

    // Step 4: Optionally send tokens to the Twikit service (if available)
    if (isTwikitAvailable()) {
      try {
        await xApiLoginWithOAuth2(
          userId,
          tokenData.access_token,
          tokenData.refresh_token || '',
          tokenData.expires_in,
          xUserId,
          xUsername
        );
      } catch (sessionErr) {
        console.warn('[OAuth Callback] Failed to send OAuth 2.0 tokens to Twikit service (non-critical):', sessionErr);
      }
    }

    // Log activity
    await db.activity.create({
      data: {
        userId,
        type: 'twitter_connect',
        metadata: JSON.stringify({
          method: 'oauth2',
          x_user_id: xUserId || undefined,
          username: xUsername || undefined,
        }),
      },
    });

    // Clean up any remaining expired OAuth states (best-effort)
    try {
      await db.oAuthState.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch {
      // ignore
    }

    // Redirect to the app with success
    const redir = redirectUrl(request, '/');
    redir.searchParams.set('x_connected', 'true');
    redir.searchParams.set('x_method', 'x_api');

    console.log('[OAuth Callback] Success! Redirecting to:', redir.toString());

    return NextResponse.redirect(redir);
  } catch (error) {
    console.error('[OAuth Callback] Error:', error);

    const redir = redirectUrl(request, '/');
    redir.searchParams.set('error', 'x_oauth_callback_failed');
    redir.searchParams.set(
      'error_detail',
      error instanceof Error ? error.message : 'Failed to complete OAuth 2.0 flow'
    );
    return NextResponse.redirect(redir);
  }
}
