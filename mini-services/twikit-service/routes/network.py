"""Network endpoints - uses dual provider (X API primary, Twikit fallback)."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.dual_provider import get_dual_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/following")
async def get_following(
    user_id: str = Query(..., description="Internal user ID"),
    target_user_id: str = Query(..., description="X user ID to fetch following for"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get users that a specific user is following (X API primary, Twikit fallback)."""
    provider = get_dual_provider()

    try:
        result = await provider.get_following(
            user_id=user_id,
            target_user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch following: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch following: {str(e)}",
        )


@router.get("/followers")
async def get_followers(
    user_id: str = Query(..., description="Internal user ID"),
    target_user_id: str = Query(..., description="X user ID to fetch followers for"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get followers of a specific user (X API primary, Twikit fallback)."""
    provider = get_dual_provider()

    try:
        result = await provider.get_followers(
            user_id=user_id,
            target_user_id=target_user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch followers: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch followers: {str(e)}",
        )
