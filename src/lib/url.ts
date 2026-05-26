/**
 * URL Resolution Utility
 *
 * Next.js serverless functions inside containers/proxies may see
 * request.url as http://0.0.0.0:3000/... instead of the public URL.
 * This utility resolves the correct public origin for redirects.
 */

/**
 * Get the public base URL for the application.
 * Priority:
 * 1. NEXT_PUBLIC_BASE_URL env var (explicitly set)
 * 2. x-forwarded-proto + host headers (from reverse proxy / CDN)
 * 3. Fallback to request.url origin (may be internal)
 */
export function getPublicBaseUrl(request: Request): string {
  // Explicit override
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (envUrl) return envUrl;

  // From reverse proxy headers (Vercel, Caddy, Cloudflare, etc.)
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host');
  if (host && !host.startsWith('0.0.0.0') && !host.startsWith('localhost')) {
    return `${proto}://${host}`;
  }

  // Fallback — try to extract from request.url
  try {
    const url = new URL(request.url);
    if (url.hostname !== '0.0.0.0' && url.hostname !== 'localhost') {
      return url.origin;
    }
  } catch {
    // ignore
  }

  // Last resort — use the internal URL (redirects may not work in browser)
  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * Build a redirect URL to the app, using the correct public origin.
 * Usage: redirectUrl(request, '/?error=something')
 */
export function redirectUrl(request: Request, path: string): URL {
  const base = getPublicBaseUrl(request);
  return new URL(path, base);
}
