/**
 * Twitter/X service proxy - communicates with the Python twikit-service on port 3031.
 *
 * The twikit-service returns data in this format:
 * {
 *   data: [{
 *     id: string,
 *     content: string,
 *     author: { id, name, username, avatar_url },
 *     media: [{ url, type, preview_url }],
 *     metrics: { replies, reposts, likes, views, bookmarks },
 *     posted_at: string,
 *     created_at: string
 *   }],
 *   cursor: string | null,
 *   has_more: boolean,
 *   count: number
 * }
 */

const TWIKIT_PORT = 3031;
const TWIKIT_BASE = `http://127.0.0.1:${TWIKIT_PORT}`;

async function twikitFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Always called from Next.js server-side API routes, so use direct localhost
  const url = `${TWIKIT_BASE}${path}`;

  // Add abort controller with 10s timeout to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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
      throw new Error(error.error || error.detail || `Twikit error: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// --- Auth ---

export async function twikitLoginWithCookies(
  userId: string,
  cookies: { auth_token: string; ct0: string; guest_id?: string; twid?: string },
  username?: string
) {
  return twikitFetch<{
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
  return twikitFetch<{
    authenticated: boolean;
    user_id: string | null;
    username: string | null;
    last_validated_at: number | null;
  }>(`/auth/status?user_id=${userId}`);
}

export async function twikitLogout(userId: string) {
  return twikitFetch<{ success: boolean; message: string }>(
    `/auth/logout?user_id=${userId}`,
    { method: 'POST' }
  );
}

// --- Bookmarks ---

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
}

export interface TwikitPaginatedResponse {
  data: TwikitPost[];
  cursor: string | null;
  has_more: boolean;
  count: number;
}

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
  return twikitFetch<TwikitPaginatedResponse>(`/bookmarks?${params}`);
}

export async function twikitSyncBookmarks(
  userId: string,
  fullSync: boolean = false
): Promise<{ success: boolean; message: string; task_id: string }> {
  return twikitFetch('/bookmarks/sync', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, full_sync: fullSync }),
  });
}

export async function twikitGetBookmarkSyncStatus(userId: string) {
  return twikitFetch(`/bookmarks/sync/status?user_id=${userId}`);
}

// --- Timeline ---

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
  return twikitFetch<TwikitPaginatedResponse>(`/timeline?${params}`);
}

// --- Media ---

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
  return twikitFetch<TwikitPaginatedResponse>(`/media/bookmarks?${params}`);
}

// --- Lists ---

export async function twikitGetLists(userId: string): Promise<TwikitPaginatedResponse> {
  return twikitFetch<TwikitPaginatedResponse>(`/lists?user_id=${userId}`);
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
  return twikitFetch<TwikitPaginatedResponse>(`/lists/${listId}/tweets?${params}`);
}

// --- Network ---

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
  return twikitFetch<TwikitPaginatedResponse>(`/network/following?${params}`);
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
  return twikitFetch<TwikitPaginatedResponse>(`/network/followers?${params}`);
}

// --- Health ---

export async function twikitHealthCheck(): Promise<{
  status: string;
  service: string;
  version: string;
}> {
  return twikitFetch('/health');
}

// --- Transform twikit post to DB format ---

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
  };
}
