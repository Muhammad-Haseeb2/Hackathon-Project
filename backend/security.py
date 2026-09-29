"""
Security module — rate limiting, API key validation, audit logging, secure headers.
All state is in-memory only (no persistent disk).
"""

import os
import time
import secrets
import hashlib
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


# ── In-memory sliding-window rate limiter ────────────────────────────────────

class RateLimiter:
    """
    Sliding window rate limiter per IP address.
    Stored entirely in memory — no Redis needed.
    """

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, deque] = {}  # IP -> deque of timestamps

    def _clean_window(self, ip: str) -> None:
        """Remove timestamps outside the current window."""
        if ip not in self._requests:
            return
        cutoff = time.time() - self.window_seconds
        while self._requests[ip] and self._requests[ip][0] < cutoff:
            self._requests[ip].popleft()
        if not self._requests[ip]:
            del self._requests[ip]

    def is_rate_limited(self, ip: str) -> bool:
        """Check if IP has exceeded the rate limit."""
        self._clean_window(ip)
        if ip in self._requests and len(self._requests[ip]) >= self.max_requests:
            return True
        return False

    def record_request(self, ip: str) -> None:
        """Record a request from this IP."""
        if ip not in self._requests:
            self._requests[ip] = deque()
        self._requests[ip].append(time.time())

    def get_remaining(self, ip: str) -> int:
        """Get remaining requests in the current window."""
        self._clean_window(ip)
        used = len(self._requests.get(ip, deque()))
        return max(0, self.max_requests - used)

    def get_status(self) -> dict:
        """Get current rate limiter status."""
        now = time.time()
        active_ips = 0
        for ip in list(self._requests.keys()):
            self._clean_window(ip)
            if ip in self._requests:
                active_ips += 1
        return {
            'active_ips': active_ips,
            'max_requests_per_window': self.max_requests,
            'window_seconds': self.window_seconds,
        }


# Global rate limiter instance
rate_limiter = RateLimiter(max_requests=60, window_seconds=60)


# ── Ephemeral Audit Logger ───────────────────────────────────────────────────

class AuditLogger:
    """
    In-memory audit log with sliding window.
    Captures generation events with zero PII retention.
    Max 1000 entries kept in memory.
    """

    def __init__(self, max_entries: int = 1000):
        self.max_entries = max_entries
        self._log: deque = deque(maxlen=max_entries)

    def log_event(
        self,
        endpoint: str,
        row_count: int = 0,
        privacy_noise: bool = False,
        execution_time_ms: float = 0,
        ip: str = "",
        status: str = "success",
        extra: Optional[dict] = None,
    ) -> None:
        """Log a generation event."""
        entry = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'endpoint': endpoint,
            'row_count': row_count,
            'privacy_noise_enabled': privacy_noise,
            'execution_time_ms': round(execution_time_ms, 2),
            'ip_hash': hashlib.sha256(ip.encode()).hexdigest()[:12] if ip else '',
            'status': status,
        }
        if extra:
            entry.update(extra)
        self._log.append(entry)

    def get_recent(self, n: int = 50) -> list[dict]:
        """Get the N most recent log entries."""
        entries = list(self._log)
        return entries[-n:]

    def get_stats(self) -> dict:
        """Get aggregate statistics from the audit log."""
        entries = list(self._log)
        if not entries:
            return {
                'total_events': 0,
                'total_rows_generated': 0,
                'avg_execution_time_ms': 0,
                'privacy_noise_usage_pct': 0,
            }

        total_rows = sum(e.get('row_count', 0) for e in entries)
        exec_times = [e.get('execution_time_ms', 0) for e in entries]
        noise_count = sum(1 for e in entries if e.get('privacy_noise_enabled'))

        return {
            'total_events': len(entries),
            'total_rows_generated': total_rows,
            'avg_execution_time_ms': round(sum(exec_times) / len(exec_times), 2),
            'privacy_noise_usage_pct': round(noise_count / len(entries) * 100, 1),
        }

    def clear(self) -> None:
        """Clear the audit log."""
        self._log.clear()


# Global audit logger instance
audit_logger = AuditLogger()


# ── API Key Management ───────────────────────────────────────────────────────

class APIKeyManager:
    """
    In-memory API key manager for developer/test keys.
    Keys are prefixed with sk_test_ for clarity.
    """

    def __init__(self):
        self._keys: dict[str, dict] = {}  # key_string -> metadata

    def generate_key(self, label: str = "default") -> dict:
        """Generate a new test API key."""
        raw = secrets.token_hex(16)
        key = f"sk_test_{raw}"
        meta = {
            'key': key,
            'label': label,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'requests_made': 0,
            'active': True,
        }
        self._keys[key] = meta
        return meta

    def validate_key(self, key: str) -> bool:
        """Check if a key is valid and active."""
        if key in self._keys:
            return self._keys[key].get('active', False)
        return False

    def record_usage(self, key: str) -> None:
        """Record that a key was used."""
        if key in self._keys:
            self._keys[key]['requests_made'] += 1

    def revoke_key(self, key: str) -> bool:
        """Revoke (deactivate) an API key."""
        if key in self._keys:
            self._keys[key]['active'] = False
            return True
        return False

    def list_keys(self) -> list[dict]:
        """List all keys (masked for display)."""
        result = []
        for key, meta in self._keys.items():
            display = {
                'key_preview': key[:12] + '...' + key[-4:],
                'key_full': key,
                'label': meta['label'],
                'created_at': meta['created_at'],
                'requests_made': meta['requests_made'],
                'active': meta['active'],
            }
            result.append(display)
        return result


# Global API key manager
api_key_manager = APIKeyManager()


# ── Admin Authentication ─────────────────────────────────────────────────────

def verify_admin(secret: str) -> bool:
    """Verify admin secret key with dev fallback."""
    admin_key = os.environ.get('ADMIN_SECRET_KEY', '') or 'admin123'
    return secrets.compare_digest(secret, admin_key)


# ── Middleware: Rate Limiting ────────────────────────────────────────────────

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Apply rate limiting to API endpoints."""

    async def dispatch(self, request: Request, call_next):
        # Only rate-limit /api/ endpoints (not static files)
        if request.url.path.startswith('/api/'):
            ip = request.client.host if request.client else '0.0.0.0'

            if rate_limiter.is_rate_limited(ip):
                return JSONResponse(
                    status_code=429,
                    content={
                        'detail': 'Rate limit exceeded. Please wait and try again.',
                        'retry_after_seconds': rate_limiter.window_seconds,
                    },
                )

            rate_limiter.record_request(ip)

        response = await call_next(request)
        return response


# ── Middleware: Secure Headers ───────────────────────────────────────────────

class SecureHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        # CSP - allow inline styles for Tailwind, self for scripts
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "connect-src 'self'"
        )
        return response


# ── Input Sanitization ───────────────────────────────────────────────────────

def sanitize_string(value: str, max_length: int = 1000) -> str:
    """Basic input sanitization."""
    if not isinstance(value, str):
        return str(value)[:max_length]
    # Strip null bytes and limit length
    return value.replace('\x00', '').strip()[:max_length]


def validate_row_count(count: int) -> int:
    """Validate and clamp row count."""
    return max(1, min(count, 50000))


def validate_file_size(size: int, max_mb: float = 5.0) -> bool:
    """Check if file size is within limits."""
    return size <= max_mb * 1024 * 1024
