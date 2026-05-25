"""Configuration module for the Twitter data service."""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "3031"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # X API v2 Credentials (Primary Method)
    X_API_BEARER_TOKEN: str = os.getenv("X_API_BEARER_TOKEN", "")
    X_API_KEY: str = os.getenv("X_API_KEY", "")
    X_API_KEY_SECRET: str = os.getenv("X_API_KEY_SECRET", "")
    X_ACCESS_TOKEN: str = os.getenv("X_ACCESS_TOKEN", "")
    X_ACCESS_TOKEN_SECRET: str = os.getenv("X_ACCESS_TOKEN_SECRET", "")

    # OAuth 2.0
    X_CLIENT_ID: str = os.getenv("X_CLIENT_ID", "")
    X_CLIENT_SECRET: str = os.getenv("X_CLIENT_SECRET", "")

    # Twitter Auth Cookies (Twikit fallback)
    TWITTER_AUTH_TOKEN: str = os.getenv("TWITTER_AUTH_TOKEN", "")
    TWITTER_CT0: str = os.getenv("TWITTER_CT0", "")

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

    # X API
    X_API_BASE_URL: str = "https://api.twitter.com/2"
    X_API_DELAY: float = float(os.getenv("X_API_DELAY", "0.5"))
    X_API_MAX_RETRIES: int = int(os.getenv("X_API_MAX_RETRIES", "3"))

    @property
    def has_oauth1_credentials(self) -> bool:
        """Check if OAuth 1.0a credentials are configured."""
        return bool(
            self.X_API_KEY
            and self.X_ACCESS_TOKEN
            and self.X_ACCESS_TOKEN_SECRET
        )

    @property
    def has_bearer_token(self) -> bool:
        """Check if Bearer Token is configured."""
        return bool(self.X_API_BEARER_TOKEN)

    @property
    def has_oauth2_credentials(self) -> bool:
        """Check if OAuth 2.0 credentials are configured."""
        return bool(self.X_CLIENT_ID and self.X_CLIENT_SECRET)


settings = Settings()
