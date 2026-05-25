"""Lists endpoints - uses dual provider (X API primary, Twikit fallback)."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.dual_provider import get_dual_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lists", tags=["lists"])


@router.get("")
async def get_lists(
    user_id: str = Query(..., description="User ID"),
):
    """Get lists for a user (X API primary, Twikit fallback)."""
    provider = get_dual_provider()

    try:
        result = await provider.get_user_lists(
            user_id=user_id,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch lists for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch lists: {str(e)}",
        )


@router.get("/{list_id}/tweets")
async def get_list_tweets(
    list_id: str,
    user_id: str = Query(..., description="User ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get tweets from a specific list (X API primary, Twikit fallback)."""
    provider = get_dual_provider()

    try:
        result = await provider.get_list_tweets(
            user_id=user_id,
            list_id=list_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch list tweets for list {list_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch list tweets: {str(e)}",
        )
