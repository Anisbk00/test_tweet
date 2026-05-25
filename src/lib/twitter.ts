// Twitter/X service proxy - communicates with the Python twikit-service on port 3031

const TWIKIT_PORT = 3031;

interface TwikitBookmark {
  id: string;
  text: string;
  author_id: string;
  author_name: string;
  author_username: string;
  author_avatar: string;
  media_urls: string[];
  media_types: string[];
  reply_count: number;
  repost_count: number;
  like_count: number;
  view_count: number;
  bookmark_count: number;
  created_at: string;
}

interface TwikitSyncResponse {
  bookmarks: TwikitBookmark[];
  count: number;
  has_more: boolean;
  last_cursor: string;
}

export async function fetchBookmarksFromTwitter(
  userId: string,
  cursor?: string,
  limit: number = 50
): Promise<TwikitSyncResponse> {
  try {
    const params = new URLSearchParams({
      user_id: userId,
      limit: limit.toString(),
    });
    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = await fetch(
      `/api/bookmarks?${params.toString()}&XTransformPort=${TWIKIT_PORT}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Twikit service error: ${response.status}`);
    }

    const data = await response.json();
    return data as TwikitSyncResponse;
  } catch (error) {
    console.error('Failed to fetch bookmarks from Twitter:', error);
    return {
      bookmarks: [],
      count: 0,
      has_more: false,
      last_cursor: '',
    };
  }
}

export async function triggerFullSync(userId: string): Promise<{
  success: boolean;
  syncedCount: number;
  error?: string;
}> {
  try {
    const response = await fetch(
      `/api/sync?XTransformPort=${TWIKIT_PORT}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId }),
      }
    );

    if (!response.ok) {
      throw new Error(`Twikit sync error: ${response.status}`);
    }

    const data = await response.json();
    return {
      success: true,
      syncedCount: data.count || 0,
    };
  } catch (error) {
    console.error('Failed to trigger full sync:', error);
    return {
      success: false,
      syncedCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function checkTwikitHealth(): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/health?XTransformPort=${TWIKIT_PORT}`,
      {
        method: 'GET',
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}
