import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'BookmarkVault API',
    version: '1.0.0',
    endpoints: {
      auth: ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/me'],
      bookmarks: ['/api/bookmarks', '/api/bookmarks/[id]', '/api/bookmarks/sync'],
      collections: ['/api/collections', '/api/collections/[id]', '/api/collections/[id]/bookmarks', '/api/collections/reorder'],
      tags: ['/api/tags', '/api/tags/[id]', '/api/tags/[id]/bookmarks'],
      search: ['/api/search'],
      analytics: ['/api/analytics/overview', '/api/analytics/activity', '/api/analytics/creators', '/api/analytics/trending'],
      discovery: ['/api/discovery/related/[bookmarkId]', '/api/discovery/recommendations', '/api/discovery/trending'],
      sync: ['/api/sync/status', '/api/sync/trigger'],
      seed: ['/api/seed'],
    },
  });
}
