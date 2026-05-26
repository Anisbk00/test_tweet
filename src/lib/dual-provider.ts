/**
 * Dual Provider Service — Orchestrates X API v2 (direct) + Cookie-based + Twikit (fallback)
 *
 * Primary: X API v2 calls directly from Next.js (works on Vercel)
 * Secondary: Cookie-based X internal GraphQL API (direct, no Python dependency)
 * Tertiary: Twikit service (requires TWIKIT_SERVICE_URL env var)
 *
 * For each data request, this service:
 * 1. Tries X API v2 directly (if user has OAuth 2.0 tokens)
 * 2. Falls back to cookie-based X GraphQL API (if user has cookies stored)
 * 3. Falls back to Twikit service (if available and user has cookies)
 * 4. Returns results from whichever provider succeeds
 */

import { db } from '@/lib/db';
import {
  getBookmarksForUser,
  getTimeline,
  getFollowing,
  getFollowers,
  getUserLists,
  getListTweets,
  searchTweets,
  refreshOAuth2Token,
  XApiError,
  StandardPaginatedResponse,
  hasOAuth1Credentials,
} from '@/lib/x-api';
import {
  twikitGetBookmarks,
  twikitGetTimeline,
  twikitGetBookmarkMedia,
  twikitGetLists,
  twikitGetListTweets,
  twikitGetFollowing,
  twikitGetFollowers,
  twikitLoginWithCookies,
  transformTwikitPost,
  isTwikitAvailable,
  TwikitPaginatedResponse,
} from '@/lib/twitter';
import {
  getCookieBookmarks,
  getCookieUserInfo,
  syncCookieBookmarks,
  transformCookiePost,
  CookieAuth,
  CookieBookmark,
} from '@/lib/x-cookie-api';

// ============================================================
// Types
// ============================================================

export type Provider = 'x_api' | 'cookie' | 'twikit';

export interface DualProviderResult {
  data: any[];
  cursor: string | null;
  has_more: boolean;
  count: number;
  provider: Provider;
}

export interface SyncResult {
  syncedCount: number;
  pages: number;
  hasMore: boolean;
  provider: Provider;
  errors: string[];
}

// ============================================================
// Helper: Get user's X auth info
// ============================================================

async function getUserAuthInfo(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      xConnected: true,
      xUserId: true,
      xUsername: true,
      xAuthMethod: true,
      xOAuth2AccessToken: true,
      xOAuth2RefreshToken: true,
      xOAuth2ExpiresAt: true,
      xCookies: true,
      xAccessToken: true,
    },
  });
}

/**
 * Parse stored cookies from the user record.
 * Includes twid cookie if available (now required by X).
 */
