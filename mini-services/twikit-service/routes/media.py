"""Media retrieval endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from auth import get_user_cookies
from services.twikit_provider import get_twikit_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/media", tags=["media"])


@router.get("")
async def get_media_posts(
    user_id: str = Query(..., description="Authenticated user ID"),
    target_user_id: str = Query(..., description="Target user ID to fetch media for"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get posts with media for a specific user."""
    cookies = get_user_cookies(user_id)
    provider = get_twikit_provider()

    try:
        result = await provider.get_media_posts(
            user_id=user_id,
            cookies=cookies,
            target_user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except Exception as e:
        logger.error(
            f"Failed to fetch media posts for user {target_user_id}: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch media posts: {str(e)}",
        )


@router.get("/bookmarks")
async def get_bookmark_media(
    user_id: str = Query(..., description="User ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get bookmarked posts that contain media (photos, videos, GIFs)."""
    cookies = get_user_cookies(user_id)
    provider = get_twikit_provider()

    try:
        # Fetch bookmarks and filter for media
        result = await provider.get_bookmarks(
            user_id=user_id,
            cookies=cookies,
            cursor=cursor,
            limit=limit * 2,  # Fetch more since we'll filter
        )

        # Filter to only include posts with media
        media_posts = [
            post for post in result.get("data", []) if post.get("media")
        ]

        return {
            "data": media_posts[:limit],
            "cursor": result.get("cursor"),
            "has_more": result.get("has_more", False),
            "count": len(media_posts[:limit]),
        }
    except Exception as e:
        logger.error(
            f"Failed to fetch bookmark media for user {user_id}: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch bookmark media: {str(e)}",
        )
