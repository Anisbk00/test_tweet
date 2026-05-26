import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/proxy/media?url=<encoded_url>
 *
 * Proxies media (videos, images) from Twitter's CDN through our server.
 * This fixes 403 Forbidden errors because Twitter's CDN blocks direct
 * external access (checks Referer header). Our server-side fetch adds
 * the correct Referer header.
 *
 * Also supports caching — responses are cached for 24 hours.
 */

// In-memory cache for media responses (small cache, just headers + status)
const mediaCache = new Map<string, { status: number; contentType: string; timestamp: number }>();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mediaUrl = searchParams.get('url');

    if (!mediaUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    // Only proxy Twitter CDN URLs for security
    const allowedHosts = [
      'video.twimg.com',
      'pbs.twimg.com',
      'abs.twimg.com',
      'ton.twimg.com',
    ];

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(mediaUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    if (!allowedHosts.some(host => parsedUrl.hostname.endsWith(host))) {
      return NextResponse.json({ error: 'URL host not allowed' }, { status: 403 });
    }

    // Fetch the media with proper headers to bypass Twitter's Referer check
    const response = await fetch(mediaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://x.com/',
        'Origin': 'https://x.com',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.warn(`[proxy/media] Upstream ${response.status} for ${mediaUrl.substring(0, 80)}...`);
      return NextResponse.json(
        { error: `Upstream returned ${response.status}` },
        { status: response.status }
      );
    }

    // Get content type
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = response.headers.get('Content-Length');

    // Stream the response back with CORS and caching headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, immutable', // Cache for 24h
      'Access-Control-Allow-Origin': '*',
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    // For video content, support range requests for seeking
    if (contentType.startsWith('video/')) {
      headers['Accept-Ranges'] = 'bytes';
    }

    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[proxy/media] Error:', error);
    return NextResponse.json(
      { error: 'Proxy failed' },
      { status: 500 }
    );
  }
}
