/**
 * X Cookie-Based API Client — Direct access to X's internal GraphQL API
 *
 * Uses auth_token + ct0 + twid cookies to make authenticated requests to X's
 * internal API endpoints (the same ones x.com's frontend uses).
 *
 * This eliminates the need for the Python Twikit service for cookie-based auth.
 * Works on Vercel serverless functions and any Node.js environment.
 */

// ============================================================
// Configuration
// ============================================================

// Public bearer token used by x.com's web client — we discover it dynamically
// Updated 2025-03: Current bearer token from x.com's main JS bundle
const FALLBACK_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const X_API_BASE = 'https://x.com/i/api/graphql';

// ============================================================
// Dynamic Bearer Token Discovery
// ============================================================

let cachedBearerToken: string | null = null;
let lastBearerFetch = 0;
const BEARER_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Discover the public bearer token from x.com's JavaScript bundles.
 * X rotates this token periodically when they update their frontend.
 */
async function discoverBearerToken(): Promise<string> {
  // Return cached if fresh
  if (cachedBearerToken && Date.now() - lastBearerFetch < BEARER_CACHE_TTL) {
    return cachedBearerToken;
  }

  try {
    // Fetch x.com's main page
    const response = await fetch('https://x.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

    // Search through JS bundles for the bearer token
    // The bearer token is a base64-encoded string that starts with "AAAAA"
    // It's typically in the "main" bundle
    const bundlesToSearch = jsUrls.slice(0, 8);

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

        // Pattern 1: Bearer token in "Bearer XXXXX" format (most reliable)
        const bearerMatch1 = js.match(/Bearer\s+(AAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%_]+)/);
        if (bearerMatch1) {
          cachedBearerToken = bearerMatch1[1];
          lastBearerFetch = Date.now();
          console.log('[x-cookie-api] Discovered bearer token from JS bundle (Bearer pattern)');
          return cachedBearerToken;
        }

        // Pattern 2: Bearer token in quotes — typically looks like "AAAAAAAAAAAAAAAAAAAAA..."
        const bearerMatch = js.match(/"((?:A{5,}[A-Za-z0-9%]+))"/);
        if (bearerMatch && bearerMatch[1].length > 50) {
          cachedBearerToken = bearerMatch[1];
          lastBearerFetch = Date.now();
          console.log('[x-cookie-api] Discovered bearer token from JS bundle');
          return cachedBearerToken;
        }

        // Pattern 3: bearerToken= or authorization:"Bearer ..."
        const bearerMatch2 = js.match(/(?:bearerToken|authorization)["\s:=]+"([^"]+)"/i);
        if (bearerMatch2) {
          cachedBearerToken = bearerMatch2[1].replace(/^Bearer\s+/i, '');
          lastBearerFetch = Date.now();
          console.log('[x-cookie-api] Discovered bearer token from JS bundle (pattern 3)');
          return cachedBearerToken;
        }
      } catch {
        continue;
      }
    }

    throw new Error('Could not find bearer token in JS bundles');
  } catch (error) {
    console.warn('[x-cookie-api] Failed to discover bearer token, using fallback:', error);
    cachedBearerToken = FALLBACK_BEARER;
    lastBearerFetch = Date.now();
    return FALLBACK_BEARER;
  }
}

// ============================================================
// Query ID Cache
// ============================================================

let cachedQueryIds: Record<string, string> = {};
let lastQueryIdFetch = 0;
const QUERY_ID_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Updated 2025-03: Current query IDs discovered from x.com's main JS bundle
// X renamed the Bookmarks operation to "BookmarkSearchTimeline" and changed the
// response path from viewer.bookmarks_timeline to search_by_raw_query.bookmarks_search_timeline
const FALLBACK_QUERY_IDS: Record<string, string> = {
  BookmarkSearchTimeline: '5kB8iO1n19yXfcxM4e30Nw',
  UserByScreenName: 'IGgvgiOx4QZndDHuD3x9TQ',
  UserByRestId: 'VQfQ9wwYdk6j_u2O4vt64Q',
  Viewer: '_8ClT24oZ8tpylf_OSuNdg',
};

// Alternative query IDs to try if the primary one doesn't work
// These include older IDs that may still be accepted
const ALTERNATIVE_BOOKMARKS_IDS = [
  '5kB8iO1n19yXfcxM4e30Nw',
];

const DISCOVER_TIMEOUT_MS = 10000;

async function discoverQueryIdsSafe(): Promise<Record<string, string>> {
  try {
    const result = await Promise.race([
      discoverQueryIds(),
      new Promise<Record<string, string>>((_, reject) =>
        setTimeout(() => reject(new Error('Query ID discovery timed out')), DISCOVER_TIMEOUT_MS)
      ),
    ]);
    return result;
  } catch (error) {
    console.warn('[x-cookie-api] discoverQueryIds failed or timed out, using fallback IDs:', error instanceof Error ? error.message : error);
    return { ...FALLBACK_QUERY_IDS, ...cachedQueryIds };
  }
}

async function discoverQueryIds(): Promise<Record<string, string>> {
  if (Object.keys(cachedQueryIds).length > 0 && Date.now() - lastQueryIdFetch < QUERY_ID_CACHE_TTL) {
    return cachedQueryIds;
  }

  try {
    const response = await fetch('https://x.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

    const jsUrls: string[] = [];
    const jsRegex = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^\s"']+\.js/g;
    let match;
    while ((match = jsRegex.exec(html)) !== null) {
      jsUrls.push(match[0]);
    }

    if (jsUrls.length === 0) {
      throw new Error('Could not find JS bundle URLs');
    }

    const queryIds: Record<string, string> = {};
    // Search main bundle first (most likely to contain query IDs)
    const bundlesToSearch = jsUrls.slice(0, 8);

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

        // X renamed the operation from "Bookmarks" to "BookmarkSearchTimeline"
        // Try both names for compatibility
        if (!queryIds.BookmarkSearchTimeline) {
          const bookmarksMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"BookmarkSearchTimeline"/);
          if (bookmarksMatch) {
            queryIds.BookmarkSearchTimeline = bookmarksMatch[1];
          }
        }

        // Fallback: try old "Bookmarks" operation name
        if (!queryIds.BookmarkSearchTimeline && !queryIds.Bookmarks) {
          const oldMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"Bookmarks"/);
          if (oldMatch) {
            queryIds.Bookmarks = oldMatch[1];
          }
        }

        if (!queryIds.UserByScreenName) {
          const userMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"UserByScreenName"/);
          if (userMatch) {
            queryIds.UserByScreenName = userMatch[1];
          }
        }

        if (!queryIds.UserByRestId) {
          const userRestMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"UserByRestId"/);
          if (userRestMatch) {
            queryIds.UserByRestId = userRestMatch[1];
          }
        }

        if (!queryIds.Viewer) {
          const viewerMatch = js.match(/queryId:"([^"]+)"[^}]*operationName:"Viewer"/);
          if (viewerMatch) {
            queryIds.Viewer = viewerMatch[1];
          }
        }

        const bookmarksReady = queryIds.BookmarkSearchTimeline || queryIds.Bookmarks;
        if (bookmarksReady && queryIds.UserByScreenName && queryIds.UserByRestId) {
          break;
        }
      } catch {
        continue;
      }
    }

    const result = { ...FALLBACK_QUERY_IDS, ...queryIds };

    if (Object.keys(result).length > 0) {
      cachedQueryIds = result;
      lastQueryIdFetch = Date.now();
    }

    return result;
  } catch (error) {
    console.warn('[x-cookie-api] Failed to discover query IDs, using fallbacks:', error);
    return { ...FALLBACK_QUERY_IDS, ...cachedQueryIds };
  }
}

