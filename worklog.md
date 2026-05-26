---
Task ID: 1-7
Agent: Main Agent
Task: Fix BookmarkVault 401/500 errors and implement cookie-based X API access

Work Log:
- Analyzed all errors: 401 on auth endpoints, 500 on sync, s.map crash, Image constructor error
- Root cause: cookie-based auth required Python Twikit service which wasn't running
- Created src/lib/x-cookie-api.ts: Direct X GraphQL API client using cookies (no Python dependency)
- Updated src/lib/dual-provider.ts: Added cookie-based as secondary provider (X API v2 → Cookie → Twikit)
- Fixed auth routes: Added xConnected/xAuthMethod to login and register responses
- Fixed frontend error handling: Promise.allSettled, safe array extraction, null checks
- Fixed connect-twitter: Now validates cookies by fetching user info, stores xUserId/xUsername
- Fixed X GraphQL API: Changed from POST to GET requests for Bookmarks endpoint
- Added timeout handling to all X API requests (8-10 seconds)
- Added multiple fallback query IDs for Bookmarks endpoint
- Updated TwitterConnect UI to reflect cookie-based direct API access

Stage Summary:
- Cookie-based X API access now works directly in Next.js (no Python dependency)
- Auth flow returns complete user data including xConnected/xAuthMethod
- Frontend handles errors gracefully (no more s.map crashes)
- Sync fails gracefully with clear error messages for invalid cookies
- All lint checks pass
- The key remaining issue: Users must provide valid X cookies (auth_token + ct0) for sync to work
