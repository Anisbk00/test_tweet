"""Authentication handling - session management for both X API and Twikit."""

import logging
import time
import threading
from typing import Optional
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.twikit_provider import get_twikit_provider
from services.x_api_provider import get_x_api_provider
from services.cache import get_cache
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])


# --- Session Storage ---

@dataclass
class AuthSession:
    """Stored authentication session for a user."""

    user_id: str
    cookies: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    last_validated_at: Optional[float] = None
    is_valid: bool = True
    username: Optional[str] = None
    # X API v2 fields
    oauth2_token: Optional[str] = None
    oauth2_refresh_token: Optional[str] = None
    oauth2_expires_at: Optional[float] = None
    x_user_id: Optional[str] = None  # X platform user ID
    auth_method: str = "twikit"  # 'x_api' or 'twikit' or 'auto'


class SessionStore:
    """Thread-safe in-memory session store."""

    def __init__(self):
        self._sessions: dict[str, AuthSession] = {}
        self._lock = threading.RLock()

    def save_session(self, user_id: str, cookies: dict = None, username: str = None,
                     oauth2_token: str = None, oauth2_refresh_token: str = None,
                     oauth2_expires_at: float = None, x_user_id: str = None,
                     auth_method: str = "twikit") -> AuthSession:
        """Save or update a user session."""
        with self._lock:
            # Merge with existing session if present
            existing = self._sessions.get(user_id)
            session = AuthSession(
                user_id=user_id,
                cookies=cookies or (existing.cookies if existing else {}),
                username=username or (existing.username if existing else None),
                last_validated_at=time.time(),
                is_valid=True,
                oauth2_token=oauth2_token or (existing.oauth2_token if existing else None),
                oauth2_refresh_token=oauth2_refresh_token or (existing.oauth2_refresh_token if existing else None),
                oauth2_expires_at=oauth2_expires_at or (existing.oauth2_expires_at if existing else None),
                x_user_id=x_user_id or (existing.x_user_id if existing else None),
                auth_method=auth_method or (existing.auth_method if existing else "twikit"),
            )
            self._sessions[user_id] = session
            logger.info(f"Session saved for user {user_id} (method: {auth_method})")
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

    def get_oauth2_token(self, user_id: str) -> Optional[str]:
        """Get OAuth 2.0 access token for a user."""
        with self._lock:
            session = self._sessions.get(user_id)
            if session is None:
                return None
            # Check if token is expired
            if session.oauth2_expires_at and session.oauth2_expires_at < time.time():
                return None
            return session.oauth2_token

    def list_sessions(self) -> list[dict]:
        """List all active sessions (without sensitive data)."""
        with self._lock:
            return [
                {
                    "user_id": s.user_id,
                    "username": s.username,
                    "is_valid": s.is_valid,
                    "auth_method": s.auth_method,
                    "x_user_id": s.x_user_id,
                    "created_at": s.created_at,
                    "last_validated_at": s.last_validated_at,
                    "has_oauth2": bool(s.oauth2_token),
                    "has_cookies": bool(s.cookies),
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
    """Request body for cookie-based login (Twikit)."""

    user_id: str
    auth_token: str
    ct0: str
    guest_id: Optional[str] = ""
    twid: Optional[str] = ""
    username: Optional[str] = None


class OAuth2LoginRequest(BaseModel):
    """Request body for OAuth 2.0 login."""

    user_id: str
    access_token: str
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None  # seconds until expiration
    x_user_id: Optional[str] = None
    username: Optional[str] = None


class OAuth2AuthorizeRequest(BaseModel):
    """Request body for OAuth 2.0 authorize URL generation."""

    redirect_uri: Optional[str] = None
    scope: Optional[str] = None


class OAuth2CallbackRequest(BaseModel):
    """Request body for OAuth 2.0 callback processing."""

    code: str
    code_verifier: str
    redirect_uri: Optional[str] = None


class AuthStatusResponse(BaseModel):
    """Response for auth status endpoint."""

    authenticated: bool
    user_id: Optional[str] = None
    username: Optional[str] = None
    auth_method: Optional[str] = None
    x_user_id: Optional[str] = None
    has_oauth2: bool = False
    has_cookies: bool = False
    last_validated_at: Optional[float] = None


# --- Routes ---

@router.post("/login", response_model=dict)
async def login_with_cookies(request: LoginRequest):
    """Authenticate with Twitter using cookies dictionary (Twikit method)."""
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
        provider._set_client_cookies(request.user_id, request.cookies)

        store = get_session_store()
        session = store.save_session(
            user_id=request.user_id,
            cookies=request.cookies,
            username=request.username,
            auth_method="twikit",
        )

        cache = get_cache()
        cache.invalidate_user(request.user_id)

        return {
            "success": True,
            "user_id": session.user_id,
            "username": session.username,
            "auth_method": "twikit",
            "message": "Authentication successful via Twikit",
        }

    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Authentication failed: {str(e)}",
        )


@router.post("/login/cookies", response_model=dict)
async def login_with_individual_cookies(request: CookieLoginRequest):
    """Authenticate with Twitter using individual cookie values (Twikit method)."""
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
        provider._set_client_cookies(request.user_id, cookies)

        store = get_session_store()
        session = store.save_session(
            user_id=request.user_id,
            cookies=cookies,
            username=request.username,
            auth_method="twikit",
        )

        cache = get_cache()
        cache.invalidate_user(request.user_id)

        return {
            "success": True,
            "user_id": session.user_id,
            "username": session.username,
            "auth_method": "twikit",
            "message": "Authentication successful via Twikit",
        }

    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Authentication failed: {str(e)}",
        )


