import { NextRequest, NextResponse } from 'next/server';
import { getSession, verifyToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { generatePKCEPair, getOAuth2AuthorizeUrl, hasOAuth2Credentials } from '@/lib/x-api';

/**
 * GET /api/auth/x/authorize
 *
 * Initiates the X OAuth 2.0 PKCE flow directly from Next.js.
 * No Python service dependency — works on Vercel.
 *
 * Flow:
 * 1. Authenticates the user via Authorization header or ?token query param
 * 2. Generates a PKCE code_verifier + state directly in Next.js
 * 3. Stores code_verifier and state in secure HttpOnly cookies
 * 4. Redirects the user to X's authorization page
 */
export async function GET(request: NextRequest) {
  try {
    // Check if OAuth 2.0 is configured
    if (!hasOAuth2Credentials()) {
      const errorUrl = new URL('/', request.url);
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
      const errorUrl = new URL('/', request.url);
      errorUrl.searchParams.set('error', 'auth_required');
      errorUrl.searchParams.set('error_detail', 'Please sign in to connect your X account');
      return NextResponse.redirect(errorUrl);
    }

    // Build the redirect URI for the callback
    // Prefer the configured env var, then the request origin, then construct from URL
    const configuredRedirectUri = process.env.X_OAUTH_REDIRECT_URI;
    const requestOrigin = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const redirectUri = configuredRedirectUri ||
      (requestOrigin ? `${protocol}://${requestOrigin}/api/auth/x/callback` : undefined);

    if (!redirectUri) {
      const errorUrl = new URL('/', request.url);
      errorUrl.searchParams.set('error', 'x_oauth_no_redirect');
      errorUrl.searchParams.set('error_detail', 'Could not determine OAuth redirect URI. Set X_OAUTH_REDIRECT_URI environment variable.');
      return NextResponse.redirect(errorUrl);
    }

    // Generate PKCE pair and authorization URL directly in Next.js
    const pkce = generatePKCEPair();
    const authorizeUrl = getOAuth2AuthorizeUrl(pkce, redirectUri);

    // Store PKCE data and user context in secure HttpOnly cookies
    const response = NextResponse.redirect(authorizeUrl);

    response.cookies.set('x_oauth2_code_verifier', pkce.code_verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10, // 10 minutes
    });

    response.cookies.set('x_oauth2_state', pkce.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    });

    // Store the user ID and redirect URI so the callback knows who this is for
    response.cookies.set('x_oauth2_user_id', userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    });

    response.cookies.set('x_oauth2_redirect_uri', redirectUri, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    });

    return response;
  } catch (error) {
    console.error('X OAuth 2.0 authorize error:', error);

    // Redirect to the app with an error message
    const errorUrl = new URL('/', request.url);
    errorUrl.searchParams.set('error', 'x_oauth_authorize_failed');
    errorUrl.searchParams.set(
      'error_detail',
      error instanceof Error ? error.message : 'Failed to initiate OAuth 2.0 flow'
    );
    return NextResponse.redirect(errorUrl);
  }
}
