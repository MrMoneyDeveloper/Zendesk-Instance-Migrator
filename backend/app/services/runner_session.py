from __future__ import annotations

import hmac
import secrets
from datetime import UTC, datetime, timedelta
from threading import Lock

from app.core.settings import Settings


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _state_label(
    *,
    shutdown_requested: bool,
    execute_started_at: datetime | None,
    execute_finished_at: datetime | None,
    execute_status: str | None,
    session_token: str | None,
) -> str:
    if shutdown_requested:
        return "shutdown_requested"
    if execute_finished_at is not None:
        return "completed" if execute_status == "completed" else "failed"
    if execute_started_at is not None:
        return "running"
    if session_token is not None:
        return "approved"
    return "awaiting_approval"


def _numeric_pin(length: int) -> str:
    digits = [str(secrets.randbelow(10)) for _ in range(length)]
    return "".join(digits)


class RunnerSessionError(RuntimeError):
    pass


class RunnerSessionManager:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._lock = Lock()
        self._started_at = _utc_now()
        self._pin = _numeric_pin(settings.runner_pin_length)

        self._approved_once = False
        self._session_token: str | None = None
        self._session_expires_at: datetime | None = None
        self._approved_at: datetime | None = None
        self._execute_started_at: datetime | None = None
        self._execute_finished_at: datetime | None = None
        self._execute_status: str | None = None

        self._shutdown_requested = False
        self._shutdown_reason: str | None = None
        self._shutdown_requested_at: datetime | None = None

    @property
    def console_pin(self) -> str:
        return self._pin

    @property
    def configured_host(self) -> str:
        return self._settings.runner_host

    @property
    def configured_port(self) -> int:
        return self._settings.runner_port

    def approve(self, pin: str) -> tuple[str, datetime]:
        cleaned_pin = str(pin or "").strip()
        with self._lock:
            if self._approved_once:
                raise RunnerSessionError("This runner already issued its one allowed session.")
            if not hmac.compare_digest(cleaned_pin, self._pin):
                raise PermissionError("Invalid approval PIN.")

            now = _utc_now()
            token = secrets.token_urlsafe(48)
            expires_at = now + timedelta(seconds=self._settings.runner_session_ttl_seconds)

            self._approved_once = True
            self._session_token = token
            self._session_expires_at = expires_at
            self._approved_at = now
            return token, expires_at

    def require_token(self, value: str | None) -> None:
        token = str(value or "").strip()
        with self._lock:
            if not token:
                raise PermissionError("Missing session token.")
            if self._session_token is None:
                raise PermissionError("Session is not approved.")
            if not hmac.compare_digest(token, self._session_token):
                raise PermissionError("Invalid session token.")

            now = _utc_now()
            if self._session_expires_at is None or now >= self._session_expires_at:
                self._session_token = None
                raise PermissionError("Session token expired.")

    def mark_execute_started(self) -> None:
        with self._lock:
            now = _utc_now()
            self._execute_started_at = now
            self._execute_finished_at = None
            self._execute_status = None

    def mark_execute_finished(self, status: str) -> None:
        with self._lock:
            now = _utc_now()
            self._execute_finished_at = now
            self._execute_status = status
            self._session_token = None
            self._session_expires_at = None
            self._shutdown_requested = True
            self._shutdown_reason = f"execute_{status}"
            self._shutdown_requested_at = now

    def request_shutdown(self, reason: str) -> None:
        with self._lock:
            if self._shutdown_requested:
                return
            now = _utc_now()
            self._shutdown_requested = True
            self._shutdown_reason = reason
            self._shutdown_requested_at = now

    def get_shutdown_reason_if_due(self) -> str | None:
        with self._lock:
            now = _utc_now()
            if self._shutdown_requested:
                reason = self._shutdown_reason or "shutdown_requested"
                if (
                    self._shutdown_requested_at is not None
                    and reason.startswith("execute_")
                ):
                    delay = timedelta(seconds=self._settings.runner_shutdown_delay_seconds)
                    if now < self._shutdown_requested_at + delay:
                        return None
                return reason

            if self._session_token and self._session_expires_at and now >= self._session_expires_at:
                self._shutdown_requested = True
                self._shutdown_reason = "session_expired"
                self._shutdown_requested_at = now
                self._session_token = None
                return self._shutdown_reason

            if (
                self._approved_once
                and self._session_token is None
                and self._execute_started_at is None
                and self._approved_at is not None
            ):
                approval_deadline = self._approved_at + timedelta(seconds=self._settings.runner_session_ttl_seconds)
                if now >= approval_deadline:
                    self._shutdown_requested = True
                    self._shutdown_reason = "session_expired"
                    self._shutdown_requested_at = now
                    return self._shutdown_reason

            if self._session_token is None and self._execute_started_at is None:
                idle_deadline = self._started_at + timedelta(seconds=self._settings.runner_idle_timeout_seconds)
                if now >= idle_deadline:
                    self._shutdown_requested = True
                    self._shutdown_reason = "approval_timeout"
                    self._shutdown_requested_at = now
                    return self._shutdown_reason

            return None

    def health_payload(self) -> dict:
        with self._lock:
            return {
                "service": "instance-config-migrator-runner",
                "version": "3.0",
                "runner": {
                    "host": self._settings.runner_host,
                    "port": self._settings.runner_port,
                    "started_at": _iso(self._started_at),
                    "state": _state_label(
                        shutdown_requested=self._shutdown_requested,
                        execute_started_at=self._execute_started_at,
                        execute_finished_at=self._execute_finished_at,
                        execute_status=self._execute_status,
                        session_token=self._session_token,
                    ),
                    "approved_once": self._approved_once,
                    "session_active": self._session_token is not None,
                    "session_expires_at": _iso(self._session_expires_at),
                    "execute_started_at": _iso(self._execute_started_at),
                    "execute_finished_at": _iso(self._execute_finished_at),
                    "shutdown_requested": self._shutdown_requested,
                    "shutdown_reason": self._shutdown_reason,
                },
            }
