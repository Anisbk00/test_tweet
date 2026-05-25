"""Twikit abstraction layer providing standardized access to X/Twitter data."""

import asyncio
import logging
import time
from typing import Optional

from twikit import Client, TooManyRequests

from config import settings
from services.cache import get_cache

logger = logging.getLogger(__name__)


def transform_tweet(tweet) -> dict:
    """Transform a Twikit Tweet object into our standardized post format."""
    author_data = {}
    if hasattr(tweet, "author") and tweet.author is not None:
        author = tweet.author
        author_data = {
            "id": getattr(author, "id", ""),
            "name": getattr(author, "name", ""),
            "username": getattr(author, "screen_name", ""),
            "avatar_url": getattr(author, "profile_image_url_https", "")
            or getattr(author, "profile_image_url", ""),
        }
    else:
        author_data = {
            "id": getattr(tweet, "user_id", ""),
            "name": getattr(tweet, "name", ""),
            "username": getattr(tweet, "screen_name", ""),
            "avatar_url": "",
        }

    media_list = []
    if hasattr(tweet, "media") and tweet.media:
        for m in tweet.media:
            media_type = "photo"
            media_url = ""
            preview_url = ""

            media_type_str = getattr(m, "type", "").lower()
            if media_type_str:
                media_type = media_type_str
            elif hasattr(m, "video_info"):
                media_type = "video"
            elif hasattr(m, "animated_gif"):
                media_type = "gif"

            if media_type == "photo":
                media_url = getattr(m, "media_url_https", "") or getattr(
                    m, "media_url", ""
                )
                preview_url = media_url
            elif media_type in ("video", "gif"):
                variants = getattr(m, "video_info", {}).get("variants", [])
                if variants:
                    mp4_variants = [
                        v
                        for v in variants
                        if v.get("content_type") == "video/mp4"
                    ]
                    if mp4_variants:
                        best = max(
                            mp4_variants,
                            key=lambda v: v.get("bitrate", 0),
                        )
                        media_url = best.get("url", "")
                preview_url = (
                    getattr(m, "media_url_https", "")
                    or getattr(m, "media_url", "")
                    or ""
                )
            else:
                media_url = getattr(m, "media_url_https", "") or getattr(
                    m, "media_url", ""
                )
                preview_url = media_url

            media_list.append(
                {
                    "url": media_url,
                    "type": media_type,
                    "preview_url": preview_url,
                }
            )

    posted_at = getattr(tweet, "created_at", None)
    if posted_at is not None:
        if isinstance(posted_at, (int, float)):
            posted_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(posted_at / 1000)
            )
        else:
            posted_at = str(posted_at)

    metrics = {
        "replies": getattr(tweet, "reply_count", 0) or 0,
        "reposts": getattr(tweet, "retweet_count", 0) or 0,
        "likes": getattr(tweet, "favorite_count", 0) or 0,
        "views": getattr(tweet, "view_count", 0) or 0,
        "bookmarks": getattr(tweet, "bookmark_count", 0) or 0,
    }

    return {
        "id": getattr(tweet, "id", ""),
        "content": getattr(tweet, "full_text", "")
        or getattr(tweet, "text", ""),
        "author": author_data,
        "media": media_list,
        "metrics": metrics,
        "posted_at": posted_at,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def transform_user(user) -> dict:
    """Transform a Twikit User object into our standardized format."""
    return {
        "id": getattr(user, "id", ""),
        "name": getattr(user, "name", ""),
        "username": getattr(user, "screen_name", ""),
        "avatar_url": getattr(user, "profile_image_url_https", "")
        or getattr(user, "profile_image_url", ""),
        "bio": getattr(user, "description", ""),
        "followers_count": getattr(user, "followers_count", 0) or 0,
        "following_count": getattr(user, "friends_count", 0) or 0,
        "tweets_count": getattr(user, "statuses_count", 0) or 0,
    }


def transform_list(twit_list) -> dict:
    """Transform a Twikit List object into our standardized format."""
    return {
        "id": getattr(twit_list, "id", ""),
        "name": getattr(twit_list, "name", ""),
        "description": getattr(twit_list, "description", ""),
        "member_count": getattr(twit_list, "member_count", 0) or 0,
        "subscriber_count": getattr(twit_list, "subscriber_count", 0) or 0,
        "is_private": getattr(twit_list, "is_private", False),
        "created_at": getattr(twit_list, "created_at", None),
    }


class TwikitProvider:
    """Abstraction layer over the Twikit library for X/Twitter data access."""

    def __init__(self):
        self._clients: dict[str, Client] = {}
        self._cache = get_cache()

    def _get_client(self, user_id: str, cookies: Optional[dict] = None) -> Client:
        """Get or create a Twikit client for a user."""
        if user_id in self._clients:
            return self._clients[user_id]

        client = Client("en-US")

        # If cookies provided, set them on the client
        if cookies:
            client.set_cookies(cookies)

        self._clients[user_id] = client
        return client

    def _set_client_cookies(self, user_id: str, cookies: dict) -> Client:
        """Set cookies on an existing or new client."""
        client = self._get_client(user_id, cookies)
        if user_id in self._clients:
            # Update cookies on existing client
            client.set_cookies(cookies)
        return client

    async def _with_retry(self, func, *args, max_retries=None, **kwargs):
        """Execute a function with retry logic for rate limiting."""
        retries = max_retries or settings.TWIKIT_MAX_RETRIES
        last_error = None

        for attempt in range(retries):
            try:
                result = await func(*args, **kwargs)
                return result
            except TooManyRequests as e:
                wait_time = settings.TWIKIT_API_DELAY * (2 ** attempt)
                logger.warning(
                    f"Rate limited on attempt {attempt + 1}/{retries}. "
                    f"Waiting {wait_time}s before retry..."
                )
                await asyncio.sleep(wait_time)
                last_error = e
            except Exception as e:
                logger.error(f"Error on attempt {attempt + 1}/{retries}: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(settings.TWIKIT_API_DELAY)
                last_error = e

        raise last_error or Exception("All retries exhausted")

    async def get_bookmarks(
        self,
        user_id: str,
        cookies: dict,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch bookmarked posts for a user."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:bookmarks:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.bookmarks, cursor=cursor, limit=limit
        )

        tweets = []
        if hasattr(result, "tweets") and result.tweets:
            tweets = [transform_tweet(t) for t in result.tweets]

        next_cursor = None
        if hasattr(result, "next_cursor"):
            next_cursor = result.next_cursor

        has_more = next_cursor is not None and next_cursor != ""

        response = {
            "data": tweets,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(tweets),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_timeline(
        self,
        user_id: str,
        cookies: dict,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch user timeline."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:timeline:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.home_timeline, cursor=cursor, limit=limit
        )

        tweets = []
        if result:
            tweets = [transform_tweet(t) for t in result]

        next_cursor = None
        if tweets:
            next_cursor = tweets[-1].get("id") if has_more_check(result) else None

        has_more = next_cursor is not None

        response = {
            "data": tweets,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(tweets),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_media_posts(
        self,
        user_id: str,
        cookies: dict,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch posts with media for a specific user."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:media:{target_user_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.user_tweets,
            user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )

        tweets = []
        if result:
            all_tweets = [transform_tweet(t) for t in result]
            # Filter to only include tweets with media
            tweets = [t for t in all_tweets if t.get("media")]

        next_cursor = None
        if result and hasattr(result, "next_cursor"):
            next_cursor = result.next_cursor

        has_more = next_cursor is not None and next_cursor != ""

        response = {
            "data": tweets,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(tweets),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_user_lists(
        self,
        user_id: str,
        cookies: dict,
    ) -> dict:
        """Fetch lists that the user is subscribed to or owns."""
        cache_key = f"{user_id}:lists"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(client.lists)

        lists = []
        if result:
            lists = [transform_list(lst) for lst in result]

        response = {
            "data": lists,
            "cursor": None,
            "has_more": False,
            "count": len(lists),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_list_tweets(
        self,
        user_id: str,
        cookies: dict,
        list_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch tweets from a specific list."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:list_tweets:{list_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.list_tweets,
            list_id=list_id,
            cursor=cursor,
            limit=limit,
        )

        tweets = []
        if hasattr(result, "tweets") and result.tweets:
            tweets = [transform_tweet(t) for t in result.tweets]
        elif result and hasattr(result, "__iter__"):
            tweets = [transform_tweet(t) for t in result]

        next_cursor = None
        if hasattr(result, "next_cursor"):
            next_cursor = result.next_cursor

        has_more = next_cursor is not None and next_cursor != ""

        response = {
            "data": tweets,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(tweets),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_following(
        self,
        user_id: str,
        cookies: dict,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch users that a specific user is following."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:following:{target_user_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.following,
            user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )

        users = []
        if result:
            users = [transform_user(u) for u in result]

        next_cursor = None
        if hasattr(result, "next_cursor"):
            next_cursor = result.next_cursor

        has_more = next_cursor is not None and next_cursor != ""

        response = {
            "data": users,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(users),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_followers(
        self,
        user_id: str,
        cookies: dict,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch followers of a specific user."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:followers:{target_user_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.followers,
            user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )

        users = []
        if result:
            users = [transform_user(u) for u in result]

        next_cursor = None
        if hasattr(result, "next_cursor"):
            next_cursor = result.next_cursor

        has_more = next_cursor is not None and next_cursor != ""

        response = {
            "data": users,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(users),
        }

        self._cache.set(cache_key, response)
        return response

    async def get_user_tweets(
        self,
        user_id: str,
        cookies: dict,
        target_user_id: str,
        cursor: Optional[str] = None,
        limit: int = None,
    ) -> dict:
        """Fetch a user's tweets."""
        limit = limit or settings.DEFAULT_PAGE_LIMIT
        cache_key = f"{user_id}:user_tweets:{target_user_id}:{cursor}:{limit}"

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = self._get_client(user_id, cookies)

        result = await self._with_retry(
            client.user_tweets,
            user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )

        tweets = []
        if result:
            tweets = [transform_tweet(t) for t in result]

        next_cursor = None
        if hasattr(result, "next_cursor"):
            next_cursor = result.next_cursor
        elif tweets:
            next_cursor = tweets[-1].get("id")

        has_more = next_cursor is not None and next_cursor != ""

        response = {
            "data": tweets,
            "cursor": next_cursor,
            "has_more": has_more,
            "count": len(tweets),
        }

        self._cache.set(cache_key, response)
        return response

    def invalidate_user_cache(self, user_id: str) -> int:
        """Invalidate all cached data for a user."""
        return self._cache.invalidate_user(user_id)


def has_more_check(result) -> bool:
    """Check if a result set has more items."""
    if result is None:
        return False
    if hasattr(result, "next_cursor"):
        return result.next_cursor is not None and result.next_cursor != ""
    return False


# Singleton provider instance
twikit_provider = TwikitProvider()


def get_twikit_provider() -> TwikitProvider:
    """Get the global TwikitProvider instance."""
    return twikit_provider
