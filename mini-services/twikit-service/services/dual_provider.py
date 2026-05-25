"""Dual provider orchestrator - tries X API v2 first, falls back to Twikit.

This is the main interface for data fetching. It:
1. Attempts X API v2 (primary) with the appropriate auth method
2. Falls back to Twikit if X API fails or is rate-limited
3. Tracks which provider was used for each request
"""

import logging
from typing import Optional

from config import settings
from services.x_api_provider import get_x_api_provider, XApiError, RateLimitError
from services.twikit_provider import get_twikit_provider
from services.cache import get_cache
from auth import get_user_cookies, get_session_store

logger = logging.getLogger(__name__)


class DualProvider:
    """Orchestrates between X API v2 (primary) and Twikit (fallback)."""

    def __init__(self):
        self._x_api = get_x_api_provider()
        self._twikit = get_twikit_provider()
        self._cache = get_cache()

    def _determine_auth_method(self, user_id: str, required_scope: str = "read") -> dict:
        """Determine the best auth method for a given user and request.

        Returns:
            dict with keys:
                - method: 'oauth2' | 'oauth1' | 'twikit' | 'none'
                - oauth2_token: str (if method is oauth2)
                - x_user_id: str (X platform user ID)
        """
        store = get_session_store()
        session = store.get_session(user_id)

        # Check for OAuth 2.0 token (highest priority for bookmarks/timeline)
        oauth2_token = None
        if session and hasattr(session, 'oauth2_token') and session.oauth2_token:
            oauth2_token = session.oauth2_token

        # Check for X user ID
        x_user_id = None
        if session and hasattr(session, 'x_user_id') and session.x_user_id:
            x_user_id = session.x_user_id

        # If we have OAuth 2.0 token, use it for bookmark/timeline endpoints
        if oauth2_token and required_scope in ("bookmarks", "timeline"):
            return {
                "method": "oauth2",
                "oauth2_token": oauth2_token,
                "x_user_id": x_user_id,
            }

        # If we have OAuth 1.0a configured globally, use it for user-context
        if settings.has_oauth1_credentials:
            return {
                "method": "oauth1",
                "oauth2_token": None,
                "x_user_id": x_user_id,
            }

        # Fall back to Twikit
        if session and session.cookies:
            return {
                "method": "twikit",
                "oauth2_token": None,
                "x_user_id": None,
            }

        return {
            "method": "none",
            "oauth2_token": None,
            "x_user_id": None,
        }

    async def get_bookmarks(
        self,
        user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch bookmarks - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT

        # Try X API v2 with OAuth 2.0 first
        auth_info = self._determine_auth_method(user_id, "bookmarks")

        if auth_info["method"] == "oauth2" and auth_info.get("x_user_id"):
            try:
                result = await self._x_api.get_bookmarks(
                    user_x_id=auth_info["x_user_id"],
                    oauth2_token=auth_info["oauth2_token"],
                    cursor=cursor,
                    limit=limit,
                )
                result["provider"] = "x_api"
                logger.info(f"Fetched bookmarks via X API for user {user_id}")
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for bookmarks, falling back to Twikit: {e}")

        # Try X API v2 with OAuth 1.0a (may not work for bookmarks endpoint)
        if auth_info["method"] == "oauth1" and auth_info.get("x_user_id"):
            try:
                result = await self._x_api.get_bookmarks(
                    user_x_id=auth_info["x_user_id"],
                    oauth2_token=None,  # Will use OAuth 1.0a
                    cursor=cursor,
                    limit=limit,
                )
                result["provider"] = "x_api"
                logger.info(f"Fetched bookmarks via X API (OAuth 1.0a) for user {user_id}")
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API OAuth 1.0a failed for bookmarks, falling back to Twikit: {e}")

        # Fallback to Twikit
        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_bookmarks(
                user_id=user_id,
                cookies=cookies,
                cursor=cursor,
                limit=limit,
            )
            result["provider"] = "twikit"
            logger.info(f"Fetched bookmarks via Twikit for user {user_id}")
            return result
        except Exception as e:
            logger.error(f"Twikit also failed for bookmarks: {e}")
            raise

    async def get_timeline(
        self,
        user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch timeline - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        auth_info = self._determine_auth_method(user_id, "timeline")

        if auth_info["method"] == "oauth2" and auth_info.get("x_user_id"):
            try:
                result = await self._x_api.get_timeline(
                    user_x_id=auth_info["x_user_id"],
                    oauth2_token=auth_info["oauth2_token"],
                    cursor=cursor,
                    limit=limit,
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for timeline, falling back to Twikit: {e}")

        # Fallback to Twikit
        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_timeline(
                user_id=user_id,
                cookies=cookies,
                cursor=cursor,
                limit=limit,
            )
            result["provider"] = "twikit"
            return result
        except Exception as e:
            logger.error(f"Twikit also failed for timeline: {e}")
            raise

    async def get_following(
        self,
        user_id: str,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch following - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        auth_info = self._determine_auth_method(user_id, "read")

        if auth_info["method"] in ("oauth2", "oauth1"):
            try:
                result = await self._x_api.get_following(
                    user_x_id=target_user_id,
                    cursor=cursor,
                    limit=limit,
                    auth_type=auth_info["method"],
                    oauth2_token=auth_info.get("oauth2_token"),
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for following, falling back to Twikit: {e}")

        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_following(
                user_id=user_id,
                cookies=cookies,
                target_user_id=target_user_id,
                cursor=cursor,
                limit=limit,
            )
            result["provider"] = "twikit"
            return result
        except Exception as e:
            logger.error(f"Twikit also failed for following: {e}")
            raise

    async def get_followers(
        self,
        user_id: str,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch followers - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        auth_info = self._determine_auth_method(user_id, "read")

        if auth_info["method"] in ("oauth2", "oauth1"):
            try:
                result = await self._x_api.get_followers(
                    user_x_id=target_user_id,
                    cursor=cursor,
                    limit=limit,
                    auth_type=auth_info["method"],
                    oauth2_token=auth_info.get("oauth2_token"),
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for followers, falling back to Twikit: {e}")

        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_followers(
                user_id=user_id,
                cookies=cookies,
                target_user_id=target_user_id,
                cursor=cursor,
                limit=limit,
            )
            result["provider"] = "twikit"
            return result
        except Exception as e:
            logger.error(f"Twikit also failed for followers: {e}")
            raise

    async def get_user_lists(
        self,
        user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch user lists - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        auth_info = self._determine_auth_method(user_id, "read")

        if auth_info["method"] in ("oauth2", "oauth1") and auth_info.get("x_user_id"):
            try:
                result = await self._x_api.get_user_lists(
                    user_x_id=auth_info["x_user_id"],
                    cursor=cursor,
                    limit=limit,
                    auth_type=auth_info["method"],
                    oauth2_token=auth_info.get("oauth2_token"),
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for lists, falling back to Twikit: {e}")

        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_user_lists(
                user_id=user_id,
                cookies=cookies,
            )
            result["provider"] = "twikit"
            return result
        except Exception as e:
            logger.error(f"Twikit also failed for lists: {e}")
            raise

    async def get_list_tweets(
        self,
        user_id: str,
        list_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch list tweets - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        auth_info = self._determine_auth_method(user_id, "read")

        if auth_info["method"] in ("oauth2", "oauth1"):
            try:
                result = await self._x_api.get_list_tweets(
                    list_id=list_id,
                    cursor=cursor,
                    limit=limit,
                    auth_type=auth_info["method"],
                    oauth2_token=auth_info.get("oauth2_token"),
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for list tweets, falling back to Twikit: {e}")

        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_list_tweets(
                user_id=user_id,
                cookies=cookies,
                list_id=list_id,
                cursor=cursor,
                limit=limit,
            )
            result["provider"] = "twikit"
            return result
        except Exception as e:
            logger.error(f"Twikit also failed for list tweets: {e}")
            raise

    async def get_media_posts(
        self,
        user_id: str,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch media posts - tries X API v2 first, falls back to Twikit."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        auth_info = self._determine_auth_method(user_id, "read")

        # X API doesn't have a direct media-only endpoint, so we use Twikit for this
        # unless we want to filter timeline results
        try:
            cookies = get_user_cookies(user_id)
            result = await self._twikit.get_media_posts(
                user_id=user_id,
                cookies=cookies,
                target_user_id=target_user_id,
                cursor=cursor,
                limit=limit,
            )
            result["provider"] = "twikit"
            return result
        except Exception as e:
            logger.error(f"Twikit failed for media posts: {e}")
            raise

    async def search_tweets(
        self,
        query: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Search tweets - uses X API v2 Bearer Token (app-only)."""
        if settings.has_bearer_token:
            try:
                result = await self._x_api.search_tweets(
                    query=query,
                    cursor=cursor,
                    limit=limit,
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for search: {e}")
                raise

        raise Exception("Search requires X API Bearer Token to be configured")

    async def get_me(self, user_id: str = None, auth_type: str = "oauth1", oauth2_token: str = None) -> dict:
        """Get authenticated user info - tries X API first."""
        if settings.has_oauth1_credentials or oauth2_token:
            try:
                result = await self._x_api.get_me(
                    auth_type=auth_type,
                    oauth2_token=oauth2_token,
                    user_id=user_id,
                )
                result["provider"] = "x_api"
                return result
            except (RateLimitError, XApiError) as e:
                logger.warning(f"X API failed for get_me: {e}")

        raise Exception("Could not get user info - no auth method available")

    def invalidate_user_cache(self, user_id: str) -> int:
        """Invalidate all cached data for a user."""
        count = self._twikit.invalidate_user_cache(user_id)
        count += self._x_api.invalidate_user_cache(user_id)
        return count


# Singleton dual provider instance
dual_provider = DualProvider()


def get_dual_provider() -> DualProvider:
    """Get the global DualProvider instance."""
    return dual_provider
