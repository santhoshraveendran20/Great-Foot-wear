"""Simple in-process sliding-window rate limiter for login / OTP endpoints (NF-04).
For multi-process deployments, swap the store for Redis."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.core.deps import client_ip

_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def rate_limit(name: str, limit: int, window_seconds: int):
    def dependency(request: Request) -> None:
        key = f"{name}:{client_ip(request)}"
        now = time.monotonic()
        with _lock:
            q = _hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Please try again later.")
            q.append(now)

    return dependency
