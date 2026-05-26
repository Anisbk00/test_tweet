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
