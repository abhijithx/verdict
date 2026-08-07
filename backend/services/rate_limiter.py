"""
rate_limiter.py — Rate Limiting dependency for expensive AI API endpoints.
"""

import time
from collections import defaultdict
from fastapi import Request, HTTPException, status


class RateLimiter:
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)

    def check_rate_limit(self, client_ip: str):
        now = time.time()
        window_start = now - self.window_seconds
        self.requests[client_ip] = [t for t in self.requests[client_ip] if t > window_start]
        if len(self.requests[client_ip]) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Maximum 10 requests per minute permitted for AI endpoints."
            )
        self.requests[client_ip].append(now)


ai_rate_limiter = RateLimiter(max_requests=10, window_seconds=60)


async def check_ai_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "127.0.0.1"
    ai_rate_limiter.check_rate_limit(client_ip)
