"""Configuration module for the Twikit service."""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "3031"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # Twitter Auth Cookies
    TWITTER_AUTH_TOKEN: str = os.getenv("TWITTER_AUTH_TOKEN", "")
    TWITTER_CT0: str = os.getenv("TWITTER_CT0", "")
    TWITTER_GUEST_ID: str = os.getenv("TWITTER_GUEST_ID", "")

    # Rate Limiting
    RATE_LIMIT_REQUESTS: int = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
    RATE_LIMIT_WINDOW_SECONDS: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

    # Caching
    CACHE_TTL_SECONDS: int = int(os.getenv("CACHE_TTL_SECONDS", "300"))
    CACHE_MAX_SIZE: int = int(os.getenv("CACHE_MAX_SIZE", "1000"))

    # Sync
    SYNC_BATCH_SIZE: int = int(os.getenv("SYNC_BATCH_SIZE", "100"))
    SYNC_MAX_RETRIES: int = int(os.getenv("SYNC_MAX_RETRIES", "3"))
    SYNC_RETRY_DELAY_SECONDS: int = int(os.getenv("SYNC_RETRY_DELAY_SECONDS", "5"))

    # Default Pagination
    DEFAULT_PAGE_LIMIT: int = int(os.getenv("DEFAULT_PAGE_LIMIT", "20"))
    MAX_PAGE_LIMIT: int = int(os.getenv("MAX_PAGE_LIMIT", "100"))

    # Twikit
    TWIKIT_API_DELAY: float = float(os.getenv("TWIKIT_API_DELAY", "1.0"))
    TWIKIT_MAX_RETRIES: int = int(os.getenv("TWIKIT_MAX_RETRIES", "3"))


settings = Settings()
