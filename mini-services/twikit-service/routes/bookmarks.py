"""Bookmark fetching and syncing endpoints - uses dual provider (X API primary, Twikit fallback)."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from auth import get_user_cookies, get_session_store
from services.dual_provider import get_dual_provider
from services.twikit_provider import get_twikit_provider
from services.queue import get_queue
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


@router.get("")
async def get_bookmarks(
    user_id: str = Query(..., description="User ID"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(settings.DEFAULT_PAGE_LIMIT, description="Items per page", ge=1, le=settings.MAX_PAGE_LIMIT),
):
    """Get bookmarks for a user with pagination (X API primary, Twikit fallback)."""
    provider = get_dual_provider()

    try:
        result = await provider.get_bookmarks(
            user_id=user_id,
            cursor=cursor,
            limit=limit,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch bookmarks for user {user_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch bookmarks: {str(e)}",
        )


@router.post("/sync")
async def sync_bookmarks(
    user_id: str = Query(..., description="User ID"),
    full_sync: bool = Query(False, description="Perform a full sync instead of incremental"),
):
    """Trigger a background bookmark sync for a user (X API primary, Twikit fallback)."""
    provider = get_dual_provider()
    queue = get_queue()

    # Check if there's already an active sync
    sync_status = queue.get_sync_status(user_id)
    if sync_status["is_syncing"]:
        return {
            "success": False,
            "message": "Sync already in progress",
            "task_id": sync_status["current_task_id"],
        }

    async def sync_task():
        """Background task that fetches all bookmarks page by page."""
        all_bookmarks = []
        cursor = None
        page_count = 0
        max_pages = 50 if full_sync else 5
        provider_used = "unknown"

        while page_count < max_pages:
            result = await provider.get_bookmarks(
                user_id=user_id,
                cursor=cursor,
                limit=settings.SYNC_BATCH_SIZE,
            )

            bookmarks = result.get("data", [])
            all_bookmarks.extend(bookmarks)
            page_count += 1
            provider_used = result.get("provider", "unknown")

            if not result.get("has_more", False):
                break

            cursor = result.get("cursor")

            import asyncio
            await asyncio.sleep(settings.TWIKIT_API_DELAY)

        # Invalidate cache after sync
        provider.invalidate_user_cache(user_id)

        return {
            "total_bookmarks": len(all_bookmarks),
            "pages_fetched": page_count,
            "full_sync": full_sync,
            "provider_used": provider_used,
        }

    task_id = queue.enqueue(
        task_type="sync_bookmarks",
        user_id=user_id,
        coro_factory=sync_task,
        metadata={"full_sync": full_sync},
    )

    return {
        "success": True,
        "message": "Bookmark sync started",
        "task_id": task_id,
    }


@router.get("/sync/status")
async def get_sync_status(
    user_id: str = Query(..., description="User ID"),
):
    """Get the current sync status for a user."""
    queue = get_queue()
    return queue.get_sync_status(user_id)
