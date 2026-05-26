export function formatCount(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes <= 1 ? 'just now' : `${minutes}m`;
    }
    return `${hours}h`;
  }
  if (days === 1) return '1d';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function parseJSON<T>(jsonStr: string, fallback: T): T {
  try {
    const parsed = JSON.parse(jsonStr);
    // If we expect an array (fallback is array), ensure parsed is also an array
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse JSON and filter out invalid/empty URLs from string arrays.
 * Used for mediaUrls arrays that may contain empty strings or invalid URLs.
 * Also validates each URL to prevent 'Failed to construct Image' errors.
 */
export function parseMediaUrls(jsonStr: string): string[] {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((url: unknown) => {
      if (typeof url !== 'string' || url.trim().length === 0) return false;
      const trimmed = url.trim();
      if (!trimmed.startsWith('http')) return false;
      // Validate the URL can be parsed — prevents 'Failed to construct Image' errors
      try {
        const parsedUrl = new URL(trimmed);
        return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Validate and sanitize a URL for use in img src or other contexts.
 * Returns null if the URL is invalid or potentially dangerous.
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    // Allow only http/https URLs
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function getAvatarColor(name: string | null): string {
  const colors = [
    'from-emerald-400 to-cyan-400',
    'from-amber-400 to-orange-400',
    'from-rose-400 to-pink-400',
    'from-violet-400 to-purple-400',
    'from-teal-400 to-emerald-400',
    'from-cyan-400 to-blue-400',
    'from-orange-400 to-red-400',
    'from-pink-400 to-rose-400',
  ];
  const index = (name || '').charCodeAt(0) % colors.length;
  return colors[index];
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Convert a Twitter CDN URL to a proxied URL through our server.
 * This is needed because Twitter's CDN (video.twimg.com) blocks
 * direct external access with 403 errors when the Referer header
 * isn't from x.com.
 *
 * For image thumbnails (pbs.twimg.com), proxying is optional since
 * they generally work without it. But for video URLs, proxying is required.
 */
export function proxyMediaUrl(url: string): string {
  if (!url || !url.startsWith('http')) return url;

  try {
    const parsed = new URL(url);
    // Proxy video.twimg.com URLs (always 403 from external)
    if (parsed.hostname === 'video.twimg.com' || parsed.hostname.endsWith('.video.twimg.com')) {
      return `/api/proxy/media?url=${encodeURIComponent(url)}`;
    }
    // pbs.twimg.com images generally work directly, no proxy needed
    return url;
  } catch {
    return url;
  }
}

/**
 * Get the best display URL for a media item in an <img> tag.
 * For videos/GIFs: use the preview (thumbnail) URL if available.
 * For photos: use the direct media URL.
 * Also applies proxying for Twitter CDN URLs that need it.
 */
export function getMediaDisplayUrl(
  mediaUrl: string,
  previewUrl: string | undefined,
  mediaType: string
): string {
  let displayUrl: string;

  if ((mediaType === 'video' || mediaType === 'gif') && previewUrl) {
    // Use thumbnail for video/GIF display in img tags
    displayUrl = previewUrl;
  } else {
    // For photos, or videos without preview URLs
    displayUrl = mediaUrl;
  }

  // Always proxy through our server for Twitter CDN URLs that need it
  return proxyMediaUrl(displayUrl);
}

/**
 * Get the playback URL for a video/GIF.
 * Applies proxying since video.twimg.com URLs always 403 externally.
 */
export function getMediaPlaybackUrl(url: string): string {
  return proxyMediaUrl(url);
}
