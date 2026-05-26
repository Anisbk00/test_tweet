import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { validateCookiesDetailed, normalizeCookies } from '@/lib/x-cookie-api';

/**
 * POST /api/auth/validate-cookies
 *
 * Validate X cookies without storing them.
 * Returns detailed diagnostics about the cookie validity.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { authToken, ct0, twid } = body;

    if (!authToken || !ct0) {
      return NextResponse.json(
        { error: 'authToken and ct0 are required' },
        { status: 400 }
      );
    }

    const normalized = normalizeCookies({ auth_token: authToken, ct0, twid: twid || undefined });

    const result = await validateCookiesDetailed({
      auth_token: normalized.auth_token,
      ct0: normalized.ct0,
      twid: normalized.twid,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Validate cookies error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
