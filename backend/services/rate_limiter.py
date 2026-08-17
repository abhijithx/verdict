"""
rate_limiter.py — Rate Limiting dependency for expensive AI API endpoints.
"""

import time
from collections import defaultdict
from fastapi import Request, HTTPException, status


class RateLimiter:
    def __init__(self, max_requests: int = 15, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self._last_cleanup = time.time()

    def _cleanup_old_entries(self, now: float):
        """Periodically clean up IP entries that have no recent requests."""
        if now - self._last_cleanup > 300:  # Every 5 minutes
            window_start = now - self.window_seconds
            empty_ips = [
                ip for ip, timestamps in self.requests.items()
                if not timestamps or timestamps[-1] <= window_start
            ]
            for ip in empty_ips:
                del self.requests[ip]
            self._last_cleanup = now

    def check_rate_limit(self, client_ip: str):
        now = time.time()
        self._cleanup_old_entries(now)
        
        window_start = now - self.window_seconds
        self.requests[client_ip] = [t for t in self.requests[client_ip] if t > window_start]
        if len(self.requests[client_ip]) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Maximum {self.max_requests} requests per minute permitted for AI endpoints."
            )
        self.requests[client_ip].append(now)


ai_rate_limiter = RateLimiter(max_requests=15, window_seconds=60)


def extract_client_ip(request: Request) -> str:
    """Extract client IP respecting X-Forwarded-For / X-Real-IP if present."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # First IP in comma-separated list is the original client
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


async def check_ai_rate_limit(request: Request):
    client_ip = extract_client_ip(request)
    ai_rate_limiter.check_rate_limit(client_ip)
