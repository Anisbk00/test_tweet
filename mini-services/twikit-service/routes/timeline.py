"""Timeline endpoints - uses dual provider (X API primary, Twikit fallback)."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.dual_provider import get_dual_provider
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("")
async def get_timeline(
    user_id: str = Query(..., description="User ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get home timeline for a user (X API primary, Twikit fallback)."""
    provider = get_dual_provider()

    try:
        result = await provider.get_timeline(
            user_id=user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch timeline for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch timeline: {str(e)}",
        )
