import threading
import time
from collections import deque
from collections.abc import Callable


class LoginRateLimiter:
    """In-process limit of failed login attempts per IP within a sliding window."""

    def __init__(
        self,
        max_failures: int = 5,
        window_seconds: float = 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, ip: str, now: float) -> deque[float] | None:
        failures = self._failures.get(ip)
        if failures is None:
            return None
        while failures and failures[0] <= now - self.window_seconds:
            failures.popleft()
        if not failures:
            del self._failures[ip]
            return None
        return failures

    def is_blocked(self, ip: str) -> bool:
        with self._lock:
            failures = self._prune(ip, self._clock())
            return failures is not None and len(failures) >= self.max_failures

    def record_failure(self, ip: str) -> None:
        with self._lock:
            now = self._clock()
            self._prune(ip, now)
            self._failures.setdefault(ip, deque()).append(now)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()


login_rate_limiter = LoginRateLimiter()
