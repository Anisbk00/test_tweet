import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  twikitGetBookmarks,
  transformTwikitPost,
  twikitLoginWithCookies,
  xApiLoginWithOAuth2,
  xApiRefreshOAuth2Token,
} from '@/lib/twitter';

/**
 * POST /api/bookmarks/sync
 *
 * Sync bookmarks from X/Twitter using dual-provider support:
 * - X API v2 (primary) if OAuth 2.0 tokens are available
 * - Twikit (fallback) if cookies are available
 *
 * The Python service automatically selects the best available provider.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    // Check if already syncing
    const syncStatus = await db.syncStatus.findUnique({
      where: { userId },
    });

    if (syncStatus?.isSyncing) {
      return NextResponse.json(
        { error: 'Sync already in progress' },
        { status: 409 }
      );
    }

    // Get user's full X auth info
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        xCookies: true,
        xConnected: true,
        xUsername: true,
        xAuthMethod: true,
        xOAuth2AccessToken: true,
        xOAuth2RefreshToken: true,
        xOAuth2ExpiresAt: true,
        xUserId: true,
      },
    });

    if (!user?.xConnected) {
      return NextResponse.json(
        { error: 'Twitter not connected. Please connect your X/Twitter account first.' },
        { status: 400 }
      );
    }

    // Determine which auth method(s) are available
    const hasOAuth2Tokens = !!user.xOAuth2AccessToken && !!user.xOAuth2RefreshToken;
    const hasCookies = !!user.xCookies;

    if (!hasOAuth2Tokens && !hasCookies) {
      return NextResponse.json(
        { error: 'No X/Twitter credentials found. Please reconnect your account.' },
        { status: 400 }
      );
    }

    // Mark as syncing
    await db.syncStatus.upsert({
      where: { userId },
      update: { isSyncing: true, lastError: null },
      create: { userId, isSyncing: true },
    });

    try {
      // --- Authenticate with the Python service ---
      // Try OAuth 2.0 first (primary), then fall back to Twikit cookies

      let authMethod: 'x_api' | 'twikit' = 'twikit';
      let loginError: Error | null = null;

      if (hasOAuth2Tokens) {
        // Check if OAuth2 token needs refreshing
        const expiresAt = user.xOAuth2ExpiresAt;
        const isTokenExpired = expiresAt && new Date(expiresAt) < new Date();

        if (isTokenExpired && user.xOAuth2RefreshToken) {
          // Try to refresh the token
          try {
            const refreshed = await xApiRefreshOAuth2Token(user.xOAuth2RefreshToken);
            const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

            await db.user.update({
              where: { id: userId },
              data: {
                xOAuth2AccessToken: refreshed.access_token,
                xOAuth2RefreshToken: refreshed.refresh_token,
                xOAuth2ExpiresAt: newExpiresAt,
              },
            });

            // Login with refreshed tokens
            await xApiLoginWithOAuth2(
              userId,
              refreshed.access_token,
              refreshed.refresh_token,
              refreshed.expires_in,
              user.xUserId || '',
              user.xUsername || ''
            );
            authMethod = 'x_api';
          } catch (refreshErr) {
            console.error('OAuth2 token refresh failed, falling back to cookies:', refreshErr);
            loginError = refreshErr instanceof Error ? refreshErr : new Error('Token refresh failed');
          }
        } else {
          // Token is still valid, login with existing tokens
          try {
            await xApiLoginWithOAuth2(
              userId,
              user.xOAuth2AccessToken!,
              user.xOAuth2RefreshToken!,
              // Calculate remaining seconds until expiry
              expiresAt
                ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
                : 7200,
              user.xUserId || '',
              user.xUsername || ''
            );
            authMethod = 'x_api';
          } catch (oauthErr) {
            console.error('OAuth2 login failed, falling back to cookies:', oauthErr);
            loginError = oauthErr instanceof Error ? oauthErr : new Error('OAuth2 login failed');
          }
        }
      }

      // If OAuth 2.0 failed or wasn't available, try Twikit cookies
      if (authMethod !== 'x_api' && hasCookies) {
        try {
          let cookies: Record<string, string>;
          try {
            cookies = JSON.parse(user.xCookies!);
          } catch {
            throw new Error('Invalid Twitter cookies format');
          }

          await twikitLoginWithCookies(userId, cookies as any, user.xUsername || undefined);
          authMethod = 'twikit';
          loginError = null; // Clear the error since we successfully authenticated
        } catch (cookieErr) {
          console.error('Twikit cookie login failed:', cookieErr);
          if (loginError) {
            // Both methods failed
            await db.syncStatus.update({
              where: { userId },
              data: {
                isSyncing: false,
                errorCount: (syncStatus?.errorCount || 0) + 1,
                lastError: 'Both OAuth 2.0 and cookie authentication failed. Please reconnect your account.',
              },
            });
            return NextResponse.json(
              { error: 'Authentication failed with all methods. Please reconnect your X/Twitter account.' },
              { status: 401 }
            );
          }
          loginError = cookieErr instanceof Error ? cookieErr : new Error('Cookie login failed');
        }
      }

      // If we still have a login error and no successful auth, bail out
      if (loginError) {
        // Check if the service is unreachable
        if (
          loginError.message?.includes('fetch failed') ||
          loginError.message?.includes('abort') ||
          loginError.message?.includes('ECONNREFUSED')
        ) {
          await db.syncStatus.update({
            where: { userId },
            data: {
              isSyncing: false,
              errorCount: (syncStatus?.errorCount || 0) + 1,
              lastError: 'Twitter sync service is unavailable. Please try again later.',
            },
          });
          return NextResponse.json(
            { error: 'Twitter sync service is currently unavailable. Please ensure the service is running and try again.' },
            { status: 503 }
          );
        }

        await db.syncStatus.update({
          where: { userId },
          data: {
            isSyncing: false,
            errorCount: (syncStatus?.errorCount || 0) + 1,
            lastError: loginError.message,
          },
        });
        return NextResponse.json(
          { error: loginError.message },
          { status: 500 }
        );
      }

      // --- Fetch bookmarks from the Python service ---
      // The service automatically selects the best provider
      let allSynced = 0;
      let cursor: string | undefined = undefined;
      let hasMore = true;
      let pageCount = 0;
      const maxPages = 10; // Limit to prevent infinite loops
      let usedProvider: string = authMethod;

      while (hasMore && pageCount < maxPages) {
        const result = await twikitGetBookmarks(userId, cursor, 50);

        // Track which provider was actually used by the service
        if (result.provider) {
          usedProvider = result.provider;
        }

        for (const post of result.data) {
          try {
            const transformed = transformTwikitPost(post);
            await db.bookmark.upsert({
              where: { xPostId: transformed.xPostId },
              update: {
                content: transformed.content,
                xAuthorId: transformed.xAuthorId,
                xAuthorName: transformed.xAuthorName,
                xAuthorUsername: transformed.xAuthorUsername,
                xAuthorAvatar: transformed.xAuthorAvatar,
                mediaUrls: transformed.mediaUrls,
                mediaTypes: transformed.mediaTypes,
                replyCount: transformed.replyCount,
                repostCount: transformed.repostCount,
                likeCount: transformed.likeCount,
                viewCount: transformed.viewCount,
                bookmarkCount: transformed.bookmarkCount,
                postedAt: transformed.postedAt,
                isBookmarked: true,
                source: transformed.source,
              },
              create: {
                userId,
                ...transformed,
              },
            });
            allSynced++;
          } catch (err) {
            console.error(`Failed to sync post ${post.id}:`, err);
          }
        }

        hasMore = result.has_more;
        cursor = result.cursor || undefined;
        pageCount++;

        // If no more data, break
        if (!result.data || result.data.length === 0) break;
      }

      // Update the user's auth method based on what was actually used
      if (user.xAuthMethod !== usedProvider) {
        await db.user.update({
          where: { id: userId },
          data: { xAuthMethod: usedProvider },
        });
      }

      // Update sync status
      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          lastSyncAt: new Date(),
          lastBookmarkId: cursor || syncStatus?.lastBookmarkId,
          syncCount: (syncStatus?.syncCount || 0) + allSynced,
          errorCount: 0,
          lastError: null,
          provider: usedProvider,
        },
      });

      // Log activity
      await db.activity.create({
        data: {
          userId,
          type: 'sync_complete',
          metadata: JSON.stringify({
            syncedCount: allSynced,
            pages: pageCount,
            provider: usedProvider,
          }),
        },
      });

      return NextResponse.json({
        syncedCount: allSynced,
        pages: pageCount,
        hasMore,
        provider: usedProvider,
      });
    } catch (syncError) {
      // Mark sync as failed
      await db.syncStatus.update({
        where: { userId },
        data: {
          isSyncing: false,
          errorCount: (syncStatus?.errorCount || 0) + 1,
          lastError:
            syncError instanceof Error
              ? syncError.message
              : 'Sync failed',
        },
      });

      throw syncError;
    }
  } catch (error) {
    console.error('Sync bookmarks error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
