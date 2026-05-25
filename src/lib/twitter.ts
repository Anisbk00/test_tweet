/**
 * Twitter/X service proxy - communicates with the Python dual-provider service on port 3031.
 *
 * The service supports two providers:
 * 1. X API v2 (primary) - OAuth 2.0 PKCE flow with access/refresh tokens
 * 2. Twikit (fallback) - Cookie-based authentication
 *
 * The service returns bookmark data in this format:
 * {
 *   data: [{
 *     id: string,
 *     content: string,
 *     author: { id, name, username, avatar_url },
 *     media: [{ url, type, preview_url }],
 *     metrics: { replies, reposts, likes, views, bookmarks },
 *     posted_at: string,
 *     created_at: string,
 *     provider: 'x_api' | 'twikit'
 *   }],
 *   cursor: string | null,
 *   has_more: boolean,
 *   count: number
 * }
 */

const SERVICE_PORT = 3031;
const SERVICE_BASE = `http://127.0.0.1:${SERVICE_PORT}`;

async function serviceFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Always called from Next.js server-side API routes, so use direct localhost
  const url = `${SERVICE_BASE}${path}`;

  // Add abort controller with 15s timeout to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string>),
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || error.detail || `Service error: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Twikit Auth (Cookie-based) — existing functions kept as-is
// ============================================================

export async function twikitLoginWithCookies(
  userId: string,
  cookies: { auth_token: string; ct0: string; guest_id?: string; twid?: string },
  username?: string
) {
  return serviceFetch<{
    success: boolean;
    user_id: string;
    username: string | null;
    message: string;
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, cookies, username }),
  });
}

export async function twikitAuthStatus(userId: string) {
  return serviceFetch<{
    authenticated: boolean;
    user_id: string | null;
    username: string | null;
    last_validated_at: number | null;
  }>(`/auth/status?user_id=${userId}`);
}

export async function twikitLogout(userId: string) {
  return serviceFetch<{ success: boolean; message: string }>(
    `/auth/logout?user_id=${userId}`,
    { method: 'POST' }
  );
}

// ============================================================
// X API v2 Auth (OAuth 2.0 PKCE)
// ============================================================

/**
 * Login to the Python service using OAuth 2.0 tokens obtained from X.
 * This stores the tokens in the Python service's session so it can make
 * API calls on behalf of the user.
 */
export async function xApiLoginWithOAuth2(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  xUserId: string,
  username: string
) {
  return serviceFetch<{
    success: boolean;
    user_id: string;
    username: string | null;
    x_user_id: string | null;
    auth_method: string;
    message: string;
  }>('/auth/login/oauth2', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      x_user_id: xUserId,
      username,
    }),
  });
}

/**
 * Get the OAuth 2.0 authorization URL for X.
 * Returns the URL to redirect the user to, along with the PKCE code_verifier
 * and state that must be stored securely for the callback.
 */
export async function xApiGetOAuth2AuthorizeUrl(
  redirectUri?: string,
  scope?: string
) {
  return serviceFetch<{
    authorize_url: string;
    code_verifier: string;
    state: string;
  }>('/auth/oauth2/authorize-url', {
    method: 'POST',
    body: JSON.stringify({
      redirect_uri: redirectUri,
      scope: scope,
    }),
  });
}

/**
 * Exchange the OAuth 2.0 authorization code for tokens.
 * Called after the user authorizes the app on X and is redirected back.
 * Returns access_token, refresh_token, expires_in but NOT user info.
 * User info is obtained by calling xApiLoginWithOAuth2 after this.
 */
export async function xApiOAuth2Callback(
  code: string,
  codeVerifier: string,
  redirectUri?: string
) {
  return serviceFetch<{
    success: boolean;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  }>('/auth/oauth2/callback', {
    method: 'POST',
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });
}

/**
 * Refresh an expired OAuth 2.0 access token using the refresh token.
 */
export async function xApiRefreshOAuth2Token(refreshToken: string) {
  return serviceFetch<{
    success: boolean;
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>(`/auth/oauth2/refresh?refresh_token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
  });
}

/**
 * Get the current auth configuration from the Python service.
 * Returns which auth methods are available and configured.
 */
