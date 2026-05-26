# Task 3-b: Build Next.js Backend API Routes

## Agent: Backend API Builder

## Summary
Created all backend API routes for the BookmarkVault app including auth, bookmarks, collections, tags, search, analytics, discovery, and sync endpoints. Also created auth helpers, twitter service proxy, and seed data.

## Files Created

### Library Files
- `/src/lib/auth.ts` - JWT (HMAC-SHA256) generation/verification, PBKDF2 password hashing, getSession(), getCurrentUser()
- `/src/lib/twitter.ts` - Proxy to twikit-service on port 3031
- `/src/lib/seed.ts` - Demo data: 1 user, 5 collections, 12 tags, 52 bookmarks, 30 days activity

### API Routes (26 files)
- `/src/app/api/route.ts` - API documentation endpoint
- `/src/app/api/auth/register/route.ts` - POST user registration
- `/src/app/api/auth/login/route.ts` - POST user login
- `/src/app/api/auth/logout/route.ts` - POST session invalidation
- `/src/app/api/auth/me/route.ts` - GET current user
- `/src/app/api/bookmarks/route.ts` - GET (list+filter) / POST (create)
- `/src/app/api/bookmarks/[id]/route.ts` - GET / PUT / DELETE
- `/src/app/api/bookmarks/sync/route.ts` - POST sync from twikit
- `/src/app/api/collections/route.ts` - GET / POST
- `/src/app/api/collections/[id]/route.ts` - PUT / DELETE
- `/src/app/api/collections/[id]/bookmarks/route.ts` - POST / DELETE
- `/src/app/api/collections/reorder/route.ts` - POST reorder
- `/src/app/api/tags/route.ts` - GET / POST
- `/src/app/api/tags/[id]/route.ts` - DELETE
- `/src/app/api/tags/[id]/bookmarks/route.ts` - POST add tag to bookmarks
- `/src/app/api/search/route.ts` - GET full-text search
- `/src/app/api/analytics/overview/route.ts` - GET dashboard stats
- `/src/app/api/analytics/activity/route.ts` - GET heatmap data
- `/src/app/api/analytics/creators/route.ts` - GET top creators
- `/src/app/api/analytics/trending/route.ts` - GET trending tags/topics
- `/src/app/api/discovery/related/[bookmarkId]/route.ts` - GET related bookmarks
- `/src/app/api/discovery/recommendations/route.ts` - GET recommendations
- `/src/app/api/discovery/trending/route.ts` - GET trending
- `/src/app/api/sync/status/route.ts` - GET sync status
- `/src/app/api/sync/trigger/route.ts` - POST trigger sync
- `/src/app/api/seed/route.ts` - POST seed database

## Key Decisions
- Used Node.js crypto module for JWT and password hashing (no external deps)
- Soft delete for bookmarks (isBookmarked=false) instead of hard delete
- Relevance scoring for search results based on match position and engagement
- Heuristic-based recommendations using tag affinity, engagement, and creator preferences
- Activity tracking for all mutations (bookmark_save, collection_create, etc.)
- All API calls to twikit-service use XTransformPort=3031 pattern

## Verification
- All endpoints tested with curl and return correct HTTP status codes
- Seed endpoint creates 52 bookmarks, 5 collections, 12 tags successfully
- Lint passes with zero errors
- Demo user: demo@bookmarkvault.app / password
