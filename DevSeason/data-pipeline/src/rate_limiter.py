"""
Simple rate limiter for GRID API requests.
"""
import time
from typing import Optional


class RateLimiter:
    """Rate limiter that enforces minimum delay between calls."""

    def __init__(self, min_delay_seconds: float, name: str = "RateLimiter"):
        """
        Args:
            min_delay_seconds: Minimum seconds between calls
            name: Name for logging purposes
        """
        self.min_delay = min_delay_seconds
        self.name = name
        self.last_call: Optional[float] = None

    def wait(self):
        """Wait if necessary to enforce rate limit."""
        if self.last_call is None:
            self.last_call = time.time()
            return

        elapsed = time.time() - self.last_call
        if elapsed < self.min_delay:
            sleep_time = self.min_delay - elapsed
            time.sleep(sleep_time)

        self.last_call = time.time()
