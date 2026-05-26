/**
 * Twitter/X service proxy - communicates with the Python Twikit service.
 *
 * The Python service is OPTIONAL for Vercel deployment. When TWIKIT_SERVICE_URL
 * is not set, only the direct X API v2 client (src/lib/x-api.ts) is used.
 *
 * When available, the service provides:
 * 1. Twikit (cookie-based auth) - fallback for X API v2
 * 2. Additional endpoints like media search
 *
 * Configuration:
 * - TWIKIT_SERVICE_URL: Full URL of the Python service (e.g., "https://twikit-service.railway.app")
 *   If not set, Twikit features are unavailable.
 */

// ============================================================
// Service Connection
// ============================================================

function getServiceUrl(): string | null {
  const url = process.env.TWIKIT_SERVICE_URL;
  if (!url) return null;
  return url.replace(/\/$/, ''); // Remove trailing slash
}

function isServiceAvailable(): boolean {
  return !!getServiceUrl();
}

async function serviceFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getServiceUrl();
  if (!baseUrl) {
    throw new Error('Twikit service is not configured. Set TWIKIT_SERVICE_URL environment variable.');
  }

  const url = `${baseUrl}${path}`;

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
// Service Health Check
// ============================================================

export async function twikitHealthCheck(): Promise<{
  status: string;
  service: string;
  version: string;
} | null> {
  if (!isServiceAvailable()) return null;

  try {
    return await serviceFetch('/health');
  } catch {
    return null;
  }
}

export function isTwikitAvailable(): boolean {
  return isServiceAvailable();
}

// ============================================================
// Twikit Auth (Cookie-based)
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
// X API v2 Auth via Python Service (OAuth 2.0 PKCE)
// ============================================================

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

export async function xApiGetAuthConfig() {
  if (!isServiceAvailable()) {
    return {
      has_bearer_token: !!process.env.X_API_BEARER_TOKEN,
      has_oauth1_credentials: !!process.env.X_API_KEY && !!process.env.X_ACCESS_TOKEN,
      has_oauth2_credentials: !!process.env.X_CLIENT_ID,
      available_methods: ['x_api_direct'],
    };
  }

  return serviceFetch<{
    has_bearer_token: boolean;
    has_oauth1_credentials: boolean;
    has_oauth2_credentials: boolean;
    available_methods: string[];
  }>('/auth/config');
}

// ============================================================
// Data Types (shared between X API direct and Twikit)
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

// ============================================================
// Bookmarks (via Twikit service)
// ============================================================

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
// Timeline (via Twikit service)
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
// Media (via Twikit service)
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
// Lists (via Twikit service)
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
// Network (via Twikit service)
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
