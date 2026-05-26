# BookmarkVault Worklog

---
Task ID: 1
Agent: Main Agent
Task: Fix cookie-based X GraphQL bookmark sync (500 Internal Server Error)

Work Log:
- Traced the full error chain: frontend → /api/bookmarks/sync → syncBookmarksDual() → syncCookieBookmarks() → getCookieBookmarks() → cookieFetch() → X GraphQL API
- Identified root cause: wrong query IDs, wrong features object, unnecessary fieldToggles, incorrect variables (querySource)
- Researched current X API via fa0311/TwitterInternalAPIDocument and working Greasy Fork scripts
- Discovered correct query IDs: Bookmarks = ojgFx9G-r0OkXCFVN9k5oA, BookmarkSearchTimeline = fHKoSa-2dbV1UbhUy3EvcA
- Found that querySource variable is NOT needed for BookmarkSearchTimeline
- Found that fieldToggles is NOT needed for bookmarks endpoints
- Found correct features (37 flags matching API document, not 39)

Stage Summary:
- Rewrote FALLBACK_QUERY_IDS with correct IDs from API documentation
- Added Bookmarks endpoint (viewer.bookmarks_timeline) as PRIMARY method (simpler, just count + cursor)
- Added BookmarkSearchTimeline as secondary method (search_by_raw_query, needs rawQuery + count)
- Updated BOOKMARKS_FEATURES to match API document (37 features, correct boolean values)
- Removed BOOKMARKS_FIELD_TOGGLES (not needed)
- Removed querySource variable from BookmarkSearchTimeline requests
- Added multiple alternative query IDs for fallback
- Improved error handling in dual-provider.ts to distinguish between "no bookmarks" (valid empty) vs "API failed" (0 pages)
- All changes pass lint check

---
Task ID: 1
Agent: Main Agent
Task: Fix cookie-based bookmark sync 500 error - trace error chain, fix GraphQL error handling, improve error propagation, fix frontend bugs

Work Log:
- Read and analyzed all code in the error chain: x-cookie-api.ts (1182 lines), dual-provider.ts (760 lines), bookmarks/sync/route.ts, diagnose/route.ts
- Searched web for latest X GraphQL query IDs from fa0311/TwitterInternalAPIDocument - confirmed our fallback IDs match their repo
- Identified CRITICAL BUG: X's GraphQL API returns errors with HTTP 200 status code, but cookieFetch only checked HTTP status codes. GraphQL errors like {"errors": [...], "data": null} were silently passed through
- Fixed cookieFetch to parse response body and check for GraphQL errors array
- Added graphqlErrors and errorCode properties to thrown errors for better handling
- Added detailed error collection across all query ID attempts in getCookieBookmarks
- Added raw API response logging for debugging
- Enhanced dual-provider.ts error messages to include actual X API error details instead of generic "no bookmarks"
- Created new /api/sync/debug endpoint that makes raw X GraphQL API requests and returns the full response for diagnostics
- Enhanced /api/sync/diagnose endpoint to include GraphQL error details
- Fixed frontend bug: s.map is not a function - added Array.isArray guards on bookmark.tags and bookmark.collections
- Fixed frontend bug: Failed to construct Image - enhanced URL validation in parseMediaUrls
- Fixed frontend: Search/discovery API response shape mismatches (res.data vs res.bookmarks, etc.)
- Fixed frontend: Sync success check now checks syncedCount > 0, not just success field
- All changes pass lint check
- Pushed to GitHub (commit 0a610d7)

Stage Summary:
- Root cause: GraphQL errors returned with HTTP 200 were not being caught, causing silent failures
- Key fix: Added GraphQL error body checking in cookieFetch
- Added debug endpoint: GET /api/sync/debug for raw X API response diagnostics
- Frontend fixes: Array.isArray guards, URL validation, API response shape fixes
- Deployment: Pushed to GitHub, will auto-redeploy to x-tweet.space-z.ai

---
Task ID: 2
Agent: Main Agent
Task: Fix cookie-based X GraphQL bookmark sync — recognize bookmark_timeline_v2 response structure, fix search query, improve validation

Work Log:
- Analyzed dev server logs and identified root cause: X API returns data under `data.bookmark_timeline_v2` not `data.viewer.bookmarks_timeline`
- Fixed response structure check to recognize `data.bookmark_timeline_v2` path
- Fixed `parseBookmarksResponse` to parse `data.bookmark_timeline_v2.timeline.instructions`
- Fixed cursor parsing to handle both old (cursorType) and new (entryId prefix) formats
- Fixed BookmarkSearchTimeline: changed rawQuery from empty string to '*' (empty causes ERROR_EMPTY_QUERY)
- Updated user info extraction to handle 2025 X API format (core.name, core.screen_name, avatar.image_url)
- Removed bad alternative query ID 6u3VcFdASPZrP2wkuU3C3A (causes 422 validation errors)
- Restructured cookie validation: try Bookmarks endpoint first (most reliable), then v1.1 fallback
- Fixed getCookieUserInfo call in dual-provider to be wrapped in try-catch (was breaking sync on 403)
- Changed schema: xPostId unique → composite unique [userId, xPostId] (allows multi-user)
- Removed xUserId @unique constraint (multiple app users can have same X account)
- Updated all upsert calls to use composite unique key
- All lint checks pass

Stage Summary:
- ROOT CAUSE: X's Bookmarks GraphQL endpoint returns `data.bookmark_timeline_v2` (not `data.viewer.bookmarks_timeline`)
- Sync now works end-to-end: 498 bookmarks synced successfully
- Cookie validation now uses Bookmarks endpoint as primary (v1.1 deprecated/blocked by Cloudflare)
- All fixes verified with real X account cookies
