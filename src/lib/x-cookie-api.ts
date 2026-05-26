/**
 * X Cookie-Based API Client — Direct access to X's internal GraphQL API
 *
 * Uses auth_token + ct0 cookies to make authenticated requests to X's
 * internal API endpoints (the same ones x.com's frontend uses).
 *
 * This eliminates the need for the Python Twikit service for cookie-based auth.
 * Works on Vercel serverless functions and any Node.js environment.
 */

// ============================================================
// Configuration
// ============================================================

// Public bearer token used by x.com's web client
const X_PUBLIC_BEARER = 'AAAAAAAAAAAAAAAAAAAAAFQODgEAAAAAVHTp76lzh3rFzcHbmHVvQxYYpTw%3DckAlMinMpkYqZ2M5VsnCEq4u0LkCE7ieFgEGvGmPdKkxWnoDNT';

const X_API_BASE = 'https://x.com/i/api/graphql';

// ============================================================
// Query ID Cache
// ============================================================

let cachedQueryIds: Record<string, string> = {};
let lastQueryIdFetch = 0;
const QUERY_ID_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Fallback query IDs (these change when X updates their frontend)
// We'll try to discover fresh ones from x.com's JS bundle
// Multiple fallbacks for Bookmarks since it's the most important
const FALLBACK_QUERY_IDS: Record<string, string> = {
  Bookmarks: 'S7HmUxJnLGVCLZDi9E5YA',
  UserByScreenName: 'G3KGOASz96M-Qu0nwmGXNg',
  UserByRestId: 'tD8zKvQzwY3kdx5yz6YmOw',
};

// Alternative query IDs to try if the primary one doesn't work
const ALTERNATIVE_BOOKMARKS_IDS = [
  'S7HmUxJnLGVCLZDi9E5YA',
  'R15ObwordQG7Y6WmL7QP-A',
  'XjKM5VwkyQJmEuwSVeX9hA',
  'W8Srw8txY1m7guZd7KHpA',
];

/**
 * Discover GraphQL query IDs from x.com's JavaScript bundle.
 * These IDs change when X updates their frontend code.
 */
async function discoverQueryIds(): Promise<Record<string, string>> {
  // If cached and fresh, return
  if (Object.keys(cachedQueryIds).length > 0 && Date.now() - lastQueryIdFetch < QUERY_ID_CACHE_TTL) {
    return cachedQueryIds;
  }

  try {
    // Fetch x.com's main page to find JS bundle URLs
    const response = await fetch('https://x.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch x.com: ${response.status}`);
    }

    const html = await response.text();

    // Find all JS bundle URLs from the HTML
    const jsUrls: string[] = [];
    const jsRegex = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^\s"']+/g;
    let match;
    while ((match = jsRegex.exec(html)) !== null) {
      jsUrls.push(match[0]);
    }

    // Also try the alternative pattern
    const altRegex = /"https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[^"]+\.js"/g;
    while ((match = altRegex.exec(html)) !== null) {
      const url = match[0].replace(/"/g, '');
      if (!jsUrls.includes(url)) jsUrls.push(url);
    }

    if (jsUrls.length === 0) {
      throw new Error('Could not find JS bundle URLs');
    }

    const queryIds: Record<string, string> = {};

    // Search through JS bundles for query IDs
    // We'll search up to 5 bundles max to avoid taking too long
    const bundlesToSearch = jsUrls.slice(0, 5);

    for (const jsUrl of bundlesToSearch) {
      try {
        const jsResponse = await fetch(jsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!jsResponse.ok) continue;

        const js = await jsResponse.text();

        // Search for Bookmarks query ID
        if (!queryIds.Bookmarks) {
          // Pattern: queryId:"XXXX",operationName:"Bookmarks"
          const bookmarksMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"Bookmarks"/);
          if (bookmarksMatch) {
            queryIds.Bookmarks = bookmarksMatch[1];
          }
        }

        // Search for UserByScreenName query ID
        if (!queryIds.UserByScreenName) {
          const userMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"UserByScreenName"/);
          if (userMatch) {
            queryIds.UserByScreenName = userMatch[1];
          }
        }

        // Search for UserByRestId query ID
        if (!queryIds.UserByRestId) {
          const userRestMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"UserByRestId"/);
          if (userRestMatch) {
            queryIds.UserByRestId = userRestMatch[1];
          }
        }

        // Early exit if we found all query IDs
        if (queryIds.Bookmarks && queryIds.UserByScreenName && queryIds.UserByRestId) {
          break;
        }
      } catch {
        // Skip failed bundle fetch
        continue;
      }
    }

    // Merge with fallbacks for any missing IDs
    const result = { ...FALLBACK_QUERY_IDS, ...queryIds };

    if (Object.keys(result).length > 0) {
      cachedQueryIds = result;
      lastQueryIdFetch = Date.now();
    }

    return result;
  } catch (error) {
    console.warn('Failed to discover query IDs, using fallbacks:', error);
    return FALLBACK_QUERY_IDS;
  }
}

