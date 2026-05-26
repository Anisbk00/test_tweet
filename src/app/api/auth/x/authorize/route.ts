import { NextRequest, NextResponse } from 'next/server';
import { getSession, verifyToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { generatePKCEPair, getOAuth2AuthorizeUrl, hasOAuth2Credentials } from '@/lib/x-api';
import { redirectUrl } from '@/lib/url';

/**
 * GET /api/auth/x/authorize
 *
 * Initiates the X OAuth 2.0 PKCE flow directly from Next.js.
 * No Python service dependency — works on Vercel / Z.ai sandbox.
 *
 * Flow:
 * 1. Authenticates the user via Authorization header or ?token query param
 * 2. Generates a PKCE code_verifier + state directly in Next.js
 * 3. Stores code_verifier and state in the DATABASE (not cookies — cookies
 *    get lost when the app runs in an iframe on a different domain than
 *    the OAuth callback URL)
 * 4. Redirects the user to X's authorization page
 */
export async function GET(request: NextRequest) {
  try {
    // Check if OAuth 2.0 is configured
    if (!hasOAuth2Credentials()) {
      const errorUrl = redirectUrl(request, '/');
      errorUrl.searchParams.set('error', 'x_oauth_not_configured');
      errorUrl.searchParams.set('error_detail', 'X OAuth 2.0 is not configured. Set X_CLIENT_ID and X_CLIENT_SECRET environment variables.');
      return NextResponse.redirect(errorUrl);
    }

    // Try to authenticate the user - either via Authorization header or query param
    let userId: string | null = null;

    // First try Authorization header
    const session = await getSession(request);
    if (session) {
      userId = session.userId;
    } else {
      // Fallback to token in query string (for browser redirects)
      const tokenParam = request.nextUrl.searchParams.get('token');
      if (tokenParam) {
        const payload = verifyToken(tokenParam);
        if (payload) {
          // Verify session still exists
          const sessionRecord = await db.session.findUnique({
            where: { id: payload.sessionId },
          });
          if (sessionRecord && new Date(sessionRecord.expiresAt) > new Date()) {
            userId = payload.userId;
          }
        }
      }
    }

    if (!userId) {
      const errorUrl = redirectUrl(request, '/');
      errorUrl.searchParams.set('error', 'auth_required');
      errorUrl.searchParams.set('error_detail', 'Please sign in to connect your X account');
      return NextResponse.redirect(errorUrl);
    }

    // Build the redirect URI for the callback
    // Prefer the configured env var, then construct from public headers
    const configuredRedirectUri = process.env.X_OAUTH_REDIRECT_URI;
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host');
    const redirectUri = configuredRedirectUri ||
      (host && !host.startsWith('0.0.0.0') ? `${proto}://${host}/api/auth/x/callback` : undefined);

    if (!redirectUri) {
      const errorUrl = redirectUrl(request, '/');
      errorUrl.searchParams.set('error', 'x_oauth_no_redirect');
      errorUrl.searchParams.set('error_detail', 'Could not determine OAuth redirect URI. Set X_OAUTH_REDIRECT_URI environment variable.');
      return NextResponse.redirect(errorUrl);
    }

    console.log('[OAuth Authorize] userId:', userId, 'redirectUri:', redirectUri);

    // Generate PKCE pair and authorization URL
    const pkce = generatePKCEPair();
    const authorizeUrl = getOAuth2AuthorizeUrl(pkce, redirectUri);

    // Store PKCE data in the DATABASE instead of cookies
    // This is critical because the app may run in a preview iframe
    // on a different domain than the OAuth callback URL, causing cookies
    // to be lost during the cross-domain redirect
    await db.oAuthState.create({
      data: {
        state: pkce.state,
        codeVerifier: pkce.code_verifier,
        userId,
        redirectUri,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    });

    // Clean up expired OAuth states (best-effort)
    try {
      await db.oAuthState.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch {
      // ignore cleanup errors
    }

    console.log('[OAuth Authorize] Stored state in DB, redirecting to X. state:', pkce.state.substring(0, 8) + '...');

    // No need to set cookies — everything is in the DB now
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('[OAuth Authorize] Error:', error);

    // Redirect to the app with an error message
    const errorUrl = redirectUrl(request, '/');
    errorUrl.searchParams.set('error', 'x_oauth_authorize_failed');
    errorUrl.searchParams.set(
      'error_detail',
      error instanceof Error ? error.message : 'Failed to initiate OAuth 2.0 flow'
    );
    return NextResponse.redirect(errorUrl);
  }
}