export async function xApiGetAuthConfig() {
  return serviceFetch<{
    has_bearer_token: boolean;
    has_oauth1_credentials: boolean;
    has_oauth2_credentials: boolean;
    available_methods: string[];
  }>('/auth/config');
}

// ============================================================
// Bookmarks (dual-provider)
// ============================================================

export interface TwikitPost {
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
  provider?: 'x_api' | 'twikit';
}

export interface TwikitPaginatedResponse {
  data: TwikitPost[];
  cursor: string | null;
  has_more: boolean;
  count: number;
  provider?: 'x_api' | 'twikit';
}

/**
 * Get bookmarks from the Python service using dual-provider support.
 * The service automatically selects the best available provider:
 * - X API v2 (primary) if OAuth 2.0 tokens are available
 * - Twikit (fallback) if cookies are available
 */
export async function twikitGetBookmarks(
  userId: string,
  cursor?: string,
  limit: number = 20
): Promise<TwikitPaginatedResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    limit: limit.toString(),
  });
  if (cursor) params.set('cursor', cursor);
  return serviceFetch<TwikitPaginatedResponse>(`/bookmarks?${params}`);
}

export async function twikitSyncBookmarks(
  userId: string,
  fullSync: boolean = false
): Promise<{ success: boolean; message: string; task_id: string }> {
  return serviceFetch('/bookmarks/sync', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, full_sync: fullSync }),
  });
}

export async function twikitGetBookmarkSyncStatus(userId: string) {
  return serviceFetch(`/bookmarks/sync/status?user_id=${userId}`);
}

// ============================================================
// Timeline
// ============================================================

export async function twikitGetTimeline(
  userId: string,
  cursor?: string,
  limit: number = 20
): Promise<TwikitPaginatedResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    limit: limit.toString(),
  });
  if (cursor) params.set('cursor', cursor);
  return serviceFetch<TwikitPaginatedResponse>(`/timeline?${params}`);
}

// ============================================================
// Media
// ============================================================

export async function twikitGetBookmarkMedia(
  userId: string,
  cursor?: string,
  limit: number = 20
): Promise<TwikitPaginatedResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    limit: limit.toString(),
  });
  if (cursor) params.set('cursor', cursor);
  return serviceFetch<TwikitPaginatedResponse>(`/media/bookmarks?${params}`);
}

// ============================================================
// Lists
// ============================================================

export async function twikitGetLists(userId: string): Promise<TwikitPaginatedResponse> {
  return serviceFetch<TwikitPaginatedResponse>(`/lists?user_id=${userId}`);
}

export async function twikitGetListTweets(
  userId: string,
  listId: string,
  cursor?: string,
  limit: number = 20
): Promise<TwikitPaginatedResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    limit: limit.toString(),
  });
  if (cursor) params.set('cursor', cursor);
  return serviceFetch<TwikitPaginatedResponse>(`/lists/${listId}/tweets?${params}`);
}

// ============================================================
// Network
// ============================================================

export async function twikitGetFollowing(
  userId: string,
  targetUserId: string,
  cursor?: string,
  limit: number = 20
): Promise<TwikitPaginatedResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    target_user_id: targetUserId,
    limit: limit.toString(),
  });
  if (cursor) params.set('cursor', cursor);
  return serviceFetch<TwikitPaginatedResponse>(`/network/following?${params}`);
}

export async function twikitGetFollowers(
  userId: string,
  targetUserId: string,
  cursor?: string,
  limit: number = 20
): Promise<TwikitPaginatedResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    target_user_id: targetUserId,
    limit: limit.toString(),
  });
  if (cursor) params.set('cursor', cursor);
  return serviceFetch<TwikitPaginatedResponse>(`/network/followers?${params}`);
}

// ============================================================
// Health
// ============================================================

export async function twikitHealthCheck(): Promise<{
  status: string;
  service: string;
  version: string;
}> {
  return serviceFetch('/health');
}

// ============================================================
// Transform twikit post to DB format
// ============================================================

export function transformTwikitPost(post: TwikitPost) {
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
    source: (post.provider || 'x_api') as 'x_api' | 'twikit',
  };
}