// ============================================================
// Types
// ============================================================

export interface CookieAuth {
  auth_token: string;
  ct0: string;
}

export interface CookieBookmark {
  id: string;
  content: string;
  author: {
    id: string;
    name: string;
    username: string;
    avatar_url: string;
  };
  media: {
    url: string;
    type: string;
    preview_url: string;
  }[];
  metrics: {
    replies: number;
    reposts: number;
    likes: number;
    views: number;
    bookmarks: number;
  };
  posted_at: string | null;
  created_at: string;
  provider: 'cookie';
}

export interface CookiePaginatedResponse {
  data: CookieBookmark[];
  cursor: string | null;
  has_more: boolean;
  count: number;
  provider: 'cookie';
}

export interface CookieUserInfo {
  id: string;
  name: string;
  username: string;
  avatar_url: string;
}

// ============================================================
// Core Request Method
// ============================================================

async function cookieFetch<T>(
  path: string,
  cookies: CookieAuth,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params = {} } = options;

  const url = new URL(`${X_API_BASE}${path}`);

  // Add query parameters
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${X_PUBLIC_BEARER}`,
      'Cookie': `auth_token=${cookies.auth_token}; ct0=${cookies.ct0}`,
      'X-CSRF-TOKEN': cookies.ct0,
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Origin': 'https://x.com',
      'Referer': 'https://x.com/',
    },
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  // Add timeout (10 seconds)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  fetchOptions.signal = controller.signal;

  let response: Response;
  try {
    response = await fetch(url.toString(), fetchOptions);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Request to X API timed out. Your cookies may be invalid or the API is unreachable.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    const reset = response.headers.get('x-rate-limit-reset');
    throw new Error(`Rate limit exceeded. Reset at: ${reset || 'unknown'}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('Cookie authentication failed. Your cookies may have expired. Please reconnect your X account.');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`X API error (${response.status}): ${errorText.substring(0, 200)}`);
  }

  return response.json();
}

// ============================================================
// Features Object (required for GraphQL requests)
// ============================================================

const BOOKMARKS_FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweet_tipjar_donation_contributions_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

// ============================================================
// Public API Methods
// ============================================================

/**
 * Validate cookies by fetching the current user info.
 * Returns user info if cookies are valid, null otherwise.
 */
export async function validateCookies(cookies: CookieAuth): Promise<CookieUserInfo | null> {
  try {
    const queryIds = await discoverQueryIds();
    const queryId = queryIds.UserByScreenName || queryIds.UserByRestId;

    if (!queryId) {
      // Fallback: try to get user info using the viewer endpoint
      const result = await cookieFetch<any>(
        `/${FALLBACK_QUERY_IDS.UserByRestId}/UserByRestId`,
        cookies,
        {
          params: {
            variables: JSON.stringify({ userId: null }),
            features: JSON.stringify(USER_FEATURES),
          },
        }
      );
      return extractUserInfo(result);
    }

    // Try UserByRestId with "me" to get current user
    const result = await cookieFetch<any>(
      `/${queryId}/UserByRestId`,
      cookies,
      {
        params: {
          variables: JSON.stringify({ userId: 'me' }),
          features: JSON.stringify(USER_FEATURES),
        },
      }
    );

    return extractUserInfo(result);
  } catch (error) {
    console.error('Cookie validation failed:', error);
    return null;
  }
}

/**
 * Get the authenticated user's info using cookies.
 * Tries multiple approaches to find the current user.
 */
