# Task 5-a: Update Next.js Layer for Dual-Provider Python Service

## Agent: Next.js Dual-Provider Updater

## Summary
Updated the Next.js layer to support the new dual-provider Python service (X API v2 primary + Twikit fallback). Implemented full OAuth 2.0 PKCE flow, dual-provider bookmark sync, and updated all related API routes.

## Files Updated

### Library Files
- `/src/lib/twitter.ts` - Added X API v2 proxy functions:
  - `xApiLoginWithOAuth2()` - POST /auth/login/oauth2
  - `xApiGetOAuth2AuthorizeUrl()` - POST /auth/oauth2/authorize-url
  - `xApiOAuth2Callback()` - POST /auth/oauth2/callback
  - `xApiRefreshOAuth2Token()` - POST /auth/oauth2/refresh
  - `xApiGetAuthConfig()` - GET /auth/config
  - Added `provider` field to `TwikitPost` and `TwikitPaginatedResponse`
  - Updated `transformTwikitPost()` to include `source` field
  - Fixed return types to match actual Python service API

- `/src/lib/auth.ts` - Added `xAuthMethod` and `xOAuth2ExpiresAt` to `getCurrentUser()` select

### New Routes
- `/src/app/api/auth/x/authorize/route.ts` - OAuth 2.0 PKCE authorize URL generator
- `/src/app/api/auth/x/callback/route.ts` - OAuth 2.0 callback handler with CSRF protection

### Updated Routes
- `/src/app/api/auth/connect-twitter/route.ts` - Dual auth method support (cookies + OAuth 2.0)
- `/src/app/api/bookmarks/sync/route.ts` - Dual-provider sync with token refresh
- `/src/app/api/auth/x/config/route.ts` - Fixed to use updated xApiGetAuthConfig return type

## Key Decisions
- OAuth 2.0 PKCE flow stores state and code_verifier in secure HttpOnly cookies (10min TTL)
- Python service's `/auth/login/oauth2` validates tokens and retrieves user info (x_user_id, username)
- Bookmark sync tries OAuth 2.0 first, falls back to Twikit cookies
- Automatic OAuth 2.0 token refresh when expired during sync
- `source` field on bookmarks tracks which provider fetched the data
- `xAuthMethod` on User model tracks the authentication method
- `provider` on SyncStatus tracks which provider was last used

## Verification
- TypeScript compilation: 0 errors in updated files
- ESLint: 0 errors, 2 pre-existing warnings (unrelated)
- All API return types match Python service endpoints exactly