function parseCookies(user: NonNullable<Awaited<ReturnType<typeof getUserAuthInfo>>>): CookieAuth | null {
  if (!user.xCookies) return null;

  try {
    const cookies = JSON.parse(user.xCookies);
    if (cookies.auth_token && cookies.ct0) {
      // Include twid if available — X now requires it for authentication
      const result: CookieAuth = { auth_token: cookies.auth_token, ct0: cookies.ct0 };
      if (cookies.twid) {
        result.twid = cookies.twid;
      }
      // If we have user ID but no twid, construct it
      if (!result.twid && user.xUserId) {
        result.twid = `u=${user.xUserId}`;
      }
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure the OAuth 2.0 access token is valid, refreshing if necessary.
 * Returns the current valid access token or null if unavailable.
 */
async function ensureOAuth2Token(userId: string, user: NonNullable<Awaited<ReturnType<typeof getUserAuthInfo>>>): Promise<string | null> {
  if (!user.xOAuth2AccessToken || !user.xOAuth2RefreshToken) return null;

  // Check if token is expired
  const expiresAt = user.xOAuth2ExpiresAt;
  const isExpired = expiresAt && new Date(expiresAt) < new Date(Date.now() + 5 * 60 * 1000); // 5 min buffer

  if (!isExpired) {
    return user.xOAuth2AccessToken;
  }

  // Try to refresh the token
  try {
    const refreshed = await refreshOAuth2Token(user.xOAuth2RefreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    await db.user.update({
      where: { id: userId },
      data: {
        xOAuth2AccessToken: refreshed.access_token,
        xOAuth2RefreshToken: refreshed.refresh_token || user.xOAuth2RefreshToken,
        xOAuth2ExpiresAt: newExpiresAt,
      },
    });

    return refreshed.access_token;
  } catch (error) {
    console.error('Failed to refresh OAuth2 token:', error);
    return null;
  }
}

/**
 * Authenticate with the Twikit service using stored cookies.
 */
async function authenticateTwikit(userId: string, user: NonNullable<Awaited<ReturnType<typeof getUserAuthInfo>>>): Promise<boolean> {
  if (!isTwikitAvailable() || !user.xCookies) return false;

  try {
    let cookies: Record<string, string>;
    try {
      cookies = JSON.parse(user.xCookies);
    } catch {
      return false;
    }

    await twikitLoginWithCookies(userId, cookies as any, user.xUsername || undefined);
    return true;
  } catch (error) {
    console.error('Twikit authentication failed:', error);
    return false;
  }
}

// ============================================================
// Dual Provider Methods
// ============================================================

/**
 * Get bookmarks with dual-provider support.
 * Priority: X API v2 (OAuth 2.0) → Cookie-based GraphQL → Twikit
 */
export async function getBookmarksDual(
  userId: string,
  cursor?: string,
  limit: number = 50
): Promise<DualProviderResult> {
  const user = await getUserAuthInfo(userId);
  if (!user?.xConnected) {
    throw new Error('X/Twitter not connected');
  }

  // Try X API v2 (direct) — requires OAuth 2.0 tokens
  const accessToken = await ensureOAuth2Token(userId, user);
  if (accessToken && user.xUserId) {
    try {
      const result = await getBookmarksForUser(accessToken, user.xUserId, limit, cursor || undefined);
      return {
        ...result,
        provider: 'x_api',
      };
    } catch (error) {
      if (error instanceof XApiError && error.status === 429) {
        console.warn('X API rate limited, falling back to cookie-based');
      } else {
        console.warn('X API bookmarks failed, falling back to cookie-based:', error);
      }
    }
  }

  // Try cookie-based X GraphQL API (direct, no Python dependency)
  const cookies = parseCookies(user);
  if (cookies) {
    try {
      const result = await getCookieBookmarks(cookies, cursor || undefined, limit);
      return {
        data: result.data,
        cursor: result.cursor,
        has_more: result.has_more,
        count: result.count,
        provider: 'cookie',
      };
    } catch (error) {
      console.warn('Cookie-based bookmarks failed, falling back to Twikit:', error);
    }
  }

  // Fall back to Twikit service
  const twikitAuthed = await authenticateTwikit(userId, user);
  if (twikitAuthed) {
    try {
      const result = await twikitGetBookmarks(userId, cursor || undefined, limit);
      return {
        data: result.data.map(transformTwikitPost),
        cursor: result.cursor,
        has_more: result.has_more,
        count: result.count,
        provider: 'twikit',
      };
    } catch (error) {
      console.error('Twikit bookmarks also failed:', error);
    }
  }

  throw new Error('All bookmark providers failed. Please check your X/Twitter connection.');
}

/**
 * Get timeline with dual-provider support.
 * Priority: X API v2 (OAuth 2.0) → Cookie-based → Twikit
 */
export async function getTimelineDual(
  userId: string,
  cursor?: string,
  limit: number = 50
): Promise<DualProviderResult> {
  const user = await getUserAuthInfo(userId);
  if (!user?.xConnected) {
    throw new Error('X/Twitter not connected');
  }

  // Try X API v2 (direct)
  const accessToken = await ensureOAuth2Token(userId, user);
  if (accessToken && user.xUserId) {
    try {
      const result = await getTimeline(accessToken, user.xUserId, limit, cursor || undefined);
      return {
        ...result,
        provider: 'x_api',
      };
    } catch (error) {
      console.warn('X API timeline failed, falling back:', error);
    }
  }

  // Twikit service fallback
  const twikitAuthed = await authenticateTwikit(userId, user);
  if (twikitAuthed) {
    try {
      const result = await twikitGetTimeline(userId, cursor || undefined, limit);
      return {
        data: result.data.map(transformTwikitPost),
        cursor: result.cursor,
        has_more: result.has_more,
        count: result.count,
        provider: 'twikit',
      };
    } catch (error) {
      console.error('Twikit timeline also failed:', error);
    }
  }

  throw new Error('All timeline providers failed.');
}

/**
 * Get following with dual-provider support.
 */
export async function getFollowingDual(
  userId: string,
  targetUserId: string,
  cursor?: string,
  limit: number = 100
) {
  if (hasOAuth1Credentials()) {
    try {
      return await getFollowing(targetUserId, limit, cursor || undefined);
    } catch (error) {
      console.warn('X API following failed, falling back:', error);
    }
  }

  const user = await getUserAuthInfo(userId);
  if (user) {
    const twikitAuthed = await authenticateTwikit(userId, user);
    if (twikitAuthed) {
      try {
        return await twikitGetFollowing(userId, targetUserId, cursor || undefined, limit);
      } catch (error) {
        console.error('Twikit following also failed:', error);
      }
    }
  }

  throw new Error('All following providers failed.');
}

/**
 * Get followers with dual-provider support.
 */
export async function getFollowersDual(
  userId: string,
  targetUserId: string,
  cursor?: string,
  limit: number = 100
) {
  if (hasOAuth1Credentials()) {
    try {
      return await getFollowers(targetUserId, limit, cursor || undefined);
    } catch (error) {
      console.warn('X API followers failed, falling back:', error);
    }
  }

  const user = await getUserAuthInfo(userId);
  if (user) {
    const twikitAuthed = await authenticateTwikit(userId, user);
    if (twikitAuthed) {
      try {
        return await twikitGetFollowers(userId, targetUserId, cursor || undefined, limit);
      } catch (error) {
        console.error('Twikit followers also failed:', error);
      }
    }
  }

  throw new Error('All followers providers failed.');
}

/**
 * Get user's lists with dual-provider support.
 */
export async function getListsDual(
  userId: string,
  cursor?: string,
  limit: number = 100
) {
  if (hasOAuth1Credentials()) {
    const user = await getUserAuthInfo(userId);
    if (user?.xUserId) {
      try {
        return await getUserLists(user.xUserId, limit, cursor || undefined);
      } catch (error) {
        console.warn('X API lists failed, falling back:', error);
      }
    }
  }

  const user = await getUserAuthInfo(userId);
  if (user) {
    const twikitAuthed = await authenticateTwikit(userId, user);
    if (twikitAuthed) {
      try {
        return await twikitGetLists(userId);
      } catch (error) {
        console.error('Twikit lists also failed:', error);
      }
    }
  }

  throw new Error('All lists providers failed.');
}

/**
 * Get media posts with dual-provider support.
 */
export async function getMediaDual(
  userId: string,
  cursor?: string,
  limit: number = 50
): Promise<DualProviderResult> {
  const user = await getUserAuthInfo(userId);
  if (!user?.xConnected) {
    throw new Error('X/Twitter not connected');
  }

  // Try cookie-based first (has better media support)
  const cookies = parseCookies(user);
  if (cookies) {
    try {
      const result = await getCookieBookmarks(cookies, cursor || undefined, limit);
      // Filter for posts with media
      const mediaPosts = result.data.filter((p) => p.media && p.media.length > 0);
      return {
        data: mediaPosts.map((p) => ({
          ...transformCookiePost(p),
        })),
        cursor: result.cursor,
        has_more: result.has_more,
        count: mediaPosts.length,
        provider: 'cookie',
      };
    } catch (error) {
      console.warn('Cookie-based media failed, falling back:', error);
    }
  }

  // Fall back to Twikit media endpoint
  const twikitAuthed = await authenticateTwikit(userId, user);
  if (twikitAuthed) {
    try {
      const result = await twikitGetBookmarkMedia(userId, cursor || undefined, limit);
      return {
        data: result.data.map(transformTwikitPost),
        cursor: result.cursor,
        has_more: result.has_more,
        count: result.count,
        provider: 'twikit',
      };
    } catch (error) {
      console.warn('Twikit media failed, falling back to X API bookmarks:', error);
    }
  }

  // Fall back to X API bookmarks (and let the frontend filter for media)
  const accessToken = await ensureOAuth2Token(userId, user);
  if (accessToken && user.xUserId) {
    try {
      const result = await getBookmarksForUser(accessToken, user.xUserId, limit, cursor || undefined);
      const mediaPosts = result.data.filter((p) => p.media && p.media.length > 0);
      return {
        data: mediaPosts.map((p) => ({
          xPostId: p.id,
          content: p.content,
          xAuthorId: p.author.id,
          xAuthorName: p.author.name,
          xAuthorUsername: p.author.username,
          xAuthorAvatar: p.author.avatar_url,
          mediaUrls: JSON.stringify(p.media.map((m) => m.url)),
          mediaTypes: JSON.stringify(p.media.map((m) => m.type)),
          replyCount: p.metrics.replies,
          repostCount: p.metrics.reposts,
          likeCount: p.metrics.likes,
          viewCount: p.metrics.views,
          bookmarkCount: p.metrics.bookmarks,
          postedAt: p.posted_at ? new Date(p.posted_at) : null,
          source: 'x_api' as const,
        })),
        cursor: result.cursor,
        has_more: result.has_more,
        count: mediaPosts.length,
        provider: 'x_api',
      };
    } catch (error) {
      console.error('X API bookmarks for media also failed:', error);
    }
  }

  throw new Error('All media providers failed.');
}

/**
 * Full sync: Fetch all bookmarks from X/Twitter and upsert into database.
 * Uses dual-provider approach with automatic fallback.
 * 
 * Priority: X API v2 (OAuth 2.0) → Cookie-based GraphQL → Twikit
 */
export async function syncBookmarksDual(userId: string): Promise<SyncResult> {
  const user = await getUserAuthInfo(userId);
  if (!user?.xConnected) {
    throw new Error('X/Twitter not connected');
  }

  let provider: Provider = 'x_api';
  let allSynced = 0;
  let pageCount = 0;
  let cursor: string | undefined = undefined;
  let hasMore = true;
  const maxPages = 10;
  const errors: string[] = [];

  // ===== Method 1: X API v2 (direct) — requires OAuth 2.0 tokens =====
  const accessToken = await ensureOAuth2Token(userId, user);
  if (accessToken && user.xUserId) {
    try {
      while (hasMore && pageCount < maxPages) {
        const result = await getBookmarksForUser(accessToken, user.xUserId, 100, cursor);

        for (const post of result.data) {
          try {
            await db.bookmark.upsert({
              where: { xPostId: post.id },
              update: {
                content: post.content,
                xAuthorId: post.author?.id || null,
                xAuthorName: post.author?.name || null,
                xAuthorUsername: post.author?.username || null,
                xAuthorAvatar: post.author?.avatar_url || null,
                mediaUrls: JSON.stringify(post.media?.map((m) => m.url) || []),
                mediaTypes: JSON.stringify(post.media?.map((m) => m.type) || []),
                replyCount: post.metrics?.replies || 0,
                repostCount: post.metrics?.reposts || 0,
                likeCount: post.metrics?.likes || 0,
                viewCount: post.metrics?.views || 0,
                bookmarkCount: post.metrics?.bookmarks || 0,
                postedAt: post.posted_at ? new Date(post.posted_at) : null,
                isBookmarked: true,
                source: 'x_api',
              },
              create: {
                userId,
                xPostId: post.id,
                content: post.content,
                xAuthorId: post.author?.id || null,
                xAuthorName: post.author?.name || null,
                xAuthorUsername: post.author?.username || null,
                xAuthorAvatar: post.author?.avatar_url || null,
                mediaUrls: JSON.stringify(post.media?.map((m) => m.url) || []),
                mediaTypes: JSON.stringify(post.media?.map((m) => m.type) || []),
                replyCount: post.metrics?.replies || 0,
                repostCount: post.metrics?.reposts || 0,
                likeCount: post.metrics?.likes || 0,
                viewCount: post.metrics?.views || 0,
                bookmarkCount: post.metrics?.bookmarks || 0,
                postedAt: post.posted_at ? new Date(post.posted_at) : null,
                source: 'x_api',
              },
            });
            allSynced++;
          } catch (err) {
            errors.push(`Failed to sync post ${post.id}: ${err}`);
          }
        }

        hasMore = result.has_more;
        cursor = result.cursor || undefined;
        pageCount++;

        if (!result.data || result.data.length === 0) break;
      }

      if (allSynced > 0) {
        return { syncedCount: allSynced, pages: pageCount, hasMore, provider, errors };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'X API sync failed';
      errors.push(errorMsg);
      console.warn('X API v2 sync failed, falling back to cookie-based:', error);
    }
  }

  // ===== Method 2: Cookie-based X GraphQL API (direct, no Python dependency) =====
  provider = 'cookie';
  const cookies = parseCookies(user);
  if (cookies) {
    try {
      allSynced = 0;
      pageCount = 0;
      hasMore = true;

      const syncResult = await syncCookieBookmarks(cookies, maxPages, (page, count) => {
        console.log(`[dual-provider] Cookie sync page ${page}: ${count} bookmarks`);
      });

      console.log(`[dual-provider] Cookie sync returned ${syncResult.posts.length} posts across ${syncResult.totalPages} pages`);

      for (const post of syncResult.posts) {
        try {
          const transformed = transformCookiePost(post);
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
              source: 'cookie',
            },
            create: {
              userId,
              ...transformed,
            },
          });
          allSynced++;
        } catch (err) {
          errors.push(`Failed to sync post ${post.id}: ${err}`);
        }
      }

      if (allSynced > 0) {
        // Update the user's X info if we didn't have it
        if (!user.xUserId && syncResult.posts.length > 0) {
          // Try to get user info
          const userInfo = await getCookieUserInfo(cookies);
          if (userInfo) {
            await db.user.update({
              where: { id: userId },
              data: {
                xUserId: userInfo.id,
                xUsername: userInfo.username,
              },
            });
          }
        }

        return {
          syncedCount: allSynced,
          pages: syncResult.totalPages,
          hasMore: syncResult.hasMore,
          provider: 'cookie',
          errors,
        };
      }

      // Cookie sync returned 0 posts — distinguish between:
      // 1. User genuinely has no bookmarks (totalPages > 0 means we got a valid empty response)
      // 2. API returned unexpected structure (totalPages === 0 means the request may have failed silently)
      if (syncResult.posts.length === 0 && syncResult.totalPages === 0) {
        console.warn('[dual-provider] Cookie sync returned 0 posts and 0 pages — API may have returned unexpected structure or auth failed silently');
        errors.push('Cookie-based sync returned no bookmarks. The X API query IDs may need updating, or your cookies may have expired. Try reconnecting your X account with fresh cookies (auth_token, ct0, and twid).');
      } else if (syncResult.posts.length === 0 && syncResult.totalPages > 0) {
        // Got a valid response but user has no bookmarks — this is a success, not an error
        console.log('[dual-provider] Cookie sync returned 0 bookmarks but response was valid — user likely has no bookmarks');
        return {
          syncedCount: 0,
          pages: syncResult.totalPages,
          hasMore: false,
          provider: 'cookie',
          errors,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Cookie-based sync failed';
      errors.push(errorMsg);
      console.warn('[dual-provider] Cookie-based sync failed, falling back to Twikit:', error);
    }
  }

  // ===== Method 3: Twikit service (requires Python service running) =====
  provider = 'twikit';
  const twikitAuthed = await authenticateTwikit(userId, user);
  if (twikitAuthed) {
    try {
      allSynced = 0;
      pageCount = 0;
      cursor = undefined;
      hasMore = true;

      while (hasMore && pageCount < maxPages) {
        const result = await twikitGetBookmarks(userId, cursor, 50);

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
            errors.push(`Failed to sync post ${post.id}: ${err}`);
          }
        }

        hasMore = result.has_more;
        cursor = result.cursor || undefined;
        pageCount++;

        if (!result.data || result.data.length === 0) break;
      }

      if (allSynced > 0) {
        return { syncedCount: allSynced, pages: pageCount, hasMore, provider, errors };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Twikit sync failed';
      errors.push(errorMsg);
      console.error('Twikit sync also failed:', error);
    }
  }

  const triedMethods: string[] = [];
  if (accessToken && user.xUserId) triedMethods.push('X API v2 (OAuth 2.0)');
  if (cookies) triedMethods.push('Cookie-based X GraphQL API');
  if (twikitAuthed) triedMethods.push('Twikit service');

  let guidance: string;
  if (triedMethods.length === 0) {
    guidance = 'No sync providers are available. Please connect your X account using OAuth 2.0 (recommended) or cookies.';
  } else if (cookies && !accessToken) {
    guidance = 'Cookie authentication failed. Your cookies may have expired — please reconnect your X account with fresh cookies (auth_token, ct0, and twid). OAuth 2.0 is recommended for reliability.';
  } else if (accessToken && !cookies) {
    guidance = 'OAuth 2.0 token may be expired or lacks required scopes (bookmark.read, users.read). Try reconnecting your X account.';
  } else {
    guidance = 'All available methods failed. Try reconnecting your X account. OAuth 2.0 is recommended for reliability.';
  }

  const errorDetails = errors.length > 0 ? errors.join('; ') : 'No specific error details captured — check server logs for more information.';

  throw new Error(
    `All sync providers failed. Tried: ${triedMethods.join(', ') || 'none available'}. ` +
    `${guidance} ` +
    `Details: ${errorDetails}`
  );
}
