import { useAppStore } from './store';

const API_BASE = '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useAppStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: 'Request failed' }));
    const errorMsg = errorBody.error || `HTTP ${res.status}`;

    // Special handling for 401 — suggest re-authentication
    if (res.status === 401) {
      // Auto-logout on authenticated endpoints (but not /auth/me which is handled by the caller)
      if (token && !path.startsWith('/auth/')) {
        useAppStore.getState().logout();
        if (typeof window !== 'undefined') {
          window.location.href = '/';
        }
      }
      throw new Error(`Authentication required: ${errorMsg}. Please log in again.`);
    }

    // Special handling for 500 from sync endpoints — surface the underlying message with guidance
    if (res.status === 500 && path.includes('/sync')) {
      throw new Error(`Sync failed: ${errorMsg}. If you used cookie-based auth, your cookies may have expired — try reconnecting your X account.`);
    }

    // Generic friendly message for other server errors
    if (res.status === 500) {
      throw new Error(`Server error: ${errorMsg}. Please try again later.`);
    }

    throw new Error(errorMsg);
  }

  return res.json();
}

// Auth
export const auth = {
  register: (email: string, password: string, name: string) =>
    apiFetch<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => apiFetch<any>('/auth/me'),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  connectTwitter: (authToken: string, ct0: string) =>
    apiFetch<{ success: boolean; username?: string }>('/auth/connect-twitter', {
      method: 'POST',
      body: JSON.stringify({ authToken, ct0 }),
    }),
  disconnectTwitter: () =>
    apiFetch<{ success: boolean }>('/auth/disconnect-twitter', {
      method: 'POST',
    }),
  connectXOAuth2: () => {
    // Initiate OAuth 2.0 PKCE flow by redirecting to the authorize endpoint
    // The backend will redirect to X's OAuth page
    const token = useAppStore.getState().token;
    window.location.href = `/api/auth/x/authorize${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
  getXConfig: () => apiFetch<{
    configured: boolean;
    method: string | null;
    hasOAuth2: boolean;
    hasOAuth1: boolean;
    hasBearerToken: boolean;
    hasTwikit: boolean;
  }>('/auth/x/config'),
};

// Bookmarks
export const bookmarks = {
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch<{ bookmarks: any[]; data?: any[]; pagination: any }>(`/bookmarks${query}`);
  },
  get: (id: string) => apiFetch<any>(`/bookmarks/${id}`),
  sync: () => apiFetch<any>('/bookmarks/sync', { method: 'POST' }),
  update: (id: string, data: any) =>
    apiFetch<any>(`/bookmarks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/bookmarks/${id}`, { method: 'DELETE' }),
};

// Collections
export const collections = {
  list: () => apiFetch<any[]>('/collections'),
  create: (data: any) =>
    apiFetch<any>('/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: any) =>
    apiFetch<any>(`/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/collections/${id}`, { method: 'DELETE' }),
  addBookmarks: (id: string, bookmarkIds: string[]) =>
    apiFetch<any>(`/collections/${id}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify({ bookmarkIds }),
    }),
  removeBookmarks: (id: string, bookmarkIds: string[]) =>
    apiFetch<any>(`/collections/${id}/bookmarks`, {
      method: 'DELETE',
      body: JSON.stringify({ bookmarkIds }),
    }),
  reorder: (order: { id: string; sortOrder: number }[]) =>
    apiFetch<void>('/collections/reorder', {
      method: 'POST',
      body: JSON.stringify({ order }),
    }),
};

// Tags
export const tags = {
  list: () => apiFetch<any[]>('/tags'),
  create: (name: string, color?: string) =>
    apiFetch<any>('/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  delete: (id: string) => apiFetch<void>(`/tags/${id}`, { method: 'DELETE' }),
  addToBookmarks: (id: string, bookmarkIds: string[]) =>
    apiFetch<any>(`/tags/${id}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify({ bookmarkIds }),
    }),
};

// Search
export const search = {
  query: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch<{ data: any[]; pagination: any }>(`/search?${query}`);
  },
};

// Analytics
export const analytics = {
  overview: () => apiFetch<any>('/analytics/overview'),
  activity: () => apiFetch<any>('/analytics/activity'),
  creators: () => apiFetch<any>('/analytics/creators'),
  trending: () => apiFetch<any>('/analytics/trending'),
};

// Discovery
export const discovery = {
  related: (bookmarkId: string) => apiFetch<any>(`/discovery/related/${bookmarkId}`),
  recommendations: () => apiFetch<any>('/discovery/recommendations'),
  trending: () => apiFetch<any>('/discovery/trending'),
};

// Sync
export const sync = {
  status: () => apiFetch<any>('/sync/status'),
  trigger: () => apiFetch<{
    success: boolean;
    syncedCount: number;
    pages: number;
    hasMore: boolean;
    provider?: string;
  }>('/sync/trigger', { method: 'POST' }),
};
