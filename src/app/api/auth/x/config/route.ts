import { NextRequest, NextResponse } from 'next/server';
import { hasBearerToken, hasOAuth1Credentials, hasOAuth2Credentials } from '@/lib/x-api';
import { isTwikitAvailable, xApiGetAuthConfig } from '@/lib/twitter';

/**
 * GET /api/auth/x/config
 *
 * Returns the X API configuration status:
 * - Whether OAuth 2.0 is configured (X_CLIENT_ID + X_CLIENT_SECRET)
 * - Whether Bearer Token is available (app-only search)
 * - Whether OAuth 1.0a is configured (following/followers)
 * - Whether Twikit service is available (TWIKIT_SERVICE_URL set)
 * - Available auth methods
 *
 * Works on Vercel — no Python service dependency.
 */
export async function GET(request: NextRequest) {
  try {
    const bearerAvailable = hasBearerToken();
    const oauth1Available = hasOAuth1Credentials();
    const oauth2Available = hasOAuth2Credentials();
    const twikitAvailable = isTwikitAvailable();

    const availableMethods: string[] = [];
    if (oauth2Available) availableMethods.push('x_api_oauth2');
    if (oauth1Available) availableMethods.push('x_api_oauth1');
    if (bearerAvailable) availableMethods.push('x_api_bearer');
    availableMethods.push('cookie'); // Cookie-based always available (user provides cookies)
    if (twikitAvailable) availableMethods.push('twikit');

    // Also try to get additional info from the Twikit service if available
    let twikitServiceDetails: Record<string, unknown> | null = null;
    if (twikitAvailable) {
      try {
        twikitServiceDetails = await xApiGetAuthConfig();
      } catch {
        // Service may be down, that's fine
      }
    }

    return NextResponse.json({
      configured: true, // Always configured since cookie-based is always available
      method: oauth2Available ? 'x_api' : 'cookie',
      hasOAuth2: oauth2Available,
      hasOAuth1: oauth1Available,
      hasBearerToken: bearerAvailable,
      hasCookie: true, // Cookie-based auth is always available
      hasTwikit: twikitAvailable,
      availableMethods,
      twikitService: twikitServiceDetails,
    });
  } catch (error) {
    console.error('X config error:', error);
    return NextResponse.json(
      {
        configured: false,
        method: null,
        hasOAuth2: false,
        hasOAuth1: false,
        hasBearerToken: false,
        hasTwikit: false,
      },
      { status: 500 }
    );
  }
}
