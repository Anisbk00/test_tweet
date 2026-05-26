# Task 5-b: Frontend Update for Dual-Provider X Connection + Remove Mock Data

## Agent: frontend-updater

## Summary
Updated the BookmarkVault frontend to support the new dual-provider X connection flow (OAuth 2.0 primary + Twikit fallback) and removed all mock/fake data.

## Changes Made

### Store & API Layer
- **store.ts**: Added `xAuthMethod: string | null` to User interface
- **api.ts**: Added `auth.connectXOAuth2()`, `auth.getXConfig()`, updated `sync.trigger()` return type

### Backend (supporting changes)
- **auth.ts**: Added `xAuthMethod` to `getCurrentUser()` select
- **connect-twitter/route.ts**: Sets `xAuthMethod: 'twikit'` on connect
- **disconnect-twitter/route.ts**: Clears OAuth2 fields, resets `xAuthMethod: 'none'`
- **x/authorize/route.ts**: Added token via query string support for browser redirects
- **x/callback/route.ts**: NEW - Full OAuth 2.0 callback handler
- **x/config/route.ts**: NEW - X API configuration status endpoint

### Frontend Components
- **twitter-connect.tsx**: Complete rewrite with dual-method UI (OAuth 2.0 primary, cookie fallback collapsible)
- **profile-view.tsx**: Removed Math.random() heatmap, uses real /api/analytics/activity data, shows auth method badge
- **header.tsx**: Connection method indicator badges (green X API, amber Twikit, red Disconnected)
- **page.tsx**: OAuth callback redirect handling with toast notifications

## Key Decisions
- OAuth 2.0 button uses `window.location.href` redirect (not fetch) because it's a server-side flow
- Token passed via query string for authorize endpoint (browser navigation can't set Authorization header)
- Cookie fallback is collapsible "Advanced" section to prioritize OAuth 2.0
- Empty states shown when API returns no data instead of random/mock data
