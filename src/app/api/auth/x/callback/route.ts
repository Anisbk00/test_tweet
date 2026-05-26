import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exchangeOAuth2Code, getMe } from '@/lib/x-api';
import { isTwikitAvailable, xApiLoginWithOAuth2 } from '@/lib/twitter';

/**
 * GET /api/auth/x/callback
 *
 * OAuth 2.0 callback handler for X.
 * Works directly from Next.js — no Python service dependency.
 *
 * Flow:
 * 1. Receives the authorization code and state from X
 * 2. Validates the state matches the one stored in the cookie
 * 3. Exchanges the code for tokens directly via X API v2
 * 4. Fetches user info (x_user_id, username) using the access token
 * 5. Stores tokens in the database (User model)
 * 6. Optionally sends tokens to the Twikit service (if available)
 * 7. Redirects to the app with success/error
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // If X returned an error, redirect with the error
    if (error) {
      const redirectUrl = new URL('/', request.url);
      redirectUrl.searchParams.set('error', 'x_oauth_denied');
      redirectUrl.searchParams.set('error_detail', errorDescription || error);
      return NextResponse.redirect(redirectUrl);
    }

    // Validate required parameters
    if (!code || !state) {
      const redirectUrl = new URL('/', request.url);
      redirectUrl.searchParams.set('error', 'x_oauth_invalid_callback');
      redirectUrl.searchParams.set('error_detail', 'Missing authorization code or state');
      return NextResponse.redirect(redirectUrl);
    }

    // Retrieve stored OAuth 2.0 cookies
    const storedState = request.cookies.get('x_oauth2_state')?.value;
    const codeVerifier = request.cookies.get('x_oauth2_code_verifier')?.value;
    const userId = request.cookies.get('x_oauth2_user_id')?.value;
    const redirectUri = request.cookies.get('x_oauth2_redirect_uri')?.value;

    // Validate state to prevent CSRF
    if (!storedState || state !== storedState) {
      const redirectUrl = new URL('/', request.url);
      redirectUrl.searchParams.set('error', 'x_oauth_invalid_state');
      redirectUrl.searchParams.set('error_detail', 'OAuth state mismatch. Please try again.');
      return NextResponse.redirect(redirectUrl);
    }

    // Validate required cookies
    if (!codeVerifier || !userId) {
      const redirectUrl = new URL('/', request.url);
      redirectUrl.searchParams.set('error', 'x_oauth_expired');
      redirectUrl.searchParams.set('error_detail', 'OAuth session expired. Please try again.');
      return NextResponse.redirect(redirectUrl);
    }

    // Step 1: Exchange the authorization code for tokens directly via X API v2
    const tokenData = await exchangeOAuth2Code(code, codeVerifier, redirectUri);

    // Step 2: Get the authenticated user's info using the access token
    let xUserId = '';
    let xUsername = '';

    try {
      const meResult = await getMe(tokenData.access_token);
      if (meResult) {
        xUserId = meResult.id;
        xUsername = meResult.username;
      }
    } catch (meErr) {
      console.error('Failed to fetch user info from X API:', meErr);
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
        console.warn('Failed to send OAuth 2.0 tokens to Twikit service (non-critical):', sessionErr);
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

    // Clear the OAuth 2.0 cookies and redirect to the app with success
    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set('x_connected', 'true');
    redirectUrl.searchParams.set('x_method', 'x_api');

    const response = NextResponse.redirect(redirectUrl);

    // Clear OAuth 2.0 cookies
    response.cookies.delete('x_oauth2_code_verifier');
    response.cookies.delete('x_oauth2_state');
    response.cookies.delete('x_oauth2_user_id');
    response.cookies.delete('x_oauth2_redirect_uri');

    return response;
  } catch (error) {
    console.error('X OAuth 2.0 callback error:', error);

    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set('error', 'x_oauth_callback_failed');
    redirectUrl.searchParams.set(
      'error_detail',
      error instanceof Error ? error.message : 'Failed to complete OAuth 2.0 flow'
    );
    return NextResponse.redirect(redirectUrl);
  }
}
