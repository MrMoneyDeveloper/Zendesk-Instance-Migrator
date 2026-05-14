import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


def _as_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _as_float(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value.strip())
    except ValueError:
        return default


def _as_csv(value: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    if not value:
        return default
    parts = tuple(part.strip() for part in value.split(",") if part.strip())
    return parts or default


@dataclass(frozen=True)
class Settings:
    app_name: str
    runner_host: str
    runner_port: int
    runner_pin_length: int
    runner_session_ttl_seconds: int
    runner_idle_timeout_seconds: int
    runner_shutdown_delay_seconds: float
    local_dev_origins: tuple[str, ...]
    request_timeout_seconds: float
    request_retries: int
    request_backoff_ms: int


@lru_cache
def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("APP_NAME", "Instance Config Migrator Local Runner").strip(),
        runner_host=os.getenv("RUNNER_HOST", "127.0.0.1").strip() or "127.0.0.1",
        runner_port=max(_as_int(os.getenv("RUNNER_PORT"), 8765), 1),
        runner_pin_length=min(max(_as_int(os.getenv("RUNNER_PIN_LENGTH"), 6), 4), 12),
        runner_session_ttl_seconds=max(_as_int(os.getenv("RUNNER_SESSION_TTL_SECONDS"), 1200), 60),
        runner_idle_timeout_seconds=max(_as_int(os.getenv("RUNNER_IDLE_TIMEOUT_SECONDS"), 900), 60),
        runner_shutdown_delay_seconds=max(_as_float(os.getenv("RUNNER_SHUTDOWN_DELAY_SECONDS"), 2.0), 0.1),
        local_dev_origins=_as_csv(
            os.getenv("LOCAL_DEV_ORIGINS"),
            ("http://localhost:5173", "http://127.0.0.1:5173"),
        ),
        request_timeout_seconds=max(_as_float(os.getenv("REQUEST_TIMEOUT_SECONDS"), 45.0), 5.0),
        request_retries=max(_as_int(os.getenv("REQUEST_RETRIES"), 4), 0),
        request_backoff_ms=max(_as_int(os.getenv("REQUEST_BACKOFF_MS"), 400), 50),
    )
