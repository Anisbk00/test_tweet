"""FastAPI application for the Twitter data service - X API v2 primary + Twikit fallback."""

import logging
import time
from collections import defaultdict
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

from config import settings
from services.cache import get_cache
from services.queue import get_queue

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Twitter Data Service",
    description="X/Twitter data retrieval service using X API v2 (primary) + Twikit (fallback)",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Rate Limiting Middleware ---

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiting middleware."""

    def __init__(self, app, max_requests: int = 60, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health check
        if request.url.path == "/health":
            return await call_next(request)

        # Get client identifier (IP address)
        client_id = request.client.host if request.client else "unknown"

        # Also check X-Forwarded-For for proxied requests
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_id = forwarded.split(",")[0].strip()

        now = time.time()

        # Clean old requests outside window
        self._requests[client_id] = [
            t for t in self._requests[client_id]
            if now - t < self.window_seconds
        ]

        # Check rate limit
        if len(self._requests[client_id]) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Rate limit exceeded",
                    "retry_after": self.window_seconds,
                    "detail": f"Maximum {self.max_requests} requests per {self.window_seconds} seconds",
                },
            )

        # Record this request
        self._requests[client_id].append(now)

        return await call_next(request)


# Add rate limiting middleware
app.add_middleware(
    RateLimitMiddleware,
    max_requests=settings.RATE_LIMIT_REQUESTS,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


# --- Request Logging Middleware ---

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests with timing information."""
    start_time = time.time()
    request_id = f"{int(start_time * 1000)}"

    logger.info(
        f"[{request_id}] {request.method} {request.url.path} - Started"
    )

    try:
        response = await call_next(request)
        duration_ms = (time.time() - start_time) * 1000
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} - "
            f"Completed {response.status_code} in {duration_ms:.1f}ms"
        )
        return response
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        logger.error(
            f"[{request_id}] {request.method} {request.url.path} - "
            f"Failed in {duration_ms:.1f}ms: {e}"
        )
        raise


# --- Exception Handlers ---

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with consistent error format."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code,
            "path": str(request.url.path),
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "status_code": 500,
            "path": str(request.url.path),
        },
    )


# --- Include Routers ---

from auth import router as auth_router
from routes.bookmarks import router as bookmarks_router
from routes.timeline import router as timeline_router
from routes.media import router as media_router
from routes.lists import router as lists_router
from routes.network import router as network_router

app.include_router(auth_router)
app.include_router(bookmarks_router)
app.include_router(timeline_router)
app.include_router(media_router)
app.include_router(lists_router)
app.include_router(network_router)


# --- Health Check ---

@app.get("/health")
async def health_check():
    """Health check endpoint with provider status."""
    cache = get_cache()
    queue = get_queue()

    return {
        "status": "healthy",
        "service": "twitter-data-service",
        "version": "2.0.0",
        "providers": {
            "x_api": {
                "bearer_token": settings.has_bearer_token,
                "oauth1": settings.has_oauth1_credentials,
                "oauth2": settings.has_oauth2_credentials,
            },
            "twikit": True,  # Always available as fallback
        },
        "cache_stats": cache.stats(),
        "queue_running": queue._running,
    }


@app.get("/")
async def root():
    """Root endpoint - service info."""
    return {
        "service": "twitter-data-service",
        "version": "2.0.0",
        "description": "X/Twitter data retrieval using X API v2 (primary) + Twikit (fallback)",
        "docs": "/docs",
        "health": "/health",
        "providers": {
            "x_api": {
                "bearer_token": settings.has_bearer_token,
                "oauth1": settings.has_oauth1_credentials,
                "oauth2": settings.has_oauth2_credentials,
            },
            "twikit": True,
        },
    }


# --- Lifecycle Events ---

@app.on_event("startup")
async def startup_event():
    """Run on application startup."""
    logger.info("Twitter data service starting up...")
    logger.info(f"X API Bearer Token: {'configured' if settings.has_bearer_token else 'not configured'}")
    logger.info(f"X API OAuth 1.0a: {'configured' if settings.has_oauth1_credentials else 'not configured'}")
    logger.info(f"X API OAuth 2.0: {'configured' if settings.has_oauth2_credentials else 'not configured'}")
    logger.info(f"Twikit: always available as fallback")

    queue = get_queue()
    queue.start()
    logger.info("Background queue worker started")


@app.on_event("shutdown")
async def shutdown_event():
    """Run on application shutdown."""
    logger.info("Twitter data service shutting down...")
    queue = get_queue()
    queue.stop()
    logger.info("Background queue worker stopped")
