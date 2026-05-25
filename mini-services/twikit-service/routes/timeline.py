"""Timeline and history endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from auth import get_user_cookies
from services.twikit_provider import get_twikit_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("")
async def get_timeline(
    user_id: str = Query(..., description="User ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get the home timeline for a user."""
    cookies = get_user_cookies(user_id)
    provider = get_twikit_provider()

    try:
        result = await provider.get_timeline(
            user_id=user_id,
            cookies=cookies,
            cursor=cursor,
            limit=limit,
        )
        return result
    except Exception as e:
        logger.error(f"Failed to fetch timeline for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch timeline: {str(e)}",
        )


@router.get("/user/{target_user_id}")
async def get_user_tweets(
    target_user_id: str,
    user_id: str = Query(..., description="Authenticated user ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get tweets from a specific user."""
    cookies = get_user_cookies(user_id)
    provider = get_twikit_provider()

    try:
        result = await provider.get_user_tweets(
            user_id=user_id,
            cookies=cookies,
            target_user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except Exception as e:
        logger.error(
            f"Failed to fetch tweets for user {target_user_id}: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch user tweets: {str(e)}",
        )