export async function getCookieUserInfo(cookies: CookieAuth): Promise<CookieUserInfo | null> {
  try {
    // Try the viewer endpoint first
    const queryIds = await discoverQueryIds();
    const queryId = queryIds.UserByRestId || FALLBACK_QUERY_IDS.UserByRestId;

    // Try getting user info from the /1.1/account/verify_credentials.json endpoint
    // This is more reliable than the GraphQL endpoint
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch('https://api.x.com/1.1/account/verify_credentials.json', {
        headers: {
          'Authorization': `Bearer ${X_PUBLIC_BEARER}`,
          'Cookie': `auth_token=${cookies.auth_token}; ct0=${cookies.ct0}`,
          'X-CSRF-TOKEN': cookies.ct0,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        return {
          id: data.id_str || data.id?.toString(),
          name: data.name,
          username: data.screen_name,
          avatar_url: data.profile_image_url_https?.replace('_normal', '_bigger') || '',
        };
      }
    } catch {
      // Fall through to GraphQL approach
    }

    // Fallback: GraphQL approach
    const result = await cookieFetch<any>(
      `/${queryId}/UserByRestId`,
      cookies,
      {
        params: {
          variables: JSON.stringify({ userId: 'me' }),
          features: JSON.stringify(USER_FEATURES),
        },
      }
    );

    return extractUserInfo(result);
  } catch (error) {
    console.error('Failed to get user info with cookies:', error);
    return null;
  }
}

/**
 * Get user's bookmarks using cookies.
 * This is the main method for cookie-based bookmark fetching.
 * Tries multiple query IDs if the primary one doesn't work.
 */
export async function getCookieBookmarks(
  cookies: CookieAuth,
  cursor?: string,
  count: number = 20
): Promise<CookiePaginatedResponse> {
  const queryIds = await discoverQueryIds();
  
  // Collect all query IDs to try (discovered + alternatives)
  const bookmarkQueryIds = [
    queryIds.Bookmarks,
    ...ALTERNATIVE_BOOKMARKS_IDS.filter(id => id !== queryIds.Bookmarks),
  ].filter(Boolean);

  const variables: Record<string, unknown> = {
    count,
    includePromotedContent: false,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  const body = {
    variables,
    features: BOOKMARKS_FEATURES,
  };

  let lastError: Error | null = null;

  for (const queryId of bookmarkQueryIds) {
    try {
      const result = await cookieFetch<any>(
        `/${queryId}/Bookmarks`,
        cookies,
        {
          method: 'GET',
          params: {
            variables: JSON.stringify(body.variables),
            features: JSON.stringify(body.features),
          },
        }
      );

      // Check if response has the expected structure
      if (result?.data?.viewer?.bookmarks_timeline !== undefined || 
          result?.data?.viewer !== undefined ||
          Array.isArray(result?.data)) {
        // Cache this working query ID
        cachedQueryIds.Bookmarks = queryId;
        return parseBookmarksResponse(result);
      }
      
      // If we get a response but it doesn't have the expected structure, try next ID
      lastError = new Error(`Unexpected response structure for query ID ${queryId}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // If it's a 401/403, the cookies are invalid - no point trying other IDs
      if (lastError.message.includes('Cookie authentication failed') || 
          lastError.message.includes('cookies may have expired')) {
        throw lastError;
      }
      // 404 means query ID is wrong, try next one
      if (lastError.message.includes('404') || lastError.message.includes('Query not found')) {
        continue;
      }
      // For other errors, try next ID
      continue;
    }
  }

  throw lastError || new Error('All bookmark query IDs failed. The X API query IDs may have changed.');
}

/**
 * Full sync: Fetch all bookmarks using cookies and return standardized posts.
 * Handles pagination automatically.
 */
export async function syncCookieBookmarks(
  cookies: CookieAuth,
  maxPages: number = 10,
  onPage?: (page: number, count: number) => void
): Promise<{
  posts: CookieBookmark[];
  totalPages: number;
  hasMore: boolean;
}> {
  const allPosts: CookieBookmark[] = [];
  let cursor: string | undefined = undefined;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    try {
      const result = await getCookieBookmarks(cookies, cursor, 50);

      if (result.data.length === 0) {
        hasMore = false;
        break;
      }

      allPosts.push(...result.data);
      hasMore = result.has_more;
      cursor = result.cursor || undefined;
      pageCount++;

      if (onPage) {
        onPage(pageCount, result.data.length);
      }

      // Small delay between pages to avoid rate limiting
      if (hasMore && pageCount < maxPages) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Cookie bookmark sync failed at page ${pageCount + 1}:`, error);
      if (allPosts.length > 0) {
        // Return what we have so far
        break;
      }
      throw error;
    }
  }

  return {
    posts: allPosts,
    totalPages: pageCount,
    hasMore,
  };
}

// ============================================================
// Response Parsing Helpers
// ============================================================

function extractUserInfo(data: any): CookieUserInfo | null {
  try {
    // Try different response structures
    const user = data?.data?.user?.result || data?.data?.user || data?.user?.result;

    if (!user) return null;

    const legacy = user.legacy || user;
    return {
      id: user.rest_id || user.id_str || user.id,
      name: legacy.name || '',
      username: legacy.screen_name || '',
      avatar_url: (legacy.profile_image_url_https || legacy.profile_image_url || '').replace('_normal', '_bigger'),
    };
  } catch {
    return null;
  }
}

function parseBookmarksResponse(data: any): CookiePaginatedResponse {
  const posts: CookieBookmark[] = [];
  let cursor: string | null = null;
  let hasMore = false;

  try {
    // Navigate the complex GraphQL response structure
    const instructions =
      data?.data?.viewer?.bookmarks_timeline?.timeline?.instructions || [];

    let entries: any[] = [];

    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries') {
        entries = instruction.entries || [];
      } else if (instruction.type === 'TimelineAddToModule') {
        // Sometimes entries come in a module
        const moduleItems = instruction.moduleItems || [];
        entries = entries.concat(moduleItems);
      }
    }

    for (const entry of entries) {
      // Check for cursor entries (pagination)
      const entryContent = entry?.content;
      if (entryContent?.cursorType === 'Bottom' || entryContent?.cursorType === 'Top') {
        if (entryContent.cursorType === 'Bottom') {
          cursor = entryContent.value || entryContent.entryId?.replace('cursor-bottom-', '') || null;
          hasMore = true;
        }
        continue;
      }

      // Extract tweet from entry
      try {
        const tweetResult =
          entryContent?.itemContent?.tweet_results?.result ||
          entryContent?.items?.[0]?.item?.itemContent?.tweet_results?.result;

        if (!tweetResult) continue;

        // Handle tweet with visibility results (retweet wrapper)
        const tweet = tweetResult.__typename === 'TweetWithVisibilityResults'
          ? tweetResult.tweet
          : tweetResult;

        const legacy = tweet?.legacy || tweet;
        const userLegacy = tweet?.core?.user_results?.result?.legacy ||
                          tweet?.core?.user_results?.result ||
                          tweet?.author;

        // Process media
        const media: CookieBookmark['media'] = [];
        const mediaEntries = legacy?.entities?.media || legacy?.extended_entities?.media || [];

        for (const m of mediaEntries) {
          if (m.type === 'photo') {
            media.push({
              url: m.media_url_https || m.media_url || '',
              type: 'photo',
              preview_url: m.media_url_https || m.media_url || '',
            });
          } else if (m.type === 'video' || m.type === 'animated_gif') {
            // Get the highest bitrate video variant
            const variants = m.video_info?.variants || [];
            const mp4Variants = variants
              .filter((v: any) => v.content_type === 'video/mp4')
              .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

            const videoUrl = mp4Variants.length > 0 ? mp4Variants[0].url : '';
            media.push({
              url: videoUrl,
              type: m.type === 'animated_gif' ? 'gif' : 'video',
              preview_url: m.media_url_https || m.media_url || '',
            });
          }
        }

        // Also check for media in tweet's own media object
        if (media.length === 0 && tweet?.media?.length) {
          for (const m of tweet.media) {
            media.push({
              url: m.media_url_https || m.media_url || '',
              type: m.type === 'animated_gif' ? 'gif' : (m.type || 'photo'),
              preview_url: m.media_url_https || m.media_url || '',
            });
          }
        }

        const bookmarkPost: CookieBookmark = {
          id: tweet.rest_id || legacy.id_str || entry.entryId?.replace('tweet-', '') || '',
          content: legacy.full_text || legacy.text || '',
          author: {
            id: userLegacy?.rest_id || userLegacy?.id_str || '',
            name: userLegacy?.name || '',
            username: userLegacy?.screen_name || '',
            avatar_url: (userLegacy?.profile_image_url_https || '').replace('_normal', '_bigger'),
          },
          media,
          metrics: {
            replies: legacy.reply_count || 0,
            reposts: legacy.retweet_count || 0,
            likes: legacy.favorite_count || 0,
            views: legacy.views?.count ? parseInt(legacy.views.count) : 0,
            bookmarks: legacy.bookmark_count || 0,
          },
          posted_at: legacy.created_at ? parseTwitterDate(legacy.created_at) : null,
          created_at: legacy.created_at || new Date().toISOString(),
          provider: 'cookie',
        };

        // Only add if we have at least an ID
        if (bookmarkPost.id) {
          posts.push(bookmarkPost);
        }
      } catch (err) {
        console.warn('Failed to parse bookmark entry:', err);
        continue;
      }
    }
  } catch (error) {
    console.error('Failed to parse bookmarks response:', error);
  }

  return {
    data: posts,
    cursor,
    has_more: hasMore,
    count: posts.length,
    provider: 'cookie',
  };
}

/**
 * Parse Twitter's date format ("Mon Jan 01 00:00:00 +0000 2024") to ISO string.
 */
function parseTwitterDate(dateStr: string): string | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

// ============================================================
// Transform to standard format (compatible with dual-provider)
// ============================================================

export function transformCookiePost(post: CookieBookmark) {
  return {
    xPostId: post.id,
    content: post.content || '',
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
    source: 'cookie' as const,
  };
}