// ============================================================
// Types
// ============================================================

export interface CookieAuth {
  auth_token: string;
  ct0: string;
  twid?: string; // Optional but recommended — X now requires this
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

export interface CookieValidationResult {
  valid: boolean;
  user: CookieUserInfo | null;
  error?: string;
  details?: {
    auth_token_length: number;
    ct0_length: number;
    twid_provided: boolean;
    bearer_token_source: string;
    api_status: number;
    api_message: string;
  };
}

// ============================================================
// Cookie Normalization
// ============================================================

/**
 * Normalize cookie values — trim whitespace, decode URL-encoding, etc.
 */
export function normalizeCookies(cookies: CookieAuth): CookieAuth {
  let auth_token = cookies.auth_token.trim();
  let ct0 = cookies.ct0.trim();
  let twid = cookies.twid?.trim();

  // URL-decode ct0 if it's encoded (e.g. %3D → =)
  try {
    if (ct0.includes('%')) {
      const decoded = decodeURIComponent(ct0);
      if (/^[a-zA-Z0-9|=]+$/.test(decoded)) {
        ct0 = decoded;
      }
    }
  } catch {
    // If decode fails, use the original
  }

  // Same for auth_token
  try {
    if (auth_token.includes('%')) {
      const decoded = decodeURIComponent(auth_token);
      if (/^[a-zA-Z0-9]+$/.test(decoded)) {
        auth_token = decoded;
      }
    }
  } catch {
    // If decode fails, use the original
  }

  // Same for twid
  if (twid) {
    try {
      if (twid.includes('%')) {
        twid = decodeURIComponent(twid);
      }
    } catch {
      // If decode fails, use the original
    }
  }

  return { auth_token, ct0, twid };
}

/**
 * Construct a twid cookie value from a user ID.
 * Format: u=1234567890 (URL-encoded: u%3D1234567890)
 */
export function constructTwid(userId: string): string {
  return `u=${userId}`;
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

  // Normalize cookie values before using them
  const normalized = normalizeCookies(cookies);

  // Get the bearer token (discovered dynamically or fallback)
  const bearerToken = await discoverBearerToken();

  const url = new URL(`${X_API_BASE}${path}`);

  // Add query parameters
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  // Build cookie string — include twid if available
  let cookieStr = `auth_token=${normalized.auth_token}; ct0=${normalized.ct0}`;
  if (normalized.twid) {
    cookieStr += `; twid=${encodeURIComponent(normalized.twid)}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Cookie': cookieStr,
      'X-CSRF-TOKEN': normalized.ct0,
      'X-Twitter-Auth-Type': 'OAuth2Session', // CRITICAL: Required for cookie-based auth
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Origin': 'https://x.com',
      'Referer': 'https://x.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  // Add timeout (15 seconds)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
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
    // Provide detailed diagnostics
    const errorBody = await response.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(errorBody);
      detail = parsed?.errors?.[0]?.message || parsed?.detail || '';
    } catch {
      detail = errorBody.substring(0, 200);
    }
    
    const normCookies = normalizeCookies(cookies);
    const authLength = normCookies.auth_token.length;
    const ct0Length = normCookies.ct0.length;
    const ct0HasPercent = cookies.ct0.includes('%');
    const hasTwid = !!normCookies.twid;
    
    let hint = '';
    if (!hasTwid) {
      hint += ' WARNING: No twid cookie provided. X now requires the twid cookie for authentication. Please copy the twid cookie value from your browser (it starts with u= or %7B).';
    }
    if (ct0HasPercent) {
      hint += ' NOTE: Your ct0 cookie contained URL-encoded characters (%), which were auto-decoded.';
    }
    if (authLength < 20 || ct0Length < 20) {
      hint += ' WARNING: One of your cookie values seems too short — make sure you copied the complete value.';
    }
    
    console.error(`[Cookie Auth Failed] Status: ${response.status}, auth_token length: ${authLength}, ct0 length: ${ct0Length}, twid provided: ${hasTwid}, URL-encoded ct0: ${ct0HasPercent}, Bearer source: ${cachedBearerToken ? 'discovered' : 'fallback'}, Response: ${detail}`);
    
    throw new Error(
      `Cookie authentication failed (HTTP ${response.status}). ${detail ? `X says: "${detail}". ` : ''}` +
      `${!hasTwid ? 'Missing twid cookie — this is now required by X. ' : ''}` +
      `Your cookies may have expired. Please reconnect your X account with fresh cookies.${hint}`
    );
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

// Updated 2025-03: Features extracted from x.com's main JS bundle for BookmarkSearchTimeline
const BOOKMARKS_FEATURES = {
  rweb_video_screen_enabled: true,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: true,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

// Field toggles required by BookmarkSearchTimeline
const BOOKMARKS_FIELD_TOGGLES = {
  withPayments: true,
  withAuxiliaryUserLabels: true,
  withArticleRichContentState: true,
  withArticlePlainText: true,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
  withGrokAnalyze: true,
  withDisallowedReplyControls: true,
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
 * Validate cookies with detailed diagnostics.
 * Returns validation result with user info if valid.
 */
export async function validateCookiesDetailed(cookies: CookieAuth): Promise<CookieValidationResult> {
  const normalized = normalizeCookies(cookies);
  const bearerToken = await discoverBearerToken();
  
  const details = {
    auth_token_length: normalized.auth_token.length,
    ct0_length: normalized.ct0.length,
    twid_provided: !!normalized.twid,
    bearer_token_source: cachedBearerToken ? 'discovered' : 'fallback',
    api_status: 0,
    api_message: '',
  };

  // First, try the simple v1.1 endpoint for user validation
  try {
    let cookieStr = `auth_token=${normalized.auth_token}; ct0=${normalized.ct0}`;
    if (normalized.twid) {
      cookieStr += `; twid=${encodeURIComponent(normalized.twid)}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.x.com/1.1/account/verify_credentials.json', {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Cookie': cookieStr,
        'X-CSRF-TOKEN': normalized.ct0,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://x.com',
        'Referer': 'https://x.com/',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    details.api_status = response.status;

    if (response.ok) {
      const data = await response.json();
      const userInfo: CookieUserInfo = {
        id: data.id_str || data.id?.toString(),
        name: data.name,
        username: data.screen_name,
        avatar_url: data.profile_image_url_https?.replace('_normal', '_bigger') || '',
      };

      return {
        valid: true,
        user: userInfo,
        details,
      };
    }

    // Parse error response
    const errorBody = await response.text().catch(() => '');
    let errorMsg = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      errorMsg = parsed?.errors?.[0]?.message || parsed?.detail || errorMsg;
    } catch {
      errorMsg = errorBody.substring(0, 100) || errorMsg;
    }
    details.api_message = errorMsg;

    // If 401/403 and no twid was provided, try with a constructed twid
    if ((response.status === 401 || response.status === 403) && !normalized.twid) {
      return {
        valid: false,
        user: null,
        error: `Cookie authentication failed (${errorMsg}). Missing twid cookie — X now requires all three cookies (auth_token, ct0, twid). Please copy the twid value from your browser cookies.`,
        details,
      };
    }

    return {
      valid: false,
      user: null,
      error: `Cookie authentication failed: ${errorMsg}. Your cookies may have expired — please reconnect with fresh cookies.`,
      details,
    };
  } catch (error) {
    details.api_message = error instanceof Error ? error.message : 'Unknown error';
    return {
      valid: false,
      user: null,
      error: `Could not reach X API: ${details.api_message}. Check your network connection.`,
      details,
    };
  }
}

