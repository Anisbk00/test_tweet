import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { validateCookiesDetailed, normalizeCookies, getCookieBookmarks } from '@/lib/x-cookie-api';

/**
 * GET /api/sync/diagnose
 *
 * Diagnostic endpoint that tests the user's X cookies and attempts
 * a single bookmark fetch to identify issues. Returns detailed info
 * about what's working and what's not.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        xConnected: true,
        xAuthMethod: true,
        xUserId: true,
        xUsername: true,
        xCookies: true,
        xOAuth2AccessToken: true,
        xOAuth2RefreshToken: true,
      },
    });

    const diagnosis: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      userId,
      xConnected: user?.xConnected || false,
      xAuthMethod: user?.xAuthMethod || null,
      xUserId: user?.xUserId || null,
      xUsername: user?.xUsername || null,
    };

    // Check cookie-based auth
    if (user?.xCookies) {
      try {
        const cookies = JSON.parse(user.xCookies);
        diagnosis.hasCookies = !!(cookies.auth_token && cookies.ct0);
        diagnosis.cookieFields = {
          auth_token_length: cookies.auth_token?.length || 0,
          ct0_length: cookies.ct0?.length || 0,
          twid_provided: !!cookies.twid,
        };

        if (cookies.auth_token && cookies.ct0) {
          const normalized = normalizeCookies({
            auth_token: cookies.auth_token,
            ct0: cookies.ct0,
            twid: cookies.twid || undefined,
          });

          // Step 1: Validate cookies
          diagnosis.cookieValidation = 'running';
          const validationResult = await validateCookiesDetailed(normalized);
          diagnosis.cookieValidation = validationResult.valid ? 'success' : 'failed';
          diagnosis.cookieValidationUser = validationResult.user;
          diagnosis.cookieValidationError = validationResult.error;
          diagnosis.cookieValidationDetails = validationResult.details;

          // Step 2: Try fetching bookmarks (just the first page)
          if (validationResult.valid) {
            diagnosis.bookmarkFetch = 'running';
            try {
              const bookmarksResult = await getCookieBookmarks(normalized, undefined, 5);
              diagnosis.bookmarkFetch = 'success';
              diagnosis.bookmarkCount = bookmarksResult.count;
              diagnosis.bookmarkHasMore = bookmarksResult.has_more;
              diagnosis.bookmarkCursor = bookmarksResult.cursor ? 'present' : null;
              diagnosis.sampleBookmarks = bookmarksResult.data.slice(0, 2).map(b => ({
                id: b.id,
                author: b.author.username,
                contentPreview: b.content.substring(0, 80),
                mediaCount: b.media.length,
              }));
            } catch (bookmarkError) {
              diagnosis.bookmarkFetch = 'failed';
              diagnosis.bookmarkFetchError = bookmarkError instanceof Error ? bookmarkError.message : String(bookmarkError);
            }
          }
        }
      } catch {
        diagnosis.hasCookies = false;
        diagnosis.cookieParseError = 'Failed to parse stored cookies';
      }
    } else {
      diagnosis.hasCookies = false;
    }

    // Check OAuth2
    diagnosis.hasOAuth2 = !!(user?.xOAuth2AccessToken);
    diagnosis.hasOAuth2Refresh = !!(user?.xOAuth2RefreshToken);

    return NextResponse.json({ diagnosis });
  } catch (error) {
    console.error('Diagnose error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
