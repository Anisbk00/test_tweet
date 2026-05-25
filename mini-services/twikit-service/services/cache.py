"""In-memory caching layer with TTL support."""

import time
import threading
from typing import Any, Optional
from dataclasses import dataclass, field

from config import settings


@dataclass
class CacheEntry:
    """A single cache entry with value, expiry time, and metadata."""

    value: Any
    expires_at: float
    created_at: float = field(default_factory=time.time)
    hit_count: int = 0


class MemoryCache:
    """Thread-safe in-memory cache with TTL and LRU eviction."""

    def __init__(self, ttl: int = None, max_size: int = None):
        self.ttl = ttl or settings.CACHE_TTL_SECONDS
        self.max_size = max_size or settings.CACHE_MAX_SIZE
        self._store: dict[str, CacheEntry] = {}
        self._lock = threading.RLock()

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a value from cache if it exists and hasn't expired."""
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.time() > entry.expires_at:
                del self._store[key]
                return None
            entry.hit_count += 1
            return entry.value

    def set(self, key: str, value: Any, ttl: int = None) -> None:
        """Store a value in cache with optional custom TTL."""
        with self._lock:
            effective_ttl = ttl if ttl is not None else self.ttl
            expires_at = time.time() + effective_ttl

            # Evict expired entries first
            self._evict_expired()

            # If at capacity, evict least recently used (lowest hit count, oldest)
            if len(self._store) >= self.max_size and key not in self._store:
                self._evict_lru()

            self._store[key] = CacheEntry(
                value=value,
                expires_at=expires_at,
            )

    def delete(self, key: str) -> bool:
        """Delete a specific key from cache. Returns True if key existed."""
        with self._lock:
            if key in self._store:
                del self._store[key]
                return True
            return False

    def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching a prefix pattern. Returns count of deleted keys."""
        with self._lock:
            keys_to_delete = [
                k for k in self._store if k.startswith(pattern)
            ]
            for key in keys_to_delete:
                del self._store[key]
            return len(keys_to_delete)

    def clear(self) -> None:
        """Clear all cache entries."""
        with self._lock:
            self._store.clear()

    def invalidate_user(self, user_id: str) -> int:
        """Invalidate all cache entries for a specific user."""
        return self.delete_pattern(f"{user_id}:")

    def stats(self) -> dict:
        """Get cache statistics."""
        with self._lock:
            total = len(self._store)
            expired = sum(
                1 for e in self._store.values() if time.time() > e.expires_at
            )
            return {
                "total_entries": total,
                "expired_entries": expired,
                "active_entries": total - expired,
                "max_size": self.max_size,
                "ttl_seconds": self.ttl,
            }

    def _evict_expired(self) -> None:
        """Remove all expired entries."""
        now = time.time()
        expired_keys = [
            k for k, v in self._store.items() if now > v.expires_at
        ]
        for key in expired_keys:
            del self._store[key]

    def _evict_lru(self) -> None:
        """Evict the least recently used entry (lowest hit count, oldest)."""
        if not self._store:
            return
        lru_key = min(
            self._store,
            key=lambda k: (self._store[k].hit_count, self._store[k].created_at),
        )
        del self._store[lru_key]


# Singleton cache instance
cache = MemoryCache()


def get_cache() -> MemoryCache:
    """Get the global cache instance."""
    return cache