/**
 * Validate cookies by fetching the current user info.
 * Returns user info if cookies are valid, null otherwise.
 */
export async function validateCookies(cookies: CookieAuth): Promise<CookieUserInfo | null> {
  try {
    const result = await validateCookiesDetailed(cookies);
    return result.valid ? result.user : null;
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
    // Normalize cookies first
    const normalized = normalizeCookies(cookies);
    const bearerToken = await discoverBearerToken();
    
    // Build cookie string — include twid if available
    let cookieStr = `auth_token=${normalized.auth_token}; ct0=${normalized.ct0}`;
    if (normalized.twid) {
      cookieStr += `; twid=${encodeURIComponent(normalized.twid)}`;
    }

    // Try the v1.1 verify_credentials endpoint first (more reliable)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch('https://api.x.com/1.1/account/verify_credentials.json', {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Cookie': cookieStr,
          'X-CSRF-TOKEN': normalized.ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Origin': 'https://x.com',
          'Referer': 'https://x.com/',
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
      
      console.warn(`[x-cookie-api] verify_credentials returned ${response.status}, trying GraphQL fallback`);
    } catch (err) {
      console.warn('[x-cookie-api] verify_credentials failed, trying GraphQL fallback:', err);
    }

    // Fallback: GraphQL approach
    const queryIds = await discoverQueryIdsSafe();
    const queryId = queryIds.UserByRestId || FALLBACK_QUERY_IDS.UserByRestId;

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
  const queryIds = await discoverQueryIdsSafe();
  
  // X renamed the operation from "Bookmarks" to "BookmarkSearchTimeline"
  // Try the new name first, then fall back to the old one
  const bookmarkQueryId = queryIds.BookmarkSearchTimeline || queryIds.Bookmarks;
  
  // Collect all query IDs to try (discovered + alternatives)
  const bookmarkQueryIds = [
    bookmarkQueryId,
    ...ALTERNATIVE_BOOKMARKS_IDS.filter(id => id !== bookmarkQueryId),
  ].filter(Boolean);

  // BookmarkSearchTimeline uses rawQuery and querySource variables
  const variables: Record<string, unknown> = {
    rawQuery: '',
    count,
    querySource: '',
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  let lastError: Error | null = null;

  for (const queryId of bookmarkQueryIds) {
    // Determine the operation name:
    // - If the queryId was discovered as BookmarkSearchTimeline, use that name
    // - If it was discovered as Bookmarks (old), use that name  
    // - For the fallback ID, use BookmarkSearchTimeline
    let operationName = 'BookmarkSearchTimeline';
    if (queryId === queryIds.Bookmarks && queryId !== queryIds.BookmarkSearchTimeline) {
      operationName = 'Bookmarks'; // Only use old name if this is explicitly the old Bookmarks ID
    }
    
    try {
      const result = await cookieFetch<any>(
        `/${queryId}/${operationName}`,
        cookies,
        {
          method: 'GET',
          params: {
            variables: JSON.stringify(variables),
            features: JSON.stringify(BOOKMARKS_FEATURES),
            fieldToggles: JSON.stringify(BOOKMARKS_FIELD_TOGGLES),
          },
        }
      );

      // Check if response has the expected structure
      // New API: search_by_raw_query.bookmarks_search_timeline.timeline
      // Old API: viewer.bookmarks_timeline.timeline
      if (result?.data?.search_by_raw_query?.bookmarks_search_timeline !== undefined ||
          result?.data?.viewer?.bookmarks_timeline !== undefined ||
          result?.data?.viewer !== undefined ||
          Array.isArray(result?.data)) {
        // Cache this working query ID
        cachedQueryIds.BookmarkSearchTimeline = queryId;
        return parseBookmarksResponse(result);
      }
      
      // If we get a response but it doesn't have the expected structure, try next ID
      lastError = new Error(`Unexpected response structure for query ID ${queryId}`);
      console.warn(`[x-cookie-api] Unexpected response for ${queryId}/${operationName}:`, JSON.stringify(result).substring(0, 300));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // If it's a 401/403, the cookies are invalid - no point trying other IDs
      if (lastError.message.includes('Cookie authentication failed') || 
          lastError.message.includes('cookies may have expired')) {
        throw lastError;
      }
      // 404 means query ID is wrong, try next one
      if (lastError.message.includes('404') || lastError.message.includes('Query not found')) {
        console.warn(`[x-cookie-api] Query ID ${queryId} not found (404), trying next...`);
        continue;
      }
      // For other errors, try next ID
      console.warn(`[x-cookie-api] Error for ${queryId}/${operationName}:`, lastError.message);
      continue;
    }
  }

  throw lastError || new Error('All bookmark query IDs failed. The X API query IDs may have changed. Your cookies may also need refreshing — try reconnecting your X account.');
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
      const syncErrMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cookie bookmark sync failed: ${syncErrMsg}. Your cookies may need refreshing — try reconnecting your X account.`
      );
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
    // New API path: data.search_by_raw_query.bookmarks_search_timeline.timeline.instructions
    // Old API path: data.viewer.bookmarks_timeline.timeline.instructions
    const instructions =
      data?.data?.search_by_raw_query?.bookmarks_search_timeline?.timeline?.instructions ||
      data?.data?.viewer?.bookmarks_timeline?.timeline?.instructions || [];

    let entries: any[] = [];

    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries') {
        entries = instruction.entries || [];
      } else if (instruction.type === 'TimelineAddToModule') {
        const moduleItems = instruction.moduleItems || [];
        entries = entries.concat(moduleItems);
      }
    }

    for (const entry of entries) {
      const entryContent = entry?.content;
      if (entryContent?.cursorType === 'Bottom' || entryContent?.cursorType === 'Top') {
        if (entryContent.cursorType === 'Bottom') {
          cursor = entryContent.value || entryContent.entryId?.replace('cursor-bottom-', '') || null;
          hasMore = true;
        }
        continue;
      }

      try {
        const tweetResult =
          entryContent?.itemContent?.tweet_results?.result ||
          entryContent?.items?.[0]?.item?.itemContent?.tweet_results?.result;

        if (!tweetResult) continue;

        const tweet = tweetResult.__typename === 'TweetWithVisibilityResults'
          ? tweetResult.tweet
          : tweetResult;

        const legacy = tweet?.legacy || tweet;
        const userLegacy = tweet?.core?.user_results?.result?.legacy ||
                          tweet?.core?.user_results?.result ||
                          tweet?.author;

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