@router.post("/login/oauth2", response_model=dict)
async def login_with_oauth2(request: OAuth2LoginRequest):
    """Authenticate with X API using OAuth 2.0 tokens."""
    if not request.access_token:
        raise HTTPException(
            status_code=400,
            detail="OAuth 2.0 access token is required",
        )

    if not request.user_id:
        raise HTTPException(
            status_code=400,
            detail="User ID is required",
        )

    try:
        # Validate the token by getting user info
        x_api = get_x_api_provider()
        user_info = await x_api.get_me(
            auth_type="oauth2",
            oauth2_token=request.access_token,
            user_id=request.user_id,
        )

        # If no x_user_id provided, use the one from the API response
        x_user_id = request.x_user_id or user_info.get("id")
        username = request.username or user_info.get("username")

        expires_at = None
        if request.expires_in:
            expires_at = time.time() + request.expires_in

        store = get_session_store()
        session = store.save_session(
            user_id=request.user_id,
            oauth2_token=request.access_token,
            oauth2_refresh_token=request.refresh_token,
            oauth2_expires_at=expires_at,
            x_user_id=x_user_id,
            username=username,
            auth_method="x_api",
        )

        cache = get_cache()
        cache.invalidate_user(request.user_id)

        return {
            "success": True,
            "user_id": session.user_id,
            "username": session.username,
            "x_user_id": session.x_user_id,
            "auth_method": "x_api",
            "message": "Authentication successful via X API v2",
        }

    except Exception as e:
        logger.error(f"OAuth 2.0 login failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"OAuth 2.0 authentication failed: {str(e)}",
        )


@router.post("/oauth2/authorize-url", response_model=dict)
async def get_oauth2_authorize_url(request: OAuth2AuthorizeRequest = None):
    """Generate OAuth 2.0 PKCE authorization URL."""
    if not settings.has_oauth2_credentials:
        raise HTTPException(
            status_code=400,
            detail="OAuth 2.0 is not configured. Set X_CLIENT_ID and X_CLIENT_SECRET.",
        )

    x_api = get_x_api_provider()
    pkce_pair = x_api.generate_pkce_pair()

    redirect_uri = None
    scope = None
    if request:
        redirect_uri = request.redirect_uri
        scope = request.scope

    authorize_url = x_api.get_oauth2_authorize_url(
        code_challenge=pkce_pair["code_challenge"],
        state=pkce_pair["state"],
        redirect_uri=redirect_uri,
        scope=scope,
    )

    return {
        "authorize_url": authorize_url,
        "code_verifier": pkce_pair["code_verifier"],
        "state": pkce_pair["state"],
    }


@router.post("/oauth2/callback", response_model=dict)
async def oauth2_callback(request: OAuth2CallbackRequest):
    """Process OAuth 2.0 callback - exchange code for tokens."""
    if not settings.has_oauth2_credentials:
        raise HTTPException(
            status_code=400,
            detail="OAuth 2.0 is not configured.",
        )

    try:
        x_api = get_x_api_provider()
        token_data = await x_api.exchange_oauth2_code(
            code=request.code,
            code_verifier=request.code_verifier,
            redirect_uri=request.redirect_uri,
        )

        return {
            "success": True,
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "token_type": token_data.get("token_type", "bearer"),
            "scope": token_data.get("scope"),
        }

    except Exception as e:
        logger.error(f"OAuth 2.0 callback failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"OAuth 2.0 token exchange failed: {str(e)}",
        )


@router.post("/oauth2/refresh", response_model=dict)
async def refresh_oauth2_token(refresh_token: str = Query(...)):
    """Refresh an OAuth 2.0 access token."""
    if not settings.has_oauth2_credentials:
        raise HTTPException(
            status_code=400,
            detail="OAuth 2.0 is not configured.",
        )

    try:
        x_api = get_x_api_provider()
        token_data = await x_api.refresh_oauth2_token(refresh_token)

        return {
            "success": True,
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
        }

    except Exception as e:
        logger.error(f"OAuth 2.0 token refresh failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Token refresh failed: {str(e)}",
        )


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(user_id: str = Query(None)):
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
        auth_method=session.auth_method,
        x_user_id=session.x_user_id,
        has_oauth2=bool(session.oauth2_token),
        has_cookies=bool(session.cookies),
        last_validated_at=session.last_validated_at,
    )


@router.post("/logout", response_model=dict)
async def logout(user_id: str = Query(...)):
    """Logout and clear session for a user."""
    store = get_session_store()
    deleted = store.delete_session(user_id)

    if deleted:
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


@router.get("/config", response_model=dict)
async def auth_config():
    """Get current auth configuration (non-sensitive info)."""
    return {
        "has_bearer_token": settings.has_bearer_token,
        "has_oauth1_credentials": settings.has_oauth1_credentials,
        "has_oauth2_credentials": settings.has_oauth2_credentials,
        "available_methods": _get_available_methods(),
    }


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


def _get_available_methods() -> list[str]:
    """Get list of available authentication methods."""
    methods = []
    if settings.has_bearer_token:
        methods.append("bearer")
    if settings.has_oauth1_credentials:
        methods.append("oauth1")
    if settings.has_oauth2_credentials:
        methods.append("oauth2")
    methods.append("twikit")  # Always available as fallback
    return methods
