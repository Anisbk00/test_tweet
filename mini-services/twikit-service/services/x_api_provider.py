"""X API v2 provider - primary method for fetching Twitter data.

Uses:
- Bearer Token for app-only context (search, trends, tweet lookup)
- OAuth 1.0a for user context (user info, following, followers)
- OAuth 2.0 for user context requiring OAuth 2.0 (bookmarks, timeline)

Falls back to Twikit when X API is unavailable or rate-limited.
"""

import asyncio
import base64
import hashlib
import logging
import os
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

import requests
from requests_oauthlib import OAuth1Session

from config import settings
from services.cache import get_cache

logger = logging.getLogger(__name__)

# --- Data Transformation ---

def transform_xapi_tweet(tweet_data: dict, includes: dict = None) -> dict:
    """Transform an X API v2 tweet object into our standardized post format."""
    author_data = {"id": "", "name": "", "username": "", "avatar_url": ""}

    # Extract author from includes
    if includes and "users" in includes:
        author_id = tweet_data.get("author_id", "")
        for user in includes["users"]:
            if user.get("id") == author_id:
                author_data = {
                    "id": user.get("id", ""),
                    "name": user.get("name", ""),
                    "username": user.get("username", ""),
                    "avatar_url": user.get("profile_image_url", ""),
                }
                break

    # Extract media from includes
    media_list = []
    if includes and "media" in includes:
        media_keys = tweet_data.get("attachments", {}).get("media_keys", [])
        for media in includes["media"]:
            if media.get("media_key") in media_keys:
                media_type = media.get("type", "photo")
                media_url = ""
                preview_url = ""

                if media_type == "photo":
                    media_url = media.get("url", "")
                    preview_url = media_url
                elif media_type in ("video", "animated_gif"):
                    variants = media.get("variants", [])
                    if variants:
                        mp4_variants = [
                            v for v in variants
                            if v.get("content_type") == "video/mp4"
                        ]
                        if mp4_variants:
                            best = max(
                                mp4_variants,
                                key=lambda v: v.get("bitrate", 0),
                            )
                            media_url = best.get("url", "")
                    preview_url = media.get("preview_image_url", "")

                media_list.append({
                    "url": media_url,
                    "type": media_type,
                    "preview_url": preview_url,
                })

    # Extract metrics
    public_metrics = tweet_data.get("public_metrics", {})
    metrics = {
        "replies": public_metrics.get("reply_count", 0),
        "reposts": public_metrics.get("retweet_count", 0),
        "likes": public_metrics.get("like_count", 0),
        "views": public_metrics.get("impression_count", 0),
        "bookmarks": public_metrics.get("bookmark_count", 0),
    }

    # Extract posted_at
    posted_at = tweet_data.get("created_at", None)

    return {
        "id": tweet_data.get("id", ""),
        "content": tweet_data.get("text", ""),
        "author": author_data,
        "media": media_list,
        "metrics": metrics,
        "posted_at": posted_at,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def transform_xapi_user(user_data: dict) -> dict:
    """Transform an X API v2 user object into our standardized format."""
    public_metrics = user_data.get("public_metrics", {})
    return {
        "id": user_data.get("id", ""),
        "name": user_data.get("name", ""),
        "username": user_data.get("username", ""),
        "avatar_url": user_data.get("profile_image_url", ""),
        "bio": user_data.get("description", ""),
        "followers_count": public_metrics.get("followers_count", 0),
        "following_count": public_metrics.get("following_count", 0),
        "tweets_count": public_metrics.get("tweet_count", 0),
    }


def transform_xapi_list(list_data: dict) -> dict:
    """Transform an X API v2 list object into our standardized format."""
    return {
        "id": list_data.get("id", ""),
        "name": list_data.get("name", ""),
        "description": list_data.get("description", ""),
        "member_count": 0,
        "subscriber_count": 0,
        "is_private": list_data.get("private", False),
        "created_at": None,
    }


# --- X API v2 Provider ---

class XApiProvider:
    """X API v2 data provider with Bearer Token and OAuth 1.0a support."""

    def __init__(self):
        self._cache = get_cache()
        self._bearer_token = settings.X_API_BEARER_TOKEN
        self._oauth1_sessions: dict[str, OAuth1Session] = {}
        # OAuth 2.0 tokens per user (stored externally, passed in)
        self._oauth2_tokens: dict[str, dict] = {}

    def _get_bearer_headers(self) -> dict:
        """Get headers for Bearer Token authentication (app-only)."""
        return {
            "Authorization": f"Bearer {self._bearer_token}",
            "Content-Type": "application/json",
        }

    def _get_oauth1_session(self, user_id: str = None) -> OAuth1Session:
        """Get or create an OAuth 1.0a session for user-context requests."""
        if user_id and user_id in self._oauth1_sessions:
            return self._oauth1_sessions[user_id]

        session = OAuth1Session(
            settings.X_API_KEY,
            client_secret=settings.X_API_KEY_SECRET,
            resource_owner_key=settings.X_ACCESS_TOKEN,
            resource_owner_secret=settings.X_ACCESS_TOKEN_SECRET,
        )

        if user_id:
            self._oauth1_sessions[user_id] = session
        return session

    def _get_oauth2_headers(self, access_token: str) -> dict:
        """Get headers for OAuth 2.0 user-context requests."""
        return {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

    async def _api_request(
        self,
        method: str,
        endpoint: str,
        params: dict = None,
        auth_type: str = "bearer",
        oauth2_token: str = None,
        user_id: str = None,
    ) -> dict:
        """Make an authenticated request to the X API v2.

        Args:
            method: HTTP method (GET, POST)
            endpoint: API endpoint (e.g., '/users/me')
            params: Query parameters
            auth_type: 'bearer' (app-only), 'oauth1' (user context), 'oauth2' (OAuth 2.0)
            oauth2_token: OAuth 2.0 access token (required if auth_type='oauth2')
            user_id: User identifier for session caching

        Returns:
            JSON response dict
        """
        url = f"{settings.X_API_BASE_URL}{endpoint}"

        try:
            if auth_type == "oauth1":
                oauth1 = self._get_oauth1_session(user_id)
                if method.upper() == "GET":
                    response = oauth1.get(url, params=params)
                else:
                    response = oauth1.post(url, json=params)
            elif auth_type == "oauth2":
                if not oauth2_token:
                    raise ValueError("OAuth 2.0 access token required")
                headers = self._get_oauth2_headers(oauth2_token)
                if method.upper() == "GET":
                    response = requests.get(url, headers=headers, params=params)
                else:
                    response = requests.post(url, headers=headers, json=params)
            else:
                # Bearer Token (app-only)
                headers = self._get_bearer_headers()
                if method.upper() == "GET":
                    response = requests.get(url, headers=headers, params=params)
                else:
                    response = requests.post(url, headers=headers, json=params)

            # Handle rate limiting
            if response.status_code == 429:
                reset_time = response.headers.get("x-rate-limit-reset")
                retry_after = int(reset_time) - int(time.time()) if reset_time else 60
                logger.warning(f"X API rate limited. Retry after {retry_after}s")
                raise RateLimitError(retry_after=max(retry_after, 1))

            if response.status_code >= 400:
                error_detail = response.text
                logger.error(
                    f"X API error: {response.status_code} - {error_detail}"
                )
                raise XApiError(
                    status_code=response.status_code,
                    message=error_detail,
                )

            return response.json()

        except (requests.ConnectionError, requests.Timeout) as e:
            logger.error(f"X API connection error: {e}")
            raise XApiError(
                status_code=503,
                message=f"Connection error: {str(e)}",
            )

    async def _with_retry(self, func, *args, max_retries=None, **kwargs):
        """Execute a function with retry logic for rate limiting."""
        retries = max_retries or settings.X_API_MAX_RETRIES
        last_error = None

        for attempt in range(retries):
            try:
                result = await func(*args, **kwargs)
                return result
            except RateLimitError as e:
                wait_time = min(e.retry_after, 60) * (attempt + 1)
                logger.warning(
                    f"X API rate limited on attempt {attempt + 1}/{retries}. "
                    f"Waiting {wait_time}s..."
                )
                await asyncio.sleep(wait_time)
                last_error = e
            except XApiError as e:
                if e.status_code in (401, 403):
                    # Auth errors - don't retry
                    raise
                logger.error(f"X API error on attempt {attempt + 1}: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(settings.X_API_DELAY * (attempt + 1))
                last_error = e
            except Exception as e:
                logger.error(f"Error on attempt {attempt + 1}: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(settings.X_API_DELAY)
                last_error = e

        raise last_error or Exception("All retries exhausted")

    # --- User Info ---

    async def get_me(self, auth_type: str = "oauth1", oauth2_token: str = None, user_id: str = None) -> dict:
        """Get the authenticated user's information."""
        cache_key = f"xapi:{user_id}:me"
        cached = self._cache.get(cache_key)
        if cached:
            return cached

        result = await self._with_retry(
            self._api_request,
            "GET",
            "/users/me",
            params={"user.fields": "id,name,username,profile_image_url,description,public_metrics"},
            auth_type=auth_type,
            oauth2_token=oauth2_token,
            user_id=user_id,
        )

        user_data = result.get("data", {})
        transformed = transform_xapi_user(user_data)
        self._cache.set(cache_key, transformed, ttl=3600)
        return transformed

    # --- Bookmarks (requires OAuth 2.0) ---

    async def get_bookmarks(
        self,
        user_x_id: str,
        oauth2_token: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch bookmarked posts for a user (requires OAuth 2.0)."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:bookmarks:{user_x_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 100),
            "tweet.fields": "id,text,created_at,author_id,public_metrics,attachments,referenced_tweets",
            "user.fields": "id,name,username,profile_image_url",
            "media.fields": "media_key,type,url,preview_image_url,variants",
            "expansions": "author_id,attachments.media_keys",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/users/{user_x_id}/bookmarks",
            params=params,
            auth_type="oauth2",
            oauth2_token=oauth2_token,
        )

        tweets = []
        includes = result.get("includes", {})
        for tweet_data in result.get("data", []):
            tweets.append(transform_xapi_tweet(tweet_data, includes))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": tweets,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(tweets),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Timeline (requires OAuth 2.0) ---

    async def get_timeline(
        self,
        user_x_id: str,
        oauth2_token: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch user's home timeline (requires OAuth 2.0)."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:timeline:{user_x_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 100),
            "tweet.fields": "id,text,created_at,author_id,public_metrics,attachments",
            "user.fields": "id,name,username,profile_image_url",
            "media.fields": "media_key,type,url,preview_image_url,variants",
            "expansions": "author_id,attachments.media_keys",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/users/{user_x_id}/timelines/reverse_chronological",
            params=params,
            auth_type="oauth2",
            oauth2_token=oauth2_token,
        )

        tweets = []
        includes = result.get("includes", {})
        for tweet_data in result.get("data", []):
            tweets.append(transform_xapi_tweet(tweet_data, includes))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": tweets,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(tweets),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Following ---

    async def get_following(
        self,
        user_x_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
        auth_type: str = "oauth1",
        oauth2_token: str = None,
    ) -> dict:
        """Fetch users that a specific user is following."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:following:{user_x_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 1000),
            "user.fields": "id,name,username,profile_image_url,description,public_metrics",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/users/{user_x_id}/following",
            params=params,
            auth_type=auth_type,
            oauth2_token=oauth2_token,
        )

        users = []
        for user_data in result.get("data", []):
            users.append(transform_xapi_user(user_data))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": users,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(users),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Followers ---

    async def get_followers(
        self,
        user_x_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
        auth_type: str = "oauth1",
        oauth2_token: str = None,
    ) -> dict:
        """Fetch followers of a specific user."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:followers:{user_x_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 1000),
            "user.fields": "id,name,username,profile_image_url,description,public_metrics",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/users/{user_x_id}/followers",
            params=params,
            auth_type=auth_type,
            oauth2_token=oauth2_token,
        )

        users = []
        for user_data in result.get("data", []):
            users.append(transform_xapi_user(user_data))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": users,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(users),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Lists ---

    async def get_user_lists(
        self,
        user_x_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
        auth_type: str = "oauth1",
        oauth2_token: str = None,
    ) -> dict:
        """Fetch lists owned by a user."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:lists:{user_x_id}:{cursor}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 100),
            "list.fields": "id,name,description,private",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/users/{user_x_id}/owned_lists",
            params=params,
            auth_type=auth_type,
            oauth2_token=oauth2_token,
        )

        lists = []
        for list_data in result.get("data", []):
            lists.append(transform_xapi_list(list_data))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": lists,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(lists),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- List Tweets ---

    async def get_list_tweets(
        self,
        list_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
        auth_type: str = "oauth1",
        oauth2_token: str = None,
    ) -> dict:
        """Fetch tweets from a specific list."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:list_tweets:{list_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 100),
            "tweet.fields": "id,text,created_at,author_id,public_metrics,attachments",
            "user.fields": "id,name,username,profile_image_url",
            "media.fields": "media_key,type,url,preview_image_url,variants",
            "expansions": "author_id,attachments.media_keys",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/lists/{list_id}/tweets",
            params=params,
            auth_type=auth_type,
            oauth2_token=oauth2_token,
        )

        tweets = []
        includes = result.get("includes", {})
        for tweet_data in result.get("data", []):
            tweets.append(transform_xapi_tweet(tweet_data, includes))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": tweets,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(tweets),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Search ---

    async def search_tweets(
        self,
        query: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Search tweets (app-only context with Bearer Token)."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:search:{query}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "query": query,
            "max_results": min(limit, 100),
            "tweet.fields": "id,text,created_at,author_id,public_metrics,attachments",
            "user.fields": "id,name,username,profile_image_url",
            "media.fields": "media_key,type,url,preview_image_url,variants",
            "expansions": "author_id,attachments.media_keys",
        }
        if cursor:
            params["next_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            "/tweets/search/recent",
            params=params,
            auth_type="bearer",
        )

        tweets = []
        includes = result.get("includes", {})
        for tweet_data in result.get("data", []):
            tweets.append(transform_xapi_tweet(tweet_data, includes))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": tweets,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(tweets),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Liked Tweets ---

    async def get_liked_tweets(
        self,
        user_x_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
        auth_type: str = "oauth1",
        oauth2_token: str = None,
    ) -> dict:
        """Fetch tweets liked by a user."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"xapi:liked:{user_x_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "max_results": min(limit, 100),
            "tweet.fields": "id,text,created_at,author_id,public_metrics,attachments",
            "user.fields": "id,name,username,profile_image_url",
            "media.fields": "media_key,type,url,preview_image_url,variants",
            "expansions": "author_id,attachments.media_keys",
        }
        if cursor:
            params["pagination_token"] = cursor

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/users/{user_x_id}/liked_tweets",
            params=params,
            auth_type=auth_type,
            oauth2_token=oauth2_token,
        )

        tweets = []
        includes = result.get("includes", {})
        for tweet_data in result.get("data", []):
            tweets.append(transform_xapi_tweet(tweet_data, includes))

        meta = result.get("meta", {})
        next_token = meta.get("next_token")
        has_more = next_token is not None

        response = {
            "data": tweets,
            "cursor": next_token,
            "has_more": has_more,
            "count": len(tweets),
            "provider": "x_api",
        }

        self._cache.set(cache_key, response)
        return response

    # --- Tweet Lookup ---

    async def get_tweet(self, tweet_id: str) -> dict:
        """Fetch a single tweet by ID (app-only context)."""
        cache_key = f"xapi:tweet:{tweet_id}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "tweet.fields": "id,text,created_at,author_id,public_metrics,attachments",
            "user.fields": "id,name,username,profile_image_url",
            "media.fields": "media_key,type,url,preview_image_url,variants",
            "expansions": "author_id,attachments.media_keys",
        }

        result = await self._with_retry(
            self._api_request,
            "GET",
            f"/tweets/{tweet_id}",
            params=params,
            auth_type="bearer",
        )

        tweet_data = result.get("data", {})
        includes = result.get("includes", {})
        transformed = transform_xapi_tweet(tweet_data, includes)

        self._cache.set(cache_key, transformed)
        return transformed

    # --- OAuth 2.0 PKCE ---

    def generate_pkce_pair(self) -> dict:
        """Generate PKCE code verifier and challenge for OAuth 2.0."""
        code_verifier = base64.urlsafe_b64encode(
            secrets.token_bytes(32)
        ).rstrip(b"=").decode("ascii")

        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")

        state = secrets.token_urlsafe(32)

        return {
            "code_verifier": code_verifier,
            "code_challenge": code_challenge,
            "state": state,
        }

    def get_oauth2_authorize_url(
        self,
        code_challenge: str,
        state: str,
        redirect_uri: str = None,
        scope: str = None,
    ) -> str:
        """Generate the OAuth 2.0 authorization URL."""
        redirect_uri = redirect_uri or f"http://localhost:3000/api/auth/x/callback"
        scope = scope or "tweet.read users.read bookmark.read bookmark.write list.read follows.read offline.access"

        params = {
            "response_type": "code",
            "client_id": settings.X_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "scope": scope,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }

        return f"https://twitter.com/i/oauth2/authorize?{urlencode(params)}"

    async def exchange_oauth2_code(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str = None,
    ) -> dict:
        """Exchange an authorization code for OAuth 2.0 tokens."""
        redirect_uri = redirect_uri or f"http://localhost:3000/api/auth/x/callback"

        response = requests.post(
            "https://api.twitter.com/2/oauth2/token",
            data={
                "code": code,
                "grant_type": "authorization_code",
                "client_id": settings.X_CLIENT_ID,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if response.status_code != 200:
            logger.error(f"OAuth 2.0 token exchange failed: {response.text}")
            raise XApiError(
                status_code=response.status_code,
                message=f"Token exchange failed: {response.text}",
            )

        return response.json()

    async def refresh_oauth2_token(self, refresh_token: str) -> dict:
        """Refresh an OAuth 2.0 access token."""
        import base64 as b64

        # Use Basic auth with client_id:client_secret
        credentials = b64.b64encode(
            f"{settings.X_CLIENT_ID}:{settings.X_CLIENT_SECRET}".encode()
        ).decode()

        response = requests.post(
            "https://api.twitter.com/2/oauth2/token",
            data={
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "client_id": settings.X_CLIENT_ID,
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": f"Basic {credentials}",
            },
        )

        if response.status_code != 200:
            logger.error(f"OAuth 2.0 token refresh failed: {response.text}")
            raise XApiError(
                status_code=response.status_code,
                message=f"Token refresh failed: {response.text}",
            )

        return response.json()

    def invalidate_user_cache(self, user_x_id: str) -> int:
        """Invalidate all cached data for a user."""
        return self._cache.invalidate_user(f"xapi:{user_x_id}")


# --- Custom Exceptions ---

class RateLimitError(Exception):
    """Raised when X API rate limit is hit."""
    def __init__(self, retry_after: int = 60):
        self.retry_after = retry_after
        super().__init__(f"Rate limited. Retry after {retry_after}s")


class XApiError(Exception):
    """Raised when X API returns an error."""
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"X API error {status_code}: {message}")


# Singleton provider instance
x_api_provider = XApiProvider()


def get_x_api_provider() -> XApiProvider:
    """Get the global XApiProvider instance."""
    return x_api_provider
