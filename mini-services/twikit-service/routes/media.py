"""Media endpoints - uses dual provider (Twikit for media-specific, X API for search)."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.dual_provider import get_dual_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/bookmarks")
async def get_bookmark_media(
    user_id: str = Query(..., description="User ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get bookmarked posts that contain media."""
    provider = get_dual_provider()

    try:
        # Fetch bookmarks and filter for media
        result = await provider.get_bookmarks(
            user_id=user_id,
            cursor=cursor,
            limit=limit * 2,  # Fetch more since we'll filter
        )

        # Filter to only include posts with media
        media_posts = [p for p in result.get("data", []) if p.get("media")]

        return {
            "data": media_posts[:limit],
            "cursor": result.get("cursor"),
            "has_more": result.get("has_more", False),
            "count": len(media_posts[:limit]),
            "provider": result.get("provider", "unknown"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch bookmark media for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch media: {str(e)}",
        )


@router.get("/search")
async def search_media(
    query: str = Query(..., description="Search query"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Search for media tweets using X API."""
    provider = get_dual_provider()

    try:
        # Add media filter to search query
        media_query = f"{query} has:media"
        result = await provider.search_tweets(
            query=media_query,
            cursor=cursor,
            limit=limit,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to search media: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to search media: {str(e)}",
        )
