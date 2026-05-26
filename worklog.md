---
Task ID: 1-8
Agent: Main Orchestrator
Task: Rebuild BookmarkVault for Vercel deployment with dual X API v2 + Twikit provider

Work Log:
- Created src/lib/x-api.ts: Full X API v2 client directly in Next.js
  - Bearer Token auth (app-only: search, tweet lookup)
  - OAuth 1.0a auth (user context: following, followers, lists)
  - OAuth 2.0 PKCE flow (bookmarks, timeline) - works on Vercel serverless
  - Full tweet/user/list data transformation to standardized format
  - Rate limit handling with XApiError class
- Created src/lib/dual-provider.ts: Orchestrator for X API v2 (primary) + Twikit (fallback)
  - getBookmarksDual: tries X API OAuth 2.0 → Twikit cookies
  - getTimelineDual: tries X API OAuth 2.0 → Twikit cookies
  - getFollowingDual/getFollowersDual: tries X API OAuth 1.0a → Twikit
  - getListsDual: tries X API OAuth 1.0a → Twikit
  - getMediaDual: tries Twikit (dedicated endpoint) → X API bookmarks
  - syncBookmarksDual: full sync with automatic fallback
  - OAuth 2.0 token auto-refresh before expiry
- Updated src/lib/twitter.ts: Made Python Twikit service optional
  - TWIKIT_SERVICE_URL env var controls availability
  - isTwikitAvailable() function for feature detection
  - All service calls gracefully fail when service is unavailable
  - X API auth config can be read directly from env vars
- Updated API routes:
  - /api/auth/x/authorize: Uses PKCE directly from Next.js (no Python dependency)
  - /api/auth/x/callback: Exchanges code directly via X API, fetches user info with getMe()
  - /api/auth/x/config: Returns hasOAuth2, hasOAuth1, hasBearerToken, hasTwikit flags
  - /api/bookmarks/sync: Uses syncBookmarksDual for dual-provider support
  - /api/sync/trigger: Uses syncBookmarksDual for dual-provider support
  - /api/auth/connect-twitter: Handles both OAuth2 and cookie-based auth with optional Twikit service
  - /api/auth/disconnect-twitter: Clears all credentials, optionally logs out from Twikit service
- Updated Prisma schema:
  - SQLite for local development (current sandbox)
  - PostgreSQL schema variant for Vercel (prisma/schema.vercel.prisma)
  - db.ts auto-detects database type and applies appropriate optimizations
- Added Vercel deployment configuration:
  - vercel.json with headers and build settings
  - .env.example with all required environment variables
  - next.config.ts with Vercel detection and image domain allowlist
- Updated frontend components:
  - twitter-connect.tsx: Shows OAuth 2.0, Bearer Token, OAuth 1.0a, Twikit availability
  - api.ts: Added hasOAuth1, hasBearerToken to getXConfig type
  - Vercel-ready badge and messaging
- All ESLint checks pass (0 errors, 0 warnings)
- API endpoints tested and working:
  - GET /api/auth/x/config → Returns correct config flags
  - POST /api/auth/register → Creates user, returns JWT
  - POST /api/auth/login → Returns JWT
  - GET /api/auth/me → Returns user profile
  - POST /api/sync/trigger → Returns 400 when not connected (correct)
  - GET /api/bookmarks → Returns empty list (correct, no bookmarks synced)

Stage Summary:
- Full dual-provider architecture: X API v2 direct (primary) + Twikit (optional fallback)
- Vercel-ready: No Python service dependency for primary method
- OAuth 2.0 PKCE flow works directly from Next.js API routes
- Python Twikit service is optional, configured via TWIKIT_SERVICE_URL env var
- Database: SQLite for local dev, PostgreSQL variant for Vercel
- All mock data removed - app uses only real X/Twitter data
- Deployment instructions provided in .env.example
