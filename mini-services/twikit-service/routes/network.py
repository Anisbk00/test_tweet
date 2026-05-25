"""Following/followers network endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from auth import get_user_cookies
from services.twikit_provider import get_twikit_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/following")
async def get_following(
    user_id: str = Query(..., description="Authenticated user ID"),
    target_user_id: str = Query(..., description="Target user ID to fetch following for"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get users that a specific user is following."""
    cookies = get_user_cookies(user_id)
    provider = get_twikit_provider()

    try:
        result = await provider.get_following(
            user_id=user_id,
            cookies=cookies,
            target_user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except Exception as e:
        logger.error(
            f"Failed to fetch following for user {target_user_id}: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch following: {str(e)}",
        )


@router.get("/followers")
async def get_followers(
    user_id: str = Query(..., description="Authenticated user ID"),
    target_user_id: str = Query(..., description="Target user ID to fetch followers for"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get followers of a specific user."""
    cookies = get_user_cookies(user_id)
    provider = get_twikit_provider()

    try:
        result = await provider.get_followers(
            user_id=user_id,
            cookies=cookies,
            target_user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except Exception as e:
        logger.error(
            f"Failed to fetch followers for user {target_user_id}: {e}"
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch followers: {str(e)}",
        )
