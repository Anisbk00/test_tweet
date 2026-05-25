import { NextRequest, NextResponse } from 'next/server';
import { xApiGetAuthConfig } from '@/lib/twitter';

/**
 * GET /api/auth/x/config
 *
 * Returns the X API configuration status:
 * - Whether OAuth 2.0 is configured
 * - Whether Twikit is available
 * - Available auth methods
 */
export async function GET(request: NextRequest) {
  try {
    // Try to get config from the Python service
    let oauth2Enabled = false;
    let twikitEnabled = true; // Always available as fallback
    let availableMethods: string[] = ['twikit'];

    try {
      const config = await xApiGetAuthConfig();
      oauth2Enabled = config.has_oauth2_credentials;
      availableMethods = config.available_methods;
      twikitEnabled = availableMethods.includes('twikit');
    } catch {
      // Python service may be down, check env vars directly
      oauth2Enabled = !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
      twikitEnabled = true; // Twikit is always potentially available
    }

    return NextResponse.json({
      configured: oauth2Enabled || twikitEnabled,
      method: oauth2Enabled ? 'x_api' : twikitEnabled ? 'twikit' : null,
      hasOAuth2: oauth2Enabled,
      hasTwikit: twikitEnabled,
      availableMethods,
    });
  } catch (error) {
    console.error('X config error:', error);
    return NextResponse.json(
      {
        configured: false,
        method: null,
        hasOAuth2: false,
        hasTwikit: false,
      },
      { status: 500 }
    );
  }
}
