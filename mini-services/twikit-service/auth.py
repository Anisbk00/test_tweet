"""Twikit authentication handling - session management and validation."""

import logging
import time
import threading
from typing import Optional
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.twikit_provider import get_twikit_provider
from services.cache import get_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])


# --- Session Storage ---

@dataclass
class AuthSession:
    """Stored authentication session for a user."""

    user_id: str
    cookies: dict
    created_at: float = field(default_factory=time.time)
    last_validated_at: Optional[float] = None
    is_valid: bool = True
    username: Optional[str] = None


class SessionStore:
    """Thread-safe in-memory session store."""

    def __init__(self):
        self._sessions: dict[str, AuthSession] = {}
        self._lock = threading.RLock()

    def save_session(self, user_id: str, cookies: dict, username: str = None) -> AuthSession:
        """Save or update a user session."""
        with self._lock:
            session = AuthSession(
                user_id=user_id,
                cookies=cookies,
                username=username,
                last_validated_at=time.time(),
                is_valid=True,
            )
            self._sessions[user_id] = session
            logger.info(f"Session saved for user {user_id}")
            return session

    def get_session(self, user_id: str) -> Optional[AuthSession]:
        """Retrieve a user session."""
        with self._lock:
            return self._sessions.get(user_id)

    def delete_session(self, user_id: str) -> bool:
        """Delete a user session."""
        with self._lock:
            if user_id in self._sessions:
                del self._sessions[user_id]
                logger.info(f"Session deleted for user {user_id}")
                return True
            return False

    def validate_session(self, user_id: str) -> bool:
        """Check if a user has a valid session."""
        with self._lock:
            session = self._sessions.get(user_id)
            if session is None:
                return False
            return session.is_valid

    def get_cookies(self, user_id: str) -> Optional[dict]:
        """Get cookies for a user session."""
        with self._lock:
            session = self._sessions.get(user_id)
            if session is None:
                return None
            return session.cookies

    def list_sessions(self) -> list[dict]:
        """List all active sessions (without cookies for security)."""
        with self._lock:
            return [
                {
                    "user_id": s.user_id,
                    "username": s.username,
                    "is_valid": s.is_valid,
                    "created_at": s.created_at,
                    "last_validated_at": s.last_validated_at,
                }
                for s in self._sessions.values()
            ]


# Singleton session store
session_store = SessionStore()


def get_session_store() -> SessionStore:
    """Get the global session store."""
    return session_store


# --- Request/Response Models ---

class LoginRequest(BaseModel):
    """Request body for login endpoint."""

    user_id: str
    cookies: dict
    username: Optional[str] = None


class CookieLoginRequest(BaseModel):
    """Request body for cookie-based login."""

    user_id: str
    auth_token: str
    ct0: str
    guest_id: Optional[str] = ""
    twid: Optional[str] = ""
    username: Optional[str] = None


class AuthStatusResponse(BaseModel):
    """Response for auth status endpoint."""

    authenticated: bool
    user_id: Optional[str] = None
    username: Optional[str] = None
    last_validated_at: Optional[float] = None


# --- Routes ---

@router.post("/login", response_model=dict)
async def login_with_cookies(request: LoginRequest):
    """Authenticate with Twitter using cookies dictionary."""
    if not request.cookies:
        raise HTTPException(
            status_code=400,
            detail="Cookies are required for authentication",
        )

    if not request.user_id:
        raise HTTPException(
            status_code=400,
            detail="User ID is required",
        )

    try:
        provider = get_twikit_provider()
        client = provider._set_client_cookies(request.user_id, request.cookies)

        # Save the session
        store = get_session_store()
        session = store.save_session(
            user_id=request.user_id,
            cookies=request.cookies,
            username=request.username,
        )

        # Invalidate user cache on new login
        cache = get_cache()
        cache.invalidate_user(request.user_id)

        return {
            "success": True,
            "user_id": session.user_id,
            "username": session.username,
            "message": "Authentication successful",
        }

    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Authentication failed: {str(e)}",
        )


@router.post("/login/cookies", response_model=dict)
async def login_with_individual_cookies(request: CookieLoginRequest):
    """Authenticate with Twitter using individual cookie values."""
    if not request.auth_token or not request.ct0:
        raise HTTPException(
            status_code=400,
            detail="auth_token and ct0 cookies are required",
        )

    if not request.user_id:
        raise HTTPException(
            status_code=400,
            detail="User ID is required",
        )

    try:
        cookies = {
            "auth_token": request.auth_token,
            "ct0": request.ct0,
        }
        if request.guest_id:
            cookies["guest_id"] = request.guest_id
        if request.twid:
            cookies["twid"] = request.twid

        provider = get_twikit_provider()
        client = provider._set_client_cookies(request.user_id, cookies)

        store = get_session_store()
        session = store.save_session(
            user_id=request.user_id,
            cookies=cookies,
            username=request.username,
        )

        cache = get_cache()
        cache.invalidate_user(request.user_id)

        return {
            "success": True,
            "user_id": session.user_id,
            "username": session.username,
            "message": "Authentication successful",
        }

    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Authentication failed: {str(e)}",
        )


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(user_id: str = None):
    """Check authentication status for a user."""
    if not user_id:
        return AuthStatusResponse(authenticated=False)

    store = get_session_store()
    session = store.get_session(user_id)

    if session is None:
        return AuthStatusResponse(
            authenticated=False, user_id=user_id
        )

    return AuthStatusResponse(
        authenticated=session.is_valid,
        user_id=session.user_id,
        username=session.username,
        last_validated_at=session.last_validated_at,
    )


@router.post("/logout", response_model=dict)
async def logout(user_id: str):
    """Logout and clear session for a user."""
    store = get_session_store()
    deleted = store.delete_session(user_id)

    if deleted:
        # Clear user cache
        cache = get_cache()
        cache.invalidate_user(user_id)

    return {
        "success": True,
        "message": "Logged out successfully" if deleted else "No session found",
    }


@router.get("/sessions", response_model=list)
async def list_sessions():
    """List all active sessions (admin endpoint)."""
    store = get_session_store()
    return store.list_sessions()


def get_user_cookies(user_id: str) -> dict:
    """Helper to get cookies for a user, raising HTTPException if not authenticated."""
    store = get_session_store()
    cookies = store.get_cookies(user_id)
    if cookies is None:
        raise HTTPException(
            status_code=401,
            detail=f"Not authenticated. Please login first for user {user_id}",
        )
    return cookies
